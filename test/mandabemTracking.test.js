import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMandaBemTrackingCode,
  sanitizeDceText,
  normalizeMandaBemShipmentData,
} from '../functions/api/admin-mandabem-label.js';

test('normalizes MandaBem envio data and selects matching shipment', () => {
  const shipment = normalizeMandaBemShipmentData([
    { envio_id: 'old', etiqueta: 'OLD123', status: 'Aguardando' },
    { envio_id: 'new', etiqueta: 'MB123456789BR', status: 'Postado' },
  ], 'new');

  assert.deepEqual(shipment, { envio_id: 'new', etiqueta: 'MB123456789BR', status: 'Postado' });
});

test('extracts MandaBem tracking code from resultado.dados.etiqueta first', () => {
  assert.equal(
    extractMandaBemTrackingCode(
      { etiqueta: ' MB123456789BR ' },
      { resultado: { dados: { rastreamento: 'FALLBACK' } } },
    ),
    'MB123456789BR',
  );
});

test('sanitizes product names to the Latin-1 charset accepted by the DC-e', () => {
  assert.equal(sanitizeDceText('Cavern of Souls — English (Normal)', 80), 'Cavern of Souls - English (Normal)');
  assert.equal(sanitizeDceText('Nature’s Lore “SLD” …', 80), 'Nature\'s Lore "SLD" ...');
  assert.equal(sanitizeDceText('Lim Dûl  ✨ Ação ', 80), 'Lim Dûl Ação');
  assert.equal(sanitizeDceText('abc def', 4), 'abc');
});
