#!/usr/bin/env python3
"""
Sobe cartas para o bucket `cards` e grava as linhas na tabela `cards`,
direto da sua máquina — sem passar pelo painel admin.

Faz o caminho inteiro para cada linha do arquivo:

  1. resolve o link do Google Photos (photos.app.goo.gl) para a URL direta
     da imagem em lh3.googleusercontent.com;
  2. baixa a imagem;
  3. sobe para o bucket público `cards` do Supabase;
  4. faz UPSERT da carta na tabela `cards` (conflito por import_ref).

O nome do arquivo no bucket segue exatamente a mesma convenção do endpoint
/api/admin-add-cards-by-link — slug do nome + 10 primeiros hex do SHA-256
da URL da imagem — para que os dois caminhos produzam o mesmo import_ref e
uma carta já existente seja atualizada em vez de duplicada.

Entrada: um arquivo por tipo, uma carta por linha, no formato

    Nome da carta | link

Linhas vazias e começadas com "#" são ignoradas.

Requisitos: Python 3.8+ e o pacote `requests` (pip install requests).

A service-role key fica em: Supabase → Project Settings → API → service_role.
NUNCA commite essa chave; passe sempre por variável de ambiente.

Uso (macOS/Linux):

    export SB_SERVICE_ROLE_KEY="sua-service-role-key"
    python scripts/upload_cards_from_links.py scripts/cards/novas-2026-09-11-foil.txt

Uso (Windows PowerShell):

    $env:SB_SERVICE_ROLE_KEY="sua-service-role-key"
    python scripts/upload_cards_from_links.py scripts/cards/novas-2026-09-11-foil.txt

O tipo (Foil / Holo / Normal) é deduzido do nome do arquivo; use --type para
informar explicitamente.

O script é retomável: cada carta concluída é registrada em um arquivo de
estado (por padrão .upload-state.jsonl ao lado do arquivo de entrada) e é
pulada nas execuções seguintes. Pode interromper com Ctrl+C e rodar de novo.

Ao final, as linhas que falharam são gravadas em <entrada>.falhas.txt, no
mesmo formato de entrada, prontas para uma nova tentativa:

    python scripts/upload_cards_from_links.py scripts/cards/novas-...-foil.txt.falhas.txt --type Foil
"""

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

try:
    import requests
