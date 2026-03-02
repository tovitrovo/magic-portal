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
   - (opcional) `NEXT_PUBLIC_SUPABASE_URL` = URL do projeto Supabase
   - (opcional) `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key do Supabase

## Banco (Supabase) — ligar em 2 cliques
1. No Supabase, abra **SQL Editor**.
2. Cole e rode o arquivo: `supabase/schema.sql`
3. No Cloudflare Pages, adicione as env vars `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Pronto: a página `/wants` passa a **carregar** wants do DB (se estiver vazio localmente) e **auto-salvar**.
No `/checkout`, quando você clicar pra pagar, ele também salva um registro em `orders` (não bloqueia o pagamento se o DB estiver fora).

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
