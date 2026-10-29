import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  cleanCardName, detectVariant, cardMatchKey, extractNewCards, parseSheetCells,
  parseSharedStrings, findSheetPath, sheetExportUrl, extractPhotoUrl, isGooglePhotosLink, VARIANTS,
} from '../shared/supplierSheet.js';
import { readZip } from '../shared/xlsxZip.js';

test('tira foil/holo só do fim do nome', () => {
  assert.equal(cleanCardName('Fierce Guardianship CMM #694 foil'), 'Fierce Guardianship CMM #694');
  assert.equal(cleanCardName('Cavern of Souls MM3 2017 holo'), 'Cavern of Souls MM3 2017');
  assert.equal(cleanCardName('Sol Ring HOLO FOIL'), 'Sol Ring');
  // "Foil" é uma carta de Prophecy; no meio do nome não sai.
  assert.equal(cleanCardName('Foil (PCY)'), 'Foil (PCY)');
  assert.equal(cleanCardName('Foil'), 'Foil');
  // "none foil" descreve a carta, não o acabamento.
  assert.equal(cleanCardName('Tom Bombadil showcase none foil'), 'Tom Bombadil showcase none foil');
});

test('reconhece a variante e tira do nome', () => {
  const cases = [
    ['Bard, King of Dale HOB #280 Surge foil', 'Surge Foil', 'Bard, King of Dale HOB #280'],
    ['The Mind Stone MSH #385 golden foil', 'Golden Foil', 'The Mind Stone MSH #385'],
    ['Alania, Divergent Storm #344 (raised golden foil)EN', 'Raised Golden Foil', 'Alania, Divergent Storm #344 EN'],
    ['Aragorn, the Uniter LTR #741 (raised sliver foil)(004)', 'Raised Silver Foil', 'Aragorn, the Uniter LTR #741 (004)'],
    ['Ad Nauseam SOA #155 Silver Foil', 'Silver Foil', 'Ad Nauseam SOA #155'],
    ['A Realm Reborn #566 Chocobotrack Foil', 'Chocobo Track Foil', 'A Realm Reborn #566'],
    ['Boseiju, Who Shelters All SLD #426 Neoninkfoil', 'Neon Ink Foil', 'Boseiju, Who Shelters All SLD #426'],
  ];
  for (const [raw, variant, name] of cases) {
    assert.equal(detectVariant(raw), variant, raw);
    assert.equal(cleanCardName(raw), name, raw);
  }
  assert.equal(detectVariant('Sol Ring SLD #2783 foil'), null);
  assert.ok(VARIANTS.includes('Surge Foil'));
});

test('a chave de comparação ignora espaços, pontuação, foil/holo e MTG Proxy', () => {
  assert.equal(cardMatchKey('Scalding Tarn SPG #112 foil'), cardMatchKey('Scalding TarnSPG#112foil'));
  assert.equal(cardMatchKey('Scalding Tarn ZEN JP'), cardMatchKey('Scalding Tarn ZEN JP MTG Proxy Cards'));
  assert.notEqual(cardMatchKey('Mox Opal 2XM #275'), cardMatchKey('Mox Opal SOM #179'));
});

