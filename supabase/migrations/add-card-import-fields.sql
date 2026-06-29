-- ──────────────────────────────────────────────────────────────
-- Suporte à importação de catálogo de cartas via CSV do fornecedor
-- (endpoint /api/admin-import-cards + seção no painel admin).
-- ──────────────────────────────────────────────────────────────

-- Custo em USD do fornecedor (não é o preço de venda ao cliente).
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS cost_usd          numeric(10,2);
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS cost_original_usd numeric(10,2);

-- Referência estável da linha do CSV (nome do arquivo de image_file).
-- Permite que re-uploads façam UPSERT em vez de duplicar cartas.
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS import_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_import_ref
  ON public.cards(import_ref) WHERE import_ref IS NOT NULL;

-- Bucket público para as imagens das cartas (image_url aponta para cá).
INSERT INTO storage.buckets (id, name, public)
VALUES ('cards', 'cards', true)
ON CONFLICT (id) DO UPDATE SET public = true;
