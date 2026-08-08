import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// O título com gradiente já sumiu uma vez: a shorthand `background` no estilo
// inline reseta `background-clip` para `border-box`, e como estilo inline ganha
// da classe, o recorte se perde. Com `-webkit-text-fill-color: transparent`
// ainda de pé, o resultado é um retângulo colorido no lugar do título.
const app = readFileSync(new URL('../src/MagicPortal.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');

const gradientTitles = app
  .split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => line.includes('mp-gradient-text'));

test('todo título com gradiente existe e usa a longhand backgroundImage', () => {
  assert.ok(gradientTitles.length > 0, 'nenhum uso de mp-gradient-text encontrado');
  for (const { line, n } of gradientTitles) {
    assert.match(line, /backgroundImage:\s*'linear-gradient/, `linha ${n}: gradiente deve vir de backgroundImage`);
    assert.doesNotMatch(line, /[{,]\s*background:\s*'linear-gradient/, `linha ${n}: a shorthand background apaga o background-clip e some com o título`);
  }
});

test('o título com gradiente mantém a cor sólida de fallback', () => {
  for (const { line, n } of gradientTitles) {
    assert.match(line, /color:\s*theme\.primary/, `linha ${n}: sem color não há fallback quando o recorte não pinta`);
  }
});

test('ui.css blinda o recorte e não deixa o gradiente virar fundo', () => {
  assert.match(css, /-webkit-background-clip:\s*text\s*!important/);
  assert.match(css, /[^-]background-clip:\s*text\s*!important/);
  assert.match(css, /-webkit-text-fill-color:\s*transparent/);
  // O fallback de quem não suporta o recorte remove só a imagem de fundo.
  assert.match(css, /@supports not \(\(-webkit-background-clip: text\) or \(background-clip: text\)\) \{\s*\.mp-gradient-text \{ background-image: none !important; \}/);
});