// Aba no formato da planilha real: título da seção na linha 2 (mesclado à
// esquerda), "New Updated Cards" na 3, cabeçalhos de lote sem link.
function fixtureSheet() {
  const strings = ['REGULAR CARDS', 'HOLO CARDS', 'STOCKS', 'New Updated Cards', '6.11 NEW Updates',
    'Scalding Tarn ZEN JP', '10.9  NEW Updates', 'Cavern of Souls AVR #226', 'Dual Lands Beta',
    'Bard &amp; Co HOB #280 Surge foil', '9.29 NEW Updates', 'Sem link'];
  const sst = `<sst>${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`;
  const c = (ref, i) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
  const sheet = `<worksheet><sheetData>
    <row r="2">${c('A2', 0)}${c('C2', 1)}</row>
    <row r="3">${c('A3', 2)}${c('B3', 3)}${c('C3', 2)}${c('D3', 3)}</row>
    <row r="4">${c('A4', 8)}${c('B4', 4)}${c('D4', 6)}</row>
    <row r="5"><c r="A5" s="1"/>${c('B5', 5)}${c('D5', 7)}</row>
    <row r="6">${c('D6', 10)}</row>
    <row r="7">${c('D7', 9)}${c('B7', 11)}</row>
  </sheetData><hyperlinks>
    <hyperlink ref="A4" r:id="rId1"/><hyperlink ref="B5" r:id="rId2"/>
    <hyperlink ref="D5" r:id="rId3"/><hyperlink ref="D7" r:id="rId4"/>
  </hyperlinks></worksheet>`;
  const rels = `<Relationships>
    <Relationship Id="rId1" Target="https://photos.app.goo.gl/set"/>
    <Relationship Id="rId2" Target="https://photos.app.goo.gl/tarn"/>
    <Relationship Id="rId3" Target="https://photos.app.goo.gl/cavern"/>
    <Relationship Id="rId4" Target="https://photos.app.goo.gl/bard"/>
  </Relationships>`;
  return { sst, sheet, rels };
}

test('extrai só as colunas New Updated Cards, com o tipo da seção e o lote', () => {
  const { sst, sheet, rels } = fixtureSheet();
  const rows = extractNewCards(parseSheetCells(sheet, parseSharedStrings(sst), rels));
  assert.deepEqual(rows.map((r) => [r.type, r.block, r.name, r.variant, r.link]), [
    ['Holo', '10.9', 'Cavern of Souls AVR #226', null, 'https://photos.app.goo.gl/cavern'],
    ['Normal', '6.11', 'Scalding Tarn ZEN JP', null, 'https://photos.app.goo.gl/tarn'],
    ['Holo', '9.29', 'Bard & Co HOB #280', 'Surge Foil', 'https://photos.app.goo.gl/bard'],
  ]);
});

test('acha a aba pelo nome, sem diferenciar maiúsculas', () => {
  const wb = '<workbook><sheets><sheet name="Regular Sets" r:id="rId2"/><sheet name="SINGLES" sheetId="1" r:id="rId5"/></sheets></workbook>';
  const wbRels = '<Relationships><Relationship Id="rId5" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>';
  assert.equal(findSheetPath(wb, wbRels, 'singles'), 'xl/worksheets/sheet1.xml');
  assert.equal(findSheetPath(wb, wbRels, 'Outra'), null);
});

test('link da planilha vira URL de exportação .xlsx', () => {
  assert.equal(
    sheetExportUrl('https://docs.google.com/spreadsheets/d/1E2iSRhhNUjaZ3MblXx_rflpOIkMwK40OgX5X6yXE4zw/edit?gid=0#gid=0'),
    'https://docs.google.com/spreadsheets/d/1E2iSRhhNUjaZ3MblXx_rflpOIkMwK40OgX5X6yXE4zw/export?format=xlsx',
  );
  assert.equal(sheetExportUrl('https://example.com/planilha'), null);
});

test('acha a foto na página do álbum do Google Photos', () => {
  const html = '<script>["https://lh3.googleusercontent.com/pw/AP1GczOL9dHG_x-Y",1600]</script>';
  assert.equal(extractPhotoUrl(html), 'https://lh3.googleusercontent.com/pw/AP1GczOL9dHG_x-Y=w1600-h1600');
  assert.equal(extractPhotoUrl('<html></html>'), null);
  assert.ok(isGooglePhotosLink('https://photos.app.goo.gl/abc'));
  assert.ok(!isGooglePhotosLink('https://imgur.com/abc'));
});

// Zip mínimo (método deflate) para exercitar o leitor.
function makeZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = enc.encode(name);
    const data = deflateRawSync(enc.encode(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

test('readZip descompacta só as entradas pedidas', async () => {
  const zip = makeZip({ 'xl/workbook.xml': '<workbook/>', 'xl/sharedStrings.xml': '<sst>ção</sst>' });
  const out = await readZip(zip, (n) => n === 'xl/sharedStrings.xml');
  assert.deepEqual(out, { 'xl/sharedStrings.xml': '<sst>ção</sst>' });
  await assert.rejects(readZip(new Uint8Array(40), () => true), /não é um .xlsx/);
});
