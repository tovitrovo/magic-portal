-- ──────────────────────────────────────────────────────────────
-- FULFILLMENT DO PEDIDO INDIVIDUAL (status simplificado de importação)
--
--   Pago → Encomenda feita → A caminho do Brasil → Chegou no Brasil →
--   Em preparação → (admin gera etiqueta MandaBem, que assume o rastreio)
--
-- Usado apenas para orders.kind = 'INDIVIDUAL'. Não afeta o fluxo da
-- Encomenda Coletiva, que continua usando o status global da campanha.
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.order_batches ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'AWAITING_SUPPLIER_ORDER';
ALTER TABLE public.order_batches DROP CONSTRAINT IF EXISTS order_batches_fulfillment_status_check;
ALTER TABLE public.order_batches ADD CONSTRAINT order_batches_fulfillment_status_check
  CHECK (fulfillment_status IN ('AWAITING_SUPPLIER_ORDER','ORDERED_FROM_SUPPLIER','SHIPPED_TO_BR','ARRIVED_BR','PREPARING','LABEL_GENERATED'));
ALTER TABLE public.order_batches ADD COLUMN IF NOT EXISTS fulfillment_status_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_order_batches_fulfillment ON public.order_batches(fulfillment_status);
