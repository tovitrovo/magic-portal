import { verifyAdmin } from './_admin-auth.js';

const DEFAULT_MANDABEM_ID = "68245";
const DEFAULT_MANDABEM_KEY = "$2y$10$yrre6QlN25SlbnYtyNIHSOBA5jDsKe9nRixugJnYCQSmFZOztuS7.";
const DEFAULT_ORIGIN_CEP = "05410010";
const SERVICES = new Set(["PAC", "SEDEX", "PACMINI"]);

function json(data, status, CORS) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function onlyDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function clampText(value, max) {
  return String(value || "").trim().slice(0, max);
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
  if (idx < 0) {
    const err = new Error(text.slice(0, 200) || `HTTP ${res.status}`);
    err.raw = text;
    throw err;
  }
  try {
    return JSON.parse(text.slice(idx));
  } catch (e) {
    const err = new Error(`Resposta inválida do MandaBem: ${String(e?.message || e)}`);
    err.raw = text;
    throw err;
  }
}

function assertMandabemSuccess(payload) {
  const result = payload?.resultado;
  if (!result || String(result.sucesso).toLowerCase() !== "true") {
    throw new Error(result?.erro || result?.mensagem || "MandaBem retornou erro");
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
  if (!res.ok) throw new Error(`MandaBem HTTP ${res.status}`);
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
  return { payload, data: result.dados || {} };
}

async function patchBatch(SB_URL, headers, batchId, data) {
  const res = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Supabase PATCH falhou: ${res.status} ${t.slice(0, 240)}`);
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : rows;
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
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }, 500, CORS);
    }

    const admin = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
    if (!admin.ok) return json({ ok: false, error: admin.error }, admin.status || 403, CORS);

    const body = await context.request.json().catch(() => ({}));
    const batchId = String(body.batchId || "").trim();
    const refreshOnly = body.action === "refresh";
    const forceGenerate = body.force === true;
    const formaEnvioOverride = String(body.formaEnvio || "").trim().toUpperCase();
    if (!batchId) return json({ ok: false, error: "batchId ausente" }, 400, CORS);

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    const select = "id,order_id,status,qty_in_batch,shipping_locked,shipping_already_paid,shipping_service,shipping_address,mandabem_envio_id,mandabem_etiqueta,mandabem_status,orders(id,user_id,profiles(name,email,cep,rua,numero,complemento,bairro,cidade,uf))";
    const batchRes = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}&select=${encodeURIComponent(select)}&limit=1`, { headers });
    if (!batchRes.ok) {
      const t = await batchRes.text().catch(() => "");
      return json({ ok: false, error: `Falha ao buscar lote: ${batchRes.status} ${t.slice(0, 200)}` }, 502, CORS);
    }
    const batches = await batchRes.json().catch(() => []);
    const batch = Array.isArray(batches) ? batches[0] : null;
    if (!batch) return json({ ok: false, error: "Lote não encontrado" }, 404, CORS);

    const currentEnvioId = batch.mandabem_envio_id;
    if ((refreshOnly || (currentEnvioId && !forceGenerate)) && currentEnvioId) {
      const info = await queryShipment(context.env, currentEnvioId, batchId);
      const shipment = info.data || {};
      const updated = await patchBatch(SB_URL, headers, batchId, {
        mandabem_etiqueta: shipment.etiqueta || batch.mandabem_etiqueta || null,
        mandabem_status: shipment.status || batch.mandabem_status || null,
        mandabem_payload: info.payload,
        mandabem_updated_at: new Date().toISOString(),
      });
      return json({ ok: true, generated: false, batch: updated, shipment }, 200, CORS);
    }

    if (batch.status === "CANCELLED") return json({ ok: false, error: "Não é possível gerar etiqueta para pedido cancelado" }, 400, CORS);
    if (batch.shipping_already_paid || Number(batch.shipping_locked || 0) <= 0) {
      return json({ ok: false, error: "Este lote não possui frete cobrado pelo portal" }, 400, CORS);
    }

    const formaEnvio = formaEnvioOverride || String(batch.shipping_service || "").trim().toUpperCase();
    if (!SERVICES.has(formaEnvio)) {
      return json({ ok: false, error: "Serviço de envio ausente ou inválido. Selecione PAC, SEDEX ou PACMINI." }, 400, CORS);
    }

    const savedAddress = batch.shipping_address || {};
    const profile = batch.orders?.profiles || {};
    const destination = { ...profile, ...savedAddress, name: savedAddress.name || profile.name, email: savedAddress.email || profile.email };
    const cep = onlyDigits(destination.cep);
    const missing = [];
    if (!destination.name) missing.push("nome");
    if (cep.length !== 8) missing.push("CEP");
    if (!destination.rua) missing.push("logradouro");
    if (!destination.numero) missing.push("número");
    if (!destination.bairro) missing.push("bairro");
    if (!destination.cidade) missing.push("cidade");
    if (!destination.uf) missing.push("UF");
    if (missing.length) return json({ ok: false, error: `Endereço incompleto do cliente: ${missing.join(", ")}` }, 400, CORS);

    const itemsRes = await fetch(`${SB_URL}/rest/v1/order_items?batch_id=eq.${encodeURIComponent(batchId)}&select=${encodeURIComponent("quantity,unit_price_brl,cards(name,type)")}`, { headers });
    if (!itemsRes.ok) {
      const t = await itemsRes.text().catch(() => "");
      return json({ ok: false, error: `Falha ao buscar itens: ${itemsRes.status} ${t.slice(0, 200)}` }, 502, CORS);
    }
    const items = await itemsRes.json().catch(() => []);
    const pkg = packageForQuantity(batch.qty_in_batch || items.reduce((s, i) => s + Number(i.quantity || 0), 0));

    const params = new URLSearchParams();
    addCredentials(params, context.env);
    params.set("forma_envio", formaEnvio);
    params.set("destinatario", clampText(destination.name, 40));
    params.set("cep", cep);
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
    params.set("ref_id", batchId);
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
      const info = await queryShipment(context.env, envioId, batchId);
      shipment = info.data || {};
      finalPayload = { generated: generatedPayload, shipment: info.payload };
    } catch (e) {
      finalPayload = { generated: generatedPayload, shipment_error: String(e?.message || e) };
    }

    const updated = await patchBatch(SB_URL, headers, batchId, {
      shipping_service: formaEnvio,
      mandabem_envio_id: String(envioId),
      mandabem_etiqueta: shipment.etiqueta || null,
      mandabem_status: shipment.status || generated.mensagem || "Envio gerado",
      mandabem_payload: finalPayload,
      mandabem_generated_at: new Date().toISOString(),
      mandabem_updated_at: new Date().toISOString(),
    });

    return json({ ok: true, generated: true, batch: updated, envio_id: envioId, shipment }, 200, CORS);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, CORS);
  }
}
