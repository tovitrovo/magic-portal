// Servidor do financiamento coletivo: banco, Mercado Pago e Scryfall.
// A regra de preço mora em shared/crowdfund.js; aqui só I/O.
import { NO_STAMP_FILTER, campaignProgress, scryfallToVote } from "../../shared/crowdfund.js";
import { notifyAdminsOnce, loadActorLabel, BRL } from "./_notify.js";

const enc = encodeURIComponent;
export const CF_PREFIX = "cf_";
const MP = "https://api.mercadopago.com";

export function sb(env) {
  const { SB_URL, SB_SERVICE_ROLE_KEY: KEY } = env || {};
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  return async function rest(path, init = {}) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${init.method || "GET"} ${path.split("?")[0]}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res.status === 204 ? null : res.json().catch(() => null);
  };
}

/** Campanha visível ao público: a mais recente que não é rascunho. */
export async function loadPublicCampaign(env) {
  const rows = await sb(env)("crowdfund_campaigns?status=neq.DRAFT&select=*&order=created_at.desc&limit=1");
  return rows?.[0] || null;
}

export async function loadCampaignById(env, id) {
  const rows = await sb(env)(`crowdfund_campaigns?id=eq.${enc(id)}&select=*&limit=1`);
  return rows?.[0] || null;
}

/** Pacotes ocupados (pagos + reservas válidas) e pagos. */
export async function packCounts(env, campaignId) {
  const now = new Date().toISOString();
  const rows = await sb(env)(`crowdfund_pledges?campaign_id=eq.${enc(campaignId)}&or=(status.eq.PAID,and(status.eq.PENDING,expires_at.gt.${enc(now)}))&select=packs,status,total_brl,shipping_brl`);
  // Receita sem o frete: o frete é repasse para o MandaBem.
  let taken = 0, paid = 0, paidRevenue = 0, backers = 0;
  for (const r of rows || []) {
    taken += r.packs;
    if (r.status === "PAID") { paid += r.packs; paidRevenue += (Number(r.total_brl) || 0) - (Number(r.shipping_brl) || 0); backers++; }
  }
  return { taken, paid, paidRevenue: Math.round(paidRevenue * 100) / 100, backers };
}

export function progressOf(campaign, counts) {
  return campaignProgress({ tiers: campaign.tiers, goalPacks: campaign.goal_packs, taken: counts.taken, paid: counts.paid });
}

// ── Mercado Pago ─────────────────────────────────────────────

export async function createPreference(env, origin, pledge, campaign) {
  const pref = {
    external_reference: CF_PREFIX + pledge.id,
    items: [{
      title: `${campaign.title} — ${pledge.packs} pacote(s)`,
      quantity: 1, unit_price: Number(Number(pledge.total_brl).toFixed(2)), currency_id: "BRL",
    }],
    notification_url: `${origin}/api/mp-webhook`,
    back_urls: { success: `${origin}/?apoio=ok`, pending: `${origin}/?apoio=ok`, failure: `${origin}/?apoio` },
    auto_return: "approved",
    expires: true,
    expiration_date_to: new Date(pledge.expires_at).toISOString(),
  };
  const res = await fetch(`${MP}/checkout/preferences`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(pref),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago: ${data?.message || res.status}`);
  const link = data.init_point || data.sandbox_init_point;
  await sb(env)(`crowdfund_pledges?id=eq.${enc(pledge.id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ mp_link: link, mp_preference_id: data.id || null }),
  });
  return link;
}

const MP_TO_PLEDGE = { approved: "PAID", refunded: "REFUNDED", charged_back: "REFUNDED" };

/**
 * Aplica um pagamento do Mercado Pago a um apoio. Chamado pelo webhook e pelo
 * "já paguei" do app. Idempotente: um apoio pago não volta a pendente.
 */
