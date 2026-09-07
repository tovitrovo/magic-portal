-- ──────────────────────────────────────────────────────────────
-- PORTAL MINIMALISTA — só encomendas individuais
--
--   1. Todo pedido novo nasce INDIVIDUAL (a encomenda coletiva saiu do app).
--   2. O fulfillment ganha o estágio final ENTREGUE, que faltava para a
--      trilha do pedido terminar em algum lugar.
--   3. Álbum de coleção: `collection_items` guarda só o AJUSTE MANUAL. O que
--      foi comprado no portal é derivado dos lotes pagos — duplicar isso numa
--      coluna criaria duas verdades sobre a mesma carta.
--
-- Idempotente: rodar de novo não muda nada.
-- ──────────────────────────────────────────────────────────────

-- 1. Pedido individual como padrão ────────────────────────────
ALTER TABLE public.orders ALTER COLUMN kind SET DEFAULT 'INDIVIDUAL';

-- 2. Estágio final da trilha ──────────────────────────────────
ALTER TABLE public.order_batches DROP CONSTRAINT IF EXISTS order_batches_fulfillment_status_check;
ALTER TABLE public.order_batches ADD CONSTRAINT order_batches_fulfillment_status_check
  CHECK (fulfillment_status IN (
    'AWAITING_SUPPLIER_ORDER','ORDERED_FROM_SUPPLIER','SHIPPED_TO_BR',
    'ARRIVED_BR','PREPARING','LABEL_GENERATED','DELIVERED'
  ));

-- 3. Álbum de coleção ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collection_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id    uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  -- Cópias que ele tem FORA do portal (comprou em loja, ganhou, trocou).
  -- Nunca negativo: o ajuste soma ao comprado, não desconta dele.
  extra_qty  integer NOT NULL DEFAULT 0 CHECK (extra_qty >= 0),
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_user ON public.collection_items(user_id);

ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collection: dono lê"     ON public.collection_items;
DROP POLICY IF EXISTS "collection: dono cria"   ON public.collection_items;
DROP POLICY IF EXISTS "collection: dono edita"  ON public.collection_items;
DROP POLICY IF EXISTS "collection: dono apaga"  ON public.collection_items;

CREATE POLICY "collection: dono lê"    ON public.collection_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "collection: dono cria"  ON public.collection_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "collection: dono edita" ON public.collection_items FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "collection: dono apaga" ON public.collection_items FOR DELETE USING (auth.uid() = user_id);