except ImportError:
    print("Este script precisa do pacote 'requests'. Instale com: pip install requests", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_google_photos_links import is_google_photos_link, resolve_image_url  # noqa: E402

SB_URL = os.environ.get("SB_URL", "https://kjyqnlpiohoewmqmsuxp.supabase.co")
BUCKET = os.environ.get("SB_BUCKET", "cards")
STORAGE_BASE = f"{SB_URL}/storage/v1/object/public/{BUCKET}/"
MAX_BYTES = 8 * 1024 * 1024

EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def die(msg):
    print("ERRO: " + msg, file=sys.stderr)
    sys.exit(1)


def clean_name(name):
    """Mesmo cleanName de shared/cardImport.js: decodifica entidades e tira
    os sufixos de marketing do fornecedor."""
    n = html.unescape(str(name or ""))
    n = re.sub(r"\s*MTG\s*Proxy\s*Cards?\s*$", "", n, flags=re.I)
    n = re.sub(r"\s*MTG\s*Cards?\s*$", "", n, flags=re.I)
    return n.strip()


def slugify(value):
    """Mesmo slugify de shared/cardImport.js, inclusive o corte em 80 chars."""
    s = unicodedata.normalize("NFD", str(value or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s[:80] or "carta"


def short_hash(text):
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()[:10]


def ext_from_url(url):
    try:
        path = requests.utils.urlparse(url).path.lower()
    except Exception:
        return None
    m = re.search(r"\.(jpe?g|png|webp|gif)$", path)
    if not m:
        return None
    return ".jpg" if m.group(0) == ".jpeg" else m.group(0)


def type_from_filename(path):
    stem = Path(path).name.lower()
    if "foil" in stem:
        return "Foil"
    if "holo" in stem:
        return "Holo"
    if "normal" in stem or "regular" in stem:
        return "Normal"
    return None


def read_lines(path):
    """Arquivo -> [(nome, link)], ignorando vazias e comentários."""
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "|" not in line:
                print(f"  ignorada (sem '|'): {line[:70]}", file=sys.stderr)
                continue
            name, _, url = line.partition("|")
            name, url = clean_name(name.strip()), url.strip()
            if name and url:
                out.append((name, url))
    return out


def fetch_image(session, url, timeout):
    res = session.get(url, headers={"User-Agent": UA, "Accept": "image/*"}, timeout=timeout)
    if res.status_code != 200:
        raise ValueError(f"HTTP {res.status_code} ao baixar imagem")
    content_type = (res.headers.get("content-type") or "").split(";")[0].strip().lower()
    if not content_type.startswith("image/"):
        raise ValueError(f"conteúdo não é imagem ({content_type or 'desconhecido'})")
    buf = res.content
    if not buf:
        raise ValueError("imagem vazia")
    if len(buf) > MAX_BYTES:
        raise ValueError(f"imagem excede 8MB ({len(buf) // 1024} KB)")
    ext = EXT_BY_MIME.get(content_type) or ext_from_url(url) or ".jpg"
    out_type = content_type if content_type in EXT_BY_MIME else "image/jpeg"
    return buf, out_type, ext


def upload_to_storage(session, key, filename, buf, content_type, timeout):
    res = session.post(
        f"{SB_URL}/storage/v1/object/{BUCKET}/{requests.utils.quote(filename, safe='')}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        data=buf,
        timeout=timeout,
    )
    if not res.ok:
        raise ValueError(f"falha no upload do storage: {res.status_code} {res.text[:160]}")


def upsert_card(session, key, card, timeout):
    res = session.post(
        f"{SB_URL}/rest/v1/cards?on_conflict=import_ref",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        data=json.dumps([card]),
        timeout=timeout,
    )
    if not res.ok:
        raise ValueError(f"falha ao salvar no banco: {res.status_code} {res.text[:160]}")


def load_state(path):
    done = set()
    if not path.exists():
        return done
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                done.add(json.loads(line)["src_url"])
            except Exception:
                continue
    return done


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("arquivo", help="arquivo com 'Nome da carta | link' por linha")
    ap.add_argument("--type", choices=["Foil", "Holo", "Normal"], help="tipo da carta (padrão: deduzido do nome do arquivo)")
    ap.add_argument("--tcg", default="Magic", help="TCG gravado na carta (padrão: Magic)")
    ap.add_argument("--size", type=int, default=2048, help="tamanho pedido ao Google Photos, em pixels (padrão: 2048)")
    ap.add_argument("--delay", type=float, default=0.5, help="espera entre cartas, em segundos (padrão: 0.5)")
    ap.add_argument("--timeout", type=int, default=60, help="timeout de rede por requisição, em segundos (padrão: 60)")
    ap.add_argument("--state", help="arquivo de estado para retomada (padrão: <entrada>.state.jsonl)")
    ap.add_argument("--dry-run", action="store_true", help="só mostra o que faria; não baixa, não sobe, não grava")
    args = ap.parse_args()

    tipo = args.type or type_from_filename(args.arquivo)
    if not tipo:
        die("não consegui deduzir o tipo pelo nome do arquivo. Informe --type Foil|Holo|Normal.")

    key = os.environ.get("SB_SERVICE_ROLE_KEY")
    if not key and not args.dry_run:
        die("defina a variável de ambiente SB_SERVICE_ROLE_KEY (Supabase → Project Settings → API → service_role).")

    entrada = Path(args.arquivo)
    if not entrada.exists():
        die(f"arquivo não encontrado: {entrada}")

    itens = read_lines(entrada)
    if not itens:
        die("nenhuma carta válida no arquivo.")

    state_path = Path(args.state) if args.state else Path(str(entrada) + ".state.jsonl")
    ja_feitas = load_state(state_path)
    pendentes = [(n, u) for n, u in itens if u not in ja_feitas]

    print(f"arquivo   : {entrada}")
    print(f"tipo      : {tipo} · tcg: {args.tcg}")
    print(f"cartas    : {len(itens)} no arquivo · {len(ja_feitas & {u for _, u in itens})} já feitas · {len(pendentes)} a fazer")
    print(f"estado    : {state_path}")
    if args.dry_run:
        print("\n--dry-run: nada será baixado, subido ou gravado.\n")
        for nome, url in pendentes[:10]:
            print(f"  {tipo:6} | {nome[:56]:58} | {url[:48]}")
        if len(pendentes) > 10:
            print(f"  … e mais {len(pendentes) - 10}")
        return 0
    print()

    session = requests.Session()
    falhas = []
    ok = 0

    try:
        for i, (nome, url) in enumerate(pendentes, 1):
            prefixo = f"[{i}/{len(pendentes)}]"
            try:
                img_url = resolve_image_url(url, size=args.size, timeout=args.timeout) if is_google_photos_link(url) else url
                buf, content_type, ext = fetch_image(session, img_url, args.timeout)
                filename = f"{slugify(nome)}-{short_hash(img_url)}{ext}"
                upload_to_storage(session, key, filename, buf, content_type, args.timeout)
                card = {
                    "name": nome,
                    "type": tipo,
                    "tcg": args.tcg,
                    "is_active": True,
                    "image_url": STORAGE_BASE + filename,
                    "import_ref": filename,
                }
                upsert_card(session, key, card, args.timeout)
                with open(state_path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"src_url": url, "name": nome, "import_ref": filename}, ensure_ascii=False) + "\n")
                ok += 1
                print(f"{prefixo} ok   {nome[:60]}  ({len(buf) // 1024} KB)")
            except Exception as e:
                falhas.append((nome, url, str(e)))
                print(f"{prefixo} FALHA {nome[:60]}: {e}", file=sys.stderr)
            if args.delay > 0:
                time.sleep(args.delay)
    except KeyboardInterrupt:
        print("\ninterrompido — o progresso está salvo, rode de novo para continuar.", file=sys.stderr)

    print(f"\nsubidas: {ok} · falhas: {len(falhas)}")
    if falhas:
        fpath = Path(str(entrada) + ".falhas.txt")
        with open(fpath, "w", encoding="utf-8") as fh:
            fh.write(f"# Falhas de {entrada.name} — reexecute apontando para este arquivo.\n")
            fh.write(f"# Tipo: {tipo}\n")
            for nome, url, err in falhas:
                fh.write(f"# motivo: {err}\n{nome} | {url}\n")
        print(f"falhas gravadas em {fpath}")
        print(f"para tentar de novo:\n  python {Path(__file__).name} {fpath} --type {tipo} --delay 2")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
