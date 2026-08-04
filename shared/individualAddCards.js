// ──────────────────────────────────────────────────────────────
// JANELA DE ADIÇÃO DO PEDIDO INDIVIDUAL
//
// O pedido individual vira uma compra no fornecedor (AliExpress). Enquanto
// essa compra não sai, o cliente ainda pode mandar mais cartas para o MESMO
// pedido: elas entram num lote novo, pagam à parte e viajam no mesmo frete.
// Assim que o admin marca "Encomenda feita", a janela fecha — a compra lá
// fora já foi feita e nada mais consegue pegar carona nela.
//
// Compartilhado entre a UI (decide se mostra o botão) e o servidor (recusa o
// que chegar fora da janela). A regra mora aqui uma vez só.
// ──────────────────────────────────────────────────────────────

/** Primeiro estágio do fulfillment: comprado do cliente, ainda não do fornecedor. */
export const ADD_CARDS_STAGE = 'AWAITING_SUPPLIER_ORDER';

export const ADD_CARDS_CLOSED_ERROR =
  'A compra deste pedido já foi feita no fornecedor — não dá mais para adicionar cartas.';

const PAID_STATUSES = new Set(['PAID', 'PAID_CONFIRMED', 'CONFIRMED']);

export function isPaidBatch(batch) {
  const status = String(batch?.status || '').toUpperCase();
  const paymentStatus = String(batch?.payment_status || '').toLowerCase();
  return PAID_STATUSES.has(status) || paymentStatus === 'approved';
}

// Um lote pago segue aceitando companhia enquanto não passou do primeiro
// estágio. fulfillment_status ausente (banco sem a migração) conta como o
// primeiro; etiqueta gerada fecha na marra, aconteça o que acontecer no
// status.
export function batchAcceptsMoreCards(batch) {
  const stage = String(batch?.fulfillment_status || ADD_CARDS_STAGE).toUpperCase();
  return stage === ADD_CARDS_STAGE && !batch?.mandabem_envio_id;
}

// batches: TODOS os lotes de um mesmo pedido individual (pagos ou não).
// Aceita cartas novas quando há pelo menos um lote pago e nenhum deles saiu
// do primeiro estágio — lotes ainda não pagos não contam para nada aqui.
export function canAddCardsToOrder(batches) {
  const paid = (batches || []).filter(isPaidBatch);
  return paid.length > 0 && paid.every(batchAcceptsMoreCards);
}

// Quantidade já paga no pedido. É ela que puxa a faixa de preço das cartas
// novas: tudo vai na mesma remessa, então conta como um volume só.
export function paidQtyOf(batches) {
  return (batches || [])
    .filter(isPaidBatch)
    .reduce((sum, batch) => sum + Math.max(0, Math.floor(Number(batch.qty_in_batch) || 0)), 0);
}

function batchTime(batch) {
  const value = Date.parse(batch?.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

// O lote que pagou o frete — é dele que a adição herda endereço, serviço e
// grupo de envio. Sem nenhum com frete cobrado, cai no mais antigo pago.
export function shippingAnchorOf(batches) {
  const paid = (batches || []).filter(isPaidBatch).sort((a, b) => batchTime(a) - batchTime(b));
  return paid.find(b => !b.shipping_already_paid && Number(b.shipping_locked || 0) > 0) || paid[0] || null;
}

// Grupo de envio que a adição deve carregar: o do lote âncora, ou o próprio
// id dele quando ainda não houver grupo.
export function shippingGroupIdOf(batches) {
  const anchor = shippingAnchorOf(batches);
  if (!anchor) return null;
  return String(anchor.shipping_group_id || anchor.id);
}
