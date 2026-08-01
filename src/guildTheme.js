// ══════════════════════════════════════════════════════
// PALETA DE GUILDA
// ══════════════════════════════════════════════════════
//
// A cor primária do app vem da guilda do usuário — é o que dá identidade a
// cada conta. O problema é que ela também pinta superfícies sólidas (botão
// primário, badge do carrinho, botão "+" do catálogo), e aí o texto por cima
// precisa de contraste. Orzhov é um creme (#f0e6b2): texto branco nele fica
// em ~1.2:1, ilegível.
//
// `inkOn()` resolve isso escolhendo, entre branco e uma tinta escura, a que
// tiver mais contraste com a cor de fundo. O app expõe o resultado como
// `--gp-ink` e todo preenchimento sólido consome essa variável em vez de
// cravar `#fff`.
//
// `test/guildTheme.test.js` trava o contrato: toda guilda dos dois modos
// precisa alcançar 4.5:1 (WCAG AA para texto normal) com a tinta escolhida.

/** Tinta escura para fundos claros. Marrom quase preto, combina com o creme do modo claro. */
export const INK_DARK = '#0f0a03';
/** Tinta clara para fundos escuros. */
export const INK_LIGHT = '#ffffff';

export const GT = {
  Azorius: { primary: '#4a90d9', secondary: '#f0e6b2', glow: 'rgba(74,144,217,0.25)' },
  Dimir: { primary: '#5b6abf', secondary: '#9b8ec0', glow: 'rgba(91,106,191,0.25)' },
  Rakdos: { primary: '#d94452', secondary: '#9b8ec0', glow: 'rgba(217,68,82,0.25)' },
  Gruul: { primary: '#d94452', secondary: '#2d8f4e', glow: 'rgba(45,143,78,0.25)' },
  Selesnya: { primary: '#2d8f4e', secondary: '#f0e6b2', glow: 'rgba(45,143,78,0.25)' },
  Orzhov: { primary: '#f0e6b2', secondary: '#9b8ec0', glow: 'rgba(201,169,110,0.25)' },
  Izzet: { primary: '#4a90d9', secondary: '#d94452', glow: 'rgba(74,144,217,0.25)' },
  Golgari: { primary: '#2d8f4e', secondary: '#9b8ec0', glow: 'rgba(45,143,78,0.25)' },
  Boros: { primary: '#d94452', secondary: '#f0e6b2', glow: 'rgba(217,68,82,0.25)' },
  Simic: { primary: '#2d8f4e', secondary: '#4a90d9', glow: 'rgba(45,143,78,0.25)' },
};

export const GT_LIGHT = {
  Azorius: { primary: '#2b6cb0', secondary: '#8a6a26', glow: 'rgba(43,108,176,0.18)' },
  Dimir: { primary: '#414f9e', secondary: '#65558c', glow: 'rgba(65,79,158,0.18)' },
  Rakdos: { primary: '#b32c3c', secondary: '#65558c', glow: 'rgba(179,44,60,0.18)' },
  Gruul: { primary: '#b32c3c', secondary: '#1e7a3d', glow: 'rgba(30,122,61,0.18)' },
  Selesnya: { primary: '#1e7a3d', secondary: '#8a6a26', glow: 'rgba(30,122,61,0.18)' },
  Orzhov: { primary: '#8a6a26', secondary: '#65558c', glow: 'rgba(138,106,38,0.18)' },
  Izzet: { primary: '#2b6cb0', secondary: '#b32c3c', glow: 'rgba(43,108,176,0.18)' },
  Golgari: { primary: '#1e7a3d', secondary: '#65558c', glow: 'rgba(30,122,61,0.18)' },
  Boros: { primary: '#b32c3c', secondary: '#8a6a26', glow: 'rgba(179,44,60,0.18)' },
  Simic: { primary: '#1e7a3d', secondary: '#2b6cb0', glow: 'rgba(30,122,61,0.18)' },
};

/** #rgb ou #rrggbb → [r, g, b] em 0–255. */
export function hexToRgb(hex) {
  const h = String(hex).trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

/** Luminância relativa (WCAG 2.1, fórmula
 *  https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste entre duas cores hex (1 a 21). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Tinta legível para texto/ícone sobre um preenchimento sólido `bg`.
 * Devolve a que tiver maior contraste — não a que "combina melhor".
 */
export function inkOn(bg) {
  return contrastRatio(bg, INK_LIGHT) >= contrastRatio(bg, INK_DARK) ? INK_LIGHT : INK_DARK;
}
