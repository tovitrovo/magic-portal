-- Magic Portal — Migração: dados de envio/etiqueta MandaBem em order_batches

ALTER TABLE public.order_batches
  ADD COLUMN IF NOT EXISTS shipping_service text,
  ADD COLUMN IF NOT EXISTS shipping_address jsonb,
  ADD COLUMN IF NOT EXISTS mandabem_envio_id text,
  ADD COLUMN IF NOT EXISTS mandabem_etiqueta text,
  ADD COLUMN IF NOT EXISTS mandabem_status text,
  ADD COLUMN IF NOT EXISTS mandabem_payload jsonb,
  ADD COLUMN IF NOT EXISTS mandabem_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS mandabem_updated_at timestamptz;

COMMENT ON COLUMN public.order_batches.shipping_service
  IS 'Serviço de envio escolhido no checkout (PAC, SEDEX ou PACMINI).';

COMMENT ON COLUMN public.order_batches.mandabem_envio_id
  IS 'ID do envio gerado na API do MandaBem.';

COMMENT ON COLUMN public.order_batches.mandabem_etiqueta
  IS 'Etiqueta/código de rastreio retornado pelo MandaBem.';

COMMENT ON COLUMN public.order_batches.mandabem_status
  IS 'Status atual do envio retornado pelo MandaBem.';

COMMENT ON COLUMN public.order_batches.mandabem_payload
  IS 'Último payload bruto relevante retornado pela API do MandaBem.';

COMMENT ON COLUMN public.order_batches.shipping_address
  IS 'Snapshot do endereço usado para cálculo/geração do envio.';
