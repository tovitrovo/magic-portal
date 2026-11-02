import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refundBatch } from '../functions/api/_mp-refund.js';

// fetch falso: responde por URL e guarda as chamadas.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const hit = routes.find(([re]) => re.test(url));
    const [status, body] = hit ? hit[1] : [404, {}];
    return { ok: status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('reembolsa o pagamento aprovado do lote, com idempotência por lote', async () => {
  const f = fakeFetch([
    [/\/v1\/payments\/123\/refunds$/, [201, { id: 9, amount: 105.2 }]],
    [/\/v1\/payments\/123$/, [200, { id: 123, status: 'approved', transaction_amount: 105.2 }]],
  ]);
  const r = await refundBatch({ id: 'b1', mp_payment_id: '123' }, 'TOKEN', f);
  assert.deepEqual(r, { ok: true, refundId: 9, paymentId: 123, amount: 105.2 });
  const post = f.calls.find(c => c.opts.method === 'POST');
  assert.equal(post.opts.headers['X-Idempotency-Key'], 'refund-batch-b1');
});

test('sem id salvo, procura pela referência externa (o id do lote)', async () => {
  const f = fakeFetch([
    [/payments\/search\?external_reference=b2/, [200, { results: [{ id: 77, status: 'approved', transaction_amount: 50 }] }]],
    [/\/v1\/payments\/77\/refunds$/, [201, { id: 1, amount: 50 }]],
  ]);
  const r = await refundBatch({ id: 'b2' }, 'TOKEN', f);
  assert.equal(r.ok, true);
  assert.equal(r.paymentId, 77);
});

test('não reembolsa duas vezes nem pagamento não aprovado', async () => {
  const done = fakeFetch([[/\/v1\/payments\/5$/, [200, { id: 5, status: 'refunded', transaction_amount: 10 }]]]);
  const r1 = await refundBatch({ id: 'b', mp_payment_id: '5' }, 'TOKEN', done);
  assert.equal(r1.alreadyRefunded, true);
  assert.ok(!done.calls.some(c => c.opts.method === 'POST'), 'já reembolsado: não chama o MP de novo');

  const pending = fakeFetch([[/\/v1\/payments\/6$/, [200, { id: 6, status: 'pending' }]]]);
  const r2 = await refundBatch({ id: 'b', mp_payment_id: '6' }, 'TOKEN', pending);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /pending/);
});

test('falhas viram mensagem, nunca exceção', async () => {
  assert.match((await refundBatch({ id: 'b' }, '', fakeFetch([]))).error, /MP_ACCESS_TOKEN/);
  assert.match((await refundBatch({ id: 'b' }, 'T', fakeFetch([[/search/, [200, { results: [] }]]]))).error, /não encontrado/);
  const refused = fakeFetch([[/\/v1\/payments\/8\/refunds$/, [400, { message: 'insufficient funds' }]], [/\/v1\/payments\/8$/, [200, { id: 8, status: 'approved' }]]]);
  assert.match((await refundBatch({ id: 'b', mp_payment_id: '8' }, 'T', refused)).error, /insufficient funds/);
});

test('o endpoint reembolsa ANTES de cancelar e para se o reembolso falhar', () => {
  const src = readFileSync(new URL('../functions/api/admin-cancel-batch.js', import.meta.url), 'utf8');
  const refundAt = src.indexOf('refundBatch(batch');
  const patchAt = src.indexOf('method: "PATCH"');
  assert.ok(refundAt > 0 && patchAt > refundAt, 'reembolso vem antes do PATCH');
  assert.match(src, /if \(!refund\.ok\)[\s\S]{0,200}return new Response/, 'falha no reembolso não cancela');
  assert.match(src, /status: "REFUNDED", payment_status: "refunded"/);
});
