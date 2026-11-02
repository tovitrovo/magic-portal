// Reembolso total de um lote pelo Mercado Pago.
//
// Ordem importa: primeiro devolve o dinheiro, só depois o lote é cancelado.
// Se o Mercado Pago recusar, nada muda no banco e o admin decide o que fazer.
// A chave de idempotência é por lote: clicar duas vezes não reembolsa duas.

const MP = "https://api.mercadopago.com";

/** Acha o pagamento aprovado do lote: pelo id salvo ou pela referência. */
export async function findApprovedPayment(batch, accessToken, fetchImpl = fetch) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  if (batch?.mp_payment_id) {
    const r = await fetchImpl(`${MP}/v1/payments/${encodeURIComponent(batch.mp_payment_id)}`, { headers: auth });
    if (r.ok) return r.json();
  }
  const r = await fetchImpl(`${MP}/v1/payments/search?external_reference=${encodeURIComponent(batch.id)}&status=approved&sort=date_created&criteria=desc&limit=1`, { headers: auth });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return (d.results || [])[0] || null;
}

/**
 * Reembolsa o lote inteiro. Devolve { ok, refundId, amount, alreadyRefunded }
 * ou { ok:false, error }.
 */
export async function refundBatch(batch, accessToken, fetchImpl = fetch) {
  if (!accessToken) return { ok: false, error: "MP_ACCESS_TOKEN não configurado no servidor" };
  const payment = await findApprovedPayment(batch, accessToken, fetchImpl);
  if (!payment?.id) return { ok: false, error: "Pagamento deste pedido não encontrado no Mercado Pago" };
  if (payment.status === "refunded") return { ok: true, alreadyRefunded: true, paymentId: payment.id, amount: Number(payment.transaction_amount) || 0 };
  if (payment.status !== "approved") return { ok: false, error: `O pagamento está "${payment.status}" no Mercado Pago — só dá para reembolsar pagamento aprovado` };

  const r = await fetchImpl(`${MP}/v1/payments/${encodeURIComponent(payment.id)}/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `refund-batch-${batch.id}`,
    },
    body: "{}",
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: `Mercado Pago recusou o reembolso: ${d.message || d.error || r.status}` };
  return { ok: true, refundId: d.id, paymentId: payment.id, amount: Number(d.amount) || Number(payment.transaction_amount) || 0 };
}
