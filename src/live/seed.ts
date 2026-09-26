import demo from '../../data/demo.json';
import { createDelivery } from './data';
import { needClient } from './supabase';
import type { Item, Supplier } from './types';

const sgDate = (value: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = (key: string) => parts.find(p => p.type === key)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
export async function seedDemo(accountId: string, onProgress: (message: string) => void) {
  const db = needClient();
  onProgress('Adding sample suppliers…');
  const suppliersPayload = Object.entries(demo.suppliers).map(([key, value]) => ({
    account_id: accountId, external_ref: `demo:supplier:${key}`, name: value.name,
    short_name: value.short, contact_name: value.contact, category: value.cats,
    cutoff_time: `${String(value.cutH).padStart(2, '0')}:00:00`, delivery_days: value.days, payment_terms: value.terms
  }));
  const suppliersR = await db.from('ledger_suppliers').upsert(suppliersPayload, { onConflict: 'account_id,external_ref' }).select('id,external_ref');
  if (suppliersR.error) throw new Error(suppliersR.error.message);
  const supplierIds = Object.fromEntries(((suppliersR.data || []) as Pick<Supplier, 'id' | 'external_ref'>[]).map(s => [s.external_ref!.split(':').at(-1), s.id]));
  onProgress('Adding sample catalog…');
  const itemsPayload = Object.entries(demo.items).map(([key, value]) => ({
    account_id: accountId, external_ref: `demo:item:${key}`, supplier_id: supplierIds[value.sup],
    name: value.name, unit: value.unit, aliases: value.words, active: true
  }));
  const itemsR = await db.from('ledger_items').upsert(itemsPayload, { onConflict: 'account_id,external_ref' }).select('id,external_ref');
  if (itemsR.error) throw new Error(itemsR.error.message);
  const itemIds = Object.fromEntries(((itemsR.data || []) as Pick<Item, 'id' | 'external_ref'>[]).map(i => [i.external_ref!.split(':').at(-1), i.id]));
  const existingR = await db.from('ledger_deliveries').select('external_ref').eq('account_id', accountId).not('external_ref', 'is', null);
  if (existingR.error) throw new Error(existingR.error.message);
  const existing = new Set((existingR.data || []).map(x => x.external_ref));
  for (let index = 0; index < demo.deliveries.length; index++) {
    const d = demo.deliveries[index];
    const ref = `demo:delivery:${d.id}`;
    if (existing.has(ref)) continue;
    onProgress(`Adding sample delivery ${index + 1} of ${demo.deliveries.length}…`);
    await createDelivery(accountId, {
      supplier_id: supplierIds[d.sid], delivered_on: sgDate(d.date), order_channel: d.viaLedger ? 'ledger' : 'phone',
      note: 'Imported sample delivery', external_ref: ref,
      lines: d.lines.map(l => ({ item_id: itemIds[l.id], quantity_ordered: l.ordered,
        quantity_delivered: l.delivered, quantity_charged: l.charged, unit_price: l.price }))
    });
  }
  onProgress('Restoring sample claim statuses…');
  const claimsR = await db.from('ledger_claims').select('id,external_ref').eq('account_id', accountId).like('external_ref', 'demo:delivery:%');
  if (claimsR.error) throw new Error(claimsR.error.message);
  const statuses = new Map(demo.claims.map(c => [`demo:delivery:${c.id}`, c.status]));
  for (const claim of claimsR.data || []) {
    const base = String(claim.external_ref).replace(/:\d+$/, '');
    const status = statuses.get(base);
    if (status && status !== 'open') {
      const result = await db.from('ledger_claims').update({ status }).eq('account_id', accountId).eq('id', claim.id);
      if (result.error) throw new Error(result.error.message);
    }
  }
  const updated = await db.from('ledger_accounts').update({ demo_seeded_at: new Date().toISOString() }).eq('id', accountId);
  if (updated.error) throw new Error(updated.error.message);
  onProgress('Sample ledger ready.');
}
