import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/MagicPortal.jsx', import.meta.url), 'utf8');

function checkoutSource() {
  const start = app.indexOf('function CheckoutPage(');
  assert.ok(start > -1, 'CheckoutPage não encontrado');
  const end = app.indexOf('async function pagarAgoraPedido', start);
  assert.ok(end > start, 'fim do CheckoutPage não encontrado');
  return app.slice(start, end);
}

// O portal vende encomendas individuais e só. Estes testes travam a ausência
// da encomenda coletiva: era o status dela que desabilitava o botão de pagar
// de um pedido que não tinha nada a ver com campanha nenhuma.
test('nenhuma tela do cliente consulta status de campanha', () => {
  assert.doesNotMatch(app, /campaignCanOrder/);
  assert.doesNotMatch(app, /campaignStatus/);
  assert.doesNotMatch(app, /orderMode/);
});

test('o botão de pagar só depende de envio e submissão', () => {
  const src = checkoutSource();
  assert.match(src, /disabled=\{submitting\|\|\(!shippingSkipped&&!selectedFrete\)\}/);
});

test('o checkout não tem mais caminho de bônus', () => {
  const src = checkoutSource();
  assert.doesNotMatch(src, /bonus/i);
});

test('o mínimo de cartas vem da configuração do pedido individual', () => {
  const src = checkoutSource();
  assert.match(src, /Number\(indiv\?\.pricing\?\.min_cards\)\|\|MIN_ORDER_CARDS/);
});
