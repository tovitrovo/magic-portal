-- ──────────────────────────────────────────────────────────────
-- Sincronização automática com a planilha do fornecedor.
--
-- A Edge Function sync-supplier-sheet lê a aba SINGLES (colunas "New Updated
-- Cards"), baixa a foto de cada link do Google Photos e cria a carta.
-- Roda 1x por dia via pg_cron e sob demanda pelo console admin.
-- ──────────────────────────────────────────────────────────────

-- Acabamento especial (Surge Foil, Raised Golden Foil, Silver Foil, ...).
-- O tipo (Normal/Holo/Foil) continua decidindo o preço; a variante é só filtro.
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS variant text;
CREATE INDEX IF NOT EXISTS idx_cards_variant ON public.cards(variant) WHERE variant IS NOT NULL;

-- Link do Google Photos de onde a carta veio. É a identidade da carta na
-- planilha: link já visto não é importado de novo, mesmo que o nome mude.
-- Índice unique completo (NULLs são distintos) — ver fix-cards-import-ref-unique-index.sql.
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS source_url text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_source_url ON public.cards(source_url);

-- Configuração e status (linha única). RLS sem policy: só a service role lê,
-- o console admin passa por /api/admin-catalog-sync.
CREATE TABLE IF NOT EXISTS public.catalog_sync (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sheet_url     text,
  sheet_tab     text NOT NULL DEFAULT 'SINGLES',
  -- Segredo que o pg_cron manda no cabeçalho x-sync-secret.
  cron_secret   text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  running_since timestamptz,
  last_run_at   timestamptz,
  last_result   jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_sync ENABLE ROW LEVEL SECURITY;

INSERT INTO public.catalog_sync (id, sheet_url)
VALUES (1, 'https://docs.google.com/spreadsheets/d/1E2iSRhhNUjaZ3MblXx_rflpOIkMwK40OgX5X6yXE4zw/edit')
ON CONFLICT (id) DO NOTHING;

-- Agendamento diário: 09:17 UTC (06:17 em Brasília).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('sync-supplier-sheet')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-supplier-sheet');

SELECT cron.schedule(
  'sync-supplier-sheet',
  '17 9 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kjyqnlpiohoewmqmsuxp.supabase.co/functions/v1/sync-supplier-sheet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (SELECT cron_secret FROM public.catalog_sync WHERE id = 1)
    ),
    body    := '{}'::jsonb
  );
  $$
);
