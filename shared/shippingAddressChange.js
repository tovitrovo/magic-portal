// ──────────────────────────────────────────────────────────────
// TROCA DE ENDEREÇO DE UMA REMESSA JÁ PAGA
//
// O endereço vive em cada lote (order_batches.shipping_address) e a
// etiqueta do MandaBem sai do lote que pagou o frete. Trocar o endereço é
// trocar o da REMESSA inteira: o pedido, as cartas adicionadas depois e os
// pedidos que pegaram carona no mesmo frete viajam na mesma caixa.
//
// Se o endereço novo deixa o frete mais caro, a diferença vira um lote de
// AJUSTE DE FRETE: sem cartas, só frete, no mesmo grupo de envio. O
// endereço novo fica guardado nele e só passa para a remessa quando o
// pagamento cai. Ficou mais barato ou igual: troca na hora, sem estorno.
//
// Compartilhado entre a UI (mostra ou não o botão) e o servidor (decide).
// ──────────────────────────────────────────────────────────────

import { buildShippingGroups, isPaidBatch } from './shipping-groups.js';

export const ADDRESS_LOCKED_ERROR =
  'A etiqueta deste envio já foi gerada — não dá mais para trocar o endereço. Fale com a gente.';

export const ADDRESS_FIELDS = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

const LOCKED_STAGES = new Set(['LABEL_GENERATED', 'DELIVERED']);

// Lote de ajuste de frete: não leva carta nenhuma, só cobra frete. Não é
// raiz de grupo (shipping_already_paid = true), então pendura no grupo
// pelo shipping_group_id explícito.
export function isShippingAdjustment(batch) {
  return Math.floor(Number(batch?.qty_in_batch) || 0) === 0
    && Number(batch?.shipping_locked || 0) > 0
    && !!batch?.shipping_already_paid;
}

// Remessa (grupo de envio) que contém o lote. Lote pago fora de qualquer
// grupo vira um grupo de um, como no console do admin.
export function shipmentOf(batches, batchId) {
  const id = String(batchId);
  const group = buildShippingGroups(batches).find(g => g.batches.some(b => String(b.id) === id));
  if (group) return group;
  const solo = (batches || []).find(b => String(b.id) === id && isPaidBatch(b));
  if (!solo) return null;
  return { key: id, rootId: String(solo.shipping_group_id || solo.id), rootBatch: solo, batches: [solo] };
}

// Todos os lotes que carregam o endereço da remessa: os pagos do grupo e
// qualquer lote (pago ou não) que aponte para ele pelo shipping_group_id.
export function batchesCarryingShipment(batches, shipment) {
  const ids = new Set((shipment?.batches || []).map(b => String(b.id)));
  for (const b of batches || []) {
    if (String(b.shipping_group_id || '') === String(shipment?.rootId || '')) ids.add(String(b.id));
  }
  return [...ids];
}

// Pode trocar enquanto nenhuma etiqueta saiu.
export function canChangeShipmentAddress(shipment) {
  if (!shipment) return false;
  return !shipment.batches.some(b =>
    b.mandabem_envio_id || b.mandabem_rastreamento
    || LOCKED_STAGES.has(String(b.fulfillment_status || '').toUpperCase()));
}

// Ajuste de frete aguardando pagamento nesta remessa (só um por vez).
export function pendingAdjustmentOf(batches, shipment) {
  const rootId = String(shipment?.rootId || '');
  return (batches || []).find(b =>
    isShippingAdjustment(b) && !isPaidBatch(b)
    && String(b.shipping_group_id || '') === rootId
    && !['CANCELLED', 'FAILED', 'REFUNDED', 'CHARGEDBACK'].includes(String(b.status || '').toUpperCase())) || null;
}

export function normalizeAddress(address) {
  const out = {};
  for (const key of ADDRESS_FIELDS) out[key] = String(address?.[key] ?? '').trim();
  out.cep = out.cep.replace(/\D/g, '');
  out.uf = out.uf.toUpperCase().slice(0, 2);
  return out;
}

export function missingAddressFields(address) {
  const a = normalizeAddress(address);
  const missing = [];
  if (a.cep.length !== 8) missing.push('CEP');
  if (!a.rua) missing.push('rua');
  if (!a.numero) missing.push('número');
  if (!a.bairro) missing.push('bairro');
  if (!a.cidade) missing.push('cidade');
  if (a.uf.length !== 2) missing.push('UF');
  return missing;
}

// Quanto o cliente paga a mais. Compara o frete do endereço novo com o que
// o endereço ATUAL custaria hoje, no mesmo volume — assim só entra na conta
// o que a mudança encarece (e não o peso das cartas adicionadas depois, que
// já viajam de graça). Sem cotação do endereço atual, compara com o frete
// que foi efetivamente pago na remessa.
export function shippingDifference({ newPrice, currentPrice, paidShipping }) {
  const next = Number(newPrice);
  if (!Number.isFinite(next) || next <= 0) return null;
  const current = Number(currentPrice);
  const base = Number.isFinite(current) && current > 0 ? current : Math.max(0, Number(paidShipping) || 0);
  return Math.max(0, Math.round((next - base) * 100) / 100);
}

// Frete efetivamente pago na remessa (raiz + ajustes já pagos).
export function paidShippingOf(shipment) {
  return Math.round((shipment?.batches || [])
    .filter(isPaidBatch)
    .reduce((sum, b) => sum + Number(b.shipping_locked || 0), 0) * 100) / 100;
}
