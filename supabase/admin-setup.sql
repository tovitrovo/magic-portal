-- ══════════════════════════════════════════════════════════════════
-- Magic Portal — Configuração do Painel Admin no Supabase
-- ══════════════════════════════════════════════════════════════════
-- Execute este script no SQL Editor do Supabase para habilitar
-- o painel admin e garantir que todas as estruturas estão corretas.
--
-- ORDEM DE EXECUÇÃO:
--   1. Execute supabase/schema.sql  (cria todas as tabelas e políticas)
--   2. Execute ESTE arquivo         (configura o usuário admin e dados iniciais)
-- ══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- PASSO 1 — Conceder acesso de administrador ao seu usuário
-- ──────────────────────────────────────────────────────────────────
-- Substitua o email abaixo pelo email da conta que será o admin.
-- Você pode descobrir o UUID do usuário em:
--   Supabase Dashboard → Authentication → Users

-- Opção A — via email (mais simples):
-- UPDATE public.profiles
-- SET is_admin = true
-- WHERE email = 'seu-email@exemplo.com';

-- Opção B — via UUID (use o ID exato do Authentication > Users):
-- UPDATE public.profiles
-- SET is_admin = true
-- WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

-- Verificar quem tem acesso admin:
SELECT id, email, name, is_admin, created_at
FROM public.profiles
WHERE is_admin = true;

-- ──────────────────────────────────────────────────────────────────
-- PASSO 2 — Configuração inicial de preços (execute apenas uma vez)
-- ──────────────────────────────────────────────────────────────────
-- Insere um registro de preços padrão se ainda não existir.
-- Ajuste os valores conforme necessário pelo painel admin (aba Configurações).

INSERT INTO public.pricing_config (
  is_active,
  usd_brl_rate,     -- taxa de câmbio USD → BRL (ex: 5.80)
  card_fee_percent, -- taxa de cartão (ex: 0.04 = 4%)
  tax_percent,      -- impostos (ex: 0.18 = 18%)
  markup_percent,   -- markup (ex: 0.15 = 15%)
  profit_fixed_brl  -- lucro fixo por carta em BRL
)
SELECT
  true,
  5.80,
  0.04,
  0.18,
  0.15,
  0.50
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_config WHERE is_active = true
);

-- ──────────────────────────────────────────────────────────────────
-- PASSO 3 — Verificações de sanidade
-- ──────────────────────────────────────────────────────────────────
-- Execute estas queries para confirmar que o schema está correto:

-- Tabelas existentes:
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles','campaigns','tiers','pricing_config',
    'cards','orders','order_batches','order_items','bonus_grants'
  )
ORDER BY table_name;

-- Políticas RLS ativas:
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ──────────────────────────────────────────────────────────────────
-- PASSO 4 — Trigger de criação de perfil (idempotente)
-- ──────────────────────────────────────────────────────────────────
-- Garante que o trigger existe para criar perfil automaticamente
-- ao registrar um novo usuário.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
