-- ──────────────────────────────────────────────────────────────
-- LEMBRETES POR E-MAIL + AVISO EM MASSA
--
-- 1. Carrinho parado há 48h e pagamento pendente há 48h: o pg_cron chama
--    /api/cron (job reminders) de hora em hora; cada carrinho/lote recebe um
--    e-mail só (o carrinho volta a contar se o cliente mexer nele depois).
--    Fora das 09h–21h de Brasília o job não envia.
-- 2. Aviso "vai sair pedido": disparado pelo admin no console.
-- 3. Descadastro: link no rodapé de todo e-mail (/api/unsubscribe).
--
-- O envio usa o Resend: configure RESEND_API_KEY e EMAIL_FROM no
-- Cloudflare Pages. Sem a chave, o job roda e não envia nada.
--
-- Depende de admin-automation.sql. Script idempotente.
-- ──────────────────────────────────────────────────────────────

-- ── Descadastro ──────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_unsub_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unsub_token ON public.profiles(email_unsub_token);

-- ── Quando cada coisa foi lembrada ───────────────────────────
-- Itens antigos ganham "agora" como data: ninguém é cobrado no dia da migração.
ALTER TABLE public.order_items   ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.orders        ADD COLUMN IF NOT EXISTS cart_reminded_at timestamptz;
ALTER TABLE public.order_batches ADD COLUMN IF NOT EXISTS payment_reminded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_order_items_open_cart
  ON public.order_items (order_id) WHERE in_cart IS TRUE AND batch_id IS NULL;

-- ── Status das rotinas ───────────────────────────────────────
ALTER TABLE public.automation_config ADD COLUMN IF NOT EXISTS reminders_last_run_at timestamptz;
ALTER TABLE public.automation_config ADD COLUMN IF NOT EXISTS reminders_last_result jsonb;
ALTER TABLE public.automation_config ADD COLUMN IF NOT EXISTS broadcast_last_at timestamptz;
ALTER TABLE public.automation_config ADD COLUMN IF NOT EXISTS broadcast_last_result jsonb;

-- ── Agendamento ──────────────────────────────────────────────
SELECT cron.unschedule('customer-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'customer-reminders');

-- De hora em hora, no minuto 41.
SELECT cron.schedule(
  'customer-reminders',
  '41 * * * *',
  $$
  SELECT net.http_post(
    url     := c.site_url || '/api/cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.cron_secret),
    body    := '{"job":"reminders"}'::jsonb,
    timeout_milliseconds := 60000
  )
  FROM public.automation_config c
  WHERE c.id = 1 AND c.site_url IS NOT NULL;
  $$
);
