const PAID_BATCH_STATUSES = ["PAID", "PAID_CONFIRMED"];
const PAGE_SIZE = 1000;
const URL_CHUNK_SIZE = 75;

function enc(value) {
  return encodeURIComponent(value);
}

async function sbFetchJson(sbUrl, sbKey, path) {
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const res = await fetch(`${sbUrl}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase GET ${path} falhou: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => []);
}

async function fetchAll(sbUrl, sbKey, tableAndQuery, orderColumn = "id") {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const separator = tableAndQuery.includes("?") ? "&" : "?";
    const page = await sbFetchJson(
      sbUrl,
      sbKey,
      `${tableAndQuery}${separator}order=${orderColumn}.asc&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunk(values, size = URL_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

async function patchCampaignPool(sbUrl, sbKey, campaignId, poolQty) {
  const headers = {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  const res = await fetch(`${sbUrl}/rest/v1/campaigns?id=eq.${enc(campaignId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ pool_qty_confirmed: poolQty }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase PATCH campaigns falhou: ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function calculatePaidCampaignCardCount(sbUrl, sbKey, campaignId) {
  if (!campaignId) return 0;

  const orders = await fetchAll(
    sbUrl,
    sbKey,
    `orders?campaign_id=eq.${enc(campaignId)}&select=id`
  );
  const orderIds = orders.map(o => o.id).filter(Boolean);
  if (orderIds.length === 0) return 0;

  let paidBatchIds = [];
  for (const ids of chunk(orderIds)) {
    const batches = await fetchAll(
      sbUrl,
      sbKey,
      `order_batches?order_id=in.(${ids.map(enc).join(",")})&status=in.(${PAID_BATCH_STATUSES.join(",")})&select=id`
    );
    paidBatchIds.push(...batches.map(b => b.id).filter(Boolean));
  }
  paidBatchIds = [...new Set(paidBatchIds)];
  if (paidBatchIds.length === 0) return 0;

  let total = 0;
  for (const ids of chunk(paidBatchIds)) {
    const items = await fetchAll(
      sbUrl,
      sbKey,
      `order_items?batch_id=in.(${ids.map(enc).join(",")})&select=quantity`
    );
    total += items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }
  return total;
}

export async function syncCampaignPaidCardCount(sbUrl, sbKey, campaignId) {
  const count = await calculatePaidCampaignCardCount(sbUrl, sbKey, campaignId);
  await patchCampaignPool(sbUrl, sbKey, campaignId, count);
  return count;
}

export { PAID_BATCH_STATUSES };
