/**
 * Helper to auto-grant bonus cards when a batch payment is confirmed.
 * Uses campaign.bonus_pct to calculate how many free cards to grant.
 *
 * Flow:
 *  1. Read batch → get qty_in_batch, order_id, payment_method
 *  2. Read order → get user_id, campaign_id
 *  3. Read campaign → get bonus_pct
 *  4. Calculate bonus = floor(qty_in_batch * bonus_pct / 100)
 *  5. Check idempotency (no duplicate grant for same batch)
 *  6. INSERT bonus_grants if bonus > 0
 */

async function getBatch(sbUrl, sbKey, batchId) {
  const res = await fetch(
    `${sbUrl}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}&select=qty_in_batch,order_id,payment_method`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function getOrder(sbUrl, sbKey, orderId) {
  const res = await fetch(
    `${sbUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=user_id,campaign_id`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function getCampaign(sbUrl, sbKey, campaignId) {
  const res = await fetch(
    `${sbUrl}/rest/v1/campaigns?id=eq.${encodeURIComponent(campaignId)}&select=bonus_pct`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function existingGrant(sbUrl, sbKey, batchId) {
  const res = await fetch(
    `${sbUrl}/rest/v1/bonus_grants?batch_id=eq.${encodeURIComponent(batchId)}&select=id&limit=1`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Grant bonus automatically after a batch is marked PAID.
 * Safe to call multiple times — idempotent per batchId.
 */
export async function grantBonusOnPaid(sbUrl, sbKey, batchId) {
  try {
    const batch = await getBatch(sbUrl, sbKey, batchId);
    if (!batch?.order_id) return;

    // Don't grant bonus on full-bonus orders
    if (batch.payment_method === 'BONUS') return;

    const qty = Number(batch.qty_in_batch || 0);
    if (qty <= 0) return;

    const order = await getOrder(sbUrl, sbKey, batch.order_id);
    if (!order?.user_id || !order?.campaign_id) return;

    const campaign = await getCampaign(sbUrl, sbKey, order.campaign_id);
    const bonusPct = Number(campaign?.bonus_pct || 0);
    if (bonusPct <= 0) return;

    const bonusQty = Math.floor(qty * bonusPct / 100);
    if (bonusQty <= 0) return;

    // Idempotency: skip if bonus already granted for this batch
    const alreadyGranted = await existingGrant(sbUrl, sbKey, batchId);
    if (alreadyGranted) return;

    // Insert bonus grant
    await fetch(`${sbUrl}/rest/v1/bonus_grants`, {
      method: "POST",
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: order.user_id,
        campaign_id: order.campaign_id,
        bonus_qty: bonusQty,
        status: "AVAILABLE",
        batch_id: batchId,
      }),
    });
  } catch (e) {
    console.error("grantBonusOnPaid error:", e);
  }
}