export async function applyCrowdfundPayment(env, pledgeId, payment) {
  const rest = sb(env);
  const rows = await rest(`crowdfund_pledges?id=eq.${enc(pledgeId)}&select=*&limit=1`);
  const pledge = rows?.[0];
  if (!pledge) return { ok: false, error: "Apoio não encontrado" };
  const mpStatus = String(payment?.status || "");
  let next = MP_TO_PLEDGE[mpStatus] || null;
  const amount = Number(payment?.transaction_amount || 0);
  if (next === "PAID" && amount + 0.01 < Number(pledge.total_brl)) {
    console.error(`crowdfund: pago ${amount} < total ${pledge.total_brl} no apoio ${pledgeId}`);
    next = null;
  }
  const patch = { mp_payment_id: String(payment?.id || ""), payment_status: mpStatus, payment_amount: amount || null };
  if (next === "PAID" && pledge.status !== "PAID" && pledge.status !== "REFUNDED") {
    patch.status = "PAID"; patch.paid_at = new Date().toISOString();
  } else if (next === "REFUNDED" && pledge.status !== "REFUNDED") {
    patch.status = "REFUNDED"; patch.refunded_at = new Date().toISOString();
  }
  await rest(`crowdfund_pledges?id=eq.${enc(pledgeId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });

  if (patch.status === "PAID") {
    const short = pledgeId.slice(0, 8).toUpperCase();
    const client = (await loadActorLabel(env, pledge.user_id)) || "Cliente";
    await notifyAdminsOnce(env, `cfpaid:${pledgeId}`, {
      type: "ORDER_PAID",
      title: "🇧🇷 Novo apoio no financiamento",
      body: `${client} · ${pledge.packs} pacote(s) · ${BRL(pledge.total_brl)} · #${short}`,
      data: { pledgeId, shortId: short }, actorUserId: pledge.user_id, url: "/?admin=crowdfund",
    }).catch(() => {});
    // Meta batida: a campanha vira FUNDED e o admin é avisado uma vez.
    const campaign = await loadCampaignById(env, pledge.campaign_id);
    if (campaign?.status === "OPEN") {
      const counts = await packCounts(env, campaign.id);
      if (counts.paid >= campaign.goal_packs) {
        await rest(`crowdfund_campaigns?id=eq.${enc(campaign.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "FUNDED", updated_at: new Date().toISOString() }) });
        await notifyAdminsOnce(env, `cffunded:${campaign.id}`, {
          type: "ORDER_PAID", title: "🎉 Meta do financiamento batida!",
          body: `${campaign.title}: ${counts.paid} pacotes pagos (${BRL(counts.paidRevenue)}). Já dá para encomendar o lote.`,
          data: { campaignId: campaign.id }, url: "/?admin=crowdfund",
        }).catch(() => {});
      }
    }
  }
  return { ok: true, status: patch.status || pledge.status };
}

/** Procura no Mercado Pago o pagamento de um apoio e aplica (botão "já paguei"). */
export async function syncPledgePayment(env, pledgeId) {
  const r = await fetch(`${MP}/v1/payments/search?external_reference=${enc(CF_PREFIX + pledgeId)}&sort=date_created&criteria=desc&limit=5`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (!r.ok) return { ok: false, error: `Mercado Pago ${r.status}` };
  const results = (await r.json().catch(() => ({}))).results || [];
  const best = results.find((p) => p.status === "approved") || results[0];
  if (!best) return { ok: true, status: "PENDING" };
  return applyCrowdfundPayment(env, pledgeId, best);
}

// ── Scryfall ─────────────────────────────────────────────────

const SCRYFALL_HEADERS = { "User-Agent": "MagicPortal/1.0", Accept: "application/json" };

/**
 * Confere no Scryfall que a carta existe e tem impressão sem selo, e busca o
 * nome em português quando houver. Devolve o voto pronto ou null.
 */
export async function lookupVoteCard(oracleId) {
  const id = String(oracleId || "").replace(/[^0-9a-f-]/gi, "");
  if (!id) return null;
  const q = (extra) => `https://api.scryfall.com/cards/search?unique=cards&include_multilingual=true&q=${enc(`oracleid:${id} ${NO_STAMP_FILTER}${extra}`)}`;
  const r = await fetch(q(""), { headers: SCRYFALL_HEADERS });
  if (!r.ok) return null;
  const card = ((await r.json().catch(() => ({}))).data || [])[0];
  const vote = scryfallToVote(card);
  if (!vote) return null;
  try {
    const pt = await fetch(q(" lang:pt"), { headers: SCRYFALL_HEADERS });
    if (pt.ok) {
      const c = ((await pt.json().catch(() => ({}))).data || [])[0];
      vote.pt_name = c?.printed_name || c?.card_faces?.[0]?.printed_name || null;
    }
  } catch { /* sem nome em PT, segue com o inglês */ }
  return vote;
}
