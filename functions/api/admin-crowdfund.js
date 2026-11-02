import { corsHeaders } from "./_cors.js";
import { verifyAdmin } from "./_admin-auth.js";
import { getUsdBrlRate } from "./_fx-helper.js";
import { refundBatch } from "./_mp-refund.js";
import { emailConfigured, sendEmailBatch, unsubscribeUrl } from "./_email.js";
import { broadcastAudience, siteUrlOf } from "./_automation.js";
import { SUPPLIER_LOT_USD, financeSummary, normalizeTiers, rankVotes } from "../../shared/crowdfund.js";
import { DEFAULT_CROWDFUND_INVITE, crowdfundInviteEmail } from "../../shared/reminders.js";
import { CF_PREFIX, sb, loadCampaignById, packCounts, progressOf } from "./_crowdfund-helper.js";

const enc = encodeURIComponent;
const REFUNDS_PER_CALL = 15; // teto de subrequests das Pages Functions
const IMAGE_SLOTS = ["hero", "pack", "box", "back", "gallery"];

const EDITABLE = {
  title: "text", subtitle: "text", description: "text", status: "status", finish: "finish",
  cards_per_pack: "int", box_packs: "int", goal_packs: "int", deadline: "date", tiers: "tiers",
  supplier_lot_usd: "num", supplier_lot_packs: "int", extra_costs_brl: "num", fx_markup_pct: "num",
  max_votes_per_user: "int",
};

/**
 * POST /api/admin-crowdfund — console do financiamento coletivo.
 *
 *   { action:'get' }                                   → campanha, apoios, ranking, finanças, e-mail
 *   { action:'save', patch }                           → edita a campanha
 *   { action:'final', cards:[oracle_id] }              → fecha a lista final do pacote
 *   { action:'invite', subject, message }              → e-mail para toda a base do portal
 *   { action:'refund_all' }                            → reembolsa os apoios pagos (em partes)
 *   { action:'image', slot, dataUrl }                  → sobe uma imagem da landing (slot: hero|pack|box|back|gallery)
 *   { action:'image', slot, remove:true, url? }        → tira a imagem do slot (na galeria, a do url)
 */
