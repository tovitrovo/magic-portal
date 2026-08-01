-- ──────────────────────────────────────────────────────────────
-- CENTRAL DE NOTIFICAÇÕES + WEB PUSH (PWA)
--
-- Cria o histórico de eventos do painel admin (`app_notifications`) e o
-- registro de dispositivos que recebem push (`push_subscriptions`).
--
-- Eventos gerados hoje:
--   NEW_ORDER   — pedido novo criado (aguardando pagamento)
--   ORDER_PAID  — pagamento confirmado (webhook do Mercado Pago)
--   BONUS_ORDER — pedido fechado usando saldo de bônus
--   LOGIN       — cliente entrou no site
--   SIGNUP      — cliente criou conta
--
-- Ambas as tabelas são acessadas apenas pelas Functions com a service role
-- (RLS ligado e sem policies públicas).
--
-- Script idempotente — pode rodar várias vezes.
-- ──────────────────────────────────────────────────────────────

-- ── Histórico de notificações ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL,
  title         text NOT NULL,
  body          text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_notifications DROP CONSTRAINT IF EXISTS app_notifications_type_check;
ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN ('NEW_ORDER','ORDER_PAID','BONUS_ORDER','LOGIN','SIGNUP'));

CREATE INDEX IF NOT EXISTS idx_app_notifications_created ON public.app_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_notifications_unread  ON public.app_notifications(read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_notifications_type    ON public.app_notifications(type);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
-- Sem policies: só a service role (Functions) lê/escreve.

-- ── Dispositivos inscritos no Web Push ───────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint           text NOT NULL UNIQUE,
  p256dh             text NOT NULL,
  auth               text NOT NULL,
  user_agent         text,
  device_label       text,
  notify_new_orders  boolean NOT NULL DEFAULT true,
  notify_logins      boolean NOT NULL DEFAULT true,
  failure_count      integer NOT NULL DEFAULT 0,
  last_success_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Sem policies: o app fala com /api/push-subscribe, que usa a service role.
