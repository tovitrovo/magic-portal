import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/MagicPortal.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/responsive.css', import.meta.url), 'utf8');

test('mantém a navegação mobile e adiciona sidebar desktop no mesmo shell', () => {
  assert.match(app, /className="portal-bottom-tabs"/);
  assert.match(app, /className="portal-sidebar"/);
  assert.match(css, /\.portal-sidebar \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 960px\)[\s\S]*?\.portal-sidebar \{[\s\S]*?display: flex;/);
  assert.match(css, /@media \(min-width: 960px\)[\s\S]*?\.portal-bottom-tabs \{ display:none !important; \}/);
});

test('define breakpoints de tablet e desktop sem sobrescrever o shell mobile', () => {
  assert.match(css, /@media \(min-width: 700px\)/);
  assert.match(css, /@media \(min-width: 960px\)/);
  assert.match(css, /@media \(min-width: 1280px\)/);
  assert.match(css, /@media \(min-width: 1500px\)/);
  assert.doesNotMatch(css.split('@media (min-width: 700px)')[0], /max-width:\s*\d+px\s*!important/);
});

test('páginas prioritárias usam wrappers e grids responsivos reutilizáveis', () => {
  for (const page of ['home', 'catalog', 'wants', 'cart', 'checkout', 'profile', 'admin']) {
    assert.match(app, new RegExp(`portal-page portal-${page}`));
  }
  assert.match(app, /portal-card-grid portal-catalog-grid/);
  assert.match(app, /portal-card-grid portal-wants-grid/);
  assert.match(app, /portal-card-grid portal-cart-grid/);
});
