-- ══════════════════════════════════════════════════════════════
-- Magic Portal — Migração: Sistema de Bônus
-- ══════════════════════════════════════════════════════════════
-- Execute este script no SQL Editor do Supabase para habilitar
-- o sistema de bônus em um banco de dados já existente.
--
-- O script é IDEMPOTENTE — pode ser executado várias vezes
-- com segurança (usa IF NOT EXISTS / IF EXISTS).
--
-- Se você está criando o banco do zero, basta executar
-- supabase/schema.sql — ele já inclui tudo abaixo.
-- ══════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1. Coluna bonus_pct na tabela campaigns
--    Define a porcentagem de bônus automático (ex: 10 = 1 carta
--    grátis a cada 10 pagas)
-- ──────────────────────────────────────────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS bonus_pct integer DEFAULT 0;

-- ──────────────────────────────────────────────
-- 2. Coluna qty_bonus na tabela orders
--    Armazena a quantidade total de cartas bônus no pedido
-- ──────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS qty_bonus integer DEFAULT 0;

-- ──────────────────────────────────────────────
-- 3. Coluna is_bonus na tabela order_items
--    Marca itens individuais como bônus (grátis)
-- ──────────────────────────────────────────────
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_bonus boolean DEFAULT false;

-- ──────────────────────────────────────────────
-- 4. Tabela bonus_grants (bônus concedidos por campanha)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bonus_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  bonus_qty     integer NOT NULL DEFAULT 0,
  status        text DEFAULT 'AVAILABLE'
                  CHECK (status IN ('AVAILABLE','CONSUMED','EXPIRED')),
  grant_type    text DEFAULT 'MANUAL'
                  CHECK (grant_type IN ('MANUAL','BONUS_PCT','TIER_CHANGE')),
  created_at    timestamptz DEFAULT now(),
  batch_id      uuid REFERENCES public.order_batches(id) ON DELETE SET NULL
);

-- Migração para bancos que já têm a tabela bonus_grants
-- mas sem as colunas mais recentes:
ALTER TABLE public.bonus_grants
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE public.bonus_grants
  ADD COLUMN IF NOT EXISTS grant_type text DEFAULT 'MANUAL';

-- Adiciona CHECK constraint se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bonus_grants_grant_type_check'
      AND conrelid = 'public.bonus_grants'::regclass
  ) THEN
    ALTER TABLE public.bonus_grants
      ADD CONSTRAINT bonus_grants_grant_type_check
      CHECK (grant_type IN ('MANUAL','BONUS_PCT','TIER_CHANGE'));
  END IF;
END $$;

ALTER TABLE public.bonus_grants
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.order_batches(id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────
-- 5. Índices para queries frequentes
-- ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bonus_grants_user ON public.bonus_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_grants_camp ON public.bonus_grants(campaign_id);

-- ──────────────────────────────────────────────
-- 6. Row Level Security (RLS)
-- ──────────────────────────────────────────────
ALTER TABLE public.bonus_grants ENABLE ROW LEVEL SECURITY;

-- Usuário pode ver seus próprios bônus
DROP POLICY IF EXISTS "Users can view own bonus" ON public.bonus_grants;
CREATE POLICY "Users can view own bonus" ON public.bonus_grants
  FOR SELECT USING (auth.uid() = user_id);

-- Usuário pode atualizar seus próprios bônus (ex: marcar como USED)
DROP POLICY IF EXISTS "Users can update own bonus" ON public.bonus_grants;
CREATE POLICY "Users can update own bonus" ON public.bonus_grants
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════
-- PRONTO! O sistema de bônus está configurado.
--
-- Próximos passos:
--   1. No painel admin → Configurações → defina "Bônus automático (%)"
--      na campanha (ex: 10 = a cada 10 cartas pagas, 1 grátis)
--   2. Bônus automáticos são concedidos quando pagamentos são
--      confirmados (webhook, sync ou marcação manual)
--   3. Bônus manuais podem ser dados na aba Clientes do admin
-- ══════════════════════════════════════════════════════════════
