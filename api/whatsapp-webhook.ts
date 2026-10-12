import { waitUntil } from '@vercel/functions';
import { enqueueWhatsappMessages, processWhatsappInbox, whatsappServiceDb } from '../server/whatsappWebhook.js';
import { verifyMetaSignature } from '../server/whatsappProvider.js';

const ready = () => Boolean(process.env.SUPABASE_URL &&
  (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  process.env.OPENAI_API_KEY &&
  process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN &&
  process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_SHARED_PHONE_NUMBER_ID &&
  process.env.WHATSAPP_GRAPH_VERSION && process.env.WHATSAPP_ORDER_TEMPLATE_NAME &&
  process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_NAME);

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if (!process.env.WHATSAPP_VERIFY_TOKEN) return Response.json({ error: 'WhatsApp verification is awaiting setup.' }, { status: 503 });
      const token = url.searchParams.get('hub.verify_token');
      const mode = url.searchParams.get('hub.mode');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      return Response.json({ error: 'Invalid verification request.' }, { status: 403 });
    }
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
    if (!ready()) return Response.json({ error: 'WhatsApp integration is awaiting setup.' }, { status: 503 });
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > 1_000_000) return Response.json({ error: 'Payload too large.' }, { status: 413 });
    if (!verifyMetaSignature(raw,request.headers.get('x-hub-signature-256'),process.env.WHATSAPP_APP_SECRET!)) {
      return Response.json({ error: 'Invalid signature.' }, { status: 401 });
    }
    let payload:unknown;
    try { payload = JSON.parse(raw.toString('utf8')); }
    catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    try {
      const db = whatsappServiceDb();
      const ids = await enqueueWhatsappMessages(db,payload);
      for (const id of ids) waitUntil(processWhatsappInbox(id).catch(error => console.error('WhatsApp inbox processing failed',id,error)));
      return Response.json({ received: true });
    } catch (error) {
      console.error('WhatsApp webhook storage failed',error);
      return Response.json({ error: 'Inbox unavailable.' }, { status: 503 });
    }
  }
};
