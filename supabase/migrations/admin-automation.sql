-- ──────────────────────────────────────────────────────────────
-- AUTOMAÇÕES DO CONSOLE ADMIN + NOVOS EVENTOS DE PUSH
--
-- 1. Rastreio automático do MandaBem: de hora em hora o pg_cron chama
--    /api/cron (job tracking), que consulta cada remessa com etiqueta ainda
--    não entregue, grava status/código, marca "Entregue" sozinho e avisa o
--    admin quando a remessa é postada, entregue ou dá problema.
-- 2. Resumo diário: 08:07 em Brasília, /api/cron (job digest) manda um push
--    com vendas de ontem e a fila de trabalho.
--
-- A URL do site (Cloudflare Pages) fica em automation_config.site_url e é
-- gravada sozinha quando o admin abre o console. Enquanto estiver vazia, os
-- jobs não fazem nada.
--
-- Script idempotente — pode rodar várias vezes.
-- ──────────────────────────────────────────────────────────────

-- ── Configuração e status das rotinas (linha única) ──────────
-- RLS sem policy: só a service role lê; o console passa por /api/admin-automation.
CREATE TABLE IF NOT EXISTS public.automation_config (
  id                    int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  site_url              text,
  -- Segredo que o pg_cron manda no cabeçalho x-cron-secret.
  cron_secret           text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  tracking_last_run_at  timestamptz,
  tracking_last_result  jsonb,
  digest_last_run_at    timestamptz,
  digest_last_result    jsonb,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automation_config ENABLE ROW LEVEL SECURITY;
INSERT INTO public.automation_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Novos tipos de evento ────────────────────────────────────
ALTER TABLE public.app_notifications DROP CONSTRAINT IF EXISTS app_notifications_type_check;
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN (
    'NEW_ORDER','ORDER_PAID','BONUS_ORDER',
    'SHIPMENT_LABEL','SHIPMENT_POSTED','SHIPMENT_DELIVERED','ADDRESS_CHANGED',
    'ORDER_CANCELLED','PAYMENT_FAILED','SHIPMENT_PROBLEM','SYSTEM_ERROR',
    'DAILY_DIGEST',
    'LOGIN','SIGNUP'
  ));

-- Deduplicação de eventos de cron/webhook (data->>'dedupeKey').
CREATE INDEX IF NOT EXISTS idx_app_notifications_dedupe
  ON public.app_notifications ((data->>'dedupeKey')) WHERE data ? 'dedupeKey';

-- ── Preferências por aparelho (uma coluna por categoria) ─────
-- Ver shared/notificationTypes.js.
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS notify_shipping boolean NOT NULL DEFAULT true;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS notify_alerts   boolean NOT NULL DEFAULT true;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS notify_digest   boolean NOT NULL DEFAULT true;

-- Rastreio: consulta as remessas há mais tempo sem atualização primeiro.
CREATE INDEX IF NOT EXISTS idx_order_batches_mandabem_open
  ON public.order_batches (mandabem_updated_at NULLS FIRST)
  WHERE mandabem_envio_id IS NOT NULL;

-- ── Agendamentos ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('mandabem-tracking')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mandabem-tracking');
SELECT cron.unschedule('admin-daily-digest')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-daily-digest');

-- De hora em hora, no minuto 23.
SELECT cron.schedule(
  'mandabem-tracking',
  '23 * * * *',
  $$
  SELECT net.http_post(
    url     := c.site_url || '/api/cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.cron_secret),
    body    := '{"job":"tracking"}'::jsonb,
    timeout_milliseconds := 60000
  )
  FROM public.automation_config c
  WHERE c.id = 1 AND c.site_url IS NOT NULL;
  $$
);

-- 11:07 UTC = 08:07 em Brasília.
SELECT cron.schedule(
  'admin-daily-digest',
  '7 11 * * *',
  $$
  SELECT net.http_post(
    url     := c.site_url || '/api/cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.cron_secret),
    body    := '{"job":"digest"}'::jsonb,
    timeout_milliseconds := 60000
  )
  FROM public.automation_config c
  WHERE c.id = 1 AND c.site_url IS NOT NULL;
  $$
);
