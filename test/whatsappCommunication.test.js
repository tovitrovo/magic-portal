import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHIPMENT_WHATSAPP_MESSAGE,
  WHATSAPP_AUDIENCES,
  buildShipmentWhatsAppUrl,
  buildWhatsAppUrl,
  getWhatsAppRecipients,
  normalizeWhatsAppNumber,
  personalizeWhatsAppMessage,
} from '../src/whatsappCommunication.js';

test('normalizes Brazilian WhatsApp numbers without duplicating country code', () => {
  assert.equal(normalizeWhatsAppNumber('(11) 99999-8888'), '5511999998888');
  assert.equal(normalizeWhatsAppNumber('5511999998888'), '5511999998888');
  assert.equal(normalizeWhatsAppNumber(''), '');
  assert.equal(normalizeWhatsAppNumber('123'), '');
});

test('personalizes supported placeholders using the first name', () => {
  assert.equal(
    personalizeWhatsAppMessage('Oi, {nome}! A {encomenda} chegou. Rastreio: {rastreamento}', { name: 'Maria Silva' }, 'Encomenda Junho', 'MB123'),
    'Oi, Maria! A Encomenda Junho chegou. Rastreio: MB123',
  );
});

test('builds an encoded wa.me URL', () => {
  assert.equal(
    buildWhatsAppUrl({ name: 'João', whatsapp: '11999998888' }, 'Oi, {nome}!', 'Junho'),
    'https://wa.me/5511999998888?text=Oi%2C%20Jo%C3%A3o!',
  );
});

test('builds a shipment WhatsApp URL with MandaBem tracking code', () => {
  assert.equal(
    buildShipmentWhatsAppUrl({ name: 'João', whatsapp: '11999998888' }, 'Junho', 'MB123'),
    `https://wa.me/5511999998888?text=${encodeURIComponent(DEFAULT_SHIPMENT_WHATSAPP_MESSAGE.replace('{nome}', 'João').replace('{encomenda}', 'Junho').replace('{rastreamento}', 'MB123'))}`,
  );
  assert.equal(buildShipmentWhatsAppUrl({ name: 'João', whatsapp: '11999998888' }, 'Junho', ''), '');
});

test('selects paid buyers or every registered client with WhatsApp', () => {
  const clients = [
    { userId: '1', whatsapp: '11911111111', hasPaidOrder: true },
    { userId: '2', whatsapp: '11922222222', hasPaidOrder: false },
    { userId: '3', whatsapp: '', hasPaidOrder: true },
  ];

  assert.deepEqual(getWhatsAppRecipients(clients, WHATSAPP_AUDIENCES.BUYERS).map(c => c.userId), ['1']);
  assert.deepEqual(getWhatsAppRecipients(clients, WHATSAPP_AUDIENCES.ALL).map(c => c.userId), ['1', '2']);
});
