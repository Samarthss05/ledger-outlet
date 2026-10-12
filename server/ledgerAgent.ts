import { createClient } from '@supabase/supabase-js';
import { AiError } from './openai.js';
import { fetchRetailReferences } from './singstat.js';

type Db = ReturnType<typeof createClient<any, 'public', 'public'>>;
export type View = 'overview'|'catalog'|'spend'|'deliveries'|'prices'|'stock'|'claims'|'market';
const check = <T>(result:{data:T;error:{message:string}|null}) => { if(result.error) throw new AiError(result.error.message,400); return result.data; };
const key = (value:unknown) => String(value || '').toLocaleLowerCase().trim();
const matches = (value:unknown, search:string|null) => !search || key(value).includes(key(search));
const num = (value:unknown) => Number(value || 0);
const money = (value:unknown) => `S$${num(value).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fact = (label:string, value:unknown) => `${label}: ${JSON.stringify(value)}`.slice(0,850);

export async function readLedger(db:Db, accountId:string, view:View, search:string|null, from:string|null, to:string|null):Promise<string[]> {
  if (from && to && from > to) return ['The start date is after the end date. Ask for a valid period.'];
  if (view === 'overview') {
    const [spendR,claimsR,suppliersR,itemsR] = await Promise.all([
      db.rpc('ledger_spend_summary',{p_account_id:accountId}),db.rpc('ledger_claim_summary',{p_account_id:accountId}),
      db.rpc('ledger_supplier_stats',{p_account_id:accountId}),db.from('ledger_suppliers').select('id,name').eq('account_id',accountId).limit(200)
    ]);
    const spend = (check(spendR)||[])[0], claims = (check(claimsR)||[])[0], supplierStats = check(suppliersR)||[], suppliers = check(itemsR)||[];
    const matched=supplierStats.filter((row:any) => matches(suppliers.find((supplier:any) => supplier.id === row.supplier_id)?.name,search)).slice(0,12);
    return [fact('All-time outlet totals, not a date-filtered result',{spend:money(spend?.total),deliveries:num(spend?.delivery_count),outstandingClaims:money(claims?.outstanding),recoveredClaims:money(claims?.recovered),openClaims:num(claims?.open_count)}),
      ...matched.map((row:any) => fact('All-time supplier aggregate',{supplier:suppliers.find((supplier:any) => supplier.id === row.supplier_id)?.name,spend:money(row.total_spend),deliveries:num(row.delivery_count),shortages:num(row.short_count)})),
      ...(search && !matched.length ? [fact('Supplier aggregate search',{search,result:'No matching supplier aggregate'})] : [])];
  }
  if (view === 'catalog') {
    const [itemsR,productsR,suppliersR] = await Promise.all([
      db.from('ledger_items').select('id,name,unit,base_quantity,product_id,supplier_id,active,aliases').eq('account_id',accountId).limit(500),
      db.from('ledger_products').select('id,name,base_unit,category,grade').eq('account_id',accountId).limit(300),
      db.from('ledger_suppliers').select('id,name,lead_time_days').eq('account_id',accountId).limit(200)
    ]);
    const items=check(itemsR)||[],products=check(productsR)||[],suppliers=check(suppliersR)||[];
    const rows = items.filter((row:any) => matches(row.name,search) || (search && row.aliases?.some((name:string) => matches(name,search))) || (search && matches(suppliers.find((supplier:any) => supplier.id === row.supplier_id)?.name,search))).slice(0,search ? 25 : 15)
      .map((row:any) => fact('Catalog supplier item',{name:row.name,supplier:suppliers.find((supplier:any) => supplier.id === row.supplier_id)?.name,product:products.find((product:any) => product.id === row.product_id)?.name,packUnit:row.unit,baseQuantity:row.base_quantity,active:row.active,aliases:row.aliases}));
    const productRows = products.filter((row:any) => matches(row.name,search)).slice(0,search ? 10 : 8).map((row:any) => fact('Comparable product',{name:row.name,baseUnit:row.base_unit,category:row.category,grade:row.grade}));
    const supplierRows = suppliers.filter((row:any) => matches(row.name,search)).slice(0,search ? 10 : 12).map((row:any) => fact('Supplier',{name:row.name,leadDays:row.lead_time_days}));
    return [...rows,...productRows,...supplierRows].slice(0,35).length ? [...rows,...productRows,...supplierRows].slice(0,35) : ['No matching catalog records in the scanned outlet catalog.'];
  }
  if (view === 'spend' || view === 'deliveries') {
    const suppliers = check(await db.from('ledger_suppliers').select('id,name').eq('account_id',accountId).limit(200))||[];
    const items = check(await db.from('ledger_items').select('id,name,supplier_id,unit').eq('account_id',accountId).limit(500))||[];
    let query = db.from('ledger_deliveries').select('id,supplier_id,delivered_on,order_channel').eq('account_id',accountId).order('delivered_on',{ascending:false}).limit(view === 'spend' ? 301 : 61);
    if (from) query=query.gte('delivered_on',from);
    if (to) query=query.lte('delivered_on',to);
    const deliveries=check(await query)||[];
    if (!deliveries.length) return [fact('Delivery search',{from,to,search,result:'No recorded deliveries in this period'})];
    const ids=deliveries.map((row:any) => row.id);
    const lines=check(await db.from('ledger_delivery_lines').select('delivery_id,item_id,quantity_delivered,quantity_charged,unit_price,line_total,short_value').eq('account_id',accountId).in('delivery_id',ids).limit(1001))||[];
    const incomplete=deliveries.length >= (view === 'spend' ? 301 : 61) || lines.length >= 1001;
    const selected=deliveries.flatMap((delivery:any) => lines.filter((line:any) => line.delivery_id === delivery.id).map((line:any) => ({date:delivery.delivered_on,supplier:suppliers.find((row:any) => row.id === delivery.supplier_id)?.name || 'Unknown supplier',item:items.find((row:any) => row.id === line.item_id)?.name || 'Unknown item',unit:items.find((row:any) => row.id === line.item_id)?.unit,charged:num(line.quantity_charged),delivered:num(line.quantity_delivered),unitPrice:num(line.unit_price),total:num(line.line_total),shortValue:num(line.short_value)})))
      .filter((row:any) => matches(row.supplier,search) || matches(row.item,search));
    if (!selected.length) return [fact('Delivery search',{from,to,search,result:'No matching recorded delivery lines',complete:!incomplete})];
    if (view === 'deliveries') return [fact('Delivery results',{from,to,search,complete:!incomplete,shown:Math.min(selected.length,18)}),...selected.slice(0,18).map((row:any) => fact('Delivery line',row))];
    const bySupplier=new Map<string,number>(), byItem=new Map<string,number>();
    for(const row of selected){bySupplier.set(row.supplier,(bySupplier.get(row.supplier)||0)+row.total);byItem.set(row.item,(byItem.get(row.item)||0)+row.total);}
    return [fact('Spend calculation',{from,to,search,complete:!incomplete,deliveryLines:selected.length,total:incomplete ? null : money(selected.reduce((sum:number,row:any) => sum+row.total,0)),note:incomplete?'Result exceeded the read limit; do not present a complete total.':null}),
      ...[...bySupplier].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([supplier,total])=>fact('Spend by supplier',{supplier,total:money(total)})),
      ...[...byItem].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([item,total])=>fact('Spend by item',{item,total:money(total)}))];
  }
  if (view === 'prices' || view === 'market') {
    const [pricesR,productsR,suppliersR,benchmarksR] = await Promise.all([
      db.rpc('ledger_price_insights',{p_account_id:accountId}),
      db.from('ledger_products').select('id,name,base_unit,singstat_series_no').eq('account_id',accountId).limit(300),
      db.from('ledger_suppliers').select('id,name').eq('account_id',accountId).limit(200),
      db.from('ledger_market_benchmarks').select('product_id,market,source_name,source_url,observed_on,price_per_base,basis').eq('account_id',accountId).order('observed_on',{ascending:false}).limit(100)
    ]);
    const prices=check(pricesR)||[],products=check(productsR)||[],suppliers=check(suppliersR)||[],benchmarks=check(benchmarksR)||[];
    const product=(id:string) => products.find((row:any) => row.id === id);
    const rows=prices.filter((row:any) => matches(product(row.product_id)?.name,search) || matches(suppliers.find((supplier:any) => supplier.id === row.supplier_id)?.name,search))
      .filter((row:any) => (!from || row.observed_on >= from) && (!to || row.observed_on <= to)).sort((a:any,b:any) => String(b.observed_on).localeCompare(String(a.observed_on))).slice(0,25)
      .map((row:any) => fact('Comparable supplier price',{product:product(row.product_id)?.name,baseUnit:product(row.product_id)?.base_unit,supplier:suppliers.find((supplier:any) => supplier.id === row.supplier_id)?.name,source:row.source_kind,observedOn:row.observed_on,pricePerBase:num(row.price_per_base)}));
    const market=benchmarks.filter((row:any) => matches(product(row.product_id)?.name,search)).filter((row:any) => (!from || row.observed_on >= from) && (!to || row.observed_on <= to)).slice(0,15)
      .map((row:any) => fact('User-recorded market reference',{product:product(row.product_id)?.name,baseUnit:product(row.product_id)?.base_unit,basis:row.basis,market:row.market,source:row.source_name,url:row.source_url,observedOn:row.observed_on,pricePerBase:num(row.price_per_base)}));
    const result=[...rows,...market];
    if(view === 'market') {
      const retail=await fetchRetailReferences().catch(()=>[]);
      for(const productRow of products.filter((row:any) => matches(row.name,search)).slice(0,15)) {
        const reference=retail.find(row => row.seriesNo === productRow.singstat_series_no && row.baseUnit === productRow.base_unit);
        if(reference) result.push(fact('Singapore consumer retail reference; NOT a wholesale price',{product:productRow.name,reference:reference.name,pricePerBase:reference.pricePerBase,baseUnit:reference.baseUnit,period:reference.period,url:reference.sourceUrl}));
      }
    }
    return result.length ? result.slice(0,35) : [fact('Price search',{search,from,to,result:'No comparable price or market reference recorded; a global wholesale benchmark is unavailable without a source'})];
  }
  if (view === 'stock') {
    const [restockR,productsR,countsR,usageR] = await Promise.all([
      db.rpc('ledger_restock_insights',{p_account_id:accountId}),db.from('ledger_products').select('id,name,base_unit').eq('account_id',accountId).limit(300),
      db.from('ledger_stock_counts').select('product_id,counted_on,quantity_base').eq('account_id',accountId).order('counted_on',{ascending:false}).limit(100),
      db.from('ledger_usage_records').select('product_id,used_on,quantity_base,kind').eq('account_id',accountId).order('used_on',{ascending:false}).limit(100)
    ]);
    const restock=check(restockR)||[],products=check(productsR)||[],counts=check(countsR)||[],usage=check(usageR)||[];
    const urgency=(row:any) => {const insight=restock.find((item:any) => item.product_id === row.id);return insight?.days_cover != null && insight?.lead_days != null ? Number(insight.days_cover)-Number(insight.lead_days)-Number(insight.safety_days || 0) : 9999;};
    const rows=products.filter((row:any) => matches(row.name,search)).sort((a:any,b:any) => urgency(a)-urgency(b)).slice(0,25).map((row:any) => {
      const insight=restock.find((item:any) => item.product_id === row.id), count=counts.find((item:any) => item.product_id === row.id);
      return fact('Stock and replenishment',{product:row.name,baseUnit:row.base_unit,lastCount:count?.counted_on || null,countedQuantity:count?.quantity_base ?? null,
        stockOnHand:insight?.stock_on_hand ?? null,daysCover:insight?.days_cover ?? null,leadDays:insight?.lead_days ?? null,safetyDays:insight?.safety_days ?? null,suggestedQuantity:insight?.suggested_quantity ?? null,
        recentUsage:usage.filter((item:any) => item.product_id === row.id).slice(0,7).map((item:any) => ({on:item.used_on,quantity:item.quantity_base,kind:item.kind}))});
    });
    return rows.length ? rows : [fact('Stock search',{search,result:'No matching product or supported stock data'})];
  }
  const [claimsR,summaryR,linesR,deliveriesR,suppliersR,itemsR] = await Promise.all([
    db.from('ledger_claims').select('id,delivery_line_id,amount,status,updated_at').eq('account_id',accountId).order('updated_at',{ascending:false}).limit(100),
    db.rpc('ledger_claim_summary',{p_account_id:accountId}),
    db.from('ledger_delivery_lines').select('id,delivery_id,item_id').eq('account_id',accountId).limit(500),
    db.from('ledger_deliveries').select('id,supplier_id,delivered_on').eq('account_id',accountId).order('delivered_on',{ascending:false}).limit(300),
    db.from('ledger_suppliers').select('id,name').eq('account_id',accountId).limit(200),
    db.from('ledger_items').select('id,name').eq('account_id',accountId).limit(500)
  ]);
  const claims=check(claimsR)||[],summary=(check(summaryR)||[])[0],lines=check(linesR)||[],deliveries=check(deliveriesR)||[],suppliers=check(suppliersR)||[],items=check(itemsR)||[];
  const rows=claims.map((row:any) => { const line=lines.find((item:any) => item.id === row.delivery_line_id),delivery=deliveries.find((item:any) => item.id === line?.delivery_id);
    return {id:row.id,supplier:suppliers.find((supplier:any) => supplier.id === delivery?.supplier_id)?.name || null,item:items.find((item:any) => item.id === line?.item_id)?.name || null,deliveryDate:delivery?.delivered_on || null,amount:money(row.amount),status:row.status,updatedAt:row.updated_at};
  }).filter((row:any) => matches(row.supplier,search) || matches(row.item,search)).filter((row:any) => (!from || (row.deliveryDate && row.deliveryDate >= from)) && (!to || (row.deliveryDate && row.deliveryDate <= to)));
  return [fact('All-time claim totals, not date-filtered',{outstanding:money(summary?.outstanding),recovered:money(summary?.recovered),open:num(summary?.open_count)}),
    ...rows.slice(0,25).map((row:any)=>fact('Shortage claim',row)),
    ...(!rows.length ? [fact('Claim search',{search,from,to,result:'No matching claim rows in the scanned records'})] : [])];
}
