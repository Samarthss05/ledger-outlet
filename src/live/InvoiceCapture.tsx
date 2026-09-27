import { useState } from 'react';
import { createDelivery } from './data';
import type { Ledger } from './types';

type DraftLine = { itemId: string | null; chargedQuantity: number | null; deliveredQuantity: number | null; unitPrice: number | null; note: string };
type Draft = { supplierId: string | null; invoiceDate: string | null; invoiceNumber: string | null; lines: DraftLine[]; unmatched: string[] };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fileDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file); });
const digest = async (file: File) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);

export function InvoiceCapture({ accountId, token, ledger, busy, run, refresh }: {
  accountId: string; token: string; ledger: Ledger; busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [localError, setLocalError] = useState('');
  const choose = async (selected?: File) => {
    setFile(null); setImage(''); setDraft(null); setLocalError('');
    if (!selected) return;
    if (!['image/jpeg','image/png','image/webp'].includes(selected.type) || selected.size > 1_500_000) { setLocalError('Choose a JPEG, PNG, or WebP image under 1.5 MB.'); return; }
    try { setImage(await fileDataUrl(selected)); setFile(selected); } catch (error) { setLocalError(error instanceof Error ? error.message : 'Could not read the image.'); }
  };
  const extract = () => { if (!image) return; void run(async () => {
    const response = await fetch('/api/ai', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify({action:'extract_invoice',accountId,imageDataUrl:image}) });
    const result = await response.json() as { invoiceDraft?: Omit<Draft,'lines'> & { lines: Omit<DraftLine,'deliveredQuantity'>[] }; error?: string };
    if (!response.ok || !result.invoiceDraft) throw new Error(result.error || 'Could not extract the invoice.');
    setDraft({ ...result.invoiceDraft, lines:result.invoiceDraft.lines.map(line => ({...line,deliveredQuantity:line.chargedQuantity})) });
  }); };
  const changeLine = (index: number, update: Partial<DraftLine>) => setDraft(previous => previous ? { ...previous, lines:previous.lines.map((line, position) => position === index ? {...line,...update} : line) } : previous);
  const save = () => { if (!draft || !file) return; void run(async () => {
    if (!draft.supplierId || !ledger.suppliers.some(s => s.id === draft.supplierId)) throw new Error('Choose the invoice supplier.');
    if (!draft.invoiceDate || draft.invoiceDate > today() || Number.isNaN(Date.parse(`${draft.invoiceDate}T00:00:00Z`))) throw new Error('Confirm a valid invoice date.');
    if (!draft.lines.length || draft.lines.some(line => !line.itemId || !ledger.items.some(item => item.id === line.itemId && item.supplier_id === draft.supplierId) || line.chargedQuantity == null || line.chargedQuantity <= 0 || line.deliveredQuantity == null || line.deliveredQuantity < 0 || line.unitPrice == null || line.unitPrice < 0)) throw new Error('Review every item, charged quantity, delivered quantity, and unit price.');
    await createDelivery(accountId, { supplier_id:draft.supplierId, delivered_on:draft.invoiceDate, order_channel:'other', note:`Reviewed image invoice${draft.invoiceNumber ? ` ${draft.invoiceNumber}` : ''}`, external_ref:`image:${await digest(file)}`,
      lines:draft.lines.map(line => ({item_id:line.itemId!,quantity_ordered:line.chargedQuantity!,quantity_delivered:line.deliveredQuantity!,quantity_charged:line.chargedQuantity!,unit_price:line.unitPrice!})) });
    await refresh(); setDraft(null); setFile(null); setImage(''); setLocalError('Invoice saved as a reviewed delivery.');
  }); };
  return <div className="card pad invoice-capture"><h3>Read a photo invoice</h3><p className="muted">Your image is sent to OpenRouter only when you choose Extract. The result is a draft. Confirm prices, packs, and delivered quantities before saving.</p>
    <label>Invoice photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const selected = event.target.files?.[0]; event.currentTarget.value = ''; void choose(selected); }} /></label>
    {image && <><img src={image} alt="Selected invoice for review" className="invoice-preview" /><button className="btn ai" onClick={extract} disabled={busy || !ledger.items.length}>✦ Extract draft with AI</button></>}
    {localError && <p role="status" className="muted">{localError}</p>}
    {draft && <div className="invoice-draft"><h4>Review extracted delivery</h4><label>Supplier<select value={draft.supplierId || ''} onChange={event => setDraft({...draft,supplierId:event.target.value || null})}><option value="">Select supplier</option>{ledger.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Invoice date<input type="date" max={today()} value={draft.invoiceDate || ''} onChange={event => setDraft({...draft,invoiceDate:event.target.value})} /></label><label>Invoice number<input value={draft.invoiceNumber || ''} maxLength={100} onChange={event => setDraft({...draft,invoiceNumber:event.target.value})} /></label>
      {draft.unmatched.length > 0 && <p className="muted">Unmatched text: {draft.unmatched.join(' · ')}</p>}
      {draft.lines.map((line, index) => <div className="invoice-line" key={index}><strong>Line {index + 1}</strong>{line.note && <p className="muted">{line.note}</p>}<label>Supplier item<select value={line.itemId || ''} onChange={event => changeLine(index,{itemId:event.target.value || null})}><option value="">Select item</option>{ledger.items.filter(item => !draft.supplierId || item.supplier_id === draft.supplierId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></label><label>Charged packs<input type="number" min="0.001" step="0.001" value={line.chargedQuantity ?? ''} onChange={event => changeLine(index,{chargedQuantity:event.target.value ? Number(event.target.value) : null})} /></label><label>Delivered packs<input type="number" min="0" step="0.001" value={line.deliveredQuantity ?? ''} onChange={event => changeLine(index,{deliveredQuantity:event.target.value ? Number(event.target.value) : null})} /></label><label>Unit price per pack (SGD)<input type="number" min="0" step="0.01" value={line.unitPrice ?? ''} onChange={event => changeLine(index,{unitPrice:event.target.value ? Number(event.target.value) : null})} /></label><button className="mini-action" onClick={() => setDraft({...draft,lines:draft.lines.filter((_,position) => position !== index)})}>Remove line</button></div>)}
      <button className="btn sec" onClick={() => setDraft({...draft,lines:[...draft.lines,{itemId:null,chargedQuantity:null,deliveredQuantity:null,unitPrice:null,note:''}]})} disabled={draft.lines.length >= 30}>+ Add line</button><button className="btn" onClick={save} disabled={busy}>Save reviewed delivery</button>
    </div>}
  </div>;
}
