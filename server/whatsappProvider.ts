import { createHmac, timingSafeEqual } from 'node:crypto';
import { AiError } from './openrouter.js';
import { normalizePhone } from './whatsappOrder.js';

export type IncomingMessage = {
  id: string; phoneNumberId: string; from: string; body: string;
  contextMessageId: string | null; timestamp: string | null;
};
export type MessageStatus = { id: string; status: string };

export function verifyMetaSignature(raw: Buffer, header: string | null, secret: string): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const received = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function extractMetaEvents(payload: unknown): { messages: IncomingMessage[]; statuses: MessageStatus[] } {
  const messages: IncomingMessage[] = [];
  const statuses: MessageStatus[] = [];
  if (!payload || typeof payload !== 'object' || (payload as {object?:unknown}).object !== 'whatsapp_business_account') return { messages, statuses };
  const entries = (payload as {entry?:unknown}).entry;
  if (!Array.isArray(entries)) return { messages, statuses };
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = change?.value;
      const phoneNumberId = String(value?.metadata?.phone_number_id || '');
      if (!phoneNumberId) continue;
      if (Array.isArray(value?.messages)) for (const message of value.messages) {
        const from = normalizePhone(String(message?.from || ''));
        if (!from || typeof message?.id !== 'string' || message.id.length > 240) continue;
        const body = message.type === 'text' && typeof message.text?.body === 'string' ? message.text.body.slice(0,2000) : '';
        messages.push({ id: message.id, phoneNumberId, from, body,
          contextMessageId: typeof message.context?.id === 'string' ? message.context.id.slice(0,240) : null,
          timestamp: typeof message.timestamp === 'string' ? message.timestamp : null });
      }
      if (Array.isArray(value?.statuses)) for (const status of value.statuses) {
        if (typeof status?.id === 'string' && typeof status?.status === 'string') statuses.push({ id: status.id.slice(0,240), status: status.status.slice(0,40) });
      }
    }
  }
  return { messages, statuses };
}

function providerSettings() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const version = process.env.WHATSAPP_GRAPH_VERSION;
  if (!token || !version || !/^v\d+\.\d+$/.test(version)) throw new AiError('WhatsApp sending is not configured.', 503);
  return { token, version };
}
async function postMessage(phoneNumberId: string, payload: object): Promise<string> {
  const { token, version } = providerSettings();
  if (!/^\d{5,30}$/.test(phoneNumberId)) throw new AiError('Invalid WhatsApp phone number ID.', 500);
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload })
  }).catch(() => { throw new AiError('WhatsApp could not be reached.'); });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: { code?:number; message?:string } };
    throw new AiError(`WhatsApp rejected the message (${data.error?.code || response.status}).`);
  }
  const data = await response.json() as { messages?: { id?:string }[] };
  if (!data.messages?.[0]?.id) throw new AiError('WhatsApp did not return a message ID.');
  return data.messages[0].id;
}

export async function sendOwnerText(phoneNumberId: string, to: string, body: string): Promise<string> {
  return postMessage(phoneNumberId, { to: to.replace('+',''), type: 'text', text: { body: body.slice(0,4000), preview_url: false } });
}

/** Business-initiated supplier orders always use an approved utility template. */
export async function sendSupplierOrder(phoneNumberId: string, to: string, reference: string, outlet: string,
  lines: string, delivery: string): Promise<string> {
  const templateName = process.env.WHATSAPP_ORDER_TEMPLATE_NAME;
  const language = process.env.WHATSAPP_ORDER_TEMPLATE_LANGUAGE || 'en';
  if (!templateName || !/^[a-z0-9_]{1,512}$/.test(templateName)) throw new AiError('Approved supplier order template is not configured.', 503);
  const parameters = [reference, outlet, lines, delivery].map(text => ({ type: 'text', text: text.slice(0,950) }));
  return postMessage(phoneNumberId, { to: to.replace('+',''), type: 'template',
    template: { name: templateName, language: { code: language },
      components: [{ type: 'body', parameters }] } });
}

export async function sendOwnerAlert(phoneNumberId:string,to:string,reference:string,supplier:string,summary:string):Promise<string> {
  const templateName = process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_NAME;
  if (!templateName || !/^[a-z0-9_]{1,512}$/.test(templateName)) throw new AiError('Approved owner alert template is not configured.',503);
  return postMessage(phoneNumberId,{to:to.replace('+',''),type:'template',
    template:{name:templateName,language:{code:process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_LANGUAGE || 'en'},
      components:[{type:'body',parameters:[reference,supplier,summary].map(text => ({type:'text',text:text.slice(0,900)}))}]}});
}
