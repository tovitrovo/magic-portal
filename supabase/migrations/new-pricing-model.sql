-- ══════════════════════════════════════════════════════════════
-- Migration: Nova Lógica de Precificação e Regras de Encomenda
-- ══════════════════════════════════════════════════════════════
-- Substitui o modelo antigo de tiers/ranges por preços fixos
-- por tipo de carta (Normal, Ouro/Holo, Foil).
-- Adiciona meta mínima por encomenda (min_cards).
-- Execute no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════

-- 1. Adicionar meta mínima de cartas na campanha (default: 150)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS min_cards integer NOT NULL DEFAULT 150;

-- 2. Adicionar preços fixos por tipo de carta na pricing_config
ALTER TABLE public.pricing_config
  ADD COLUMN IF NOT EXISTS normal_price_brl numeric(10,2) NOT NULL DEFAULT 16.00;

ALTER TABLE public.pricing_config
  ADD COLUMN IF NOT EXISTS ouro_price_brl numeric(10,2) NOT NULL DEFAULT 16.00;

ALTER TABLE public.pricing_config
  ADD COLUMN IF NOT EXISTS foil_price_brl numeric(10,2) NOT NULL DEFAULT 18.00;

-- 3. Setar valores padrão na linha ativa de pricing_config (se existir)
UPDATE public.pricing_config
SET
  normal_price_brl = 16.00,
  ouro_price_brl   = 16.00,
  foil_price_brl   = 18.00
WHERE is_active = true;

-- 4. Garantir que exista ao menos uma linha ativa de pricing_config
INSERT INTO public.pricing_config (is_active, normal_price_brl, ouro_price_brl, foil_price_brl)
SELECT true, 16.00, 16.00, 18.00
WHERE NOT EXISTS (SELECT 1 FROM public.pricing_config WHERE is_active = true);

-- 5. Setar min_cards = 150 em campanhas ativas sem valor definido
UPDATE public.campaigns
SET min_cards = 150
WHERE min_cards IS NULL OR min_cards = 0;
