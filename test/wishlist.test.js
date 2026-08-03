import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const portal = readFileSync(new URL('../src/MagicPortal.jsx', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/wishlist.sql', import.meta.url), 'utf8');

// ── A regra que define o produto ──────────────────────────────────────
// Lista de desejos e carrinho são objetos diferentes. A lista é do usuário e
// sobrevive à compra; o carrinho é do pedido e se esvazia. Os testes abaixo
// travam justamente os pontos onde o código antigo confundia os dois.

test('a lista de desejos vive em wishlist_items, não em order_items', () => {
  assert.match(portal, /sbGet\('wishlist_items'/, 'a carga da lista precisa ler wishlist_items');
  assert.doesNotMatch(
    portal,
    /setWishlist\([^)]*order_items/,
    'a lista não pode ser alimentada por order_items — era isso que a atrelava ao pedido'
  );
});

test('mandar para o carrinho não remove da lista de desejos', () => {
  const fn = portal.slice(portal.indexOf('async function handleAddToCart'), portal.indexOf('async function handleRemoveFromCart'));
  assert.ok(fn.length > 100, 'handleAddToCart precisa existir');
  assert.doesNotMatch(fn, /setWishlist/, 'adicionar ao carrinho não pode mexer na lista de desejos');
  assert.match(fn, /sbPost\('order_items'|sbPatch\('order_items'/, 'o carrinho continua sendo order_items');
});

test('comprar marca como adquirida em vez de apagar da lista', () => {
  const fn = portal.slice(portal.indexOf('async function handleOrderDone'), portal.indexOf('async function handleLogout'));
  assert.ok(fn.length > 100, 'handleOrderDone precisa existir');
  assert.match(fn, /acquired_qty/, 'a compra precisa registrar quanto foi adquirido');
  assert.match(fn, /sbPatch\('wishlist_items'/, 'o registro precisa ser persistido');
  assert.doesNotMatch(
    fn,
    /setWishlist\(prev => prev\.filter/,
    'comprar não pode remover linhas da lista de desejos'
  );
});

test('desejar não depende de encomenda aberta', () => {
  const fn = portal.slice(portal.indexOf('async function handleAddToWishlist'), portal.indexOf('async function handleAddToCart'));
  assert.ok(fn.length > 100, 'handleAddToWishlist precisa existir');
  assert.doesNotMatch(fn, /orderId/, 'a lista de desejos não pode exigir um pedido carregado');
  assert.match(fn, /wishlist_items/, 'deve escrever na tabela da lista');
});

test('o carrinho morto (cartQtyByItem) não voltou', () => {
  // Era um segundo modelo de carrinho que nunca recebia valor positivo: o
  // fallback do checkout sempre resolvia para vazio e o decremento de wants
  // nunca rodava.
  assert.doesNotMatch(portal, /cartQtyByItem/, 'cartQtyByItem era código morto');
});

test('o schema e a migração definem a tabela com o unique que o upsert usa', () => {
  for (const [rotulo, sql] of [['schema.sql', schema], ['wishlist.sql', migration]]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.wishlist_items/, `${rotulo}: falta a tabela`);
    assert.match(sql, /acquired_qty\s+integer/, `${rotulo}: falta acquired_qty`);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_user_card\s+ON public\.wishlist_items\(user_id, card_id\)/,
      `${rotulo}: o upsert do app usa on_conflict=user_id,card_id e precisa deste índice`
    );
  }
});

test('a migração é idempotente — reexecutar não acumula acquired_qty', () => {
  // O backfill do que já foi comprado agrega order_items (a fonte da verdade).
  // Se o ON CONFLICT somasse ao valor existente, rodar duas vezes dobraria.
  assert.match(migration, /SET acquired_qty = EXCLUDED\.acquired_qty/, 'o SET precisa substituir, não somar');
  assert.doesNotMatch(
    migration,
    /acquired_qty\s*=\s*public\.wishlist_items\.acquired_qty\s*\+/,
    'somar ao valor atual quebra a reexecução'
  );
  assert.match(migration, /ON CONFLICT \(user_id, card_id\) DO NOTHING/, 'o backfill de desejos pendentes não pode sobrescrever');
});

test('a RLS prende cada lista ao seu dono', () => {
  for (const [rotulo, sql] of [['schema.sql', schema], ['wishlist.sql', migration]]) {
    assert.match(sql, /ALTER TABLE public\.wishlist_items ENABLE ROW LEVEL SECURITY/, `${rotulo}: RLS desligada`);
    for (const acao of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.match(sql, new RegExp(`FOR ${acao}`), `${rotulo}: falta policy de ${acao}`);
    }
    const policies = sql.slice(sql.indexOf('wishlist_items ENABLE ROW LEVEL SECURITY'));
    assert.ok(
      (policies.match(/auth\.uid\(\) = user_id/g) || []).length >= 4,
      `${rotulo}: toda policy da wishlist precisa comparar auth.uid() com user_id`
    );
  }
});
