import { useMemo, useState } from 'react';
import { createDelivery, existingDeliveryRefs, importCounts, importQuotes, importUsage } from './data';
import { csvObjects } from './csv';
import type { Ledger } from './types';

type Kind = 'deliveries' | 'usage' | 'counts' | 'quotes';
type ValidRow = { supplier_id?: string; item_id?: string; product_id?: string; date: string; quantity?: number; kind?: 'used' | 'waste'; price?: number; valid_until?: string | null; ordered?: number; delivered?: number; charged?: number; invoice_ref?: string };
const templates: Record<Kind, string> = {
  deliveries: 'supplier,item,date,quantity_ordered,quantity_delivered,quantity_charged,unit_price,invoice_ref',
  usage: 'product,date,quantity,kind',
  counts: 'product,date,quantity',
  quotes: 'supplier,item,date,price_per_pack,valid_until'
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const norm = (value: string) => value.trim().toLocaleLowerCase('en-SG');
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const sha = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);

function validate(kind: Kind, text: string, ledger: Ledger): { rows: ValidRow[]; errors: string[] } {
  const source = csvObjects(text);
  const required = templates[kind].split(',').filter(column => !['invoice_ref', 'valid_until', 'kind'].includes(column));
  const missing = required.filter(column => !(column in source[0]));
  if (missing.length) throw new Error(`Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`);
  const errors: string[] = [], rows: ValidRow[] = [];
  for (let index = 0; index < source.length; index++) {
    const raw = source[index]; const line = index + 2;
    if (!validDate(raw.date || '') || (kind !== 'quotes' && raw.date > today())) { errors.push(`Row ${line}: enter a valid date not later than today.`); continue; }
    const row: ValidRow = { date: raw.date };
    if (kind === 'usage' || kind === 'counts') {
      const matches = ledger.products.filter(p => norm(p.name) === norm(raw.product || ''));
      if (matches.length !== 1) { errors.push(`Row ${line}: product must match one catalog product exactly.`); continue; }
      row.product_id = matches[0].id; row.quantity = Number(raw.quantity);
      if (!raw.quantity?.trim() || !Number.isFinite(row.quantity) || (kind === 'usage' ? row.quantity <= 0 : row.quantity < 0)) { errors.push(`Row ${line}: invalid quantity.`); continue; }
      if (kind === 'usage') { row.kind = raw.kind === 'waste' ? 'waste' : raw.kind === 'used' || !raw.kind ? 'used' : undefined; if (!row.kind) { errors.push(`Row ${line}: kind must be used or waste.`); continue; } }
    } else {
      const suppliers = ledger.suppliers.filter(s => norm(s.name) === norm(raw.supplier || '') || norm(s.short_name) === norm(raw.supplier || ''));
      if (suppliers.length !== 1) { errors.push(`Row ${line}: supplier must match one supplier exactly.`); continue; }
      row.supplier_id = suppliers[0].id;
      const items = ledger.items.filter(i => i.supplier_id === row.supplier_id && norm(i.name) === norm(raw.item || ''));
      if (items.length !== 1) { errors.push(`Row ${line}: item must match one item from that supplier exactly.`); continue; }
      row.item_id = items[0].id;
      if (kind === 'quotes') {
        row.price = Number(raw.price_per_pack); row.valid_until = raw.valid_until || null;
        if (!Number.isFinite(row.price) || row.price <= 0 || (row.valid_until && (!validDate(row.valid_until) || row.valid_until < row.date))) { errors.push(`Row ${line}: invalid quote price or expiry.`); continue; }
      } else {
        row.ordered = Number(raw.quantity_ordered); row.delivered = Number(raw.quantity_delivered); row.charged = Number(raw.quantity_charged); row.price = Number(raw.unit_price); row.invoice_ref = (raw.invoice_ref || '').slice(0, 100);
        if (['quantity_ordered','quantity_delivered','quantity_charged','unit_price'].some(key => !raw[key]?.trim()) || [row.ordered,row.delivered,row.charged,row.price].some(value => !Number.isFinite(value) || value! < 0)) { errors.push(`Row ${line}: invalid delivery quantity or price.`); continue; }
      }
    }
    rows.push(row);
  }
  if (kind === 'counts') {
    const seen = new Set<string>();
    for (const row of rows) { const key = `${row.product_id}:${row.date}`; if (seen.has(key)) errors.push('A product has two stock counts on the same date. Keep one end-of-day count per product.'); seen.add(key); }
  }
  if (kind === 'deliveries') {
    const groups = new Map<string, number>();
    for (const row of rows) { const key = `${row.supplier_id}:${row.date}:${row.invoice_ref || ''}`; groups.set(key, (groups.get(key) || 0) + 1); }
    if ([...groups.values()].some(count => count > 100)) errors.push('A delivery has more than 100 item lines. Split that invoice into smaller files.');
  }
  return { rows, errors };
}

