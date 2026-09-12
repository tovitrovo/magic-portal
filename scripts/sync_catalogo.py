#!/usr/bin/env python3
"""
Sincroniza o catálogo do portal com a planilha do fornecedor, em um comando.

O que ele faz, nesta ordem:

  1. lê a planilha .xlsx, inclusive os links embutidos nas células;
  2. lê o catálogo ativo direto do Supabase;
  3. compara os dois e mostra quantas cartas entram e quantas saem;
  4. pede sua confirmação;
  5. sobe as cartas novas (resolve o link do Google Photos, baixa a imagem,
     manda para o bucket `cards` e grava a carta no banco);
  6. desativa as cartas ativas que não estão mais na planilha, guardando a
     lista para poder desfazer.

Nada é apagado: sair do catálogo é `is_active = false`, reversível.

Requisitos: Python 3.8+ e o pacote `requests` (pip install requests).
A leitura do .xlsx usa só a biblioteca padrão — não precisa de openpyxl.

Antes de rodar, exporte a planilha do Google Sheets como .xlsx:
Arquivo → Fazer download → Microsoft Excel (.xlsx)

Uso (Windows PowerShell):

    $env:SB_SERVICE_ROLE_KEY="sua-service-role-key"
    py scripts\\sync_catalogo.py "C:\\Users\\voce\\Downloads\\planilha.xlsx"

Uso (macOS/Linux):

    export SB_SERVICE_ROLE_KEY="sua-service-role-key"
    python3 scripts/sync_catalogo.py ~/Downloads/planilha.xlsx

Opções úteis:

  --dry-run     só mostra o relatório; não sobe nem desativa nada
  --so-novas    sobe as cartas novas e não desativa nada
  --sim         pula a pergunta de confirmação (para uso automatizado)
  --delay N     segundos de espera entre cartas (padrão: 0.5)

O script é retomável: cada carta concluída vai para um arquivo de estado
ao lado da planilha e é pulada se você rodar de novo. Pode interromper com
Ctrl+C sem perder o que já subiu.
"""

import argparse
import collections
import difflib
import json
import os
import re
import sys
import time
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree

try:
    import requests
