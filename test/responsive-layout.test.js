import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// O app está dividido entre a loja, o kit de UI e o console admin.
const appSource = ['../src/MagicPortal.jsx', '../src/kit.jsx', '../src/admin/AdminConsole.jsx']
  .map(p => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
const app = appSource;
const css = readFileSync(new URL('../src/responsive.css', import.meta.url), 'utf8');

test('a navegação é o topo com o menu da conta — sem abas embaixo nem lateral', () => {
  assert.match(app, /function AccountMenu\(/, 'o menu do avatar substitui as abas');
  assert.match(app, /<AccountMenu/, 'o topo precisa montar o menu da conta');
  assert.match(app, /function OrderPill\(/, 'a pílula do pedido substitui a aba de carrinho');
  assert.doesNotMatch(app, /className="portal-bottom-tabs"/, 'a barra de abas de baixo saiu');
  assert.doesNotMatch(app, /className="portal-sidebar"/, 'a lateral do desktop saiu');
  assert.doesNotMatch(css, /\.portal-sidebar/, 'sem regra órfã da lateral');
});

test('a grade do catálogo ganha colunas conforme a tela cresce', () => {
  assert.match(css, /\.portal-catalog-grid \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 960px\)[\s\S]*?\.portal-catalog-grid \{ grid-template-columns:repeat\(4,minmax\(0,1fr\)\); \}/);
  assert.match(css, /@media \(min-width: 1280px\)[\s\S]*?\.portal-catalog-grid \{ grid-template-columns:repeat\(5,minmax\(0,1fr\)\); \}/);
});

test('define breakpoints de tablet e desktop sem sobrescrever o shell mobile', () => {
  assert.match(css, /@media \(min-width: 700px\)/);
  assert.match(css, /@media \(min-width: 960px\)/);
  assert.match(css, /@media \(min-width: 1280px\)/);
  assert.match(css, /@media \(min-width: 1500px\)/);
  assert.doesNotMatch(css.split('@media (min-width: 700px)')[0], /max-width:\s*\d+px\s*!important/);
});

test('páginas prioritárias usam wrappers e grids responsivos reutilizáveis', () => {
  for (const page of ['catalog', 'wants', 'profile', 'admin']) {
    assert.match(app, new RegExp(`portal-page portal-${page}`));
  }
  assert.match(app, /portal-card-grid portal-catalog-grid/);
  assert.match(app, /className="portal-wants-grid"/);
  // Carrinho e checkout viraram uma folha só, aberta pela pílula.
  assert.match(app, /className="portal-modal portal-order-sheet"/);
});
