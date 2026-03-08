-- ══════════════════════════════════════════════════════════════
-- Magic Portal — Supabase Schema
-- ══════════════════════════════════════════════════════════════
-- Execute este script no SQL Editor do Supabase para criar
-- todas as tabelas, foreign keys, índices e políticas RLS
-- necessárias para o funcionamento do painel admin e do app.
--
-- IMPORTANTE: este script é idempotente (usa IF NOT EXISTS).
-- Pode ser re-executado com segurança.
-- ══════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1. PROFILES (estende auth.users)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text,
  email       text,
  whatsapp    text,
  is_admin    boolean DEFAULT false,
  mana_color_1 text,
  mana_color_2 text,
  guild       text,
  cep         text,
  rua         text,
  numero      text,
  complemento text,
  bairro      text,
  cidade      text,
  uf          text,
  created_at  timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────
-- 2. CAMPAIGNS
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  status              text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','ACTIVE','LOCKED','ORDERING','ORDERED','RECEIVED','PACKING','SHIPPING','DONE','CANCELLED')),
  close_at            timestamptz,
  max_cards           integer,
  pool_qty_confirmed  integer DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────
-- 3. TIERS (faixas de preço por campanha)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tiers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  rank          integer NOT NULL DEFAULT 0,
  label         text,
  min_qty       integer,
  max_qty       integer,
  usd_per_card  numeric(10,4),
  quest_text    text,
  created_at    timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────
-- 4. PRICING_CONFIG (configuração global de preço)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pricing_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active         boolean DEFAULT true,
  usd_brl_rate      numeric(10,4) NOT NULL DEFAULT 5.0,
  card_fee_percent  numeric(6,4) DEFAULT 0,
  tax_percent       numeric(6,4) DEFAULT 0,
  markup_percent    numeric(6,4) DEFAULT 0,
  profit_fixed_brl  numeric(10,2) DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────
-- 5. CARDS (catálogo de cartas)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text DEFAULT 'Normal',
  image_url   text,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────
-- 6. ORDERS (pedidos — 1 por usuário por campanha)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                 uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id                     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status                      text NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT','PAID','CANCELLED')),
  qty_paid                    integer DEFAULT 0,
  qty_bonus                   integer DEFAULT 0,
  shipping_price_brl_locked   numeric(10,2),
  created_at                  timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────
-- 7. ORDER_BATCHES (lotes de pagamento)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_batches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','PENDING_PAYMENT','PAID','CONFIRMED','CANCELLED','FAILED','REFUNDED','CHARGEDBACK')),
  payment_method        text,
  brl_unit_price_locked numeric(10,4),
  qty_in_batch          integer DEFAULT 0,
  subtotal_locked       numeric(10,2),
  shipping_locked       numeric(10,2),
  total_locked          numeric(10,2),
  mp_link               text,
  mp_preference_id      text,
  mp_payment_id         text,
  payment_status        text,
  payment_status_detail text,
  payment_amount        numeric(10,2),
  mp_payload            jsonb,
  confirmed_at          timestamptz,
  created_at            timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────
-- 8. ORDER_ITEMS (itens dentro de um batch/pedido)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  batch_id        uuid REFERENCES public.order_batches(id) ON DELETE SET NULL,
  card_id         uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  quantity        integer NOT NULL DEFAULT 1,
  is_bonus        boolean DEFAULT false,
  unit_price_brl  numeric(10,4) DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────
-- 9. BONUS_GRANTS (bônus por campanha)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bonus_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  bonus_qty     integer NOT NULL DEFAULT 0,
  status        text DEFAULT 'AVAILABLE'
                  CHECK (status IN ('AVAILABLE','USED','EXPIRED')),
  created_at    timestamptz DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- INDEXES (para queries frequentes do app e admin)
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_orders_campaign    ON public.orders(campaign_id);
CREATE INDEX IF NOT EXISTS idx_orders_user        ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_order_batches_order ON public.order_batches(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order  ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_batch  ON public.order_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_order_items_card   ON public.order_items(card_id);
CREATE INDEX IF NOT EXISTS idx_tiers_campaign     ON public.tiers(campaign_id);
CREATE INDEX IF NOT EXISTS idx_bonus_grants_user  ON public.bonus_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_grants_camp  ON public.bonus_grants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cards_active       ON public.cards(is_active);
CREATE INDEX IF NOT EXISTS idx_campaigns_status   ON public.campaigns(status);

-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ══════════════════════════════════════════════════════════════
-- O painel admin usa SB_SERVICE_ROLE_KEY (bypassa RLS).
-- As políticas abaixo protegem o acesso via anon/user token.

-- ─── profiles ────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ─── campaigns (leitura pública) ─────────────
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view campaigns" ON public.campaigns;
CREATE POLICY "Anyone can view campaigns" ON public.campaigns
  FOR SELECT USING (true);

-- ─── tiers (leitura pública) ─────────────────
ALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view tiers" ON public.tiers;
CREATE POLICY "Anyone can view tiers" ON public.tiers
  FOR SELECT USING (true);

-- ─── pricing_config (leitura pública) ────────
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view pricing" ON public.pricing_config;
CREATE POLICY "Anyone can view pricing" ON public.pricing_config
  FOR SELECT USING (true);

-- ─── cards (leitura pública) ─────────────────
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view cards" ON public.cards;
CREATE POLICY "Anyone can view cards" ON public.cards
  FOR SELECT USING (true);

-- ─── orders ──────────────────────────────────
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own orders" ON public.orders;
CREATE POLICY "Users can insert own orders" ON public.orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own orders" ON public.orders;
CREATE POLICY "Users can update own orders" ON public.orders
  FOR UPDATE USING (auth.uid() = user_id);

-- ─── order_batches ───────────────────────────
ALTER TABLE public.order_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own batches" ON public.order_batches;
CREATE POLICY "Users can view own batches" ON public.order_batches
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_batches.order_id AND orders.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert own batches" ON public.order_batches;
CREATE POLICY "Users can insert own batches" ON public.order_batches
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_batches.order_id AND orders.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own batches" ON public.order_batches;
CREATE POLICY "Users can update own batches" ON public.order_batches
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_batches.order_id AND orders.user_id = auth.uid())
  );

-- ─── order_items ─────────────────────────────
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own items" ON public.order_items;
CREATE POLICY "Users can view own items" ON public.order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert own items" ON public.order_items;
CREATE POLICY "Users can insert own items" ON public.order_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own items" ON public.order_items;
CREATE POLICY "Users can update own items" ON public.order_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete own items" ON public.order_items;
CREATE POLICY "Users can delete own items" ON public.order_items
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
  );

-- ─── bonus_grants ────────────────────────────
ALTER TABLE public.bonus_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own bonus" ON public.bonus_grants;
CREATE POLICY "Users can view own bonus" ON public.bonus_grants
  FOR SELECT USING (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════
-- TRIGGER: auto-criar perfil ao registrar usuário
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
