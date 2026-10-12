import type { Ledger, Product } from './types';
import { addBenchmark, addQuote, addStockCount, addUsage, createDelivery, createItem, createProduct, createSupplier, setItemActive, updateClaim, updateItem, updateSupplierLeadTime } from './data';
import { addAgentMemory } from './memories';

export type AssistantProposal = {
  kind: 'create_item' | 'edit_item' | 'toggle_item' | 'create_product' | 'create_supplier' | 'record_quote' | 'record_stock' | 'record_usage' | 'set_lead_time' | 'record_delivery' | 'update_claim' | 'record_benchmark' | 'remember_fact';
  itemId: string | null;
  supplierId: string | null;
  productId: string | null;
  name: string | null;
  unit: string | null;
  baseQuantity: number | null;
  baseUnit: Product['base_unit'] | null;
  active: boolean | null;
  category: string | null;
  grade: string | null;
  aliases: string[];
  date: string | null;
  quantity: number | null;
  price: number | null;
  usageKind: 'used' | 'waste' | null;
  leadDays: number | null;
  claimId: string | null;
  claimStatus: 'open' | 'asked' | 'credited' | 'refused' | null;
  deliveryLines: { itemId: string | null; quantityOrdered: number | null; quantityDelivered: number | null; quantityCharged: number | null; unitPrice: number | null }[];
  market: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  note: string | null;
};

