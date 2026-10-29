import { verifyAdmin } from './_admin-auth.js';
import { identifyShippingService, normalizeShippingService, SHIPPING_SERVICE_UNKNOWN } from '../../shared/shipping-groups.js';
import { isShippingAdjustment } from '../../shared/shippingAddressChange.js';

import {
  sanitizeDceText, normalizeMandaBemShipmentData, extractMandaBemTrackingCode, getMandaBemTrackingDetails, onlyDigits, clampText, packageForQuantity, assertMandabemSuccess, postMandabem, addCredentials, queryShipment, DEFAULT_ORIGIN_CEP, DEFAULT_QUOTE_ORIGIN_CEP, SERVICES,
} from './_mandabem.js';
import { notifyAdmins } from './_notify.js';

// Reexportados para os testes, que importam deste módulo.
export { sanitizeDceText, normalizeMandaBemShipmentData, extractMandaBemTrackingCode };

function json(data, status, CORS) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function patchBatches(SB_URL, headers, batchIds, data) {
  const ids = batchIds.map(id => String(id)).filter(Boolean);
  const filter = ids.length === 1 ? `id=eq.${encodeURIComponent(ids[0])}` : `id=in.(${ids.map(encodeURIComponent).join(",")})`;
  const res = await fetch(`${SB_URL}/rest/v1/order_batches?${filter}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase PATCH falhou: ${res.status} ${text.slice(0, 240)}`);
  }
  return res.json().catch(() => []);
}

async function quoteService(env, cepDestino, quantity, service) {
  const pkg = packageForQuantity(quantity);
  const params = new URLSearchParams();
  addCredentials(params, env);
  params.set("cep_origem", onlyDigits(env.MANDABEM_CEP_COTACAO_ORIGEM || DEFAULT_QUOTE_ORIGIN_CEP));
  params.set("cep_destino", cepDestino);
  params.set("servico", service);
  params.set("peso", pkg.peso);
  params.set("altura", pkg.altura);
  params.set("largura", pkg.largura);
  params.set("comprimento", pkg.comprimento);
  params.set("valor_seguro", "0");
  try {
    const payload = await postMandabem("valor_envio", params);
    const result = assertMandabemSuccess(payload);
    const raw = result?.[service]?.valor;
    if (!raw) return null;
    let price = Number(String(raw).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) return null;
    if (price > 300) price /= 100;
    return { service, price: Math.round((price + 1.2) * 100) / 100 };
  } catch (error) {
    console.warn(`[MandaBem] Cotação ${service} falhou:`, error?.message || error);
    return null;
  }
}

function destinationFor(batch) {
  const savedAddress = batch.shipping_address || {};
  const profile = batch.orders?.profiles || {};
  return { ...profile, ...savedAddress, name: savedAddress.name || profile.name, email: savedAddress.email || profile.email };
}

function validateDestination(destination) {
  const missing = [];
  if (!destination.name) missing.push("nome");
  if (onlyDigits(destination.cep).length !== 8) missing.push("CEP");
  if (!destination.rua) missing.push("logradouro");
  if (!destination.numero) missing.push("número");
  if (!destination.bairro) missing.push("bairro");
  if (!destination.cidade) missing.push("cidade");
  if (!destination.uf) missing.push("UF");
  return missing;
}

