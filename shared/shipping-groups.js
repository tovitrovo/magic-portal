export const SHIPPING_SERVICE_UNKNOWN = "UNKNOWN";
export const SHIPPING_SERVICE_TOLERANCE = 0.5;

export function normalizeShippingService(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (normalized === "PACMINI") return "PACMINI";
  if (normalized === "SEDEX") return "SEDEX";
  if (normalized === "PAC") return "PAC";
  if (normalized === "UNKNOWN" || normalized === "NAOIDENTIFICADO") return SHIPPING_SERVICE_UNKNOWN;
  return "";
}

export function isPaidBatch(batch) {
  const status = String(batch?.status || "").toUpperCase();
  const paymentStatus = String(batch?.payment_status || "").toLowerCase();
  return status === "PAID" || status === "PAID_CONFIRMED" || status === "CONFIRMED" || paymentStatus === "approved";
}

function batchTime(batch) {
  const value = Date.parse(batch?.created_at || "");
  return Number.isFinite(value) ? value : 0;
}

function hasPaidShipping(batch) {
  return !batch?.shipping_already_paid && Number(batch?.shipping_locked || 0) > 0;
}

export function buildShippingGroups(batches) {
  const sorted = [...(batches || [])]
    .filter(isPaidBatch)
    .sort((a, b) => batchTime(a) - batchTime(b) || String(a.id).localeCompare(String(b.id)));
  const rootsByUser = new Map();
  const groups = new Map();

  for (const batch of sorted) {
    const userId = String(batch.userId || batch.user_id || batch.orders?.user_id || batch.order_id || "");
    const explicitRootId = String(batch.shipping_group_id || "").trim();
    let rootId;

    if (hasPaidShipping(batch)) {
      rootId = explicitRootId || String(batch.id);
      rootsByUser.set(userId, rootId);
    } else {
      rootId = explicitRootId || rootsByUser.get(userId);
      if (!rootId) continue;
    }

    if (!groups.has(rootId)) groups.set(rootId, { key: rootId, rootId, batches: [] });
    groups.get(rootId).batches.push(batch);
  }

  return [...groups.values()].map(group => {
    const rootBatch = group.batches.find(batch => String(batch.id) === group.rootId)
      || group.batches.find(hasPaidShipping)
      || group.batches[0];
    const service = normalizeShippingService(rootBatch?.shipping_service)
      || group.batches.map(batch => normalizeShippingService(batch.shipping_service)).find(Boolean)
      || "";
    return {
      ...group,
      rootBatch,
      shippingService: service,
      totalValue: group.batches.reduce((sum, batch) => sum + Number(batch.total_locked || 0), 0),
      totalQuantity: group.batches.reduce((sum, batch) => sum + Number(batch.qty_in_batch || 0), 0),
      hasLabel: group.batches.some(batch => Boolean(batch.mandabem_envio_id)),
      hasCompleteLabel: group.batches.every(batch => Boolean(batch.mandabem_envio_id)),
    };
  });
}

export function identifyShippingService(paidValue, quotes, tolerance = SHIPPING_SERVICE_TOLERANCE) {
  const paid = Number(paidValue);
  if (!Number.isFinite(paid) || paid <= 0) return SHIPPING_SERVICE_UNKNOWN;

  const matches = (quotes || []).filter(quote => {
    const service = normalizeShippingService(quote?.service || quote?.nome);
    const price = Number(quote?.price ?? quote?.preco);
    return service && service !== SHIPPING_SERVICE_UNKNOWN && Number.isFinite(price) && Math.abs(price - paid) <= tolerance;
  });

  return matches.length === 1
    ? normalizeShippingService(matches[0].service || matches[0].nome)
    : SHIPPING_SERVICE_UNKNOWN;
}
