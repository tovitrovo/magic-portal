#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ──────────────────────────────────────────────────────────────
# Sobe as imagens das cartas para o bucket público `cards` do Supabase.
# Versão em Python da scripts/upload-card-images.mjs.
#
# Os arquivos devem ter o mesmo nome que aparece na coluna image_file
# do CSV (ex: tom-bombadil-hoc-38-mtg-proxy-cards.jpg), pois os
# image_url gravados no banco apontam para cards/<nome-do-arquivo>.
#
# Requisitos: Python 3.8+ (usa só a biblioteca padrão, sem pip install).
#
# Uso (Windows PowerShell):
#   $env:SB_SERVICE_ROLE_KEY="sua-service-role-key"
#   python scripts\upload_card_images.py "C:\caminho\para\output\images"
#
# Uso (macOS/Linux):
#   SB_SERVICE_ROLE_KEY=sua-service-role-key \
#     python3 scripts/upload_card_images.py ./output/images
#
# A service-role key fica em: Supabase → Project Settings → API → service_role.
# NUNCA commite essa chave; passe sempre por variável de ambiente.
# ──────────────────────────────────────────────────────────────

import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib import request, parse, error

SB_URL = os.environ.get("SB_URL", "https://kjyqnlpiohoewmqmsuxp.supabase.co").rstrip("/")
KEY = os.environ.get("SB_SERVICE_ROLE_KEY")
BUCKET = os.environ.get("SB_BUCKET", "cards")
CONCURRENCY = int(os.environ.get("CONCURRENCY", "8"))
DIR = sys.argv[1] if len(sys.argv) > 1 else None

MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif",
}


def die(msg):
    print("X " + msg, file=sys.stderr)
    sys.exit(1)


if not KEY:
    die("Defina a variavel de ambiente SB_SERVICE_ROLE_KEY.")
if not DIR:
    die("Informe a pasta das imagens. Ex: python scripts/upload_card_images.py ./output/images")
if not os.path.isdir(DIR):
    die("Pasta nao encontrada: " + str(DIR))


def list_files(root):
    out = []
    for base, _dirs, names in os.walk(root):
        for n in names:
            if os.path.splitext(n)[1].lower() in MIME:
                out.append(os.path.join(base, n))
    return out


def upload_one(path, attempt=1):
    name = os.path.basename(path)
    ct = MIME.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    with open(path, "rb") as f:
        body = f.read()
    url = "{}/storage/v1/object/{}/{}".format(SB_URL, BUCKET, parse.quote(name))
    req = request.Request(url, data=body, method="POST")
    req.add_header("apikey", KEY)
    req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", ct)
    req.add_header("x-upsert", "true")  # sobrescreve se ja existir
    try:
        with request.urlopen(req, timeout=120) as resp:
            resp.read()
        return
    except error.HTTPError as e:
        status = e.code
        detail = e.read().decode("utf-8", "replace")[:160]
        if attempt < 4 and (status >= 500 or status == 429):
            time.sleep(attempt)
            return upload_one(path, attempt + 1)
        raise RuntimeError("{}: {} {}".format(name, status, detail))
    except (error.URLError, TimeoutError) as e:
        if attempt < 4:
            time.sleep(attempt)
            return upload_one(path, attempt + 1)
        raise RuntimeError("{}: {}".format(name, e))


def main():
    files = list_files(DIR)
    if not files:
        die("Nenhuma imagem (.jpg/.jpeg/.png/.webp/.gif) em " + DIR)

    print("{} imagens -> bucket \"{}\" em {}\n".format(len(files), BUCKET, SB_URL))

    total = len(files)
    lock = threading.Lock()
    state = {"done": 0, "failed": 0}
    errors = []

    def work(path):
        try:
            upload_one(path)
            ok = True
        except Exception as e:  # noqa: BLE001
            ok = False
            with lock:
                errors.append(str(e))
        with lock:
            if not ok:
                state["failed"] += 1
            state["done"] += 1
            done = state["done"]
            failed = state["failed"]
        if done % 100 == 0 or done == total:
            sys.stdout.write("\r  {}/{} enviadas ({} falhas)".format(done, total, failed))
            sys.stdout.flush()

    with ThreadPoolExecutor(max_workers=max(1, CONCURRENCY)) as pool:
        list(pool.map(work, files))

    print("\n")
    if errors:
        print("! {} falhas (primeiras 10):".format(len(errors)))
        for e in errors[:10]:
            print("   - " + e)
        sys.exit(1)
    print("OK Upload concluido. As cartas ja devem exibir as imagens.")


if __name__ == "__main__":
    main()
