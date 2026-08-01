import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const themeCss = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../src/MagicPortal.jsx', import.meta.url), 'utf8');
const responsive = readFileSync(new URL('../src/responsive.css', import.meta.url), 'utf8');

/** Extrai os tokens (--nome: valor) do bloco cujo seletor casa com `selector`. */
function tokensOf(selector) {
  const start = themeCss.indexOf(selector);
  assert.notEqual(start, -1, `bloco não encontrado: ${selector}`);
  const open = themeCss.indexOf('{', start);
  const close = themeCss.indexOf('}', open);
  const body = themeCss.slice(open + 1, close);
  const tokens = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
  return tokens;
}

const dark = tokensOf(":root,\n:root[data-theme='dark']");
const light = tokensOf(":root[data-theme='light']");

test('os dois temas definem exatamente o mesmo conjunto de tokens', () => {
  const faltandoNoClaro = [...dark.keys()].filter(k => !light.has(k));
  const sobrandoNoClaro = [...light.keys()].filter(k => !dark.has(k));
  assert.deepEqual(faltandoNoClaro, [], 'tokens sem versão no modo claro');
  assert.deepEqual(sobrandoNoClaro, [], 'tokens que só existem no modo claro');
  assert.ok(dark.size > 20, 'o tema deveria ter dezenas de tokens');
});

test('tokens de tinta são tripletes RGB — o app os usa dentro de rgba()', () => {
  for (const key of ['--ink', '--sunk', '--ok-rgb', '--gold-rgb', '--danger-rgb', '--wa-rgb', '--info-rgb', '--pix-rgb']) {
    for (const [nome, mapa] of [['escuro', dark], ['claro', light]]) {
      assert.match(mapa.get(key), /^\d+,\s*\d+,\s*\d+$/, `${key} no modo ${nome} precisa ser "r, g, b"`);
    }
  }
});

test('o modo claro usa um off-white quente, não branco puro nem cinza', () => {
  const bg = light.get('--bg');
  const [, r, g, b] = /^#(\w{2})(\w{2})(\w{2})$/.exec(bg).map((v, i) => (i ? parseInt(v, 16) : v));
  assert.ok(r > 235 && r < 253, `--bg claro deveria ser off-white, veio ${bg}`);
  assert.ok(r > b, 'o vermelho precisa superar o azul para o fundo puxar para o quente');
  assert.ok(g > b, 'o verde precisa superar o azul para o fundo puxar para o quente');
  assert.notEqual(bg.toLowerCase(), '#ffffff', 'branco puro não é off-white');
});

test('o multiplicador de contraste do claro compensa a opacidade', () => {
  assert.equal(Number(dark.get('--ink-a')), 1);
  assert.ok(Number(light.get('--ink-a')) > 1, 'no claro a mesma opacidade some, precisa ser escalada');
});

// Guarda de regressão: um `rgba(255,255,255,…)` novo no JSX volta a ser branco
// fixo e quebra o modo claro sem erro nenhum de build.
test('nenhuma cor exclusiva do modo escuro sobrou no app', () => {
  for (const [rotulo, fonte] of [['MagicPortal.jsx', portal], ['responsive.css', responsive]]) {
    assert.equal((fonte.match(/rgba\(255,\s*255,\s*255/g) || []).length, 0, `${rotulo}: use rgba(var(--ink),…)`);
    assert.equal((fonte.match(/rgba\(0,\s*0,\s*0/g) || []).length, 0, `${rotulo}: use rgba(var(--sunk),…)`);
    assert.equal((fonte.match(/#e9edf7/gi) || []).length, 0, `${rotulo}: use var(--text)`);
  }
});

// A guarda acima só pegava rgba(). Um hex escuro cravado passava batido — foi
// assim que a folha de detalhe da carta (background:'#0f0f17') e a barra
// sticky do admin (rgba(8,8,15,.88)) ficaram pretas sobre o creme do claro.
//
// Regra: qualquer hex cuja luminância seja de superfície escura tem que virar
// token. Cores de acento (que existem nas duas paletas com valores próprios)
// são legítimas, então o corte é pela escuridão, não pelo hex em si.
test('nenhuma superfície escura cravada em hex sobrou no app', () => {
  const brilho = hex => {
    const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000; // 0–255
  };
  // Exceções conscientes, com motivo:
  const permitido = new Set([
    '#0f0a03', // INK_DARK — tinta sobre preenchimento claro, não é superfície
    '#08080f', // MODE_BG.dark — é a definição do fundo escuro em si
  ]);
  for (const [rotulo, fonte] of [['MagicPortal.jsx', portal], ['responsive.css', responsive]]) {
    const escuros = (fonte.match(/#[0-9a-f]{3,8}\b/gi) || [])
      .filter(h => h.length === 4 || h.length === 7)
      .filter(h => !permitido.has(h.toLowerCase()))
      .filter(h => brilho(h) < 40);
    assert.deepEqual(
      [...new Set(escuros)],
      [],
      `${rotulo}: hex escuro cravado quebra o modo claro — use var(--sheet-bg)/var(--chrome-bg)/var(--bg)`
    );
  }
});

// O botão primário pinta `--gp` (cor da guilda) e escreve por cima. A tinta
// não pode ser fixa: em Orzhov, `--gp` é um creme e branco nele dá 1.2:1.
test('preenchimentos da cor de guilda usam a tinta calculada, não #fff cravado', () => {
  const fills = portal.match(/background:\s*'var\(--gp\)'[^}]*?color:\s*'([^']+)'/g) || [];
  for (const trecho of fills) {
    assert.match(trecho, /color:\s*'var\(--gp-ink\)'/, `use var(--gp-ink) em vez de tinta fixa: ${trecho.slice(0, 120)}`);
  }
  assert.match(portal, /'--gp-ink':\s*inkOn\(theme\.primary\)/, 'o shell precisa publicar --gp-ink');
});

test('wa() produz opacidade a partir do sufixo hexadecimal', async () => {
  // A função é interna ao componente; replicamos o contrato aqui para travar
  // a conversão (0x30 ≈ 19%) usada em dezenas de call sites.
  const pct = hex => Math.round(parseInt(hex, 16) / 255 * 100);
  assert.equal(pct('ff'), 100);
  assert.equal(pct('30'), 19);
  assert.equal(pct('14'), 8);
  assert.match(portal, /function wa\(color,hexAlpha\)/, 'o helper wa() precisa existir no app');
  assert.match(portal, /color-mix\(in srgb/, 'wa() deve usar color-mix para aceitar hex e var()');
});
