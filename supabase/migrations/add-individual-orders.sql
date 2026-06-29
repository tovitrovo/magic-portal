-- ──────────────────────────────────────────────────────────────
-- PEDIDO INDIVIDUAL (encomenda avulsa com desconto por volume)
--   preço/carta (R$) = máx( custo_da_faixa(USD) × multiplier × dólar , piso[tipo] )
-- ──────────────────────────────────────────────────────────────

-- Faixas de preço por volume (custo USD do fornecedor).
CREATE TABLE IF NOT EXISTS public.individual_tiers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_qty      integer NOT NULL,
  max_qty      integer,            -- NULL = sem limite superior (1001+)
  usd_per_card numeric(10,4) NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (min_qty)
);

-- Config singleton: multiplicador, pisos por tipo, fallback do dólar, mínimo.
CREATE TABLE IF NOT EXISTS public.individual_pricing (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active        boolean DEFAULT true,
  multiplier       numeric(6,3)  NOT NULL DEFAULT 2.0,
  normal_floor_brl numeric(10,2) NOT NULL DEFAULT 16,
  holo_floor_brl   numeric(10,2) NOT NULL DEFAULT 18,
  foil_floor_brl   numeric(10,2) NOT NULL DEFAULT 21,
  fx_fallback_rate numeric(10,4) NOT NULL DEFAULT 5.50,
  min_cards        integer       NOT NULL DEFAULT 15,
  updated_at       timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now()
);

-- Cache do dólar do dia (atualizado pelo backend a partir de uma API de câmbio).
CREATE TABLE IF NOT EXISTS public.fx_cache (
  pair       text PRIMARY KEY,
  rate       numeric(10,4) NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- orders: distinguir pedido de campanha x individual; campaign_id passa a ser opcional.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'CAMPAIGN';
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_kind_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_kind_check CHECK (kind IN ('CAMPAIGN','INDIVIDUAL'));
ALTER TABLE public.orders ALTER COLUMN campaign_id DROP NOT NULL;

-- Seed das 14 faixas (idempotente).
INSERT INTO public.individual_tiers (min_qty, max_qty, usd_per_card) VALUES
  (1,10,2.50),(11,30,2.20),(31,50,2.15),(51,100,2.00),(101,200,1.90),
  (201,300,1.80),(301,400,1.70),(401,500,1.66),(501,600,1.63),(601,700,1.52),
  (701,800,1.41),(801,900,1.30),(901,1000,1.19),(1001,NULL,1.08)
ON CONFLICT (min_qty) DO UPDATE SET max_qty=EXCLUDED.max_qty, usd_per_card=EXCLUDED.usd_per_card;

-- Config inicial (só se ainda não existir).
INSERT INTO public.individual_pricing (multiplier, normal_floor_brl, holo_floor_brl, foil_floor_brl, fx_fallback_rate, min_cards)
SELECT 2.0, 16, 18, 21, 5.50, 15
WHERE NOT EXISTS (SELECT 1 FROM public.individual_pricing);

-- RLS: leitura pública (catálogo/checkout); escrita só via service role.
ALTER TABLE public.individual_tiers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.individual_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_cache           ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read tiers"   ON public.individual_tiers;
DROP POLICY IF EXISTS "read pricing" ON public.individual_pricing;
DROP POLICY IF EXISTS "read fx"      ON public.fx_cache;
CREATE POLICY "read tiers"   ON public.individual_tiers   FOR SELECT USING (true);
CREATE POLICY "read pricing" ON public.individual_pricing FOR SELECT USING (true);
CREATE POLICY "read fx"      ON public.fx_cache           FOR SELECT USING (true);
