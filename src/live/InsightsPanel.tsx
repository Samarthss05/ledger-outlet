import { useEffect, useState, type FormEvent } from 'react';
import { addBenchmark, addQuote, addStockCount, addUsage, createProduct, updateItemPack, updateProductRetailSeries, updateSupplierLeadTime } from './data';
import type { Ledger, Product, RetailReference } from './types';

const money = (value: number) => `S$${Number(value).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sgToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ageDays = (date: string) => Math.max(0, Math.floor((Date.now() - new Date(`${date}T00:00:00+08:00`).getTime()) / 86400000));
const number = (form: FormData, key: string) => Number(form.get(key));

export function InsightsPanel({ accountId, token, ledger, busy, run, refresh }: {
  accountId: string; token: string; ledger: Ledger; busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [retail, setRetail] = useState<RetailReference[]>([]);
  const [retailError, setRetailError] = useState('');
  const [buyerBrief, setBuyerBrief] = useState<{ answer: string; evidence: string[] } | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/market').then(async response => {
      if (!response.ok) throw new Error('Official price feed is unavailable.');
      return response.json() as Promise<{ rows: RetailReference[] }>;
    }).then(data => { if (active) setRetail(data.rows); }).catch(error => { if (active) setRetailError(error.message); });
    return () => { active = false; };
  }, []);
  const supplierById = new Map(ledger.suppliers.map(s => [s.id, s]));
  const comparison = ledger.products.map(product => {
    const prices = ledger.priceInsights.filter(row => row.product_id === product.id).sort((a, b) => Number(a.price_per_base) - Number(b.price_per_base));
    const latestPaid = [...prices].filter(row => row.source_kind === 'paid').sort((a, b) => b.observed_on.localeCompare(a.observed_on))[0];
    const currentOffers = prices.filter(row => ageDays(row.observed_on) <= 30);
    const bestAlternative = currentOffers.find(row => row.supplier_id !== latestPaid?.supplier_id);
    const benchmark = ledger.marketBenchmarks.find(row => row.product_id === product.id && row.basis === 'wholesale' && ageDays(row.observed_on) <= 30);
    const official = retail.find(row => row.seriesNo === product.singstat_series_no && row.baseUnit === product.base_unit && ageDays(row.observedOn) <= 90);
    return { product, prices, latestPaid, bestAlternative, benchmark, official };
  });
  const restock = ledger.restockInsights.filter(row => row.days_cover !== null && row.lead_days !== null);
  const alerts = restock.filter(row => Number(row.days_cover) <= Number(row.lead_days) + Number(row.safety_days));
  const formAction = (action: (form: FormData) => Promise<void>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    void run(async () => { await action(values); await refresh(); form.reset(); });
  };
  const productOptions = ledger.products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.base_unit}</option>);
  const itemOptions = ledger.items.map(i => <option key={i.id} value={i.id}>{i.name} · {supplierById.get(i.supplier_id)?.name || 'Supplier'} · {i.unit}</option>);
  const explain = () => void run(async () => {
    const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'insights', accountId }) });
    const result = await response.json() as { answer?: string; evidence?: string[]; error?: string };
    if (!response.ok) throw new Error(result.error || 'Could not generate buyer brief.');
    setBuyerBrief({ answer: result.answer || '', evidence: result.evidence || [] });
  });

  return <>
    <section className="sec"><div className="sec-lbl"><h2>Market & stock insights</h2></div>
      <div className="insight-hero card pad"><span className="insight-kicker">PURCHASING DESK</span><h3>Know what to buy, and when.</h3>
        <p>Compare like-for-like supplier prices, check sourced market context, and plan replenishment from your own stock and usage records.</p>
        <div className="insight-stats"><div><strong>{comparison.filter(x => x.prices.length).length}</strong><span>products with prices</span></div><div><strong>{alerts.length}</strong><span>restock alerts</span></div><div><strong>{ledger.items.filter(i => i.base_quantity == null).length}</strong><span>packs to review</span></div></div>
        <button className="btn ai insight-ai-btn" onClick={explain} disabled={busy}>✦ Explain my buying insights</button>
      </div>
    </section>
    {buyerBrief && <section className="sec"><div className="sec-lbl"><h2>Buyer brief</h2></div><div className="card pad"><p className="result-text">{buyerBrief.answer}</p>{buyerBrief.evidence.map((line, index) => <p className="muted" key={index}>{line}</p>)}</div></section>}
    <section className="sec"><div className="sec-lbl"><h2>Supplier price analysis</h2></div>
      <p className="insight-intro">Prices are shown per product base unit. A comparison appears only after you link equivalent products and confirm each pack size.</p>
      {comparison.map(({ product, prices, latestPaid, bestAlternative, benchmark, official }) => <div className="card pad insight-card" key={product.id}>
        <div className="insight-title"><div><h3>{product.name}</h3><small>{product.grade ? `${product.grade} · ` : ''}per {product.base_unit}</small></div><span className="insight-chip">{prices.length} source{prices.length === 1 ? '' : 's'}</span></div>
        {latestPaid ? <div className="insight-lead"><span>Latest paid</span><strong>{money(Number(latestPaid.price_per_base))}</strong><small>{supplierById.get(latestPaid.supplier_id)?.name} · {latestPaid.observed_on}</small></div> : <p className="muted">No normalized purchase price yet. Confirm the supplier item’s pack size and record a delivery.</p>}
        {bestAlternative && latestPaid && Number(bestAlternative.price_per_base) < Number(latestPaid.price_per_base) && ageDays(latestPaid.observed_on) <= 30 && <p className="insight-callout">{supplierById.get(bestAlternative.supplier_id)?.name} has a {bestAlternative.source_kind} at {money(Number(bestAlternative.price_per_base))}/{product.base_unit}, {Math.round((1 - Number(bestAlternative.price_per_base) / Number(latestPaid.price_per_base)) * 100)}% below the latest paid price. Check availability and terms.</p>}
        {benchmark && latestPaid && <p className="insight-note">Recorded wholesale reference: {money(Number(benchmark.price_per_base))}/{product.base_unit} in {benchmark.market} ({benchmark.observed_on}). Latest paid is {Math.abs(Math.round((Number(latestPaid.price_per_base) / Number(benchmark.price_per_base) - 1) * 100))}% {Number(latestPaid.price_per_base) >= Number(benchmark.price_per_base) ? 'above' : 'below'} that reference. {benchmark.source_url && <a href={benchmark.source_url} target="_blank" rel="noopener noreferrer">Source ↗</a>}</p>}
        {official && <p className="retail-context">Singapore retail context: {money(official.pricePerBase)}/{product.base_unit} for {official.name}, {official.period}. <a href={official.sourceUrl} target="_blank" rel="noopener noreferrer">SingStat ↗</a><br /><small>Retail consumer average; it is not a wholesale buying benchmark.</small></p>}
        {prices.length > 0 && <div className="insight-price-list">{prices.map(row => <div key={`${row.source_kind}-${row.source_id}`}><span>{supplierById.get(row.supplier_id)?.name || 'Supplier'} <small>· {row.source_kind} · {row.observed_on}</small></span><b>{money(Number(row.price_per_base))}</b></div>)}</div>}
      </div>)}
      {!ledger.products.length && <div className="card pad"><p className="muted">Create a product, then link supplier items to it to begin comparing prices.</p></div>}
    </section>
    <section className="sec"><div className="sec-lbl"><h2>Restock timing</h2></div>
      <p className="insight-intro">Stock is calculated from your last end-of-day count, later deliveries, and usage or waste. Recommendations require at least seven recorded usage days and a supplier lead time.</p>
      {ledger.products.map(product => { const row = ledger.restockInsights.find(x => x.product_id === product.id); const urgent = row?.days_cover != null && row.lead_days != null && Number(row.days_cover) <= Number(row.lead_days) + Number(row.safety_days); return <div className="card pad restock-card" key={product.id}>
        <div className="insight-title"><h3>{product.name}</h3><span className={`insight-chip ${urgent ? 'urgent' : ''}`}>{urgent ? 'Order soon' : row?.days_cover != null ? 'On track' : 'Needs data'}</span></div>
        {!row ? <p className="muted">Add an end-of-day stock count to start tracking.</p> : <><div className="restock-numbers"><div><b>{Number(row.stock_on_hand).toFixed(1)} {product.base_unit}</b><small>estimated on hand</small></div><div><b>{row.days_cover == null ? '—' : `${row.days_cover} days`}</b><small>estimated cover</small></div></div><p className="muted">Last count {row.counted_on} · {row.usage_days} usage days · lead time {row.lead_days ?? 'unset'} days</p>
          {urgent && <p className="insight-callout">Review an order of about {Number(row.suggested_quantity).toFixed(1)} {product.base_unit} to cover lead time, {row.safety_days} safety days, and the following week. Confirm incoming orders and current stock first.</p>}
          {row.days_cover == null && <p className="muted">Record daily usage on at least seven dates in the past 28 days.</p>}{row.lead_days == null && <p className="muted">Set a supplier lead time to enable reorder timing.</p>}</>}
      </div>; })}
    </section>
    <section className="sec"><div className="sec-lbl"><h2>Improve the data</h2></div>
      <div className="card pad insight-forms"><details><summary>Create comparable product</summary><form onSubmit={formAction(async f => createProduct(accountId, { name: String(f.get('name')).trim(), category: String(f.get('category') || '').trim(), grade: String(f.get('grade') || '').trim(), base_unit: String(f.get('base_unit')) as Product['base_unit'], safety_days: number(f, 'safety_days'), singstat_series_no: f.get('singstat_series_no') ? number(f, 'singstat_series_no') : null }))}>
        <label>Product name<input name="name" required minLength={2} placeholder="Tomatoes" /></label><label>Category<input name="category" placeholder="Produce" /></label><label>Grade or specification<input name="grade" placeholder="Roma, grade A" /></label><label>Comparison unit<select name="base_unit"><option value="kg">kg</option><option value="l">litre</option><option value="each">each</option></select></label><label>Safety stock days<input name="safety_days" type="number" min="0" max="30" defaultValue="2" required /></label><button className="btn" disabled={busy}>Create product</button>
      </form></details>
      <details><summary>Match supplier item & pack size</summary><form onSubmit={formAction(async f => updateItemPack(accountId, String(f.get('item_id')), String(f.get('product_id')), number(f, 'base_quantity')))}><p className="muted">Choose only products with the same grade and specification. Enter how many base units one supplier pack contains.</p><label>Supplier item<select name="item_id" required>{itemOptions}</select></label><label>Comparable product<select name="product_id" required>{productOptions}</select></label><label>Base units per supplier pack<input name="base_quantity" type="number" min="0.0001" step="0.0001" required placeholder="e.g. 5 kg per carton" /></label><button className="btn" disabled={busy || !ledger.items.length || !ledger.products.length}>Save match</button></form></details>
      <details><summary>Record a supplier quote</summary><form onSubmit={formAction(async f => addQuote(accountId, String(f.get('item_id')), String(f.get('quoted_on')), number(f, 'price_per_pack'), String(f.get('valid_until') || '') || null))}><label>Supplier item<select name="item_id" required>{itemOptions}</select></label><label>Quoted date<input name="quoted_on" type="date" defaultValue={sgToday()} required /></label><label>Price per supplier pack (SGD)<input name="price_per_pack" type="number" min="0.01" step="0.01" required /></label><label>Valid until<input name="valid_until" type="date" /></label><button className="btn" disabled={busy || !ledger.items.length}>Save quote</button></form></details>
      <details><summary>Count stock</summary><form onSubmit={formAction(async f => addStockCount(accountId, String(f.get('product_id')), String(f.get('counted_on')), number(f, 'quantity_base')))}><p className="muted">Enter an end-of-day count. Later deliveries and usage will adjust it.</p><label>Product<select name="product_id" required>{productOptions}</select></label><label>Counted on<input name="counted_on" type="date" defaultValue={sgToday()} required /></label><label>Quantity in product unit<input name="quantity_base" type="number" min="0" step="0.001" required /></label><button className="btn" disabled={busy || !ledger.products.length}>Save count</button></form></details>
      <details><summary>Record daily usage or waste</summary><form onSubmit={formAction(async f => addUsage(accountId, String(f.get('product_id')), String(f.get('used_on')), number(f, 'quantity_base'), String(f.get('kind')) as 'used' | 'waste'))}><label>Product<select name="product_id" required>{productOptions}</select></label><label>Date<input name="used_on" type="date" defaultValue={sgToday()} required /></label><label>Type<select name="kind"><option value="used">Used or sold</option><option value="waste">Waste</option></select></label><label>Quantity in product unit<input name="quantity_base" type="number" min="0.001" step="0.001" required /></label><button className="btn" disabled={busy || !ledger.products.length}>Save usage</button></form></details>
      <details><summary>Set supplier lead time</summary><form onSubmit={formAction(async f => updateSupplierLeadTime(accountId, String(f.get('supplier_id')), number(f, 'lead_time_days')))}><label>Supplier<select name="supplier_id" required>{ledger.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Days from order to delivery<input name="lead_time_days" type="number" min="0" max="90" required /></label><button className="btn" disabled={busy || !ledger.suppliers.length}>Save lead time</button></form></details>
      <details><summary>Link an official retail reference</summary><form onSubmit={formAction(async f => { const product = ledger.products.find(p => p.id === f.get('product_id')); const seriesNo = f.get('series_no') ? number(f, 'series_no') : null; const reference = retail.find(r => r.seriesNo === seriesNo); if (product && reference && product.base_unit !== reference.baseUnit) throw new Error('Product and reference units must match.'); await updateProductRetailSeries(accountId, String(f.get('product_id')), seriesNo); })}><p className="muted">Match the same product and unit. This is consumer retail context, never a wholesale verdict.</p><label>Your product<select name="product_id" required>{productOptions}</select></label><label>SingStat series<select name="series_no"><option value="">None</option>{retail.map(r => <option key={r.seriesNo} value={r.seriesNo}>{r.name} · per {r.baseUnit}</option>)}</select></label><button className="btn" disabled={busy || !ledger.products.length || !retail.length}>Save reference</button>{retailError && <p role="status" className="muted">{retailError}</p>}</form></details>
      <details><summary>Add sourced wholesale benchmark</summary><form onSubmit={formAction(async f => addBenchmark(accountId, { product_id: String(f.get('product_id')), market: String(f.get('market')).trim(), source_name: String(f.get('source_name')).trim(), source_url: String(f.get('source_url') || '').trim(), observed_on: String(f.get('observed_on')), price_per_base: number(f, 'price_per_base'), basis: 'wholesale', note: String(f.get('note') || '').trim() }))}><p className="muted">Only enter a genuine, comparable wholesale price for the same product grade, location, and unit. Include a source link when available.</p><label>Product<select name="product_id" required>{productOptions}</select></label><label>Market<input name="market" required minLength={2} defaultValue="Singapore" /></label><label>Source name<input name="source_name" required minLength={2} placeholder="Market bulletin or written supplier offer" /></label><label>Source URL<input name="source_url" type="url" pattern="https://.*" placeholder="https://…" /></label><label>Observed date<input name="observed_on" type="date" defaultValue={sgToday()} required /></label><label>Price per product unit (SGD)<input name="price_per_base" type="number" min="0.001" step="0.001" required /></label><label>Notes<input name="note" placeholder="Grade, minimum quantity, terms" /></label><button className="btn" disabled={busy || !ledger.products.length}>Save benchmark</button></form></details>
      </div>
    </section>
  </>;
}
