-- ══════════════════════════════════════════════════════════════
-- Magic Portal — Migração: Corrigir constraint única de tiers
-- ══════════════════════════════════════════════════════════════
-- O constraint tiers_min_qty_max_qty_key impede que campanhas
-- diferentes tenham tiers com as mesmas faixas (min_qty, max_qty).
-- Esta migração substitui por um constraint que inclui campaign_id,
-- permitindo que cada campanha tenha seus próprios tiers.
--
-- O script é IDEMPOTENTE — pode ser executado várias vezes.
-- ══════════════════════════════════════════════════════════════

-- 1. Remove o constraint global (min_qty, max_qty) se existir
ALTER TABLE public.tiers
  DROP CONSTRAINT IF EXISTS tiers_min_qty_max_qty_key;

-- 2. Adiciona constraint com escopo por campanha (campaign_id, min_qty, max_qty)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tiers_campaign_min_max_key'
      AND conrelid = 'public.tiers'::regclass
  ) THEN
    ALTER TABLE public.tiers
      ADD CONSTRAINT tiers_campaign_min_max_key
      UNIQUE (campaign_id, min_qty, max_qty);
  END IF;
END $$;
