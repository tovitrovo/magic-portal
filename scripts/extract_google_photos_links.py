#!/usr/bin/env python3
"""
Extrai o link direto da imagem (lh3.googleusercontent.com) a partir de um
link de compartilhamento do Google Photos (photos.app.goo.gl ou
photos.google.com/share/.../photo/...?key=...).

Não existe API pública gratuita para isso — o script baixa o HTML da
página pública de visualização e procura a URL da imagem que o Google
embute nos dados da página. É uma técnica não-oficial: se o Google mudar
o formato da página, o script pode parar de encontrar a imagem.

Requisitos: Python 3.8+ e o pacote `requests`.
  pip install requests

Uso — um link avulso (imprime a URL direta em stdout):
  python scripts/extract_google_photos_links.py "https://photos.app.goo.gl/HwYXQBNQkPLiXuCV8"

Uso — lote, no mesmo formato aceito pelo painel admin ("Adicionar Cartas
por Link"). O arquivo de entrada tem uma carta por linha:
  Nome da carta | link (Google Photos, Google Imagens ou link direto)

  python scripts/extract_google_photos_links.py --file cartas.txt > resolvidas.txt

A saída troca apenas os links do Google Photos pelo link direto da
imagem; as demais linhas passam sem alteração. Linhas que falharem saem
comentadas (prefixo "#") com o motivo do erro, para você revisar antes
de colar no admin.
"""

import argparse
import re
import sys
import time
from urllib.parse import urlsplit

try:
    import requests
except ImportError:
    print("Este script precisa do pacote 'requests'. Instale com: pip install requests", file=sys.stderr)
    sys.exit(1)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

GOOGLE_PHOTOS_HOSTS = {"photos.app.goo.gl", "photos.google.com"}

# URLs de imagem do Google Photos servidas por lh3.googleusercontent.com,
# opcionalmente com um sufixo de tamanho tipo "=w1200-h800" no final.
IMAGE_URL_RE = re.compile(r"https://lh3\.googleusercontent\.com/[A-Za-z0-9_\-/]+(?:=[\w-]+)?")

SIZE_SUFFIX_RE = re.compile(r"=[whs]\d[\w-]*$")


def is_google_photos_link(url: str) -> bool:
    try:
        return urlsplit(url).netloc.lower() in GOOGLE_PHOTOS_HOSTS
    except ValueError:
        return False


def strip_size_suffix(url: str) -> str:
    """Remove um sufixo de tamanho existente (ex: '=w800-h600', '=s512') do fim da URL."""
    return SIZE_SUFFIX_RE.sub("", url)


def resolve_image_url(share_link: str, size: int = 2048, timeout: int = 20) -> str:
    """Baixa a página de compartilhamento do Google Photos e retorna o link
    direto da imagem principal, pedindo o tamanho `size` (em pixels).
    Lança ValueError com uma mensagem legível se não conseguir extrair.
    """
    try:
        resp = requests.get(
            share_link,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"},
            timeout=timeout,
            allow_redirects=True,
        )
    except requests.RequestException as e:
        raise ValueError(f"falha ao acessar o link: {e}") from e

    if resp.status_code != 200:
        raise ValueError(f"HTTP {resp.status_code} ao abrir a página")

    candidates = IMAGE_URL_RE.findall(resp.text)
    if not candidates:
        raise ValueError(
            "nenhuma imagem lh3.googleusercontent.com encontrada na página "
            "(o link pode exigir login, ter expirado, ou o Google mudou o formato da página)"
        )

    # Remove duplicatas mantendo a ordem; a primeira ocorrência costuma ser a foto principal.
    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)

    base = strip_size_suffix(unique[0])
    return f"{base}=w{size}-h{size}"


def process_file(path: str, size: int, delay: float) -> int:
    """Lê 'Nome | link' por linha, resolve links do Google Photos e imprime
    o resultado pronto para colar no admin. Retorna a quantidade de falhas.
    """
    failures = 0
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    for raw in lines:
        line = raw.rstrip("\n")
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            print(line)
            continue

        if "|" not in stripped:
            print(f"# ERRO (formato esperado 'Nome | link'): {stripped}")
            failures += 1
            continue

        name, _, link = stripped.partition("|")
        name = name.strip()
        link = link.strip()

        if not is_google_photos_link(link):
            print(f"{name} | {link}")
            continue

        try:
            resolved = resolve_image_url(link, size=size)
            print(f"{name} | {resolved}")
        except ValueError as e:
            print(f"AVISO: \"{name}\" não resolvido: {e}", file=sys.stderr)
            print(f"# ERRO ({e}): {name} | {link}")
            failures += 1

        if delay > 0:
            time.sleep(delay)

    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("links", nargs="*", help="Link(s) de compartilhamento do Google Photos")
    parser.add_argument("--file", help="Arquivo com linhas 'Nome da carta | link' (formato do admin)")
    parser.add_argument("--size", type=int, default=2048, help="Tamanho pedido da imagem em pixels (padrão: 2048)")
    parser.add_argument("--delay", type=float, default=0.5, help="Segundos de espera entre requisições no modo --file (padrão: 0.5)")
    args = parser.parse_args()

    if not args.links and not args.file:
        parser.error("informe ao menos um link ou use --file")

    exit_code = 0

    if args.file:
        failures = process_file(args.file, size=args.size, delay=args.delay)
        if failures:
            print(f"\n{failures} link(s) não resolvido(s) — veja os comentários acima.", file=sys.stderr)
            exit_code = 1

    for link in args.links:
        try:
            print(resolve_image_url(link, size=args.size))
        except ValueError as e:
            print(f"ERRO ao resolver {link}: {e}", file=sys.stderr)
            exit_code = 1

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
