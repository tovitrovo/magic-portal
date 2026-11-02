// ──────────────────────────────────────────────────────────────
// Financiamento coletivo de pacotes em português — lógica pura.
//
// Usado pelo servidor (preço autoritativo, /api/crowdfund), pelo app
// (a página da campanha) e pelos testes. Sem rede.
//
// O modelo:
//   - O fornecedor imprime um LOTE de pacotes iguais (100, por padrão).
//   - Os pacotes são vendidos em fila: o pacote nº 1 é o mais barato. Cada
//     faixa (`tiers`) cobre os pacotes até `upto` com um preço por carta.
//   - Um apoio de N pacotes pode atravessar faixas: cada pacote paga a faixa
//     da sua posição na fila (crowdfunding de verdade, sem arredondar a favor
//     de ninguém).
//   - A meta (`goal_packs`) é o número de pacotes que paga o lote inteiro.
// ──────────────────────────────────────────────────────────────

export const DEFAULT_TIERS = [
  { upto: 40, per_card_brl: 10, label: 'Fundadores' },
  { upto: 70, per_card_brl: 13, label: 'Apoiadores' },
  { upto: 100, per_card_brl: 16, label: 'Última chamada' },
];

/** Taxa do Mercado Pago usada no simulador de lucro (cartão/Pix à vista). */
export const MP_FEE_PCT = 4.99;

/** Custo por pacote do fornecedor (lote de 100), por acabamento. */
export const SUPPLIER_LOT_USD = { Normal: 3500, Foil: 4000, Holo: 4500 };

const round2 = (n) => Math.round(n * 100) / 100;

/** Faixas válidas, ordenadas e com `upto` crescente. */
export function normalizeTiers(tiers) {
  const list = (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({ upto: Math.floor(Number(t?.upto)), per_card_brl: Number(t?.per_card_brl), label: String(t?.label || '').trim() }))
    .filter((t) => t.upto > 0 && t.per_card_brl > 0)
    .sort((a, b) => a.upto - b.upto);
  const out = [];
  for (const t of list) if (!out.length || t.upto > out[out.length - 1].upto) out.push(t);
  return out.map((t, i) => ({ ...t, from: i === 0 ? 1 : out[i - 1].upto + 1, label: t.label || `Faixa ${i + 1}` }));
}

/** Total de pacotes à venda: o `upto` da última faixa. */
export function capacityOf(tiers) {
  const t = normalizeTiers(tiers);
  return t.length ? t[t.length - 1].upto : 0;
}

/** Faixa do pacote de número `n` (1-based), ou null se passou da capacidade. */
export function tierForPack(tiers, n) {
  return normalizeTiers(tiers).find((t) => n >= t.from && n <= t.upto) || null;
}

/**
 * Preço de um apoio de `packs` pacotes, com `taken` pacotes já vendidos ou
 * reservados. Devolve { ok, firstPack, breakdown, total, perCardAvg } ou
 * { ok:false, error, available }.
 */
export function quotePledge({ tiers, taken = 0, packs, cardsPerPack = 56 }) {
  const list = normalizeTiers(tiers);
  const cap = list.length ? list[list.length - 1].upto : 0;
  const qty = Math.floor(Number(packs) || 0);
  const used = Math.max(0, Math.floor(Number(taken) || 0));
  const available = Math.max(0, cap - used);
  if (qty < 1) return { ok: false, error: 'Escolha pelo menos 1 pacote', available };
  if (qty > available) return { ok: false, error: available ? `Restam só ${available} pacote(s)` : 'Esgotado', available };
  const cpp = Math.max(1, Math.floor(Number(cardsPerPack) || 56));
  const breakdown = [];
  for (let n = used + 1; n <= used + qty; n++) {
    const t = list.find((x) => n >= x.from && n <= x.upto);
    const last = breakdown[breakdown.length - 1];
    if (last && last.label === t.label && last.per_card_brl === t.per_card_brl) last.packs++;
    else breakdown.push({ label: t.label, packs: 1, per_card_brl: t.per_card_brl, per_pack_brl: round2(t.per_card_brl * cpp) });
  }
  const total = round2(breakdown.reduce((s, b) => s + b.packs * b.per_pack_brl, 0));
  return { ok: true, firstPack: used + 1, breakdown, total, perCardAvg: round2(total / (qty * cpp)), available };
}

/**
 * Estado da campanha para a vitrine: faixa atual, quanto falta nela, meta.
 * `taken` conta pagos + reservados; `paid` só pagos (a meta conta pagos).
 */
export function campaignProgress({ tiers, goalPacks, taken = 0, paid = 0 }) {
  const list = normalizeTiers(tiers);
  const capacity = list.length ? list[list.length - 1].upto : 0;
  const goal = Math.max(1, Math.floor(Number(goalPacks) || 1));
  const current = list.find((t) => taken + 1 >= t.from && taken + 1 <= t.upto) || null;
  const idx = current ? list.indexOf(current) : list.length;
  return {
    capacity,
    taken,
    paid,
    goal,
    goalReached: paid >= goal,
    goalPct: Math.min(100, Math.round((paid / goal) * 100)),
    soldOut: taken >= capacity,
    tiers: list.map((t, i) => ({
      ...t,
      size: t.upto - t.from + 1,
      sold: Math.max(0, Math.min(t.upto, taken) - t.from + 1),
      state: i < idx ? 'done' : i === idx ? 'current' : 'next',
    })),
    current: current ? { ...current, left: current.upto - taken } : null,
    next: list[idx + 1] || null,
  };
}

