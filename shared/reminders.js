// ──────────────────────────────────────────────────────────────
// LEMBRETES — carrinho parado, pagamento pendente e o aviso em massa
//
// Fonte única das regras ("quem está parado há quanto tempo") e dos textos.
// O servidor usa para o cron de e-mail e para a fila do console; o console
// usa os mesmos textos no botão de WhatsApp — o cliente recebe a mesma
// conversa, seja qual for o canal.
// ──────────────────────────────────────────────────────────────

/** Tempo parado até virar lembrete. */
export const REMINDER_AFTER_HOURS = 48;
/** Pagamento pendente mais velho que isso já esfriou: não insistimos. */
export const PAYMENT_REMINDER_MAX_DAYS = 14;
/** Status de lote que ainda espera pagamento. */
export const UNPAID_BATCH_STATUSES = ['DRAFT', 'AWAITING_PAYMENT', 'PENDING_PAYMENT'];

const HOUR = 3600 * 1000;
const time = (iso) => (iso ? Date.parse(iso) || 0 : 0);

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'tudo bem';
}

/**
 * Carrinhos parados a partir das linhas `order_items` (in_cart, sem lote)
 * com o pedido-rascunho embutido em `orders`. Um por pedido.
 *
 * Parado = o item mais novo tem mais de `hours`. Já lembrado só volta a
 * contar se o cliente mexeu no carrinho depois do lembrete.
 *
 * Devolve `{ orderId, userId, name, email, whatsapp, optOut, unsubToken,
 * items:[{name,qty}], qty, lastActivityAt, remindedAt, due }`.
 */
export function pickAbandonedCarts(rows, now = Date.now(), hours = REMINDER_AFTER_HOURS) {
  const byOrder = new Map();
  for (const row of rows || []) {
    const order = row?.orders;
    if (!order?.id || String(order.status || '').toUpperCase() !== 'DRAFT') continue;
    if (!byOrder.has(order.id)) {
      const p = order.profiles || {};
      byOrder.set(order.id, {
        orderId: order.id, userId: order.user_id || null,
        name: p.name || '', email: p.email || '', whatsapp: p.whatsapp || '',
        optOut: p.email_opt_out === true, unsubToken: p.email_unsub_token || null,
        items: [], qty: 0, lastActivityAt: null, remindedAt: order.cart_reminded_at || null,
      });
    }
    const cart = byOrder.get(order.id);
    const qty = Math.max(1, Number(row.quantity) || 1);
    cart.items.push({ name: row.cards?.name || 'Carta', qty });
    cart.qty += qty;
    if (time(row.created_at) > time(cart.lastActivityAt)) cart.lastActivityAt = row.created_at;
  }
  const carts = [...byOrder.values()].filter((c) => c.lastActivityAt && now - time(c.lastActivityAt) >= hours * HOUR);
  for (const c of carts) c.due = !c.remindedAt || time(c.remindedAt) < time(c.lastActivityAt);
  return carts.sort((a, b) => time(a.lastActivityAt) - time(b.lastActivityAt));
}

/**
 * Pagamentos pendentes a partir de `order_batches` com `orders(profiles)`.
 * Pendente = lote não pago, com cartas ou frete, criado entre `hours` e
 * PAYMENT_REMINDER_MAX_DAYS atrás. Um lembrete por lote.
 */
export function pickPendingPayments(batches, now = Date.now(), hours = REMINDER_AFTER_HOURS) {
  const oldest = now - PAYMENT_REMINDER_MAX_DAYS * 24 * HOUR;
  return (batches || [])
    .filter((b) => UNPAID_BATCH_STATUSES.includes(String(b?.status || '').toUpperCase()))
    .filter((b) => String(b?.payment_status || '').toLowerCase() !== 'approved')
    .filter((b) => Number(b.total_locked || 0) > 0)
    .filter((b) => { const t = time(b.created_at); return t && now - t >= hours * HOUR && t >= oldest; })
    .map((b) => {
      const p = b.orders?.profiles || {};
      return {
        batchId: b.id, orderId: b.order_id || b.orders?.id || null, userId: b.orders?.user_id || null,
        shortId: String(b.id).slice(0, 8).toUpperCase(),
        name: p.name || '', email: p.email || '', whatsapp: p.whatsapp || '',
        optOut: p.email_opt_out === true, unsubToken: p.email_unsub_token || null,
        qty: Number(b.qty_in_batch || 0), total: Number(b.total_locked || 0),
        createdAt: b.created_at, remindedAt: b.payment_reminded_at || null,
        due: !b.payment_reminded_at,
      };
    })
    .sort((a, b) => time(a.createdAt) - time(b.createdAt));
}

