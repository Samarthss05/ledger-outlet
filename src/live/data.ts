import { needClient } from './supabase';
import type { Account, Claim, ClaimSummary, Delivery, Item, ItemStat, Ledger, Line, SpendSummary, Supplier, SupplierStat } from './types';
const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
const nowMonthStart = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  return `${year}-${month}-01`;
};

export async function listAccounts(): Promise<Account[]> {
  const { data, error } = await needClient().from('ledger_accounts').select('id,owner_user_id,name,demo_seeded_at').order('created_at'); fail(error);
  return (data || []) as Account[];
}
export async function createAccount(name: string, userId: string): Promise<Account> {
  const { data, error } = await needClient().from('ledger_accounts').insert({ name: name.trim(), owner_user_id: userId }).select('id,owner_user_id,name,demo_seeded_at').single(); fail(error);
  return data as Account;
}
export async function loadLedger(accountId: string, page = 0, pageSize = 100): Promise<Ledger> {
  const db = needClient();
  const [suppliersR, itemsR, deliveriesR, supplierStatsR, itemStatsR, claimsSummaryR, spendSummaryR, monthSummaryR] = await Promise.all([
    db.from('ledger_suppliers').select('*').eq('account_id', accountId).order('name'),
    db.from('ledger_items').select('*').eq('account_id', accountId).order('name'),
    db.from('ledger_deliveries').select('*').eq('account_id', accountId).order('delivered_on', { ascending: false }).range(page * pageSize, (page + 1) * pageSize),
    db.rpc('ledger_supplier_stats', { p_account_id: accountId }),
    db.rpc('ledger_all_item_stats', { p_account_id: accountId }),
    db.rpc('ledger_claim_summary', { p_account_id: accountId }),
    db.rpc('ledger_spend_summary', { p_account_id: accountId }),
    db.rpc('ledger_spend_summary', { p_account_id: accountId, p_start: nowMonthStart() })
  ]);
  for (const r of [suppliersR, itemsR, deliveriesR, supplierStatsR, itemStatsR, claimsSummaryR, spendSummaryR, monthSummaryR]) fail(r.error);
  const deliveryRows = ((deliveriesR.data || []) as Omit<Delivery, 'lines'>[]).slice(0, pageSize);
  const ids = deliveryRows.map(d => d.id);
  const linesR = ids.length ? await db.from('ledger_delivery_lines').select('*').eq('account_id', accountId).in('delivery_id', ids) : { data: [] as Line[], error: null };
  fail(linesR.error);
  const lines = (linesR.data || []) as Line[];
  const lineIds = lines.map(l => l.id);
  const claimsR = lineIds.length ? await db.from('ledger_claims').select('*').eq('account_id', accountId).in('delivery_line_id', lineIds) : { data: [] as Claim[], error: null };
  fail(claimsR.error);
  return {
    suppliers: (suppliersR.data || []) as Supplier[], items: (itemsR.data || []) as Item[],
    deliveries: deliveryRows.map(d => ({ ...d, lines: lines.filter(l => l.delivery_id === d.id) })), claims: (claimsR.data || []) as Claim[],
    supplierStats: (supplierStatsR.data || []) as SupplierStat[], itemStats: (itemStatsR.data || []) as ItemStat[],
    claimsSummary: ((claimsSummaryR.data || [])[0] || { outstanding: 0, recovered: 0, open_count: 0, asked_count: 0 }) as ClaimSummary,
    spendSummary: ((spendSummaryR.data || [])[0] || { total: 0, delivery_count: 0 }) as SpendSummary,
    monthSummary: ((monthSummaryR.data || [])[0] || { total: 0, delivery_count: 0 }) as SpendSummary,
    hasMore: (deliveriesR.data || []).length > pageSize
  };
}
export async function createSupplier(accountId: string, value: { name: string; short_name: string; contact_name: string; category: string; cutoff_time: string | null; delivery_days: number[]; payment_terms: string }) {
  const { error } = await needClient().from('ledger_suppliers').insert({ account_id: accountId, ...value }); fail(error);
}
export async function createItem(accountId: string, value: { supplier_id: string; name: string; unit: string; aliases: string[] }) {
  const { error } = await needClient().from('ledger_items').insert({ account_id: accountId, ...value }); fail(error);
}
export async function createDelivery(accountId: string, value: { supplier_id: string; delivered_on: string; order_channel: Delivery['order_channel']; note: string; lines: { item_id: string; quantity_ordered: number; quantity_delivered: number; quantity_charged: number; unit_price: number }[]; external_ref?: string | null }) {
  const { error } = await needClient().rpc('ledger_create_delivery', {
    p_account_id: accountId, p_supplier_id: value.supplier_id, p_delivered_on: value.delivered_on,
    p_order_channel: value.order_channel, p_note: value.note, p_lines: value.lines,
    p_external_ref: value.external_ref || null
  }); fail(error);
}
export async function updateClaim(accountId: string, claimId: string, status: Claim['status']) {
  const { error } = await needClient().from('ledger_claims').update({ status, updated_at: new Date().toISOString() }).eq('account_id', accountId).eq('id', claimId); fail(error);
}
export async function deleteDelivery(accountId: string, deliveryId: string) {
  const { error } = await needClient().from('ledger_deliveries').delete().eq('account_id', accountId).eq('id', deliveryId); fail(error);
}