/** Preço do pacote e da caixa na faixa atual (para o card de compra). */
export function packPrices(tier, cardsPerPack = 56, boxPacks = 4) {
  if (!tier) return null;
  const pack = round2(tier.per_card_brl * cardsPerPack);
  return { pack, box: round2(pack * boxPacks) };
}

/**
 * Simulador do console: custo do lote, receita e lucro se vender tudo, e se
 * a meta paga o lote.
 */
export function financeSummary({ tiers, cardsPerPack = 56, goalPacks, supplierLotUsd, fxRate, fxMarkupPct = 0, extraCostsBrl = 0, paidRevenue = 0, mpFeePct = MP_FEE_PCT }) {
  const fx = Number(fxRate) * (1 + (Number(fxMarkupPct) || 0) / 100);
  const lotCost = round2(Number(supplierLotUsd || 0) * fx + Number(extraCostsBrl || 0));
  const fee = (v) => v * (Number(mpFeePct) || 0) / 100;
  const cap = capacityOf(tiers);
  const full = cap ? quotePledge({ tiers, taken: 0, packs: cap, cardsPerPack }) : null;
  const goalQuote = quotePledge({ tiers, taken: 0, packs: Math.min(cap, Number(goalPacks) || 0), cardsPerPack });
  const fullRevenue = full?.ok ? full.total : 0;
  const goalRevenue = goalQuote.ok ? goalQuote.total : 0;
  const paidNet = round2(paidRevenue - fee(paidRevenue));
  return {
    fxEffective: round2(fx * 100) / 100,
    lotCost,
    costPerPack: cap ? round2(lotCost / cap) : 0,
    costPerCard: cap ? round2(lotCost / (cap * cardsPerPack)) : 0,
    fullRevenue,
    fullProfit: round2(fullRevenue - fee(fullRevenue) - lotCost),
    goalRevenue,
    goalNet: round2(goalRevenue - fee(goalRevenue)),
    goalCoversLot: goalRevenue - fee(goalRevenue) >= lotCost,
    paidNet,
    paidCoversLot: paidNet >= lotCost,
    toCoverLot: round2(Math.max(0, lotCost - paidNet)),
  };
}

// ─── Cartas: Scryfall ────────────────────────────────────────────

/**
 * Cartas que têm pelo menos uma impressão em papel SEM selo holográfico
 * (security stamp). O fornecedor não reproduz o selo, então só essas entram.
 * Com `unique=cards`, o Scryfall devolve justamente uma impressão sem selo.
 */
export const NO_STAMP_FILTER = 'game:paper -stamp:oval -stamp:triangle -stamp:acorn -stamp:arena -stamp:heart -stamp:circle -is:token -t:basic';

export const SUGGESTION_PRESETS = [
  { key: 'commander', label: 'Staples de Commander', q: 'f:commander', order: 'edhrec' },
  { key: 'expensive', label: 'Cartas caras', q: 'usd>=8 (f:modern or f:legacy or f:commander or f:pioneer)', order: 'usd' },
  { key: 'modern', label: 'Modern', q: 'f:modern', order: 'edhrec' },
  { key: 'pauper', label: 'Pauper', q: 'f:pauper', order: 'edhrec' },
];

/** Query do Scryfall para a busca livre ou um atalho. */
export function scryfallQuery(text, presetKey) {
  const preset = SUGGESTION_PRESETS.find((p) => p.key === presetKey);
  const term = String(text || '').trim().replace(/"/g, '');
  const parts = [NO_STAMP_FILTER];
  if (preset) parts.push(preset.q);
  if (term) parts.push(`name:"${term}"`);
  return { q: parts.join(' '), order: preset?.order || 'edhrec' };
}

/** Normaliza um card do Scryfall no formato do voto. */
export function scryfallToVote(card) {
  if (!card) return null;
  const face = Array.isArray(card.card_faces) ? card.card_faces[0] : null;
  const img = card.image_uris?.normal || face?.image_uris?.normal || null;
  const usd = Number(card.prices?.usd || card.prices?.usd_foil || 0) || null;
  return {
    oracle_id: card.oracle_id || face?.oracle_id || card.id,
    card_name: card.name,
    image_url: img,
    set_code: card.set || null,
    usd_price: usd,
  };
}

/** Ranking de votos: [{ oracle_id, card_name, pt_name, image_url, votes, mine }]. */
export function rankVotes(rows, myUserId = null) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.oracle_id) continue;
    const cur = by.get(r.oracle_id) || {
      oracle_id: r.oracle_id, card_name: r.card_name, pt_name: r.pt_name || null,
      image_url: r.image_url || null, set_code: r.set_code || null, usd_price: r.usd_price ?? null,
      votes: 0, mine: false, first: r.created_at || '',
    };
    cur.votes++;
    if (myUserId && r.user_id === myUserId) cur.mine = true;
    if (!cur.pt_name && r.pt_name) cur.pt_name = r.pt_name;
    if (r.created_at && r.created_at < cur.first) cur.first = r.created_at;
    by.set(r.oracle_id, cur);
  }
  // Empate: quem foi sugerida primeiro fica na frente.
  return [...by.values()].sort((a, b) => b.votes - a.votes || String(a.first).localeCompare(String(b.first)) || a.card_name.localeCompare(b.card_name));
}

export const BRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
