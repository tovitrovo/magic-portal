import { corsHeaders } from "./_cors.js";
import { verifyUser } from "./_admin-auth.js";
import { packPrices, quotePledge, rankVotes } from "../../shared/crowdfund.js";
import {
  sb, loadPublicCampaign, packCounts, progressOf, createPreference,
  syncPledgePayment, lookupVoteCard,
} from "./_crowdfund-helper.js";

const enc = encodeURIComponent;
const MAX_PACKS_PER_PLEDGE = 12;
const OPEN = ["OPEN", "FUNDED"];

/**
 * POST /api/crowdfund — a página do financiamento coletivo.
 *
 *   { action:'get' }                 → campanha, progresso, ranking; com login, os meus apoios e votos
 *   { action:'quote', packs }        → preço de N pacotes agora
 *   { action:'pledge', packs }       → reserva os pacotes (45 min) e devolve o link do Mercado Pago
 *   { action:'pay', pledgeId }       → link de novo para um apoio pendente
 *   { action:'sync', pledgeId }      → "já paguei": confere no Mercado Pago
 *   { action:'cancel', pledgeId }    → desiste de um apoio ainda não pago
 *   { action:'vote', oracle_id }     → sugere/vota numa carta (conferida no Scryfall)
 *   { action:'unvote', oracle_id }
 *
 * 'get' funciona sem login (a vitrine); o resto exige.
 */
