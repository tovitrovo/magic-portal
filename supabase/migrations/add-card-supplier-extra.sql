-- Adicional do fornecedor por carta (US$), para cartas especiais.
--
-- A planilha do fornecedor marca algumas cartas com "($5 a card)": ele cobra
-- US$ 5 nelas em vez do preço da faixa. O adicional (US$ 5 − US$ 2,50 da
-- faixa base = 2,50) entra no custo antes do multiplicador e do dólar — ver
-- pricePerCard em shared/individualPricing.js. Já aplicada em produção em
-- 02/11/2026, com as cartas marcadas e o "($5 a card)" tirado dos nomes.
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS supplier_extra_usd numeric(10,2) NOT NULL DEFAULT 0;
