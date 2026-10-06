import { timingSafeEqual } from 'node:crypto';
import { drainWhatsappInbox } from '../server/whatsappWebhook.js';

const same = (a:string,b:string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left,right);
};
export default {
  async fetch(request:Request):Promise<Response> {
    if (request.method !== 'POST') return Response.json({error:'Method not allowed.'},{status:405});
    const secret = process.env.WHATSAPP_WORKER_SECRET;
    if (!secret) return Response.json({error:'Worker is not configured.'},{status:503});
    if (!same(request.headers.get('authorization') || '',`Bearer ${secret}`)) return Response.json({error:'Unauthorized.'},{status:401});
    try { return Response.json({processed:await drainWhatsappInbox(5)}); }
    catch (error) { console.error(error); return Response.json({error:'Worker failed.'},{status:500}); }
  }
};
