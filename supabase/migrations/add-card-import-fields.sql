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
-- Índice unique completo (sem WHERE) para casar com ON CONFLICT (import_ref) no
-- upsert. Um índice PARCIAL não é inferível pelo ON CONFLICT do PostgREST e gera
-- o erro 42P10 ("no unique or exclusion constraint matching the ON CONFLICT").
-- NULLs continuam permitidos em múltiplas linhas (NULLs são distintos).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_import_ref
  ON public.cards(import_ref);

-- Bucket público para as imagens das cartas (image_url aponta para cá).
INSERT INTO storage.buckets (id, name, public)
VALUES ('cards', 'cards', true)
ON CONFLICT (id) DO UPDATE SET public = true;
