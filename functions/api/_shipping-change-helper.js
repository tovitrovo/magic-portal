import { batchesCarryingShipment, isShippingAdjustment, shipmentOf } from "../../shared/shippingAddressChange.js";
import { isPaidBatch } from "../../shared/shipping-groups.js";

const enc = encodeURIComponent;

export const SHIPMENT_BATCH_FIELDS = "id,order_id,status,payment_status,created_at,qty_in_batch,shipping_locked,shipping_already_paid,shipping_group_id,shipping_service,shipping_address,fulfillment_status,mandabem_envio_id,mandabem_rastreamento";

// Todos os lotes do cliente, com user_id — é o que buildShippingGroups
// precisa para montar as remessas.
export async function loadUserBatches(SB_URL, SB_KEY, userId) {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
  const select = `id,user_id,order_batches(${SHIPMENT_BATCH_FIELDS})`;
  const res = await fetch(`${SB_URL}/rest/v1/orders?user_id=eq.${enc(userId)}&select=${enc(select)}`, { headers });
  if (!res.ok) throw new Error(`Falha ao ler pedidos: ${res.status}`);
  const orders = await res.json().catch(() => []);
  return (Array.isArray(orders) ? orders : []).flatMap(o => (o.order_batches || []).map(b => ({ ...b, user_id: o.user_id })));
}

export async function patchShipmentAddress(SB_URL, SB_KEY, batchIds, { address, service }) {
  if (!batchIds.length) return;
  const body = { shipping_address: address };
  if (service) body.shipping_service = service;
  const res = await fetch(`${SB_URL}/rest/v1/order_batches?id=in.(${batchIds.map(enc).join(",")})`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Falha ao gravar endereço: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
}

// Chamado quando um lote vira PAGO (webhook, sync, admin). Se for um ajuste
// de frete, o endereço que ele guardou passa a valer para a remessa toda.
// Idempotente e nunca lança: pagamento confirmado não pode falhar por isso.
export async function applyPaidShippingAdjustment(SB_URL, SB_KEY, batchId) {
  try {
    const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
    const res = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${enc(batchId)}&select=${enc(`${SHIPMENT_BATCH_FIELDS},orders(user_id)`)}&limit=1`, { headers });
    const batch = (await res.json().catch(() => []))[0];
    if (!batch || !isShippingAdjustment(batch) || !isPaidBatch(batch) || !batch.shipping_address) return;

    const userId = batch.orders?.user_id;
    if (!userId) return;
    const batches = await loadUserBatches(SB_URL, SB_KEY, userId);
    const shipment = shipmentOf(batches, batchId);
    if (!shipment) return;
    if (shipment.batches.some(b => b.mandabem_envio_id)) {
      console.error(`Ajuste de frete ${batchId} pago depois da etiqueta gerada — endereço NÃO aplicado.`);
      return;
    }
    await patchShipmentAddress(SB_URL, SB_KEY, batchesCarryingShipment(batches, shipment), {
      address: batch.shipping_address, service: batch.shipping_service,
    });
  } catch (e) {
    console.error("applyPaidShippingAdjustment:", e);
  }
}
