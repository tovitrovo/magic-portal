import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeHtmlEntities, parseCsv, categoryToType, cleanName,
  basename, parseMoney, rowToCard, buildCardsFromCsv, STORAGE_BASE,
} from '../shared/cardImport.js';

test('decodeHtmlEntities decodifica numéricas e nomeadas', () => {
  assert.equal(decodeHtmlEntities('Yawgmoth&#8217;s Will'), 'Yawgmoth’s Will');
  assert.equal(decodeHtmlEntities('2&#215;2'), '2×2');
  assert.equal(decodeHtmlEntities('Art &#8211; Foil'), 'Art – Foil');
  assert.equal(decodeHtmlEntities('Minsc &#038; Boo'), 'Minsc & Boo');
  assert.equal(decodeHtmlEntities('a &amp; b'), 'a & b');
});

test('categoryToType mapeia as categorias do fornecedor', () => {
  assert.equal(categoryToType('Foil Cards ( Rare and Shinny )'), 'Foil');
  assert.equal(categoryToType('Holo Cards(holostamp on button)'), 'Holo');
  assert.equal(categoryToType('Regular Cards'), 'Normal');
  assert.equal(categoryToType(''), 'Normal');
  assert.equal(categoryToType(null), 'Normal');
});

test('cleanName remove sufixos e decodifica', () => {
  assert.equal(cleanName('Tom Bombadil HOC #38 MTG Proxy Cards'), 'Tom Bombadil HOC #38');
  assert.equal(cleanName('55PCS/Set BL FOIL 19 MTG CARDS'), '55PCS/Set BL FOIL 19');
  assert.equal(cleanName('Nature&#8217;s Claim SLD #2297 MTG Proxy Cards'), 'Nature’s Claim SLD #2297');
});

test('basename lida com caminho do Windows', () => {
  assert.equal(basename('output\\images\\tom-bombadil-hoc-38.jpg'), 'tom-bombadil-hoc-38.jpg');
  assert.equal(basename('a/b/c.png'), 'c.png');
});

test('parseMoney remove cifrão e converte', () => {
  assert.equal(parseMoney('$64.99'), 64.99);
  assert.equal(parseMoney('$2.99'), 2.99);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
});

test('rowToCard monta o registro completo', () => {
  const card = rowToCard({
    name: 'Tom Bombadil HOC #38 MTG Proxy Cards',
    category: 'Holo Cards(holostamp on button)',
    price: '$2.99', original_price: '$3.99',
    image_file: 'output\\images\\tom-bombadil-hoc-38-mtg-proxy-cards.jpg',
  });
  assert.deepEqual(card, {
    name: 'Tom Bombadil HOC #38',
    type: 'Holo',
    tcg: 'Magic',
    is_active: true,
    image_url: STORAGE_BASE + 'tom-bombadil-hoc-38-mtg-proxy-cards.jpg',
    cost_usd: 2.99,
    cost_original_usd: 3.99,
    import_ref: 'tom-bombadil-hoc-38-mtg-proxy-cards.jpg',
  });
});

test('rowToCard ignora linhas sem nome ou imagem', () => {
  assert.equal(rowToCard({ name: '', image_file: 'x.jpg' }), null);
  assert.equal(rowToCard({ name: 'X', image_file: '' }), null);
});

test('parseCsv respeita vírgulas dentro de aspas', () => {
  const csv = 'name,category\n"Kambal, Consul of Allocation #237","Holo Cards(holostamp on button)"\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Kambal, Consul of Allocation #237');
  assert.equal(rows[0].category, 'Holo Cards(holostamp on button)');
});

test('buildCardsFromCsv deduplica import_ref e conta puladas', () => {
  const csv = [
    'name,sku,price,original_price,category,product_url,image_url,image_file',
    'A Card MTG Proxy Cards,a,$2.99,$3.99,Regular Cards,u,i,output\\images\\a.jpg',
    'A Card Again MTG Proxy Cards,a,$2.99,$3.99,Foil Cards,u,i,output\\images\\a.jpg',
    ',b,$1,$1,Regular Cards,u,i,output\\images\\b.jpg',
  ].join('\n');
  const { cards, skipped, total } = buildCardsFromCsv(csv);
  assert.equal(total, 3);
  assert.equal(cards.length, 1);
  assert.equal(skipped, 2); // duplicado + linha sem nome
  assert.equal(cards[0].import_ref, 'a.jpg');
});
