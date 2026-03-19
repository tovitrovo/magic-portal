-- Add tcg column to cards table (defaults to 'Magic' for existing cards)
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS tcg text NOT NULL DEFAULT 'Magic';

-- Index for efficient filtering by tcg
CREATE INDEX IF NOT EXISTS idx_cards_tcg ON public.cards(tcg);
