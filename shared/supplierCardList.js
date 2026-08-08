// ──────────────────────────────────────────────────────────────
// LISTA DE COMPRA DE UM PEDIDO INDIVIDUAL
//
// Um pedido individual pode ter mais de um lote: o pedido original e as
// adições que o cliente fez antes da compra no fornecedor. Na hora de comprar,
// o admin não quer lote por lote — quer a lista do pedido inteiro, com as
// repetições somadas, num texto só pra colar no fornecedor.
//
// A regra de junção mora aqui pra ser testável fora da tela.
// ──────────────────────────────────────────────────────────────

const txt = v => String(v ?? '').trim();

// Quantidade do item. Ausente vale 1 (é o que o resto do portal assume);
// zero, negativo ou lixo não vira linha de compra.
function qtyOf(item) {
  const parsed = Math.floor(Number(item?.quantity ?? item?.qty ?? 1) || 0);
  return parsed > 0 ? parsed : 0;
}

// Aceita tanto o item cru do banco ({quantity, cards:{name,type}}) quanto o
// já mastigado pela UI ({qty, name, type}). Cartas iguais viram uma linha só,
// mesmo vindo de lotes diferentes. Ordem alfabética: é assim que o admin
// confere a lista contra o carrinho do fornecedor.
export function aggregateOrderCards(items) {
  const byCard = new Map();
  for (const item of items || []) {
    const qty = qtyOf(item);
    if (qty <= 0) continue;
    const name = txt(item?.cards?.name ?? item?.name) || 'Carta';
    const type = txt(item?.cards?.type ?? item?.type);
    const key = `${name.toLowerCase()}|${type.toLowerCase()}`;
    const found = byCard.get(key);
    if (found) found.qty += qty;
    else byCard.set(key, { name, type, qty });
  }
  return [...byCard.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Mesmo formato da lista de compra da encomenda coletiva — o fornecedor já
// recebe as duas listas assim.
export function formatSupplierCardList(cards) {
  return (cards || []).map(c => `${c.qty}x ${c.name}${c.type ? ` (${c.type})` : ''}`).join('\n');
}

export function totalCardQty(cards) {
  return (cards || []).reduce((sum, c) => sum + (Number(c?.qty) || 0), 0);
}
