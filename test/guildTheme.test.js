import test from 'node:test';
import assert from 'node:assert/strict';
import { GT, GT_LIGHT, INK_DARK, INK_LIGHT, contrastRatio, inkOn, relativeLuminance } from '../src/guildTheme.js';

/** WCAG AA para texto normal. O botão primário é 14px bold — não conta como
 *  texto grande (18.66px bold), então o piso é 4.5, não 3. */
const AA = 4.5;

test('contrastRatio bate com os extremos conhecidos da WCAG', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(Math.round(contrastRatio('#ffffff', '#ffffff')), 1);
  // Cinza médio clássico usado como referência (#767676 sobre branco ≈ 4.54).
  assert.ok(contrastRatio('#767676', '#ffffff') >= AA);
});

test('relativeLuminance respeita o trecho linear das cores muito escuras', () => {
  // Abaixo de 0.03928 a fórmula divide por 12.92 em vez de elevar a 2.4.
  assert.ok(relativeLuminance('#050505') < relativeLuminance('#0a0a0a'));
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
});

test('hex de 3 dígitos é expandido antes da conta', () => {
  assert.equal(relativeLuminance('#fff'), relativeLuminance('#ffffff'));
  assert.equal(relativeLuminance('#000'), relativeLuminance('#000000'));
});

test('toda guilda alcança contraste AA com a tinta que inkOn escolhe', () => {
  for (const [rotulo, palette] of [['escuro', GT], ['claro', GT_LIGHT]]) {
    for (const [guilda, { primary }] of Object.entries(palette)) {
      const ratio = contrastRatio(primary, inkOn(primary));
      assert.ok(
        ratio >= AA,
        `${guilda} no modo ${rotulo}: ${primary} + ${inkOn(primary)} dá ${ratio.toFixed(2)}:1, abaixo de ${AA}`
      );
    }
  }
});

test('inkOn devolve branco em fundo escuro e tinta escura em fundo claro', () => {
  assert.equal(inkOn('#000000'), INK_LIGHT);
  assert.equal(inkOn('#ffffff'), INK_DARK);
  // Orzhov no escuro é um creme — era exatamente o caso que quebrava com #fff.
  assert.equal(inkOn(GT.Orzhov.primary), INK_DARK);
  assert.ok(contrastRatio(GT.Orzhov.primary, INK_LIGHT) < 2, 'branco sobre o creme do Orzhov era ilegível');
});

test('as duas paletas cobrem exatamente as mesmas guildas', () => {
  assert.deepEqual(Object.keys(GT).sort(), Object.keys(GT_LIGHT).sort());
  assert.ok(Object.keys(GT).length === 10, 'são as 10 guildas de duas cores');
});

test('toda guilda define primary, secondary e glow', () => {
  for (const palette of [GT, GT_LIGHT]) {
    for (const [guilda, t] of Object.entries(palette)) {
      assert.match(t.primary, /^#[0-9a-f]{6}$/i, `${guilda}.primary precisa ser hex — é concatenado em gradientes`);
      assert.match(t.secondary, /^#[0-9a-f]{6}$/i, `${guilda}.secondary precisa ser hex`);
      assert.match(t.glow, /^rgba\(/, `${guilda}.glow precisa ser rgba`);
    }
  }
});
