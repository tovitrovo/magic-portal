-- ──────────────────────────────────────────────────────────────
-- Corrige o upsert da importação de catálogo via CSV.
--
-- O índice unique de import_ref era PARCIAL (WHERE import_ref IS NOT NULL).
-- O PostgREST monta o upsert como ON CONFLICT (import_ref) sem repetir o
-- predicado do índice, então o Postgres não consegue inferir o índice parcial
-- e devolve:
--   42P10 "there is no unique or exclusion constraint matching the
--   ON CONFLICT specification"
--
-- A solução é usar um índice unique COMPLETO. NULLs continuam permitidos em
-- múltiplas linhas porque NULLs são tratados como distintos em índices unique.
-- ──────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_cards_import_ref;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_import_ref
  ON public.cards(import_ref);
