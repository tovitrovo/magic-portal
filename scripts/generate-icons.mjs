#!/usr/bin/env node
/**
 * Gera os ícones do PWA em public/icons/ sem depender de libs de imagem.
 *
 *   node scripts/generate-icons.mjs
 *
 * Desenha a marca do portal: fundo escuro do app + uma carta com o gradiente
 * Izzet (azul → vermelho) e um losango de mana no centro. Rode de novo depois
 * de mudar cores/forma; os PNGs ficam versionados no repositório.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ── PNG mínimo (RGBA, sem filtros) ───────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Desenho ──────────────────────────────────────────────────
const BG = [8, 8, 15];
const BLUE = [74, 144, 217];
const RED = [217, 68, 82];
const GOLD = [232, 216, 178];

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Distância assinada até um retângulo arredondado centrado em (cx,cy). */
function roundedRectDist(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Antialias simples: 1 dentro, 0 fora, rampa de 1px na borda. */
const coverage = (dist) => Math.min(Math.max(0.5 - dist, 0), 1);

function blend(target, offset, color, alpha) {
  if (alpha <= 0) return;
  const inv = 1 - alpha;
  target[offset] = Math.round(target[offset] * inv + color[0] * alpha);
  target[offset + 1] = Math.round(target[offset + 1] * inv + color[1] * alpha);
  target[offset + 2] = Math.round(target[offset + 2] * inv + color[2] * alpha);
  target[offset + 3] = Math.round(target[offset + 3] * inv + 255 * alpha);
}

/**
 * @param {number} size    lado do ícone em px
 * @param {boolean} maskable  true = fundo sangra até a borda (safe zone menor)
 */
function drawIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const c = size / 2;

  // Fundo do app. Ícone comum ganha cantos arredondados; maskable é quadrado
  // cheio porque o launcher aplica a própria máscara.
  const bgRadius = maskable ? 0 : size * 0.22;
  const cardScale = maskable ? 0.30 : 0.38; // safe zone de 80% no maskable

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const off = (y * size + x) * 4;
      const bgAlpha = maskable ? 1 : coverage(roundedRectDist(x, y, c, c, c, c, bgRadius));
      // Leve brilho radial no topo, como no fundo do app.
      const glow = Math.max(0, 1 - Math.hypot(x - c, y - size * 0.12) / (size * 0.75));
      blend(rgba, off, mix(BG, [26, 30, 52], glow * 0.55), bgAlpha);
    }
  }

  // Carta: retângulo arredondado em proporção 63×88 (carta real).
  const halfH = size * cardScale;
  const halfW = halfH * (63 / 88);
  const cardRadius = halfW * 0.16;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const off = (y * size + x) * 4;
      const dist = roundedRectDist(x, y, c, c, halfW, halfH, cardRadius);
      const alpha = coverage(dist);
      if (alpha <= 0) continue;
      const t = (y - (c - halfH)) / (2 * halfH); // gradiente vertical
      blend(rgba, off, mix(BLUE, RED, Math.min(Math.max(t, 0), 1)), alpha);
    }
  }

  // Borda dourada fina da carta.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = roundedRectDist(x, y, c, c, halfW, halfH, cardRadius);
      const edge = Math.max(0, 1 - Math.abs(dist + size * 0.008) / (size * 0.008));
      if (edge > 0) blend(rgba, (y * size + x) * 4, GOLD, edge * 0.55);
    }
  }

  // Losango de mana no centro da carta.
  const gem = halfW * 0.46;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = (Math.abs(x - c) + Math.abs(y - c)) - gem;
      const alpha = coverage(d);
      if (alpha > 0) blend(rgba, (y * size + x) * 4, [255, 255, 255], alpha * 0.92);
    }
  }

  return encodePng(size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true], // iOS não arredonda por conta própria
  ['badge-72.png', 72, false],
];

for (const [name, size, maskable] of targets) {
  writeFileSync(join(OUT_DIR, name), drawIcon(size, maskable));
  console.log('gerado', `public/icons/${name}`, `(${size}×${size})`);
}
