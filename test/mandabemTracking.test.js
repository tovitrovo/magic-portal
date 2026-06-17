import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMandaBemTrackingCode,
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