except ImportError:
    print("Este script precisa do pacote 'requests'. Instale com: pip install requests", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_google_photos_links import is_google_photos_link, resolve_image_url  # noqa: E402
from upload_cards_from_links import (  # noqa: E402
    SB_URL,
    STORAGE_BASE,
    clean_name,
    fetch_image,
    short_hash,
    slugify,
    upload_to_storage,
    upsert_card,
)

# A planilha tem carta com nome em japonês. No console do Windows o Python
# escreve Unicode direto, mas com a saída redirecionada para arquivo ele cai
# no cp1252 e levanta UnicodeEncodeError no meio da execução — depois de já
# ter subido imagem e gravado carta. Trocar por '?' é sempre melhor que
# abortar: o nome no banco continua correto, só o eco na tela perde o acento.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL_DOC = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NS_REL_PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"

# Colunas da planilha do fornecedor: 1-2 REGULAR, 3-4 HOLO, 5-6 FOIL.
# As colunas ímpares são o estoque; as pares, as adições recentes.
COLUNA_TIPO = {1: "Normal", 2: "Normal", 3: "Holo", 4: "Holo", 5: "Foil", 6: "Foil"}

CABECALHO_DATA = re.compile(r"^\d+\.\d+\s+NEW Updates", re.I)
LINHAS_CABECALHO = 3
PALAVRAS_IGNORADAS = {"foil", "holo", "regular", "none", "art"}
CUTOFF_APROXIMADO = 0.93


def die(msg):
    print("\nERRO: " + msg, file=sys.stderr)
    sys.exit(1)


# ── Leitura do .xlsx (só biblioteca padrão) ───────────────────────────

def _coluna_da_celula(ref):
    """'BC12' -> 55 (número da coluna, base 1)."""
    letras = "".join(c for c in ref if c.isalpha())
    n = 0
    for c in letras:
        n = n * 26 + (ord(c.upper()) - 64)
    return n


def _linha_da_celula(ref):
    """'BC12' -> 12."""
    digitos = "".join(c for c in ref if c.isdigit())
    return int(digitos) if digitos else 0


def ler_planilha(caminho):
    """Devolve [(nome, url, tipo)] lendo texto e hyperlink de cada célula."""
    try:
        zf = zipfile.ZipFile(caminho)
    except zipfile.BadZipFile:
        die(f"'{caminho}' não parece um .xlsx. Exporte do Google Sheets em\n"
            "       Arquivo → Fazer download → Microsoft Excel (.xlsx).")

    with zf:
        nomes = set(zf.namelist())

        compartilhadas = []
        if "xl/sharedStrings.xml" in nomes:
            raiz = ElementTree.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in raiz.findall(f"{NS_MAIN}si"):
                compartilhadas.append("".join(t.text or "" for t in si.iter(f"{NS_MAIN}t")))

        folha = next((n for n in sorted(nomes) if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")), None)
        if not folha:
            die("não achei nenhuma planilha dentro do arquivo .xlsx.")

        rels = {}
        nome_rels = folha.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels"
        if nome_rels in nomes:
            raiz = ElementTree.fromstring(zf.read(nome_rels))
            for rel in raiz.findall(f"{NS_REL_PKG}Relationship"):
                rels[rel.get("Id")] = rel.get("Target")

        raiz = ElementTree.fromstring(zf.read(folha))

        # ref da célula -> link embutido
        links = {}
        for h in raiz.iter(f"{NS_MAIN}hyperlink"):
            ref = (h.get("ref") or "").split(":")[0]
            alvo = rels.get(h.get(f"{NS_REL_DOC}id")) or h.get("display") or ""
            if ref and alvo:
                links[ref] = alvo

        linhas = []
        for celula in raiz.iter(f"{NS_MAIN}c"):
            ref = celula.get("r") or ""
            v = celula.find(f"{NS_MAIN}v")
            if celula.get("t") == "s":
                idx = int(v.text) if v is not None and v.text else -1
                texto = compartilhadas[idx] if 0 <= idx < len(compartilhadas) else ""
            elif celula.get("t") == "inlineStr":
                texto = "".join(t.text or "" for t in celula.iter(f"{NS_MAIN}t"))
            else:
                texto = (v.text or "") if v is not None else ""
            texto = (texto or "").strip()
            # As três primeiras linhas são o cabeçalho do fornecedor
            # (link da loja, "REGULAR/HOLO/FOIL CARDS", "STOCKS").
            if not texto or _linha_da_celula(ref) <= LINHAS_CABECALHO or CABECALHO_DATA.match(texto):
                continue
            tipo = COLUNA_TIPO.get(_coluna_da_celula(ref))
            if not tipo:
                continue
            linhas.append((clean_name(texto), links.get(ref, ""), tipo))
    return linhas


# ── Comparação planilha × catálogo ────────────────────────────────────

def _base(texto):
    """Normaliza nome ou nome-de-arquivo para comparação.

    Cuidados que a versão ingênua erra: o catálogo usa apóstrofo curvo
    (Akroma’s) e a planilha usa reto (Akroma's) — dobrar direto para ASCII
    apaga o curvo e gera 'akromas' contra 'akroma s'; e o sufixo do
    fornecedor aparece como 'mtg-proxy-cards', 'mtg-proxy' ou 'mtg-cards'.
    """
    s = re.sub(r"[\u2018\u2019\u00b4\u0060\u02bc]", "'", str(texto or ""))
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\.(jpg|jpeg|png|webp|gif)$", "", s)
    s = re.sub(r"-[0-9a-f]{8,12}$", "", s)
    s = re.sub(r"[-_ ]?mtg[-_ ]?proxy([-_ ]?cards?)?", "", s)
    s = re.sub(r"[-_ ]?proxy([-_ ]?cards?)?", "", s)
    s = re.sub(r"[-_ ]?mtg[-_ ]?cards?", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+\d{1,2}$", "", s)
    return " ".join(s.split())


def _chave(texto):
    return " ".join(sorted(p for p in _base(texto).split() if p not in PALAVRAS_IGNORADAS))


def ler_catalogo(sessao, key, tcg):
    """Baixa as cartas do tcg informado, paginando de mil em mil."""
    cartas = []
    passo = 1000
    while True:
        res = sessao.get(
            f"{SB_URL}/rest/v1/cards",
            params={
                "select": "id,name,type,is_active,import_ref",
                "tcg": f"eq.{tcg}",
                "limit": passo,
                "offset": len(cartas),
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=60,
        )
        if not res.ok:
            die(f"não consegui ler o catálogo: {res.status_code} {res.text[:200]}\n"
                "       Confira se a SB_SERVICE_ROLE_KEY é a 'service_role' (não a 'anon').")
        lote = res.json()
        cartas.extend(lote)
        if len(lote) < passo:
            return cartas


def _casa(origens, exatos, chaves, lista_chaves):
    """Uma carta 'casa' com o outro lado se qualquer um dos seus nomes bate
    por igualdade, por tokens ou por aproximação — nesta ordem, porque as
    duas primeiras são baratas e resolvem a grande maioria."""
    origens = [o for o in origens if o]
    if any(_base(o) in exatos for o in origens):
        return True
    if any(_chave(o) in chaves for o in origens):
        return True
    return any(
        difflib.get_close_matches(_chave(o), lista_chaves, n=1, cutoff=CUTOFF_APROXIMADO)
        for o in origens
    )


def comparar(planilha, catalogo):
    """Devolve (novas, orfas), comparando a planilha com as cartas ativas.

    A aproximação roda nos dois sentidos de propósito: sem ela, variações de
    grafia entre a planilha e o catálogo viram falsas 'novas' de um lado e
    falsas 'órfãs' do outro — e uma falsa órfã tira do ar carta que existe.
    """
    ativas = [c for c in catalogo if c.get("is_active")]

    cat_exatos, cat_chaves = set(), set()
    for c in ativas:
        for origem in (c.get("name"), c.get("import_ref")):
            if origem:
                cat_exatos.add(_base(origem))
                cat_chaves.add(_chave(origem))
    cat_lista = list(cat_chaves)

    pl_exatos = {_base(n) for n, _, _ in planilha}
    pl_chaves = {_chave(n) for n, _, _ in planilha}
    pl_lista = list(pl_chaves)

    novas = [
        (nome, url, tipo) for nome, url, tipo in planilha
        if not _casa([nome], cat_exatos, cat_chaves, cat_lista)
    ]
    orfas = [
        c for c in ativas
        if not _casa([c.get("name"), c.get("import_ref")], pl_exatos, pl_chaves, pl_lista)
    ]
    return novas, orfas


# ── Escrita ───────────────────────────────────────────────────────────

def carregar_estado(caminho):
    feitas = set()
    if caminho.exists():
        with open(caminho, "r", encoding="utf-8") as fh:
            for linha in fh:
                linha = linha.strip()
                if linha:
                    try:
                        feitas.add(json.loads(linha)["src_url"])
                    except Exception:
                        pass
    return feitas


def subir_novas(sessao, key, novas, tcg, estado, delay, size, timeout):
    feitas = carregar_estado(estado)
    pendentes = [(n, u, t) for n, u, t in novas if u and u not in feitas]
    ja = len(novas) - len(pendentes) - sum(1 for n, u, t in novas if not u)
    if ja:
        print(f"  {ja} já tinham subido em execução anterior — pulando.")

    ok, falhas = 0, []
    for i, (nome, url, tipo) in enumerate(pendentes, 1):
        prefixo = f"  [{i}/{len(pendentes)}]"
        try:
            img = resolve_image_url(url, size=size, timeout=timeout) if is_google_photos_link(url) else url
            buf, content_type, ext = fetch_image(sessao, img, timeout)
            arquivo = f"{slugify(nome)}-{short_hash(img)}{ext}"
            upload_to_storage(sessao, key, arquivo, buf, content_type, timeout)
            upsert_card(sessao, key, {
                "name": nome,
                "type": tipo,
                "tcg": tcg,
                "is_active": True,
                "image_url": STORAGE_BASE + arquivo,
                "import_ref": arquivo,
            }, timeout)
            with open(estado, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"src_url": url, "name": nome, "import_ref": arquivo}, ensure_ascii=False) + "\n")
            ok += 1
            print(f"{prefixo} ok   {nome[:58]}")
        except Exception as e:
            falhas.append((nome, url, tipo, str(e)))
            print(f"{prefixo} FALHA {nome[:58]}: {e}", file=sys.stderr)
        if delay > 0:
            time.sleep(delay)
    return ok, falhas


def desativar(sessao, key, orfas, timeout):
    desativadas = 0
    for i in range(0, len(orfas), 100):
        lote = orfas[i:i + 100]
        ids = ",".join(c["id"] for c in lote)
        res = sessao.patch(
            f"{SB_URL}/rest/v1/cards",
            params={"id": f"in.({ids})"},
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            data=json.dumps({"is_active": False}),
            timeout=timeout,
        )
        if not res.ok:
            print(f"  FALHA ao desativar lote: {res.status_code} {res.text[:160]}", file=sys.stderr)
            continue
        desativadas += len(lote)
        print(f"  desativadas {desativadas}/{len(orfas)}")
    return desativadas


# ── Programa ──────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("planilha", help="caminho do arquivo .xlsx exportado do Google Sheets")
    ap.add_argument("--tcg", default="Magic", help="TCG sincronizado (padrão: Magic)")
    ap.add_argument("--dry-run", action="store_true", help="só o relatório; não escreve nada")
    ap.add_argument("--so-novas", action="store_true", help="sobe as novas e não desativa nada")
    ap.add_argument("--sim", action="store_true", help="não pergunta antes de aplicar")
    ap.add_argument("--delay", type=float, default=0.5, help="espera entre cartas, em segundos (padrão: 0.5)")
    ap.add_argument("--size", type=int, default=2048, help="tamanho pedido da imagem, em pixels (padrão: 2048)")
    ap.add_argument("--timeout", type=int, default=60, help="timeout de rede, em segundos (padrão: 60)")
    args = ap.parse_args()

    planilha_path = Path(args.planilha)
    if not planilha_path.exists():
        die(f"não encontrei o arquivo: {planilha_path}\n"
            "       Confira o caminho — no Windows costuma ser algo como\n"
            '       C:\\Users\\seu-usuario\\Downloads\\planilha.xlsx')

    key = os.environ.get("SB_SERVICE_ROLE_KEY")
    if not key and not args.dry_run:
        die("a variável SB_SERVICE_ROLE_KEY não está definida nesta janela.\n"
            "       Pegue em Supabase → Project Settings → API → service_role e rode:\n"
            '       $env:SB_SERVICE_ROLE_KEY="a-chave"        (PowerShell)\n'
            '       export SB_SERVICE_ROLE_KEY="a-chave"      (macOS/Linux)')

    print("\n[1/4] Lendo a planilha…")
    linhas = ler_planilha(planilha_path)
    com_link = [x for x in linhas if x[1]]
    sem_link = [x for x in linhas if not x[1]]
    if not linhas:
        die("não achei nenhuma carta na planilha. O arquivo é a planilha certa?")
    print(f"      {len(linhas)} cartas · {len(sem_link)} sem link na célula")
    por_tipo = collections.Counter(t for _, _, t in linhas)
    print("      " + " · ".join(f"{k}: {v}" for k, v in sorted(por_tipo.items())))

    if args.dry_run and not key:
        print("\n--dry-run sem chave: parei na leitura da planilha.\n")
        return 0

    print("\n[2/4] Lendo o catálogo no Supabase…")
    sessao = requests.Session()
    catalogo = ler_catalogo(sessao, key, args.tcg)
    ativas = [c for c in catalogo if c.get("is_active")]
    print(f"      {len(catalogo)} cartas {args.tcg} no banco · {len(ativas)} ativas")

    print("\n[3/4] Comparando…")
    novas, orfas = comparar(linhas, catalogo)
    novas_com_link = [x for x in novas if x[1]]
    novas_sem_link = [x for x in novas if not x[1]]
    print(f"      ENTRAM : {len(novas_com_link)} cartas novas"
          + (f" (+{len(novas_sem_link)} sem link, serão ignoradas)" if novas_sem_link else ""))
    print(f"      SAEM   : {len(orfas)} ativas que não estão na planilha")
    if novas_com_link:
        print("\n      exemplos do que entra:")
        for nome, _, tipo in novas_com_link[:5]:
            print(f"        + {tipo:6} {nome[:60]}")
    if orfas and not args.so_novas:
        print("\n      exemplos do que sai:")
        for c in orfas[:5]:
            print(f"        - {c.get('type',''):6} {(c.get('name') or '')[:60]}")

    if args.dry_run:
        print("\n--dry-run: nada foi escrito.\n")
        return 0
    if not novas_com_link and (args.so_novas or not orfas):
        print("\nCatálogo já está em dia. Nada a fazer.\n")
        return 0

    if not args.sim:
        acao = f"subir {len(novas_com_link)} carta(s)"
        if orfas and not args.so_novas:
            acao += f" e desativar {len(orfas)}"
        print(f"\nVou {acao}. Nada é apagado — sair do catálogo é reversível.")
        if input("Digite SIM (maiúsculas) para continuar: ").strip() != "SIM":
            print("Cancelado. Nada foi alterado.\n")
            return 1

    print("\n[4/4] Aplicando…")
    estado = Path(str(planilha_path) + ".state.jsonl")
    falhas = []
    if novas_com_link:
        print(f"\n  Subindo {len(novas_com_link)} cartas novas:")
        ok, falhas = subir_novas(sessao, key, novas_com_link, args.tcg, estado,
                                 args.delay, args.size, args.timeout)
        print(f"\n  subidas: {ok} · falhas: {len(falhas)}")

    if orfas and not args.so_novas:
        registro = planilha_path.parent / f"desativadas-{time.strftime('%Y-%m-%d')}.txt"
        with open(registro, "w", encoding="utf-8") as fh:
            fh.write(f"# {len(orfas)} cartas desativadas em {time.strftime('%d/%m/%Y %H:%M')}.\n")
            fh.write("# Para reverter, rode no SQL Editor do Supabase:\n")
            fh.write("#   update cards set is_active = true where id in (<os uuids abaixo>);\n")
            for c in orfas:
                fh.write(f"{c['id']} | {c.get('type','')} | {c.get('name','')}\n")
        print(f"\n  Desativando {len(orfas)} cartas (lista salva em {registro}):")
        desativar(sessao, key, orfas, args.timeout)

    if falhas:
        fpath = planilha_path.parent / "falhas.txt"
        with open(fpath, "w", encoding="utf-8") as fh:
            fh.write("# Cartas que falharam. Rode o sync de novo — ele retoma de onde parou.\n")
            for nome, url, tipo, err in falhas:
                fh.write(f"# {tipo} · motivo: {err}\n{nome} | {url}\n")
        print(f"\n{len(falhas)} falha(s) — detalhes em {fpath}")
        print("Rode o mesmo comando de novo: ele pula o que já subiu e tenta só o que faltou.")
        return 1

    print("\nPronto. Catálogo sincronizado com a planilha.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