export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }, 500, CORS);
    const admin = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
    if (!admin.ok) return json({ ok: false, error: admin.error }, admin.status || 403, CORS);

    const body = await context.request.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.batchIds) ? body.batchIds : [body.batchId];
    const batchIds = [...new Set(requestedIds.map(id => String(id || "").trim()).filter(Boolean))];
    const action = String(body.action || "generate");
    const forceGenerate = body.force === true;
    const override = normalizeShippingService(body.formaEnvio);
    if (!batchIds.length) return json({ ok: false, error: "batchId ausente" }, 400, CORS);

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };
    const select = "id,order_id,status,payment_status,created_at,qty_in_batch,shipping_locked,shipping_already_paid,shipping_group_id,shipping_service,shipping_address,mandabem_envio_id,mandabem_etiqueta,mandabem_rastreamento,mandabem_status,orders(id,user_id,profiles(name,email,cep,rua,numero,complemento,bairro,cidade,uf))";
    const batchFilter = batchIds.length === 1 ? `id=eq.${encodeURIComponent(batchIds[0])}` : `id=in.(${batchIds.map(encodeURIComponent).join(",")})`;
    const batchRes = await fetch(`${SB_URL}/rest/v1/order_batches?${batchFilter}&select=${encodeURIComponent(select)}`, { headers });
    if (!batchRes.ok) {
      const text = await batchRes.text().catch(() => "");
      return json({ ok: false, error: `Falha ao buscar lotes: ${batchRes.status} ${text.slice(0, 200)}` }, 502, CORS);
    }
    const batches = await batchRes.json().catch(() => []);
    if (!Array.isArray(batches) || batches.length !== batchIds.length) return json({ ok: false, error: "Um ou mais lotes não foram encontrados" }, 404, CORS);
    if (new Set(batches.map(batch => batch.orders?.user_id)).size !== 1) return json({ ok: false, error: "Os lotes do grupo pertencem a clientes diferentes" }, 400, CORS);

    const paidShippingBatches = batches.filter(batch => !batch.shipping_already_paid && Number(batch.shipping_locked || 0) > 0);
    if (paidShippingBatches.length > 1) return json({ ok: false, error: "O grupo contém mais de um frete pago" }, 400, CORS);
    const rootBatch = batches.find(batch => String(batch.id) === String(body.rootBatchId || "")) || paidShippingBatches[0];
    if (!rootBatch || !paidShippingBatches.some(batch => batch.id === rootBatch.id)) return json({ ok: false, error: "Grupo sem pedido original com frete pago" }, 400, CORS);
    const groupId = String(rootBatch.shipping_group_id || rootBatch.id);
    const destination = destinationFor(rootBatch);
    const missing = validateDestination(destination);
    if (missing.length) return json({ ok: false, error: `Endereço incompleto do cliente: ${missing.join(", ")}` }, 400, CORS);
    const totalQuantity = batches.reduce((sum, batch) => sum + Number(batch.qty_in_batch || 0), 0);

    if (action === "identify") {
      const quoteResults = await Promise.all(["PACMINI", "SEDEX", "PAC"].map(service => quoteService(context.env, onlyDigits(destination.cep), totalQuantity, service)));
      const quotes = quoteResults.filter(Boolean);
      const service = identifyShippingService(rootBatch.shipping_locked, quotes);
      const updated = await patchBatches(SB_URL, headers, batchIds, { shipping_group_id: groupId, shipping_service: service });
      return json({ ok: true, service, quotes, identified: service !== SHIPPING_SERVICE_UNKNOWN, batches: updated }, 200, CORS);
    }

    const existing = batches.find(batch => batch.mandabem_envio_id);
    if ((action === "refresh" || (existing && !forceGenerate)) && existing?.mandabem_envio_id) {
      const info = await queryShipment(context.env, existing.mandabem_envio_id, groupId);
      const shipment = info.data || {};
      const trackingInfo = getMandaBemTrackingDetails(shipment, existing.mandabem_status, info.payload);
      const trackingCode = trackingInfo.code || existing.mandabem_rastreamento || existing.mandabem_etiqueta || null;
      const trackingStatus = trackingInfo.status;
      const updated = await patchBatches(SB_URL, headers, batchIds, {
        shipping_group_id: groupId,
        shipping_service: override || normalizeShippingService(rootBatch.shipping_service) || normalizeShippingService(existing.shipping_service) || SHIPPING_SERVICE_UNKNOWN,
        mandabem_envio_id: String(existing.mandabem_envio_id),
        mandabem_etiqueta: trackingCode,
        mandabem_rastreamento: trackingCode,
        mandabem_status: trackingStatus,
        mandabem_payload: info.payload,
        mandabem_updated_at: new Date().toISOString(),
      });
      return json({ ok: true, generated: false, batches: updated, shipment, tracking_code: trackingCode, tracking_status: trackingStatus }, 200, CORS);
    }

    if (batches.some(batch => String(batch.status).toUpperCase() === "CANCELLED")) return json({ ok: false, error: "Não é possível gerar etiqueta para pedido cancelado" }, 400, CORS);

    // Cliente pediu troca de endereço e ainda não pagou a diferença de frete:
    // a etiqueta sairia para o endereço velho. Espera o pagamento ou cancela
    // a cobrança pendente no console.
    const pendingRes = await fetch(`${SB_URL}/rest/v1/order_batches?shipping_group_id=eq.${encodeURIComponent(groupId)}&status=in.(DRAFT,AWAITING_PAYMENT)&select=id,qty_in_batch,shipping_locked,shipping_already_paid`, { headers });
    if (!pendingRes.ok) {
      const text = await pendingRes.text().catch(() => "");
      return json({ ok: false, error: `Falha ao buscar cobranças pendentes: ${pendingRes.status} ${text.slice(0, 200)}` }, 502, CORS);
    }
    const pendingRows = await pendingRes.json().catch(() => []);
    const pendingAdjustments = (Array.isArray(pendingRows) ? pendingRows : []).filter(isShippingAdjustment);
    if (pendingAdjustments.length) return json({ ok: false, error: "O cliente pediu troca de endereço e a diferença de frete ainda não foi paga. Aguarde o pagamento ou cancele essa cobrança." }, 409, CORS);
    const service = override || normalizeShippingService(rootBatch.shipping_service);
    if (!SERVICES.has(service)) return json({ ok: false, error: "Serviço de envio ausente ou inválido. Selecione PAC, SEDEX ou PACMINI." }, 400, CORS);

    const itemFilter = batchIds.length === 1 ? `batch_id=eq.${encodeURIComponent(batchIds[0])}` : `batch_id=in.(${batchIds.map(encodeURIComponent).join(",")})`;
    const itemsRes = await fetch(`${SB_URL}/rest/v1/order_items?${itemFilter}&select=${encodeURIComponent("batch_id,quantity,unit_price_brl,cards(name,type)")}`, { headers });
    if (!itemsRes.ok) {
      const text = await itemsRes.text().catch(() => "");
      return json({ ok: false, error: `Falha ao buscar itens: ${itemsRes.status} ${text.slice(0, 200)}` }, 502, CORS);
    }
    const items = await itemsRes.json().catch(() => []);
    const pkg = packageForQuantity(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || totalQuantity);
    const params = new URLSearchParams();
    addCredentials(params, context.env);
    params.set("forma_envio", service);
    params.set("destinatario", sanitizeDceText(destination.name, 40));
    params.set("cep", onlyDigits(destination.cep));
    params.set("logradouro", clampText(destination.rua, 60));
    params.set("numero", clampText(destination.numero, 6));
    if (destination.complemento) params.set("complemento", clampText(destination.complemento, 30));
    params.set("cidade", clampText(destination.cidade, 40));
    params.set("bairro", clampText(destination.bairro, 60));
    params.set("estado", clampText(destination.uf, 2).toUpperCase());
    params.set("peso", pkg.peso);
    params.set("altura", pkg.altura);
    params.set("largura", pkg.largura);
    params.set("comprimento", pkg.comprimento);
    params.set("valor_seguro", "0");
    params.set("ref_id", groupId);
    params.set("integration", "MagicPortal");
    if (destination.email) params.set("email", clampText(destination.email, 120));
    params.set("cep_origem", onlyDigits(context.env.MANDABEM_CEP_ORIGEM || DEFAULT_ORIGIN_CEP));
    items.forEach((item, index) => {
      const name = `${item.cards?.name || "Carta"}${item.cards?.type ? ` (${item.cards.type})` : ""}`;
      params.append(`produtos[${index}][nome]`, sanitizeDceText(name, 80) || "Carta");
      params.append(`produtos[${index}][quantidade]`, String(Math.max(Number(item.quantity || 1), 1)));
      params.append(`produtos[${index}][preco]`, Number(item.unit_price_brl || 0).toFixed(2));
    });

    const generatedPayload = await postMandabem("gerar_envio", params);
    const generated = assertMandabemSuccess(generatedPayload);
    const envioId = generated.envio_id;
    if (!envioId) throw new Error(generated.mensagem || "MandaBem não retornou envio_id");
    let shipment = {};
    let finalPayload = generatedPayload;
    try {
      const info = await queryShipment(context.env, envioId, groupId);
      shipment = info.data || {};
      finalPayload = { generated: generatedPayload, shipment: info.payload };
    } catch (error) {
      finalPayload = { generated: generatedPayload, shipment_error: String(error?.message || error) };
    }
    const trackingInfo = getMandaBemTrackingDetails(shipment, generated.mensagem || "Envio gerado", finalPayload, generated);
    const trackingCode = trackingInfo.code;
    const trackingStatus = trackingInfo.status || "Envio gerado";
    const updated = await patchBatches(SB_URL, headers, batchIds, {
      shipping_group_id: groupId,
      shipping_service: service,
      mandabem_envio_id: String(envioId),
      mandabem_etiqueta: trackingCode,
      mandabem_rastreamento: trackingCode,
      mandabem_status: trackingStatus,
      mandabem_payload: finalPayload,
      mandabem_generated_at: new Date().toISOString(),
      mandabem_updated_at: new Date().toISOString(),
      // A etiqueta é o "Enviado" da trilha do cliente — e o ponto de partida
      // do rastreio automático (/api/cron, job tracking).
      fulfillment_status: "LABEL_GENERATED",
    });
    await notifyAdmins(context.env, {
      type: "SHIPMENT_LABEL",
      title: "🏷️ Etiqueta gerada",
      body: `${destination.name || "Cliente"} · ${service}${trackingCode ? ` · ${trackingCode}` : ""} · #${groupId.slice(0, 8).toUpperCase()}`,
      data: { shortId: groupId.slice(0, 8).toUpperCase(), groupId, envioId: String(envioId), trackingCode, clientName: destination.name || "" },
      actorUserId: rootBatch.orders?.user_id || null,
      url: "/?admin=shipping",
    });
    return json({ ok: true, generated: true, batches: updated, envio_id: envioId, shipment, tracking_code: trackingCode, tracking_status: trackingStatus }, 200, CORS);
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500, CORS);
  }
}
