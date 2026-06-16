-- Magic Portal — Migração: código de rastreamento MandaBem em order_batches

ALTER TABLE public.order_batches
  ADD COLUMN IF NOT EXISTS mandabem_rastreamento text;

COMMENT ON COLUMN public.order_batches.mandabem_rastreamento
  IS 'Código de rastreamento retornado automaticamente pela API do MandaBem.';
