export const WHATSAPP_AUDIENCES = {
  BUYERS: 'buyers',
  ALL: 'all',
};

export const DEFAULT_WHATSAPP_MESSAGES = {
  [WHATSAPP_AUDIENCES.BUYERS]: 'Oi, {nome}! A sua encomenda {encomenda} chegou. Estou organizando tudo e farei o envio até terça-feira. Assim que for enviado, aviso você por aqui.',
  [WHATSAPP_AUDIENCES.ALL]: 'Oi, {nome}! Está aberta uma nova encomenda no Magic Portal. Se quiser participar, já pode acessar o portal e montar seu pedido.',
};

export function normalizeWhatsAppNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return '';
}

export function personalizeWhatsAppMessage(template, client, campaignName = '') {
  const firstName = String(client?.name || 'cliente').trim().split(/\s+/)[0] || 'cliente';
  return String(template || '')
    .replaceAll('{nome}', firstName)
    .replaceAll('{encomenda}', String(campaignName || ''));
}

export function buildWhatsAppUrl(client, template, campaignName = '') {
  const phone = normalizeWhatsAppNumber(client?.whatsapp);
  if (!phone) return '';
  const message = personalizeWhatsAppMessage(template, client, campaignName);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function getWhatsAppRecipients(clients, audience) {
  return (clients || []).filter(client => {
    if (!normalizeWhatsAppNumber(client?.whatsapp)) return false;
    return audience === WHATSAPP_AUDIENCES.BUYERS ? Boolean(client.hasPaidOrder) : true;
  });
}
