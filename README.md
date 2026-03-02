# Magic Portal (Cloudflare Pages) — Checkout MP + Frete Manda Bem

## Deploy sem terminal (GitHub -> Cloudflare Pages)
1. Suba esta pasta no seu repo.
2. Cloudflare Pages:
   - Framework preset: Next.js
   - Build command: `npm run build`
   - Build output directory: `out`
3. Environment variables (Settings -> Environment variables):
   - `MP_ACCESS_TOKEN` = seu access token (PRODUÇÃO)
   - `MANDABEM_TOKEN` = token API Manda Bem
   - (opcional) `MANDABEM_BASE_URL` = base da API se for diferente

## Rotas
- `/` home
- `/wants` wants local (localStorage)
- `/checkout` calcula frete e abre checkout MP
- Functions:
  - `POST /api/mp/create-preference`
  - `POST /api/shipping/quote`

## Observação importante
O endpoint do Manda Bem pode variar. Se sua API não for `/v1/fretes/cotacao`, troque no arquivo:
`functions/api/shipping/quote.ts`
