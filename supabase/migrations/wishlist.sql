-- ══════════════════════════════════════════════════════════════
-- LISTA DE DESEJOS — tabela própria, desacoplada do pedido
-- ══════════════════════════════════════════════════════════════
--
-- Antes, a "lista de wants" eram linhas de `order_items` com
-- `batch_id IS NULL AND in_cart = false`. Isso dava ao desejo o ciclo de vida
-- de um item de pedido: mover para o carrinho tirava a carta da lista, e
-- comprar a fazia sumir de vez (a linha ganhava `batch_id` e caía fora do
-- filtro). Uma lista de desejos precisa do contrário — ela sobrevive à compra
-- e registra o que já foi adquirido.
--
-- `wishlist_items` é por USUÁRIO, não por pedido nem por campanha. Uma linha
-- por (user_id, card_id); `quantity` é quanto a pessoa quer e `acquired_qty`
-- é quanto já comprou.
--
-- Idempotente: pode rodar de novo com segurança. Os dois INSERT de backfill
-- recalculam a partir de `order_items`, que continua sendo a fonte da verdade
-- do que foi comprado — reexecutar chega no mesmo resultado, não acumula.

-- ──────────────────────────────────────────────
-- 1. Tabela
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wishlist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id      uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  quantity     integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  acquired_qty integer NOT NULL DEFAULT 0 CHECK (acquired_qty >= 0),
  acquired_at  timestamptz,
  created_at   timestamptz DEFAULT now()
);

-- Uma carta aparece uma vez só na lista de cada pessoa. O índice unique também
-- é o que permite o ON CONFLICT dos backfills abaixo e do upsert do app.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_user_card
  ON public.wishlist_items(user_id, card_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_user
  ON public.wishlist_items(user_id);

-- ──────────────────────────────────────────────
-- 2. RLS — cada um enxerga e mexe só na sua lista
-- ──────────────────────────────────────────────
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own wishlist" ON public.wishlist_items;
CREATE POLICY "Users can view own wishlist" ON public.wishlist_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own wishlist" ON public.wishlist_items;
CREATE POLICY "Users can insert own wishlist" ON public.wishlist_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own wishlist" ON public.wishlist_items;
CREATE POLICY "Users can update own wishlist" ON public.wishlist_items
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own wishlist" ON public.wishlist_items;
CREATE POLICY "Users can delete own wishlist" ON public.wishlist_items
  FOR DELETE USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- 3. Backfill — desejos ainda não comprados
-- ──────────────────────────────────────────────
-- As linhas soltas de order_items (sem batch) eram a lista de desejos antiga.
-- Inclui as que estavam `in_cart = true`: no modelo novo, mandar para o
-- carrinho copia em vez de mover, então uma carta no carrinho continua sendo
-- um desejo. Deixá-las de fora apagaria da lista justamente as cartas que a
-- pessoa mais quer. `DO NOTHING` mantém a reexecução segura.
INSERT INTO public.wishlist_items (user_id, card_id, quantity, created_at)
SELECT o.user_id, oi.card_id, SUM(oi.quantity), MIN(oi.created_at)
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
 WHERE oi.batch_id IS NULL
   AND oi.is_bonus IS NOT TRUE
 GROUP BY o.user_id, oi.card_id
    ON CONFLICT (user_id, card_id) DO NOTHING;

-- ──────────────────────────────────────────────
-- 4. Backfill — o que já foi comprado
-- ──────────────────────────────────────────────
-- Dá história à lista: cartas compradas no passado entram marcadas como
-- adquiridas, então o catálogo consegue avisar "você já comprou esta".
-- O SET usa EXCLUDED direto (não soma) justamente para ser idempotente: o
-- SELECT já agrega o total de order_items, que é a fonte da verdade.
INSERT INTO public.wishlist_items (user_id, card_id, quantity, acquired_qty, acquired_at, created_at)
SELECT o.user_id, oi.card_id, SUM(oi.quantity), SUM(oi.quantity), MAX(oi.created_at), MIN(oi.created_at)
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
 WHERE oi.batch_id IS NOT NULL
   AND oi.is_bonus IS NOT TRUE
 GROUP BY o.user_id, oi.card_id
    ON CONFLICT (user_id, card_id) DO UPDATE
   SET acquired_qty = EXCLUDED.acquired_qty,
       acquired_at  = EXCLUDED.acquired_at;

-- ──────────────────────────────────────────────
-- 5. Limpeza (opcional, destrutiva — rode só depois de conferir)
-- ──────────────────────────────────────────────
-- Depois do backfill, as linhas de order_items que representavam desejos
-- viram lixo: o app não lê mais `in_cart = false` sem batch. Elas são
-- inofensivas, então a remoção fica comentada e a critério de quem migra.
--
-- DELETE FROM public.order_items
--  WHERE batch_id IS NULL AND is_bonus IS NOT TRUE AND in_cart IS NOT TRUE;
