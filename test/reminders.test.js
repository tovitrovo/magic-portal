import test from 'node:test';
import assert from 'node:assert/strict';
import {
  broadcastEmail, canEmail, cartReminderEmail, cartWhatsAppText, paymentWhatsAppText,
  pickAbandonedCarts, pickPendingPayments,
} from '../shared/reminders.js';
import { formatDigest, isQuietHour, summarizeQueue } from '../functions/api/_automation.js';

const NOW = Date.parse('2026-10-31T15:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const profile = { name: 'Ana Souza', email: 'ana@x.com', whatsapp: '11999998888', email_unsub_token: 'tok' };
const order = (extra = {}) => ({ id: 'o1', status: 'DRAFT', user_id: 'u1', cart_reminded_at: null, profiles: profile, ...extra });

test('carrinho só vira lembrete depois de 48h sem mexer', () => {
  const rows = [
    { quantity: 2, created_at: hoursAgo(60), cards: { name: 'Sol Ring' }, orders: order() },
    { quantity: 1, created_at: hoursAgo(50), cards: { name: 'Counterspell' }, orders: order() },
  ];
  const [cart] = pickAbandonedCarts(rows, NOW);
  assert.equal(cart.qty, 3);
  assert.equal(cart.due, true);
  assert.equal(cart.items.length, 2);

  rows.push({ quantity: 1, created_at: hoursAgo(5), cards: { name: 'Bolt' }, orders: order() });
  assert.equal(pickAbandonedCarts(rows, NOW).length, 0);
});

test('carrinho já lembrado só volta a contar se o cliente mexeu depois', () => {
  const rows = [{ quantity: 1, created_at: hoursAgo(100), cards: { name: 'X' }, orders: order({ cart_reminded_at: hoursAgo(50) }) }];
  assert.equal(pickAbandonedCarts(rows, NOW)[0].due, false);
  const touched = [{ quantity: 1, created_at: hoursAgo(49), cards: { name: 'X' }, orders: order({ cart_reminded_at: hoursAgo(80) }) }];
  assert.equal(pickAbandonedCarts(touched, NOW)[0].due, true);
});

test('pedido que não é rascunho não é carrinho', () => {
  const rows = [{ quantity: 1, created_at: hoursAgo(60), cards: { name: 'X' }, orders: order({ status: 'PAID' }) }];
  assert.equal(pickAbandonedCarts(rows, NOW).length, 0);
});

test('pagamento pendente entre 48h e 14 dias, uma vez por lote', () => {
  const b = (extra) => ({ id: 'abcdef123456', status: 'AWAITING_PAYMENT', total_locked: 120, qty_in_batch: 4, created_at: hoursAgo(50), orders: { user_id: 'u1', profiles: profile }, ...extra });
  const [p] = pickPendingPayments([b()], NOW);
  assert.equal(p.shortId, 'ABCDEF12');
  assert.equal(p.due, true);
  assert.equal(pickPendingPayments([b({ created_at: hoursAgo(10) })], NOW).length, 0);
  assert.equal(pickPendingPayments([b({ created_at: hoursAgo(24 * 20) })], NOW).length, 0);
  assert.equal(pickPendingPayments([b({ status: 'PAID' })], NOW).length, 0);
  assert.equal(pickPendingPayments([b({ payment_reminded_at: hoursAgo(1) })], NOW)[0].due, false);
});

test('descadastrado ou sem e-mail não recebe', () => {
  assert.equal(canEmail({ email: 'a@b.co' }), true);
  assert.equal(canEmail({ email: 'a@b.co', optOut: true }), false);
  assert.equal(canEmail({ email: '' }), false);
});

test('textos usam o primeiro nome e escapam HTML', () => {
  const cart = { name: 'Ana Souza', qty: 1, items: [{ name: '<b>X</b>', qty: 1 }] };
  assert.match(cartWhatsAppText(cart), /^Oi, Ana!/);
  assert.match(paymentWhatsAppText({ name: 'Ana', shortId: 'AB12', total: 10 }), /#AB12/);
  const mail = cartReminderEmail(cart, { siteUrl: 'https://x.dev', unsubUrl: 'https://x.dev/u' });
  assert.ok(!mail.html.includes('<b>X</b>'));
  assert.match(mail.text, /Descadastrar: https:\/\/x.dev\/u/);
  const b = broadcastEmail({ subject: 'Oi {nome}', message: 'Olá {nome}!\n\nParágrafo 2' }, { name: 'Bia' }, { siteUrl: 'https://x.dev' });
  assert.equal(b.subject, 'Oi Bia');
  assert.match(b.text, /Olá Bia!/);
});

test('resumo diário cobra carrinhos e pagamentos parados', () => {
  const text = formatDigest({ paidCount: 0, paidTotal: 0, awaiting: 0, carts: 3, stalePayments: 2, stalePaymentsTotal: 340 }, summarizeQueue([]));
  assert.match(text, /3 carrinho\(s\) parado\(s\)/);
  assert.match(text, /2 pgto\(s\) pendente\(s\)/);
  assert.doesNotMatch(formatDigest({ paidCount: 0, paidTotal: 0, awaiting: 0 }, summarizeQueue([])), /Cobrar/);
});

test('não manda lembrete de madrugada (horário de Brasília)', () => {
  assert.equal(isQuietHour(new Date('2026-10-31T05:00:00Z')), true);  // 02h
  assert.equal(isQuietHour(new Date('2026-10-31T15:00:00Z')), false); // 12h
  assert.equal(isQuietHour(new Date('2026-11-01T00:30:00Z')), true);  // 21h30
});
