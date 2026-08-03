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

test('checkout trata pedido individual como aberto independente da encomenda', () => {
  const src = checkoutSource();
  assert.match(src, /const campaignOpen\s*=\s*isIndividual\s*\|\|\s*campaignCanOrder\(campaignStatus\)/);
  // Sem o isIndividual o botão de pagar do pedido individual fica desabilitado
  // sempre que a campanha coletiva não está ACTIVE.
  assert.doesNotMatch(src, /const campaignOpen\s*=\s*campaignCanOrder\(campaignStatus\)/);
});

test('botão de pagar só depende de envio, submissão e abertura do pedido', () => {
  const src = checkoutSource();
  assert.match(src, /disabled=\{submitting\|\|!campaignOpen\|\|\(!shippingSkipped&&!selectedFrete\)\}/);
});

test('catálogo e carrinho seguem liberando o fluxo individual', () => {
  assert.match(app, /const campaignOpen = isIndividual\|\|campaignCanOrder\(campaignStatus\)/);
  assert.match(app, /const canGoCheckout=isIndividual\|\|campaignOpen/);
});
