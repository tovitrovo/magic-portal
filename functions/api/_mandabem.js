// Cliente da API do MandaBem (cotação, geração e consulta de envio).
// Usado pela geração de etiqueta no console e pelo rastreio automático.
const DEFAULT_MANDABEM_ID = "68245";
const DEFAULT_MANDABEM_KEY = "$2y$10$yrre6QlN25SlbnYtyNIHSOBA5jDsKe9nRixugJnYCQSmFZOztuS7.";
export const DEFAULT_ORIGIN_CEP = "05412002";
export const DEFAULT_QUOTE_ORIGIN_CEP = "05410010";
export const SERVICES = new Set(["PAC", "SEDEX", "PACMINI"]);
const MAX_RAW_DEBUG_LENGTH = 2000;

function safeStringify(value, maxLen = 500) {
  try { return JSON.stringify(value).slice(0, maxLen); }
  catch (_) { return String(value).slice(0, maxLen); }
}


export function onlyDigits(value = "") { return String(value || "").replace(/\D/g, ""); }
export function clampText(value, max) { return String(value || "").trim().slice(0, max); }

// A DC-e (declaração de conteúdo) que o MandaBem envia à SEFAZ só aceita
// caracteres Latin-1 imprimíveis (U+0020–U+00FF), sem espaço nas pontas.
// Travessão, aspas curvas etc. derrubam a etiqueta com "not a valid value".
export function sanitizeDceText(value, max) {
  const text = String(value || "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ch => ch.normalize("NFD").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ""))
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ");
  return text.trim().slice(0, max).trim();
}


export function normalizeMandaBemShipmentData(dados, envioId = '', refId = '') {
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

export function extractMandaBemTrackingCode(shipment, ...fallbackSources) {
  // MandaBem API /ws/envio documents resultado.dados.etiqueta as the shipment tracking code.
  return clampText(shipment?.etiqueta, 80) || extractMandaBemTracking(...fallbackSources);
}

export function getMandaBemTrackingDetails(shipment, fallbackStatus = '', ...fallbackSources) {
  return {
    code: extractMandaBemTrackingCode(shipment, ...fallbackSources) || null,
    status: clampText(shipment?.status, 120) || fallbackStatus || null,
  };
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

export function packageForQuantity(quantity) {
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

export function extractMandabemError(payload) {
  const result = payload?.resultado;
  if (!result) return payload?.erro || payload?.mensagem || payload?.message || payload?.error || null;
  return result.erro || result.mensagem || result.message || result.error
    || (Array.isArray(result.errors) ? result.errors.join("; ") : null)
    || (Array.isArray(result.erros) ? result.erros.join("; ") : null);
}

export function assertMandabemSuccess(payload) {
  const result = payload?.resultado;
  if (!result || String(result.sucesso).toLowerCase() !== "true") {
    const detail = extractMandabemError(payload) || safeStringify(result || payload, 300);
    console.error("[MandaBem] Falha na resposta:", detail, "| Raw:", payload?.__raw || safeStringify(payload));
    throw new Error(detail || "MandaBem retornou erro sem mensagem");
  }
  return result;
}

export async function postMandabem(endpoint, params) {
  const res = await fetch(`https://mandabem.com.br/ws/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const payload = await readMandabemJson(res);
  if (!res.ok) throw new Error(`MandaBem erro ${res.status}${extractMandabemError(payload) ? `: ${extractMandabemError(payload)}` : ""}`);
  return payload;
}

export function addCredentials(params, env) {
  params.set("plataforma_id", env.MANDABEM_PLATAFORMA_ID || DEFAULT_MANDABEM_ID);
  params.set("plataforma_chave", env.MANDABEM_PLATAFORMA_CHAVE || DEFAULT_MANDABEM_KEY);
}

export async function queryShipment(env, envioId, refId) {
  const params = new URLSearchParams();
  addCredentials(params, env);
  if (envioId) params.set("id", String(envioId));
  else params.set("ref_id", String(refId));
  const payload = await postMandabem("envio", params);
  const result = assertMandabemSuccess(payload);
  return { payload, data: normalizeMandaBemShipmentData(result.dados, envioId, refId) };
}
