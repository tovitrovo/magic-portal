import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WHATSAPP_AUDIENCES,
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
    personalizeWhatsAppMessage('Oi, {nome}! A {encomenda} chegou.', { name: 'Maria Silva' }, 'Encomenda Junho'),
    'Oi, Maria! A Encomenda Junho chegou.',
  );
});

test('builds an encoded wa.me URL', () => {
  assert.equal(
    buildWhatsAppUrl({ name: 'João', whatsapp: '11999998888' }, 'Oi, {nome}!', 'Junho'),
    'https://wa.me/5511999998888?text=Oi%2C%20Jo%C3%A3o!',
  );
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
