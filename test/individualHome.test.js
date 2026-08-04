import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A home do Pedido Individual já foi uma casca: título e um botão. O que
// vende esse modo — a escada de desconto, o mínimo e a economia da próxima
// faixa — vinha carregado em `indivPricing` e não aparecia em lugar nenhum.
const app = readFileSync(new URL('../src/MagicPortal.jsx', import.meta.url), 'utf8');
const home = app.slice(app.indexOf('function IndividualHomePage'), app.indexOf('// CATALOG — Supabase powered'));

const usage = app.split('\n').find(l => l.includes('<IndividualHomePage')) || '';

test('a home individual é um componente próprio e recebe o que precisa mostrar', () => {
  assert.ok(home.length > 0, 'IndividualHomePage não encontrado');
  assert.match(usage, /indiv=\{indivPricing\}/);
  for (const prop of ['cartItems', 'wishlistCount', 'myOrders', 'openIndividualOrders', 'addTo', 'onAddCards']) {
    assert.match(usage, new RegExp(`\\b${prop}=`), `falta a prop ${prop}`);
  }
});

test('mostra a escada de desconto, o mínimo e a próxima faixa', () => {
  assert.match(home, /Escada de desconto/);
  assert.match(home, /Mínimo de \{minCards\} cartas/);
  // O piso por tipo achata o fim da escada. A home tem de usar as duas
  // funções que tratam disso, senão volta a repetir preço na tabela e a
  // prometer desconto que não existe.
  assert.match(home, /discountLadder\(\{\.\.\.quote,minCards\}\)/);
  assert.match(home, /nextCheaperTier\(tierQty,quote\)/);
  assert.match(home, /ladder\.map\(/);
});

test('a faixa sai do volume somado quando o cliente adiciona a um pedido pago', () => {
  assert.match(home, /tierQty=cartQty\+\(isAdding\?\(Number\(addTo\.qtyPaid\)\|\|0\):0\)/);
  // Somar cartas a um pedido pago não tem mínimo próprio.
  assert.match(home, /missingForMin=isAdding\?0:/);
});

test('puxa pedido aberto e andamento para a home', () => {
  assert.match(home, /ainda aceita cartas/);
  assert.match(home, /IndivStageTrack/);
  // O pedido viaja inteiro: o estágio mostrado é o do lote menos adiantado.
  assert.match(home, /slowest=paid\.reduce/);
});

test('a ação principal acompanha o estado do carrinho', () => {
  assert.match(home, /Continuar pedido · \{cartQty\}/);
  assert.match(home, /Montar meu pedido/);
});

test('o seletor de modo só aparece quando há campanha, e sem emoji', () => {
  assert.match(app, /\{campaign&&<div style=\{\{display:'flex',gap:8,marginBottom:14\}\}>/);
  const start = app.indexOf("{campaign&&<div style={{display:'flex',gap:8,marginBottom:14}}>");
  const selector = app.slice(start, app.indexOf('<IndividualHomePage', start));
  assert.doesNotMatch(selector, /[\u{1F300}-\u{1FAFF}]/u, 'o seletor voltou a usar emoji no lugar dos ícones lucide');
  assert.match(selector, /<Store size=\{14\}\/>/);
  assert.match(selector, /<User size=\{14\}\/>/);
});
