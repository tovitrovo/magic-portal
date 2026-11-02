-- ══════════════════════════════════════════════════════════════
-- FINANCIAMENTO COLETIVO — pacotes de cartas em português
-- ══════════════════════════════════════════════════════════════
--
-- O fornecedor imprime um lote de 100 pacotes iguais ("Custom 100 sets Print
-- service": US$ 3.500 normal, 4.000 foil, 4.500 holo). A campanha vende esses
-- pacotes antes de encomendar: quem entra primeiro paga menos por carta, e a
-- primeira faixa sozinha precisa pagar o lote inteiro.
--
-- Três tabelas, todas lidas e escritas SÓ pelas Pages Functions com a
-- service role (/api/crowdfund e /api/admin-crowdfund). O app nunca fala
-- com elas pelo REST direto: preço e contagem de vagas são do servidor.
--
--   crowdfund_campaigns — a campanha (faixas, meta, prazo, acabamento)
--   crowdfund_pledges   — cada apoio: N pacotes com preço travado na hora
--   crowdfund_votes     — sugestões/votos de cartas (1 linha por pessoa×carta)
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.crowdfund_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  subtitle        text,
  description     text,
  -- OPEN: aceitando apoio · FUNDED: meta batida, ainda vendendo ·
  -- CLOSED: vendas encerradas · CANCELLED: não bateu a meta (reembolsos)
  -- DRAFT: só o admin vê.
  status          text NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','OPEN','FUNDED','CLOSED','CANCELLED')),
  finish          text NOT NULL DEFAULT 'Normal' CHECK (finish IN ('Normal','Foil','Holo')),
  cards_per_pack  integer NOT NULL DEFAULT 56 CHECK (cards_per_pack > 0),
  box_packs       integer NOT NULL DEFAULT 4 CHECK (box_packs > 0),
  -- [{ "upto": 40, "per_card_brl": 10, "label": "Fundadores" }, ...]
  -- Faixas por número do pacote vendido; a última "upto" é o total à venda.
  tiers           jsonb NOT NULL DEFAULT '[{"upto":40,"per_card_brl":10,"label":"Fundadores"},{"upto":70,"per_card_brl":13,"label":"Apoiadores"},{"upto":100,"per_card_brl":16,"label":"Última chamada"}]'::jsonb,
  goal_packs      integer NOT NULL DEFAULT 40 CHECK (goal_packs > 0),
  deadline        timestamptz,
  -- Custo do fornecedor, para o simulador do console.
  supplier_lot_usd   numeric NOT NULL DEFAULT 3500,
  supplier_lot_packs integer NOT NULL DEFAULT 100,
  extra_costs_brl    numeric NOT NULL DEFAULT 1030, -- frete FedEx + pedidos AliExpress
  fx_markup_pct      numeric NOT NULL DEFAULT 5.6,  -- spread do PayPal/banco sobre a PTAX
  max_votes_per_user integer NOT NULL DEFAULT 20,
  -- Lista final escolhida pelo admin: [{ oracle_id, name, pt_name, image_url }]
  final_cards     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crowdfund_pledges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES public.crowdfund_campaigns(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  packs           integer NOT NULL CHECK (packs > 0),
  -- Posição na fila: pacotes [first_pack, first_pack + packs - 1].
  first_pack      integer NOT NULL CHECK (first_pack > 0),
  -- [{ "label": "Fundadores", "packs": 2, "per_card_brl": 10, "per_pack_brl": 560 }]
  breakdown       jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_brl       numeric NOT NULL CHECK (total_brl > 0),
  -- PENDING: reservado, esperando pagamento (expira) · PAID · EXPIRED ·
  -- CANCELLED: desistiu antes de pagar · REFUNDED: dinheiro devolvido
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED','REFUNDED')),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '45 minutes'),
  mp_link         text,
  mp_preference_id text,
  mp_payment_id   text,
  payment_status  text,
  payment_amount  numeric,
  paid_at         timestamptz,
  refunded_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cf_pledges_campaign ON public.crowdfund_pledges(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_cf_pledges_user ON public.crowdfund_pledges(user_id);

CREATE TABLE IF NOT EXISTS public.crowdfund_votes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES public.crowdfund_campaigns(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  oracle_id    text NOT NULL,          -- Scryfall oracle_id: a carta, não a impressão
  card_name    text NOT NULL,
  pt_name      text,
  image_url    text,
  set_code     text,                   -- impressão sem selo usada de referência
  usd_price    numeric,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_votes_unique ON public.crowdfund_votes(campaign_id, user_id, oracle_id);
CREATE INDEX IF NOT EXISTS idx_cf_votes_campaign ON public.crowdfund_votes(campaign_id, oracle_id);

-- Vagas: dois apoios não podem pegar o mesmo número de pacote. A função
-- reserva sob lock da campanha, calcula a posição e grava o apoio de uma vez.
-- O preço por faixa é calculado no servidor (shared/crowdfund.js) e passado
-- pronto; a função confere que a posição usada no cálculo ainda é a mesma —
-- se outro apoio entrou no meio, devolve NULL e a API recalcula.
CREATE OR REPLACE FUNCTION public.crowdfund_reserve(
  p_campaign uuid, p_user uuid, p_packs integer, p_expected_first integer,
  p_breakdown jsonb, p_total numeric, p_ttl_minutes integer DEFAULT 45
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_taken integer;
  v_id uuid;
BEGIN
  PERFORM 1 FROM crowdfund_campaigns WHERE id = p_campaign AND status IN ('OPEN','FUNDED') FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Reservas vencidas liberam a vaga.
  UPDATE crowdfund_pledges SET status = 'EXPIRED'
   WHERE campaign_id = p_campaign AND status = 'PENDING' AND expires_at < now();
  SELECT COALESCE(SUM(packs), 0) INTO v_taken FROM crowdfund_pledges
   WHERE campaign_id = p_campaign AND status IN ('PENDING','PAID');
  IF v_taken + 1 <> p_expected_first THEN RETURN NULL; END IF;
  INSERT INTO crowdfund_pledges (campaign_id, user_id, packs, first_pack, breakdown, total_brl, expires_at)
  VALUES (p_campaign, p_user, p_packs, p_expected_first, p_breakdown, p_total, now() + make_interval(mins => p_ttl_minutes))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.crowdfund_reserve(uuid, uuid, integer, integer, jsonb, numeric, integer) FROM anon, authenticated, PUBLIC;

-- Fechadas para o REST público: só a service role lê e escreve.
ALTER TABLE public.crowdfund_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crowdfund_pledges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crowdfund_votes     ENABLE ROW LEVEL SECURITY;

-- A primeira campanha nasce em rascunho: o admin revisa e abre no console.
INSERT INTO public.crowdfund_campaigns (slug, title, subtitle, description, deadline)
VALUES (
  'pt-1',
  'Cartas em Português — Pacote 1',
  '56 cartas diferentes em português, escolhidas pela comunidade.',
  'Pela primeira vez, staples e cartas caras de Magic impressas em português. Cada pacote tem 56 cartas diferentes; a caixa com 4 pacotes fecha um playset completo. Quem entra primeiro paga menos.',
  now() + interval '30 days'
)
ON CONFLICT (slug) DO NOTHING;

-- ── Frete na hora e imagens da landing ─────────────────────────
-- O frete (MandaBem) é cotado no servidor no momento do apoio e entra no
-- total cobrado; shipping_brl fica separado para não inflar a receita.
ALTER TABLE public.crowdfund_pledges ADD COLUMN IF NOT EXISTS shipping_service text;
ALTER TABLE public.crowdfund_pledges ADD COLUMN IF NOT EXISTS shipping_brl numeric NOT NULL DEFAULT 0;
ALTER TABLE public.crowdfund_pledges ADD COLUMN IF NOT EXISTS shipping_address jsonb;
-- Imagens da landing: { hero, pack, box, back, gallery: [url, ...] }
ALTER TABLE public.crowdfund_campaigns ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '{}'::jsonb;