export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const env = context.env;
  const { SB_URL, SB_SERVICE_ROLE_KEY } = env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const body = await context.request.json().catch(() => ({}));
  const action = String(body.action || "get");
  const hasToken = !!(context.request.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  const auth = hasToken ? await verifyUser(context, SB_URL, SB_SERVICE_ROLE_KEY) : { ok: false, status: 401, error: "Faça login para participar" };
  if (action !== "get" && !auth.ok) return json({ ok: false, error: auth.error }, auth.status || 401);
  const userId = auth.ok ? auth.userId : null;
  const rest = sb(env);

  try {
    const campaign = await loadPublicCampaign(env);
    if (!campaign) return json({ ok: true, campaign: null });
    const isOpen = OPEN.includes(campaign.status) && (!campaign.deadline || new Date(campaign.deadline) > new Date());

    if (action === "get") {
      const [counts, votes, mine, myVotes] = await Promise.all([
        packCounts(env, campaign.id),
        rest(`crowdfund_votes?campaign_id=eq.${enc(campaign.id)}&select=oracle_id,card_name,pt_name,image_url,set_code,usd_price,user_id,created_at&limit=20000`),
        userId ? rest(`crowdfund_pledges?campaign_id=eq.${enc(campaign.id)}&user_id=eq.${enc(userId)}&status=in.(PENDING,PAID,REFUNDED)&select=id,packs,first_pack,breakdown,total_brl,status,expires_at,mp_link,paid_at,created_at&order=created_at.desc`) : [],
        userId ? rest(`crowdfund_votes?campaign_id=eq.${enc(campaign.id)}&user_id=eq.${enc(userId)}&select=oracle_id`) : [],
      ]);
      const progress = progressOf(campaign, counts);
      const now = Date.now();
      return json({
        ok: true,
        campaign: publicCampaign(campaign),
        isOpen,
        progress: { ...progress, backers: counts.backers },
        prices: packPrices(progress.current, campaign.cards_per_pack, campaign.box_packs),
        ranking: rankVotes(votes, userId).slice(0, 150).map(({ first, ...r }) => r),
        voters: new Set((votes || []).map((v) => v.user_id)).size,
        myPledges: (mine || []).map((p) => ({ ...p, expired: p.status === "PENDING" && new Date(p.expires_at).getTime() < now })),
        myVotes: (myVotes || []).map((v) => v.oracle_id),
        loggedIn: !!userId,
      });
    }

    if (action === "quote" || action === "pledge") {
      if (!isOpen) return json({ ok: false, error: "A campanha não está aceitando apoios agora" }, 409);
      const packs = Math.floor(Number(body.packs) || 0);
      if (packs > MAX_PACKS_PER_PLEDGE) return json({ ok: false, error: `Máximo de ${MAX_PACKS_PER_PLEDGE} pacotes por apoio` }, 400);

      if (action === "quote") {
        const counts = await packCounts(env, campaign.id);
        const q = quotePledge({ tiers: campaign.tiers, taken: counts.taken, packs, cardsPerPack: campaign.cards_per_pack });
        return json(q, q.ok ? 200 : 409);
      }

      if (!env.MP_ACCESS_TOKEN) return json({ ok: false, error: "Mercado Pago não configurado" }, 500);
      // Reserva atômica: se outro apoio entrou entre a cotação e a gravação,
      // a função devolve null e a gente cota de novo com a fila atualizada.
      let pledgeId = null, quote = null;
      for (let attempt = 0; attempt < 4 && !pledgeId; attempt++) {
        const counts = await packCounts(env, campaign.id);
        quote = quotePledge({ tiers: campaign.tiers, taken: counts.taken, packs, cardsPerPack: campaign.cards_per_pack });
        if (!quote.ok) return json(quote, 409);
        pledgeId = await rest("rpc/crowdfund_reserve", {
          method: "POST",
          body: JSON.stringify({
            p_campaign: campaign.id, p_user: userId, p_packs: packs, p_expected_first: quote.firstPack,
            p_breakdown: quote.breakdown, p_total: quote.total, p_ttl_minutes: 45,
          }),
        });
      }
      if (!pledgeId) return json({ ok: false, error: "Muita gente comprando agora — tente de novo em alguns segundos" }, 409);
      const pledge = (await rest(`crowdfund_pledges?id=eq.${enc(pledgeId)}&select=*&limit=1`))[0];
      const origin = new URL(context.request.url).origin;
      const link = await createPreference(env, origin, pledge, campaign);
      return json({ ok: true, pledgeId, mpLink: link, total: quote.total, breakdown: quote.breakdown, firstPack: quote.firstPack });
    }

    // Ações sobre um apoio meu.
    if (["pay", "sync", "cancel"].includes(action)) {
      const pledgeId = String(body.pledgeId || "");
      const pledge = (await rest(`crowdfund_pledges?id=eq.${enc(pledgeId)}&user_id=eq.${enc(userId)}&select=*&limit=1`))?.[0];
      if (!pledge) return json({ ok: false, error: "Apoio não encontrado" }, 404);

      if (action === "sync") {
        if (!env.MP_ACCESS_TOKEN) return json({ ok: false, error: "Mercado Pago não configurado" }, 500);
        const r = await syncPledgePayment(env, pledge.id);
        return json(r, r.ok ? 200 : 502);
      }
      if (pledge.status !== "PENDING") return json({ ok: false, error: "Este apoio não está pendente" }, 409);
      if (action === "cancel") {
        await rest(`crowdfund_pledges?id=eq.${enc(pledge.id)}&status=eq.PENDING`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "CANCELLED" }) });
        return json({ ok: true });
      }
      // pay: a reserva venceu → o preço pode ter mudado; pede um apoio novo.
      if (new Date(pledge.expires_at) < new Date()) {
        return json({ ok: false, code: "EXPIRED", error: "A reserva venceu e as vagas voltaram para a fila. Faça um apoio novo com o preço atual." }, 409);
      }
      const link = pledge.mp_link || await createPreference(env, new URL(context.request.url).origin, pledge, campaign);
      return json({ ok: true, mpLink: link });
    }

    if (action === "vote" || action === "unvote") {
      if (!["OPEN", "FUNDED", "DRAFT"].includes(campaign.status)) return json({ ok: false, error: "A votação está encerrada" }, 409);
      const oracleId = String(body.oracle_id || "").trim();
      if (!oracleId) return json({ ok: false, error: "Carta inválida" }, 400);
      if (action === "unvote") {
        await rest(`crowdfund_votes?campaign_id=eq.${enc(campaign.id)}&user_id=eq.${enc(userId)}&oracle_id=eq.${enc(oracleId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return json({ ok: true });
      }
      const mineCount = (await rest(`crowdfund_votes?campaign_id=eq.${enc(campaign.id)}&user_id=eq.${enc(userId)}&select=id`))?.length || 0;
      const max = Number(campaign.max_votes_per_user) || 20;
      if (mineCount >= max) return json({ ok: false, error: `Você já usou seus ${max} votos. Tire o voto de uma carta para votar em outra.` }, 409);
      const card = await lookupVoteCard(oracleId);
      if (!card) return json({ ok: false, error: "Essa carta só existe com selo holográfico — não dá para imprimir" }, 422);
      await rest("crowdfund_votes?on_conflict=campaign_id,user_id,oracle_id", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ campaign_id: campaign.id, user_id: userId, ...card }),
      });
      return json({ ok: true, card, left: max - mineCount - 1 });
    }

    return json({ ok: false, error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
}

// O que o público vê da campanha: sem custos do fornecedor.
function publicCampaign(c) {
  return {
    id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle, description: c.description,
    status: c.status, finish: c.finish, cards_per_pack: c.cards_per_pack, box_packs: c.box_packs,
    goal_packs: c.goal_packs, deadline: c.deadline, max_votes_per_user: c.max_votes_per_user,
    final_cards: c.final_cards || [],
  };
}