export async function applyAssistantProposal(accountId: string, proposal: AssistantProposal, fields: FormData, ledger: Ledger) {
  const value = (key: string) => String(fields.get(key) || '').trim();
  const bounded = (key: string, max: number) => value(key).slice(0, max);
  const date = value('date');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
  if (proposal.kind === 'remember_fact') {
    const content = bounded('note', 500);
    if (content.length < 2) throw new Error('Enter a fact for Ledger to remember.');
    await addAgentMemory(accountId, content);
    return 'Saved that outlet memory. The agent team will consider it in future conversations.';
  }
  if (proposal.kind === 'update_claim') {
    const claim = ledger.claims.find(row => row.id === value('claimId'));
    const status = value('claimStatus');
    if (!claim || !['open', 'asked', 'credited', 'refused'].includes(status)) throw new Error('Choose a claim and status.');
    await updateClaim(accountId, claim.id, status as typeof claim.status);
    return `Marked the S$${Number(claim.amount).toFixed(2)} claim as ${status}.`;
  }
  if (proposal.kind === 'record_delivery') {
    const supplier = ledger.suppliers.find(row => row.id === value('supplierId'));
    if (!supplier || !validDate) throw new Error('Choose a supplier and delivery date.');
    const indices = fields.getAll('lineIndex').map(Number);
    if (!indices.length || indices.length > 100) throw new Error('A delivery needs 1 to 100 item lines.');
    const lines = indices.map(index => {
      const item = ledger.items.find(row => row.id === value(`lineItemId${index}`) && row.supplier_id === supplier.id && row.active);
      const quantityOrdered = Number(value(`lineOrdered${index}`));
      const quantityDelivered = Number(value(`lineDelivered${index}`));
      const quantityCharged = Number(value(`lineCharged${index}`));
      const unitPrice = Number(value(`linePrice${index}`));
      if (!item || ['lineOrdered','lineDelivered','lineCharged','linePrice'].some(key => !value(`${key}${index}`)) || ![quantityOrdered, quantityDelivered, quantityCharged, unitPrice].every(Number.isFinite) || quantityOrdered < 0 || quantityDelivered < 0 || quantityCharged < 0 || unitPrice < 0 || quantityOrdered + quantityDelivered + quantityCharged === 0) throw new Error('Each line needs an active supplier item, quantities, and a valid unit price.');
      return { item_id: item.id, quantity_ordered: quantityOrdered, quantity_delivered: quantityDelivered, quantity_charged: quantityCharged, unit_price: unitPrice };
    });
    await createDelivery(accountId, { supplier_id: supplier.id, delivered_on: date, order_channel: 'other', note: 'Recorded from assistant review', lines });
    return `Recorded ${lines.length} delivery line${lines.length === 1 ? '' : 's'} from ${supplier.name} on ${date}.`;
  }
  if (proposal.kind === 'record_quote') {
    const item = ledger.items.find(row => row.id === value('itemId'));
    const price = Number(value('price'));
    if (!item || !validDate || !Number.isFinite(price) || price <= 0) throw new Error('Choose an item, date, and positive price per pack.');
    await addQuote(accountId, item.id, date, price, null);
    return `Recorded a S$${price.toFixed(2)} quote for ${item.name} on ${date}.`;
  }
  if (proposal.kind === 'record_benchmark') {
    const product = ledger.products.find(row => row.id === value('productId'));
    const price = Number(value('price'));
    const market = bounded('market', 120);
    const sourceName = bounded('sourceName', 160);
    const sourceUrl = bounded('sourceUrl', 500);
    if (!product || !validDate || !Number.isFinite(price) || price <= 0 || market.length < 2 || sourceName.length < 2 || (sourceUrl && !/^https:\/\//i.test(sourceUrl))) throw new Error('Choose a product, valid date, positive unit price, market, and real source. Source links must start with https://.');
    await addBenchmark(accountId, { product_id: product.id, market, source_name: sourceName, source_url: sourceUrl, observed_on: date, price_per_base: price, basis: 'wholesale', note: bounded('note', 400) });
    return `Recorded a sourced wholesale reference of S$${price.toFixed(2)} per ${product.base_unit} for ${product.name}.`;
  }
  if (proposal.kind === 'record_stock' || proposal.kind === 'record_usage') {
    const product = ledger.products.find(row => row.id === value('productId'));
    const quantity = Number(value('quantity'));
    if (!product || !validDate || !Number.isFinite(quantity) || quantity < 0 || (proposal.kind === 'record_usage' && quantity === 0)) throw new Error('Choose a product, date, and valid quantity.');
    if (proposal.kind === 'record_stock') { await addStockCount(accountId, product.id, date, quantity); return `Recorded ${quantity} ${product.base_unit} of ${product.name} in stock on ${date}.`; }
    const kind = value('usageKind');
    if (kind !== 'used' && kind !== 'waste') throw new Error('Choose used or waste.');
    await addUsage(accountId, product.id, date, quantity, kind);
    return `Recorded ${quantity} ${product.base_unit} of ${product.name} as ${kind} on ${date}.`;
  }
  if (proposal.kind === 'set_lead_time') {
    const supplier = ledger.suppliers.find(row => row.id === value('supplierId'));
    const days = Number(value('leadDays'));
    if (!supplier || !Number.isInteger(days) || days < 0 || days > 90) throw new Error('Choose a supplier and a lead time from 0 to 90 days.');
    await updateSupplierLeadTime(accountId, supplier.id, days);
    return `Set ${supplier.name}'s delivery lead time to ${days} days.`;
  }
  if (proposal.kind === 'create_supplier') {
    const name = bounded('name', 160);
    if (name.length < 2) throw new Error('Enter a supplier name.');
    await createSupplier(accountId, { name, short_name: name.slice(0, 80), contact_name: '', category: '', cutoff_time: null, delivery_days: [], payment_terms: '', lead_time_days: null });
    return `Added supplier ${name}.`;
  }
  if (proposal.kind === 'create_product') {
    const name = bounded('name', 160);
    const baseUnit = value('baseUnit');
    if (name.length < 2 || !['kg', 'l', 'each'].includes(baseUnit)) throw new Error('Enter a product name and comparison unit.');
    await createProduct(accountId, { name, category: bounded('category', 80), grade: bounded('grade', 80), base_unit: baseUnit as Product['base_unit'], safety_days: 2, singstat_series_no: null });
    return `Added product ${name}.`;
  }
  if (proposal.kind === 'toggle_item') {
    const item = ledger.items.find(row => row.id === proposal.itemId);
    if (!item || proposal.active == null) throw new Error('Item no longer found. Ask again to refresh the action.');
    await setItemActive(accountId, item.id, proposal.active);
    return `${proposal.active ? 'Reactivated' : 'Deactivated'} ${item.name}.`;
  }
  const name = bounded('name', 160);
  const unit = bounded('unit', 30);
  const baseQuantity = Number(value('baseQuantity'));
  const aliases = value('aliases').split(',').map(row => row.trim()).filter(Boolean).slice(0, 20);
  if (!name || !unit || !Number.isFinite(baseQuantity) || baseQuantity <= 0 || baseQuantity > 1_000_000) throw new Error('Enter an item name, pack unit, and positive pack size.');
  if (proposal.kind === 'edit_item') {
    const item = ledger.items.find(row => row.id === proposal.itemId);
    if (!item) throw new Error('Item no longer found. Ask again to refresh the action.');
    const productId = value('productId');
    if (!ledger.products.some(row => row.id === productId)) throw new Error('Choose a comparable product.');
    await updateItem(accountId, item.id, { name, unit, base_quantity: baseQuantity, product_id: productId, aliases });
    return `Updated ${name}.`;
  }
  let supplierId = value('supplierId');
  let productId = value('productId');
  if (supplierId !== '__new' && !ledger.suppliers.some(row => row.id === supplierId)) throw new Error('Choose a supplier.');
  if (productId !== '__new' && !ledger.products.some(row => row.id === productId)) throw new Error('Choose a comparable product.');
  const supplierName = bounded('newSupplierName', 160);
  const productName = bounded('newProductName', 160);
  const baseUnit = value('newBaseUnit');
  if (supplierId === '__new' && supplierName.length < 2) throw new Error('Enter the new supplier name.');
  if (productId === '__new' && (productName.length < 2 || !['kg', 'l', 'each'].includes(baseUnit))) throw new Error('Enter the new product name and comparison unit.');
  if (supplierId === '__new') {
    const supplier = await createSupplier(accountId, { name: supplierName, short_name: supplierName.slice(0, 80), contact_name: '', category: '', cutoff_time: null, delivery_days: [], payment_terms: '', lead_time_days: null });
    supplierId = supplier.id;
  }
  if (productId === '__new') {
    const product = await createProduct(accountId, { name: productName, category: '', grade: '', base_unit: baseUnit as Product['base_unit'], safety_days: 2, singstat_series_no: null });
    productId = product.id;
  }
  if (!supplierId || !productId) throw new Error('Choose or create a supplier and product.');
  const created = await createItem(accountId, { supplier_id: supplierId, product_id: productId, name, unit, base_quantity: baseQuantity, aliases });
  return { message: `Added ${name} to the item catalog.`, createdItemId: created.id };
}