export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const env = context.env;
  const { SB_URL, SB_SERVICE_ROLE_KEY } = env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);
  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const action = String(body.action || "get");
  const rest = sb(env);

  try {
    const rows = await rest("crowdfund_campaigns?select=*&order=created_at.desc&limit=1").catch((e) => {
      throw new Error(/crowdfund_campaigns/.test(String(e)) ? "Banco sem a migração crowdfund.sql" : String(e));
    });
    let campaign = rows?.[0];
    if (!campaign) return json({ ok: false, error: "Nenhuma campanha. Rode supabase/migrations/crowdfund.sql." }, 404);

    if (action === "save") {
      const patch = cleanPatch(body.patch || {});
      if (patch.finish && body.patch.supplier_lot_usd === undefined) patch.supplier_lot_usd = SUPPLIER_LOT_USD[patch.finish];
      if (!Object.keys(patch).length) return json({ ok: false, error: "Nada para salvar" }, 400);
      patch.updated_at = new Date().toISOString();
      await rest(`crowdfund_campaigns?id=eq.${enc(campaign.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      campaign = await loadCampaignById(env, campaign.id);
    }

    if (action === "final") {
      const ids = (Array.isArray(body.cards) ? body.cards : []).map(String);
      const votes = await rest(`crowdfund_votes?campaign_id=eq.${enc(campaign.id)}&select=oracle_id,card_name,pt_name,image_url,set_code,usd_price,user_id,created_at&limit=20000`);
      const byId = new Map(rankVotes(votes).map((r) => [r.oracle_id, r]));
      const final = ids.map((id) => byId.get(id)).filter(Boolean)
        .map(({ oracle_id, card_name, pt_name, image_url, set_code, votes: v }) => ({ oracle_id, card_name, pt_name, image_url, set_code, votes: v }));
      await rest(`crowdfund_campaigns?id=eq.${enc(campaign.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ final_cards: final, updated_at: new Date().toISOString() }) });
      campaign.final_cards = final;
    }

    if (action === "image") {
      const slot = String(body.slot || "");
      if (!IMAGE_SLOTS.includes(slot)) return json({ ok: false, error: "Espaço de imagem inválido" }, 400);
      const images = { ...(campaign.images || {}) };
      if (body.remove) {
        if (slot === "gallery") images.gallery = (images.gallery || []).filter((u) => u !== body.url);
        else delete images[slot];
      } else {
        const m = String(body.dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!m) return json({ ok: false, error: "Envie uma imagem JPG, PNG ou WebP" }, 400);
        const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
        if (bytes.byteLength > 6 * 1024 * 1024) return json({ ok: false, error: "Imagem acima de 6 MB" }, 413);
        const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
        const file = `crowdfund/${campaign.slug}-${slot}-${Date.now()}.${ext}`;
        const up = await fetch(`${SB_URL}/storage/v1/object/cards/${file}`, {
          method: "POST",
          headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": m[1], "x-upsert": "true" },
          body: bytes,
        });
        if (!up.ok) return json({ ok: false, error: `Storage: ${up.status} ${(await up.text()).slice(0, 160)}` }, 502);
        const url = `${SB_URL}/storage/v1/object/public/cards/${file}`;
        if (slot === "gallery") images.gallery = [...(images.gallery || []), url].slice(0, 12);
        else images[slot] = url;
      }
      await rest(`crowdfund_campaigns?id=eq.${enc(campaign.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ images, updated_at: new Date().toISOString() }) });
      campaign.images = images;
    }

    if (action === "invite") {
      if (!emailConfigured(env)) return json({ ok: false, error: "Configure RESEND_API_KEY no Cloudflare Pages" }, 400);
      const subject = String(body.subject || DEFAULT_CROWDFUND_INVITE.subject).slice(0, 200);
      const message = String(body.message || DEFAULT_CROWDFUND_INVITE.message).slice(0, 5000);
      const [people, siteUrl] = await Promise.all([broadcastAudience(env), siteUrlOf(env)]);
      if (!siteUrl) return json({ ok: false, error: "Domínio do site ainda não registrado (Mais → Automações)" }, 400);
      const ctaUrl = `${siteUrl}/?apoio`;
      const messages = people.map((p) => {
        const unsubUrl = unsubscribeUrl(siteUrl, p.unsubToken);
        return { to: p.email, ...crowdfundInviteEmail({ subject, message }, p, { ctaUrl, unsubUrl }), unsubUrl };
      });
      const result = { recipients: messages.length, ...(await sendEmailBatch(env, messages)) };
      return json({ ok: true, result });
    }

    if (action === "refund_all") {
      if (!env.MP_ACCESS_TOKEN) return json({ ok: false, error: "MP_ACCESS_TOKEN não configurado" }, 500);
      const paid = await rest(`crowdfund_pledges?campaign_id=eq.${enc(campaign.id)}&status=eq.PAID&select=id,mp_payment_id&limit=${REFUNDS_PER_CALL}`);
      const result = { refunded: 0, failed: 0, firstError: null };
      for (const p of paid || []) {
        const r = await refundBatch({ id: CF_PREFIX + p.id, mp_payment_id: p.mp_payment_id }, env.MP_ACCESS_TOKEN);
        if (r.ok) {
          result.refunded++;
          await rest(`crowdfund_pledges?id=eq.${enc(p.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "REFUNDED", refunded_at: new Date().toISOString() }) });
        } else { result.failed++; result.firstError = result.firstError || r.error; }
      }
      const left = (await rest(`crowdfund_pledges?campaign_id=eq.${enc(campaign.id)}&status=eq.PAID&select=id`))?.length || 0;
      if (!left && campaign.status !== "CANCELLED") {
        await rest(`crowdfund_campaigns?id=eq.${enc(campaign.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "CANCELLED", updated_at: new Date().toISOString() }) });
      }
      return json({ ok: true, result: { ...result, left } });
    }

    if (!["get", "save", "final", "image"].includes(action)) return json({ ok: false, error: "Ação desconhecida" }, 400);

    // Visão completa para o console.
    const [counts, pledges, votes, fx, audience, siteUrl] = await Promise.all([
      packCounts(env, campaign.id),
      rest(`crowdfund_pledges?campaign_id=eq.${enc(campaign.id)}&select=id,user_id,packs,first_pack,breakdown,total_brl,shipping_brl,shipping_service,shipping_address,status,expires_at,paid_at,refunded_at,created_at,profiles(name,email,whatsapp)&order=first_pack.asc&limit=2000`),
      rest(`crowdfund_votes?campaign_id=eq.${enc(campaign.id)}&select=oracle_id,card_name,pt_name,image_url,set_code,usd_price,user_id,created_at&limit=20000`),
      getUsdBrlRate(SB_URL, SB_SERVICE_ROLE_KEY).catch(() => ({ rate: 5.5, source: "fallback" })),
      broadcastAudience(env).then((a) => a.length).catch(() => null),
      siteUrlOf(env).catch(() => null),
    ]);
    const progress = progressOf(campaign, counts);
    const finance = financeSummary({
      tiers: campaign.tiers, cardsPerPack: campaign.cards_per_pack, goalPacks: campaign.goal_packs,
      supplierLotUsd: campaign.supplier_lot_usd, fxRate: fx.rate, fxMarkupPct: campaign.fx_markup_pct,
      extraCostsBrl: campaign.extra_costs_brl, paidRevenue: counts.paidRevenue,
    });
    const ctaUrl = siteUrl ? `${siteUrl}/?apoio` : null;
    return json({
      ok: true,
      campaign,
      progress: { ...progress, backers: counts.backers, paidRevenue: counts.paidRevenue },
      finance: { ...finance, fx },
      pledges: pledges || [],
      ranking: rankVotes(votes).map(({ first, ...r }) => r),
      voters: new Set((votes || []).map((v) => v.user_id)).size,
      email: {
        configured: emailConfigured(env), audience, ctaUrl,
        defaults: DEFAULT_CROWDFUND_INVITE,
        // Versão para colar no Wix (sem nome nem descadastro do portal).
        wix: ctaUrl ? crowdfundInviteEmail(DEFAULT_CROWDFUND_INVITE, null, { ctaUrl: `${ctaUrl}&origem=wix`, unsubUrl: null }) : null,
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
}

function cleanPatch(raw) {
  const out = {};
  for (const [k, kind] of Object.entries(EDITABLE)) {
    if (raw[k] === undefined) continue;
    const v = raw[k];
    if (kind === "text") out[k] = String(v ?? "").slice(0, k === "description" ? 4000 : 200);
    else if (kind === "int") { const n = Math.floor(Number(v)); if (n > 0) out[k] = n; }
    else if (kind === "num") { const n = Number(v); if (Number.isFinite(n) && n >= 0) out[k] = n; }
    else if (kind === "status") { if (["DRAFT", "OPEN", "FUNDED", "CLOSED", "CANCELLED"].includes(v)) out[k] = v; }
    else if (kind === "finish") { if (["Normal", "Foil", "Holo"].includes(v)) out[k] = v; }
    else if (kind === "date") out[k] = v ? new Date(v).toISOString() : null;
    else if (kind === "tiers") { const t = normalizeTiers(v); if (t.length) out[k] = t.map(({ upto, per_card_brl, label }) => ({ upto, per_card_brl, label })); }
  }
  return out;
}
