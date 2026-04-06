-- ══════════════════════════════════════════════════════════════
-- Magic Portal — Migração: Campo shipping_already_paid em order_batches
-- ══════════════════════════════════════════════════════════════
-- Adiciona campo para indicar que o cliente marcou "Já paguei o frete".
-- Quando true, o frete não é cobrado neste lote porque o cliente informou
-- que já pagou o frete em um pedido/envio anterior.
--
-- Seguro para executar várias vezes (idempotente).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.order_batches
  ADD COLUMN IF NOT EXISTS shipping_already_paid boolean DEFAULT false;

COMMENT ON COLUMN public.order_batches.shipping_already_paid
  IS 'true quando o cliente marcou "Já paguei o frete" no checkout. O frete não é cobrado neste lote.';
