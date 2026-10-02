import { verifyUser } from "./_admin-auth.js";
import { corsHeaders } from "./_cors.js";
import { quoteShipping } from "./_frete-helper.js";
import { loadUserBatches, patchShipmentAddress } from "./_shipping-change-helper.js";
import { normalizeShippingService } from "../../shared/shipping-groups.js";
import {
  ADDRESS_LOCKED_ERROR, batchesCarryingShipment, canChangeShipmentAddress, missingAddressFields,
  normalizeAddress, paidShippingOf, pendingAdjustmentOf, shipmentOf, shippingDifference,
} from "../../shared/shippingAddressChange.js";

const enc = encodeURIComponent;

// POST /api/change-shipping-address
// body: { batchId, address:{cep,rua,numero,complemento,bairro,cidade,uf}, service?, confirm? }
//
// Sem `confirm`: cota o frete do endereço novo e devolve, por serviço, a
// diferença a pagar. Com `confirm` + `service`: aplica. Diferença zero troca
// o endereço da remessa na hora; diferença positiva cria um lote de ajuste
// de frete (pago pelo Mercado Pago) e o endereço só passa a valer quando o
// pagamento cai (ver applyPaidShippingAdjustment).
export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const auth = await verifyUser(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const batchId = String(body.batchId || "").trim();
  if (!batchId) return json({ ok: false, error: "batchId ausente" }, 400);

  const missing = missingAddressFields(body.address);
  if (missing.length) return json({ ok: false, error: `Endereço incompleto: ${missing.join(", ")}` }, 400);
  const newAddress = normalizeAddress(body.address);

  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  try {
    // Só lotes do próprio usuário entram: a posse é garantida pela consulta.
    const batches = await loadUserBatches(SB_URL, SB_SERVICE_ROLE_KEY, auth.userId);
    const shipment = shipmentOf(batches, batchId);
    if (!shipment) return json({ ok: false, error: "Pedido não encontrado ou ainda não pago" }, 404);
    if (!canChangeShipmentAddress(shipment)) return json({ ok: false, code: "ADDRESS_LOCKED", error: ADDRESS_LOCKED_ERROR }, 409);
    if (pendingAdjustmentOf(batches, shipment)) {
      return json({ ok: false, code: "ADJUSTMENT_PENDING", error: "Já existe uma troca de endereço aguardando o pagamento da diferença. Pague ou cancele essa antes." }, 409);
    }

    const root = shipment.rootBatch;
    const profileRes = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${enc(auth.userId)}&select=name,email,cep,rua,numero,complemento,bairro,cidade,uf&limit=1`, { headers });
    const profile = (await profileRes.json().catch(() => []))[0] || {};
    // Mesmo fallback da etiqueta: lote sem endereço salvo usa o do perfil.
    const currentAddress = { ...profile, ...(root.shipping_address || {}) };
    const currentService = normalizeShippingService(root.shipping_service);
    const quantity = shipment.batches.reduce((s, b) => s + (Number(b.qty_in_batch) || 0), 0) || 1;
    const paidShipping = paidShippingOf(shipment);

    const currentCep = String(currentAddress.cep || "").replace(/\D/g, "");
    const [nextQuote, currentQuote] = await Promise.all([
      quoteShipping(context.env, newAddress.cep, quantity),
      currentCep.length === 8 && currentService ? quoteShipping(context.env, currentCep, quantity) : Promise.resolve({ opcoes: [] }),
    ]);
    if (nextQuote.error) return json({ ok: false, error: `Erro no frete: ${nextQuote.error}` }, 502);
    if (!nextQuote.opcoes.length) return json({ ok: false, error: "O MandaBem não retornou opções de frete para este CEP." }, 422);
    const currentPrice = currentQuote.opcoes.find(o => o.nome === currentService)?.preco ?? null;

    const options = nextQuote.opcoes.map(o => ({
      service: o.nome, price: o.preco, prazo: o.prazo,
      difference: shippingDifference({ newPrice: o.preco, currentPrice, paidShipping }),
    }));

    if (!body.confirm) {
      return json({ ok: true, options, currentService: currentService || null, currentAddress: normalizeAddress(currentAddress) });
    }

    const chosen = options.find(o => o.service === normalizeShippingService(body.service));
    if (!chosen || chosen.difference === null) return json({ ok: false, error: "Escolha uma opção de frete válida" }, 400);

    // name/email do destinatário seguem os que já estavam no envio.
    const address = { ...newAddress, name: currentAddress.name || profile.name || "", ...(currentAddress.email ? { email: currentAddress.email } : {}) };

    if (chosen.difference <= 0) {
      await patchShipmentAddress(SB_URL, SB_SERVICE_ROLE_KEY, batchesCarryingShipment(batches, shipment), { address, service: chosen.service });
      return json({ ok: true, applied: true, difference: 0 });
    }

    const adjRes = await fetch(`${SB_URL}/rest/v1/order_batches`, {
      method: "POST", headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        order_id: root.order_id, status: "DRAFT", payment_method: "MERCADO_PAGO",
        brl_unit_price_locked: 0, qty_in_batch: 0, subtotal_locked: 0,
        shipping_locked: chosen.difference, total_locked: chosen.difference,
        shipping_service: chosen.service, shipping_address: address,
        shipping_already_paid: true, shipping_group_id: shipment.rootId,
        fulfillment_status: root.fulfillment_status || "AWAITING_SUPPLIER_ORDER",
      }),
    });
    if (!adjRes.ok) return json({ ok: false, error: `Falha ao criar cobrança: ${adjRes.status} ${(await adjRes.text()).slice(0, 160)}` }, 502);
    const adj = (await adjRes.json())[0];

    return json({
      ok: true, applied: false, difference: chosen.difference,
      adjustmentBatchId: adj.id, rootShortId: String(shipment.rootId).slice(0, 8).toUpperCase(),
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
