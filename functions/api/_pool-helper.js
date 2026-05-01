/**
 * Helper to update campaign pool_qty_confirmed when batch payment status changes.
 * Uses read-then-write approach via PostgREST.
 */

async function getBatchInfo(sbUrl, sbKey, batchId) {
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const res = await fetch(
    `${sbUrl}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}&select=qty_in_batch,order_id,status`,
    { headers }
  );
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function getCampaignId(sbUrl, sbKey, orderId) {
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const res = await fetch(
    `${sbUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=campaign_id`,
    { headers }
  );
  const arr = await res.json().catch(() => []);
  const order = Array.isArray(arr) && arr.length ? arr[0] : null;
  return order?.campaign_id || null;
}

async function getCurrentPool(sbUrl, sbKey, campaignId) {
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const res = await fetch(
    `${sbUrl}/rest/v1/campaigns?id=eq.${encodeURIComponent(campaignId)}&select=pool_qty_confirmed`,
    { headers }
  );
  const arr = await res.json().catch(() => []);
  const camp = Array.isArray(arr) && arr.length ? arr[0] : null;
  return Number(camp?.pool_qty_confirmed || 0);
}

async function patchPool(sbUrl, sbKey, campaignId, newPool) {
  const headers = {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  await fetch(
    `${sbUrl}/rest/v1/campaigns?id=eq.${encodeURIComponent(campaignId)}`,
    { method: "PATCH", headers, body: JSON.stringify({ pool_qty_confirmed: newPool }) }
  );
}

/**
 * Increment pool_qty_confirmed when a batch is newly paid.
 * Call BEFORE updating the batch status to PAID so we can detect the transition.
 */
export async function incrementPoolOnPaid(sbUrl, sbKey, batchId) {
  try {
    const batch = await getBatchInfo(sbUrl, sbKey, batchId);
    if (!batch?.order_id) return;
    // Avoid double-counting: only increment if batch is not already PAID
    if (batch.status === "PAID" || batch.status === "PAID_CONFIRMED") return;
    const qty = Number(batch.qty_in_batch || 0);
    if (qty <= 0) return;

    const campaignId = await getCampaignId(sbUrl, sbKey, batch.order_id);
    if (!campaignId) return;

    const currentPool = await getCurrentPool(sbUrl, sbKey, campaignId);
    await patchPool(sbUrl, sbKey, campaignId, currentPool + qty);
  } catch (e) {
    console.error("incrementPoolOnPaid error:", e);
  }
}

/**
 * Decrement pool_qty_confirmed when a paid batch is cancelled.
 * Call BEFORE updating the batch status to CANCELLED.
 */
export async function decrementPoolOnCancel(sbUrl, sbKey, batchId) {
  try {
    const batch = await getBatchInfo(sbUrl, sbKey, batchId);
    if (!batch?.order_id) return;
    // Only decrement if batch was PAID
    if (batch.status !== "PAID" && batch.status !== "PAID_CONFIRMED") return;
    const qty = Number(batch.qty_in_batch || 0);
    if (qty <= 0) return;

    const campaignId = await getCampaignId(sbUrl, sbKey, batch.order_id);
    if (!campaignId) return;

    const currentPool = await getCurrentPool(sbUrl, sbKey, campaignId);
    await patchPool(sbUrl, sbKey, campaignId, Math.max(0, currentPool - qty));
  } catch (e) {
    console.error("decrementPoolOnCancel error:", e);
  }
}
