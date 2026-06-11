-- Vincula lotes que devem compartilhar uma única etiqueta de envio.
-- O lote raiz é o que efetivamente cobrou o frete; lotes posteriores que usam
-- "envio conjunto" apontam para ele.

ALTER TABLE public.order_batches
  ADD COLUMN IF NOT EXISTS shipping_group_id uuid REFERENCES public.order_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_batches_shipping_group_id_idx
  ON public.order_batches(shipping_group_id);

COMMENT ON COLUMN public.order_batches.shipping_group_id
  IS 'Lote raiz do grupo de envio. Todos os lotes do grupo compartilham uma única etiqueta.';

COMMENT ON COLUMN public.order_batches.shipping_service
  IS 'Serviço de envio normalizado (PAC, SEDEX, PACMINI ou UNKNOWN quando não identificado).';