/** Pode receber e-mail: tem endereço e não pediu para sair. */
export function canEmail(person) {
  return !!person && !person.optOut && /\S+@\S+\.\S+/.test(String(person.email || ''));
}

// ── Textos ───────────────────────────────────────────────────

export const BRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cardList(items, max = 5) {
  const shown = (items || []).slice(0, max).map((i) => `${i.qty}x ${i.name}`);
  const rest = (items || []).length - shown.length;
  return rest > 0 ? [...shown, `e mais ${rest}`] : shown;
}

export function cartWhatsAppText(cart) {
  return `Oi, ${firstName(cart.name)}! Vi que ficaram ${cart.qty} carta(s) no seu carrinho do Magic Portal (${cardList(cart.items, 3).join(', ')}). Quer ajuda para fechar o pedido?`;
}

export function paymentWhatsAppText(p) {
  return `Oi, ${firstName(p.name)}! Seu pedido #${p.shortId} (${BRL(p.total)}) ainda está aguardando pagamento. Se precisar de ajuda ou de um novo link, me chama por aqui.`;
}

export const DEFAULT_BROADCAST = {
  subject: 'Vai sair pedido em 3 dias ✨',
  message: 'Oi, {nome}!\n\nVamos fazer um novo pedido no fornecedor daqui a 3 dias. Se você quer alguma carta, é a hora: entra no Magic Portal, monta seu carrinho e garante o seu lugar nesse lote.\n\nAté já!',
};

export function personalize(template, person) {
  return String(template || '').replaceAll('{nome}', firstName(person?.name));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Monta `{ subject, html, text }` com a mesma moldura para todo e-mail. */
function layout({ subject, paragraphs, list, cta, siteUrl, unsubUrl }) {
  const p = (t) => `<p style="margin:0 0 14px;line-height:1.5">${esc(t).replace(/\n/g, '<br>')}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#222">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:12px;padding:24px">
<div style="font-weight:bold;font-size:18px;margin-bottom:16px">Magic Portal</div>
${paragraphs.map(p).join('')}
${list?.length ? `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">${list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
${cta && siteUrl ? `<p style="margin:20px 0"><a href="${esc(siteUrl)}" style="background:#6b4ce6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:bold">${esc(cta)}</a></p>` : ''}
</div>
${unsubUrl ? `<p style="font-size:12px;color:#888;text-align:center;margin-top:16px">Não quer mais receber esses e-mails? <a href="${esc(unsubUrl)}" style="color:#888">Descadastrar</a></p>` : ''}
</div></body></html>`;
  const text = [...paragraphs, ...(list || []).map((i) => `- ${i}`), cta && siteUrl ? `${cta}: ${siteUrl}` : '', unsubUrl ? `\nDescadastrar: ${unsubUrl}` : '']
    .filter(Boolean).join('\n\n');
  return { subject, html, text };
}

export function cartReminderEmail(cart, { siteUrl, unsubUrl }) {
  return layout({
    subject: 'Suas cartas ainda estão no carrinho',
    paragraphs: [`Oi, ${firstName(cart.name)}!`, `Você deixou ${cart.qty} carta(s) no carrinho do Magic Portal:`],
    list: cardList(cart.items),
    cta: 'Fechar meu pedido', siteUrl, unsubUrl,
  });
}

export function paymentReminderEmail(p, { siteUrl, unsubUrl }) {
  return layout({
    subject: `Pedido #${p.shortId} aguardando pagamento`,
    paragraphs: [
      `Oi, ${firstName(p.name)}!`,
      `Seu pedido #${p.shortId} de ${BRL(p.total)} ainda está aguardando pagamento. Assim que ele cair, a gente encomenda suas cartas.`,
      'Se já pagou, pode ignorar esta mensagem.',
    ],
    cta: 'Pagar agora', siteUrl, unsubUrl,
  });
}

export function broadcastEmail({ subject, message }, person, { siteUrl, unsubUrl }) {
  return layout({
    subject: personalize(subject, person),
    paragraphs: personalize(message, person).split(/\n{2,}/).map((s) => s.trim()).filter(Boolean),
    cta: 'Entrar no Magic Portal', siteUrl, unsubUrl,
  });
}
