import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AiError } from './openai.js';
import { extractOutletOrder, validateOutletOrder, type OrderItem, type OrderSupplier } from './whatsappOrder.js';

const schema = z.object({ accountId: z.string().uuid(), text: z.string().trim().min(3).max(2000) });
const requireData = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new AiError(result.error.message, 400);
  return result.data;
};

/** The web preview uses the same parser and checks as incoming WhatsApp, but never creates or sends an order. */
export async function handleWhatsappPreview(input: unknown, authorization: string | undefined) {
  const { accountId, text } = schema.parse(input);
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new AiError('Sign in to preview an order.', 401);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AiError('Supabase is not configured.', 503);
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw new AiError('Session expired. Sign in again.', 401);
  const account = requireData(await db.from('ledger_accounts').select('id').eq('id', accountId).eq('owner_user_id', user.id).maybeSingle());
  if (!account) throw new AiError('Outlet not found.', 404);
  const allowed = requireData(await db.rpc('ledger_consume_ai_quota', { p_account_id: accountId }));
  if (!allowed) throw new AiError('AI limit reached. Try again in an hour.', 429);
  const [items, suppliers, settings] = await Promise.all([
    db.from('ledger_items').select('id,supplier_id,name,unit,aliases,order_unit_aliases,active').eq('account_id', accountId).limit(500),
    db.from('ledger_suppliers').select('id,name,whatsapp_e164,delivery_days,cutoff_time,lead_time_days').eq('account_id', accountId).limit(200),
    db.from('ledger_wa_settings').select('owner_phone_e164').eq('account_id', accountId).maybeSingle()
  ]);
  const itemRows = requireData(items) as OrderItem[];
  const supplierRows = requireData(suppliers) as OrderSupplier[];
  const ownerPhone = requireData(settings)?.owner_phone_e164;
  const extracted = await extractOutletOrder(text, itemRows, supplierRows);
  return validateOutletOrder(extracted, itemRows, supplierRows, new Date(), ownerPhone);
}