export function CsvImporter({ accountId, ledger, busy, run, refresh }: { accountId: string; ledger: Ledger; busy: boolean; run: (action: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [kind, setKind] = useState<Kind>('deliveries');
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [progress, setProgress] = useState('');
  const reviewed = useMemo(() => { if (!text) return null; try { return validate(kind, text, ledger); } catch (error) { return { rows: [], errors: [error instanceof Error ? error.message : 'Invalid CSV.'] }; } }, [kind, text, ledger]);
  const selectFile = async (file?: File) => {
    setProgress(''); setText(''); setFileName(''); if (!file) return;
    if (file.size > 1_000_000) { setProgress('Choose a CSV smaller than 1 MB.'); return; }
    setFileName(file.name); setText(await file.text());
  };
  const importFile = () => { if (!reviewed?.rows.length || reviewed.errors.length) return; void run(async () => {
    const digest = await sha(text); const rows = reviewed.rows;
    if (kind === 'usage') await importUsage(accountId, rows.map((row, index) => ({ product_id: row.product_id!, used_on: row.date, quantity_base: row.quantity!, kind: row.kind!, external_ref: `csv:${digest}:${index + 2}` })));
    else if (kind === 'counts') await importCounts(accountId, rows.map(row => ({ product_id: row.product_id!, counted_on: row.date, quantity_base: row.quantity! })));
    else if (kind === 'quotes') await importQuotes(accountId, rows.map((row, index) => ({ item_id: row.item_id!, quoted_on: row.date, price_per_pack: row.price!, valid_until: row.valid_until || null, external_ref: `csv:${digest}:${index + 2}` })));
    else {
      const groups = new Map<string, ValidRow[]>();
      for (const row of rows) { const key = `${row.supplier_id}:${row.date}:${row.invoice_ref || ''}`; groups.set(key, [...(groups.get(key) || []), row]); }
      const existing = await existingDeliveryRefs(accountId, digest); let done = 0;
      for (const [index, group] of [...groups.values()].entries()) {
        const externalRef = `csv:${digest}:${index + 1}`;
        if (!existing.has(externalRef)) await createDelivery(accountId, { supplier_id: group[0].supplier_id!, delivered_on: group[0].date, order_channel: 'other', note: group[0].invoice_ref ? `CSV invoice ${group[0].invoice_ref}` : 'CSV import', external_ref: externalRef, lines: group.map(row => ({ item_id: row.item_id!, quantity_ordered: row.ordered!, quantity_delivered: row.delivered!, quantity_charged: row.charged!, unit_price: row.price! })) });
        done++; setProgress(`Processed ${done} of ${groups.size} delivery groups…`);
      }
    }
    await refresh(); setProgress(`Imported ${rows.length} rows. Re-uploading the same file is safe.`); setText(''); setFileName('');
  }); };
  return <div className="card pad csv-import"><h3>Import existing records</h3><p className="muted">CSV rows are checked against your catalog before saving. Re-uploading the same file will not double-count usage, quotes, or deliveries.</p>
    <label>Record type<select value={kind} onChange={event => { setKind(event.target.value as Kind); setText(''); setFileName(''); setProgress(''); }}><option value="deliveries">Supplier deliveries / invoices</option><option value="usage">Daily sales or usage</option><option value="counts">End-of-day stock counts</option><option value="quotes">Supplier quotes</option></select></label>
    <p className="muted">Required CSV headers:</p><code className="csv-template">{templates[kind]}</code>
    <label>Choose CSV<input type="file" accept=".csv,text/csv" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void selectFile(file); }} /></label>
    {fileName && <p className="muted">{fileName} · {reviewed?.rows.length || 0} valid rows</p>}
    {reviewed && reviewed.errors.length > 0 && <div className="notice" role="alert"><div>{reviewed.errors.slice(0, 8).map((error, index) => <p key={index}>{error}</p>)}{reviewed.errors.length > 8 && <p>…and {reviewed.errors.length - 8} more errors.</p>}</div></div>}
    {reviewed && !reviewed.errors.length && <><div className="csv-preview"><strong>Preview</strong>{reviewed.rows.slice(0, 5).map((row, index) => <p key={index}>{row.date} · {row.supplier_id ? ledger.suppliers.find(s => s.id === row.supplier_id)?.name : ledger.products.find(p => p.id === row.product_id)?.name} · {row.quantity ?? row.delivered ?? row.price}</p>)}{reviewed.rows.length > 5 && <small>+ {reviewed.rows.length - 5} more rows</small>}</div><button className="btn" disabled={busy} onClick={importFile}>Confirm import of {reviewed.rows.length} rows</button></>}
    {progress && <p role="status" className="muted">{progress}</p>}
  </div>;
}
