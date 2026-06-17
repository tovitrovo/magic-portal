import { verifyAdmin } from './_admin-auth.js';
import { identifyShippingService, normalizeShippingService, SHIPPING_SERVICE_UNKNOWN } from '../../shared/shipping-groups.js';

const DEFAULT_MANDABEM_ID = "68245";
const DEFAULT_MANDABEM_KEY = "$2y$10$yrre6QlN25SlbnYtyNIHSOBA5jDsKe9nRixugJnYCQSmFZOztuS7.";
const DEFAULT_ORIGIN_CEP = "05412002";
const DEFAULT_QUOTE_ORIGIN_CEP = "05410010";
const SERVICES = new Set(["PAC", "SEDEX", "PACMINI"]);
const MAX_RAW_DEBUG_LENGTH = 2000;

function safeStringify(value, maxLen = 500) {
  try { return JSON.stringify(value).slice(0, maxLen); }
  catch (_) { return String(value).slice(0, maxLen); }
}

function json(data, status, CORS) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function onlyDigits(value = "") { return String(value || "").replace(/\D/g, ""); }
function clampText(value, max) { return String(value || "").trim().slice(0, max); }


function normalizeMandaBemShipmentData(dados, envioId = '', refId = '') {
  if (!dados || typeof dados !== "object") return {};
  const candidates = Array.isArray(dados) ? dados : Object.values(dados).every(value => value && typeof value === "object") ? Object.values(dados) : [dados];
  const wantedEnvioId = String(envioId || "");
  const wantedRefId = String(refId || "");
  return candidates.find(item => {
    if (!item || typeof item !== "object") return false;
    const itemEnvioId = String(item.envio_id || item.id || "");
    const itemRefId = String(item.ref_id || "");
    return (wantedEnvioId && itemEnvioId === wantedEnvioId) || (wantedRefId && itemRefId === wantedRefId);
  }) || candidates.find(item => item && typeof item === "object") || {};
}

function extractMandaBemTrackingCode(shipment, ...fallbackSources) {
  // MandaBem API /ws/envio documents resultado.dados.etiqueta as the shipment tracking code.
  return clampText(shipment?.etiqueta, 80) || extractMandaBemTracking(...fallbackSources);
}

function extractMandaBemTracking(...sources) {
  const trackingKeys = new Set([
    "rastreamento",
    "rastreio",
    "codigorastreamento",
    "codigorastreio",
    "codrastreamento",
    "codrastreio",
    "tracking",
    "trackingcode",
    "objeto",
  ]);
  const seen = new Set();
  const normalizeKey = key => String(key || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  function visit(value) {
    if (!value || typeof value !== "object") return "";
    if (seen.has(value)) return "";
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return "";
    }
    for (const [key, raw] of Object.entries(value)) {
      if (trackingKeys.has(normalizeKey(key)) && raw != null && typeof raw !== "object") {
        const tracking = clampText(raw, 80);
        if (tracking) return tracking;
      }
    }
    for (const raw of Object.values(value)) {
      const found = visit(raw);
      if (found) return found;
    }
    return "";
  }

  for (const source of sources) {
    const found = visit(source);
    if (found) return found;
  }
  return "";
}

function packageForQuantity(quantity) {
  const qty = Math.max(Number(quantity || 0), 1);
  return {
    peso: String(Math.max((qty * 2 + 50) / 1000, 0.3)),
    altura: String(Math.min(Math.max(Math.ceil(qty / 50), 2), 4)),
    largura: "16",
    comprimento: "24",
  };
}

async function readMandabemJson(res) {
  const text = await res.text();
  const idx = text.indexOf("{");
  if (idx < 0) throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  try {
    const parsed = JSON.parse(text.slice(idx));
    parsed.__raw = text.slice(idx, idx + MAX_RAW_DEBUG_LENGTH);
    return parsed;
  } catch (e) {
    throw new Error(`Resposta inválida do MandaBem: ${String(e?.message || e)}`);
  }
}

function extractMandabemError(payload) {
  const result = payload?.resultado;
  if (!result) return payload?.erro || payload?.mensagem || payload?.message || payload?.error || null;
  return result.erro || result.mensagem || result.message || result.error
    || (Array.isArray(result.errors) ? result.errors.join("; ") : null)
    || (Array.isArray(result.erros) ? result.erros.join("; ") : null);
}

function assertMandabemSuccess(payload) {
  const result = payload?.resultado;
  if (!result || String(result.sucesso).toLowerCase() !== "true") {
    const detail = extractMandabemError(payload) || safeStringify(result || payload, 300);
    console.error("[MandaBem] Falha na resposta:", detail, "| Raw:", payload?.__raw || safeStringify(payload));
    throw new Error(detail || "MandaBem retornou erro sem mensagem");
  }
  return result;
}

async function postMandabem(endpoint, params) {
  const res = await fetch(`https://mandabem.com.br/ws/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const payload = await readMandabemJson(res);
  if (!res.ok) throw new Error(`MandaBem erro ${res.status}${extractMandabemError(payload) ? `: ${extractMandabemError(payload)}` : ""}`);
  return payload;
}

function addCredentials(params, env) {
  params.set("plataforma_id", env.MANDABEM_PLATAFORMA_ID || DEFAULT_MANDABEM_ID);
  params.set("plataforma_chave", env.MANDABEM_PLATAFORMA_CHAVE || DEFAULT_MANDABEM_KEY);
}

async function queryShipment(env, envioId, refId) {
  const params = new URLSearchParams();
  addCredentials(params, env);
  if (envioId) params.set("id", String(envioId));
  else params.set("ref_id", String(refId));
  const payload = await postMandabem("envio", params);
  const result = assertMandabemSuccess(payload);
  return { payload, data: normalizeMandaBemShipmentData(result.dados, envioId, refId) };
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
      const trackingCode = extractMandaBemTrackingCode(shipment, info.payload) || existing.mandabem_rastreamento || existing.mandabem_etiqueta || null;
      const trackingStatus = clampText(shipment.status, 120) || existing.mandabem_status || null;
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
    params.set("destinatario", clampText(destination.name, 40));
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
      params.append(`produtos[${index}][nome]`, clampText(name, 80));
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
    const trackingCode = extractMandaBemTrackingCode(shipment, finalPayload, generated) || null;
    const trackingStatus = clampText(shipment.status, 120) || generated.mensagem || "Envio gerado";
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
    });
    return json({ ok: true, generated: true, batches: updated, envio_id: envioId, shipment, tracking_code: trackingCode, tracking_status: trackingStatus }, 200, CORS);
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500, CORS);
  }
}
