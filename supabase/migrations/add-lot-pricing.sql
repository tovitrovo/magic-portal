-- ──────────────────────────────────────────────────────────────
-- Precificação de LOTES (sets, uncut sheets, "PCS/Set"...).
--
-- Lotes não são cartas avulsas: o preço é formado pelo custo de lista do
-- fornecedor convertido pelo dólar do dia, com o custo real do PayPal e uma
-- margem embutidos:
--
--   price_brl = teto( cost_original_usd × dólar × lot_cost_factor × (1 + lot_margin_percent/100) )
--
--   lot_cost_factor   → cobre o PayPal pago no cartão de crédito BR:
--                       spread PayPal 4,5% × IOF 3,5% = 1,045 × 1,035 ≈ 1,082
--   lot_margin_percent→ lucro + taxa de recebimento do Mercado Pago
--
-- O price_brl é um override travado: quando presente, é o preço de venda
-- (vale nos dois modos, Encomenda e Individual). É recalculado por dia,
-- na importação e sob demanda (botão admin / endpoint admin-recalc-lots).
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS is_lot    boolean NOT NULL DEFAULT false;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS price_brl numeric(10,2);  -- override de preço de venda

ALTER TABLE public.pricing_config ADD COLUMN IF NOT EXISTS lot_cost_factor    numeric(8,4) NOT NULL DEFAULT 1.082;
ALTER TABLE public.pricing_config ADD COLUMN IF NOT EXISTS lot_margin_percent numeric(8,4) NOT NULL DEFAULT 15;
