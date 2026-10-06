import { needClient } from './supabase';
import type { Account, Claim, ClaimSummary, Delivery, Item, ItemStat, Ledger, Line, MarketBenchmark, PriceInsight, Product, RestockInsight, SpendSummary, Supplier, SupplierStat } from './types';
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
  const [suppliersR, productsR, itemsR, deliveriesR, supplierStatsR, itemStatsR, claimsSummaryR, spendSummaryR, monthSummaryR, priceR, restockR, benchmarksR] = await Promise.all([
    db.from('ledger_suppliers').select('*').eq('account_id', accountId).order('name'),
    db.from('ledger_products').select('*').eq('account_id', accountId).order('name'),
    db.from('ledger_items').select('*').eq('account_id', accountId).order('name'),
    db.from('ledger_deliveries').select('*').eq('account_id', accountId).order('delivered_on', { ascending: false }).range(page * pageSize, (page + 1) * pageSize),
    db.rpc('ledger_supplier_stats', { p_account_id: accountId }),
    db.rpc('ledger_all_item_stats', { p_account_id: accountId }),
    db.rpc('ledger_claim_summary', { p_account_id: accountId }),
    db.rpc('ledger_spend_summary', { p_account_id: accountId }),
    db.rpc('ledger_spend_summary', { p_account_id: accountId, p_start: nowMonthStart() }),
    db.rpc('ledger_price_insights', { p_account_id: accountId }),
    db.rpc('ledger_restock_insights', { p_account_id: accountId }),
    db.from('ledger_market_benchmarks').select('*').eq('account_id', accountId).order('observed_on', { ascending: false }).limit(500)
  ]);
  for (const r of [suppliersR, productsR, itemsR, deliveriesR, supplierStatsR, itemStatsR, claimsSummaryR, spendSummaryR, monthSummaryR, priceR, restockR, benchmarksR]) fail(r.error);
  const deliveryRows = ((deliveriesR.data || []) as Omit<Delivery, 'lines'>[]).slice(0, pageSize);
  const ids = deliveryRows.map(d => d.id);
  const lines: Line[] = [];
  if (ids.length) for (let from = 0; ; from += 1000) {
    const result = await db.from('ledger_delivery_lines').select('*').eq('account_id', accountId).in('delivery_id', ids).order('id').range(from, from + 999);
    fail(result.error);
    lines.push(...((result.data || []) as Line[]));
    if ((result.data || []).length < 1000) break;
  }
  const lineIds = lines.map(l => l.id);
  const claims: Claim[] = [];
  for (let start = 0; start < lineIds.length; start += 100) {
    const chunk = lineIds.slice(start, start + 100);
    for (let from = 0; ; from += 1000) {
      const result = await db.from('ledger_claims').select('*').eq('account_id', accountId).in('delivery_line_id', chunk).order('id').range(from, from + 999);
      fail(result.error);
      claims.push(...((result.data || []) as Claim[]));
      if ((result.data || []).length < 1000) break;
    }
  }
  return {
    suppliers: (suppliersR.data || []) as Supplier[], products: (productsR.data || []) as Product[], items: (itemsR.data || []) as Item[],
    deliveries: deliveryRows.map(d => ({ ...d, lines: lines.filter(l => l.delivery_id === d.id) })), claims,
    supplierStats: (supplierStatsR.data || []) as SupplierStat[], itemStats: (itemStatsR.data || []) as ItemStat[],
    priceInsights: (priceR.data || []) as PriceInsight[], restockInsights: (restockR.data || []) as RestockInsight[],
    marketBenchmarks: (benchmarksR.data || []) as MarketBenchmark[],
    claimsSummary: ((claimsSummaryR.data || [])[0] || { outstanding: 0, recovered: 0, open_count: 0, asked_count: 0 }) as ClaimSummary,
    spendSummary: ((spendSummaryR.data || [])[0] || { total: 0, delivery_count: 0 }) as SpendSummary,
    monthSummary: ((monthSummaryR.data || [])[0] || { total: 0, delivery_count: 0 }) as SpendSummary,
    hasMore: (deliveriesR.data || []).length > pageSize
  };
}
export async function createSupplier(accountId: string, value: { name: string; short_name: string; contact_name: string; category: string; cutoff_time: string | null; delivery_days: number[]; payment_terms: string; lead_time_days: number | null; whatsapp_e164?: string | null }) {
  const { data, error } = await needClient().from('ledger_suppliers').insert({ account_id: accountId, ...value }).select('*').single(); fail(error);
  return data as Supplier;
}
export async function createProduct(accountId: string, value: { name: string; category: string; grade: string; base_unit: Product['base_unit']; safety_days: number; singstat_series_no: number | null }): Promise<Product> {
  const { data, error } = await needClient().from('ledger_products').insert({ account_id: accountId, ...value }).select('*').single(); fail(error);
  return data as Product;
}
export async function createItem(accountId: string, value: { supplier_id: string; product_id: string; base_quantity: number | null; name: string; unit: string; aliases: string[]; order_unit_aliases?: string[] }) {
  const { error } = await needClient().from('ledger_items').insert({ account_id: accountId, ...value }); fail(error);
}
export async function updateItem(accountId: string, itemId: string, value: { product_id: string; base_quantity: number; name: string; unit: string; aliases: string[]; order_unit_aliases?: string[] }) {
  const { error } = await needClient().from('ledger_items').update(value).eq('account_id', accountId).eq('id', itemId).select('id').single(); fail(error);
}
export async function setItemActive(accountId: string, itemId: string, active: boolean) {
  const { error } = await needClient().from('ledger_items').update({ active }).eq('account_id', accountId).eq('id', itemId).select('id').single(); fail(error);
}
export async function updateItemPack(accountId: string, itemId: string, productId: string, baseQuantity: number) {
  const { error } = await needClient().from('ledger_items').update({ product_id: productId, base_quantity: baseQuantity }).eq('account_id', accountId).eq('id', itemId); fail(error);
}
export async function updateProductRetailSeries(accountId: string, productId: string, seriesNo: number | null) {
  const { error } = await needClient().from('ledger_products').update({ singstat_series_no: seriesNo }).eq('account_id', accountId).eq('id', productId); fail(error);
}
export async function updateSupplierLeadTime(accountId: string, supplierId: string, days: number) {
  const { error } = await needClient().from('ledger_suppliers').update({ lead_time_days: days }).eq('account_id', accountId).eq('id', supplierId); fail(error);
}
export async function addQuote(accountId: string, itemId: string, date: string, price: number, validUntil: string | null) {
  const { error } = await needClient().from('ledger_supplier_quotes').insert({ account_id: accountId, item_id: itemId, quoted_on: date, price_per_pack: price, valid_until: validUntil }); fail(error);
}
export async function addStockCount(accountId: string, productId: string, date: string, quantity: number) {
  const { error } = await needClient().from('ledger_stock_counts').upsert({ account_id: accountId, product_id: productId, counted_on: date, quantity_base: quantity }, { onConflict: 'account_id,product_id,counted_on' }); fail(error);
}
export async function addUsage(accountId: string, productId: string, date: string, quantity: number, kind: 'used' | 'waste') {
  const { error } = await needClient().from('ledger_usage_records').insert({ account_id: accountId, product_id: productId, used_on: date, quantity_base: quantity, kind }); fail(error);
}
export async function addBenchmark(accountId: string, value: { product_id: string; market: string; source_name: string; source_url: string; observed_on: string; price_per_base: number; basis: 'wholesale' | 'retail_reference'; note: string }) {
  const { error } = await needClient().from('ledger_market_benchmarks').insert({ account_id: accountId, ...value }); fail(error);
}
export async function importUsage(accountId: string, rows: { product_id: string; used_on: string; quantity_base: number; kind: 'used' | 'waste'; external_ref: string }[]) {
  const { error } = await needClient().from('ledger_usage_records').upsert(rows.map(row => ({ account_id: accountId, ...row })), { onConflict: 'account_id,external_ref' }); fail(error);
}
export async function importQuotes(accountId: string, rows: { item_id: string; quoted_on: string; price_per_pack: number; valid_until: string | null; external_ref: string }[]) {
  const { error } = await needClient().from('ledger_supplier_quotes').upsert(rows.map(row => ({ account_id: accountId, ...row })), { onConflict: 'account_id,external_ref' }); fail(error);
}
export async function importCounts(accountId: string, rows: { product_id: string; counted_on: string; quantity_base: number }[]) {
  const { error } = await needClient().from('ledger_stock_counts').upsert(rows.map(row => ({ account_id: accountId, ...row })), { onConflict: 'account_id,product_id,counted_on' }); fail(error);
}
export async function existingDeliveryRefs(accountId: string, digest: string): Promise<Set<string>> {
  const { data, error } = await needClient().from('ledger_deliveries').select('external_ref').eq('account_id', accountId).like('external_ref', `csv:${digest}:%`); fail(error);
  return new Set((data || []).map(row => row.external_ref).filter(Boolean) as string[]);
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
