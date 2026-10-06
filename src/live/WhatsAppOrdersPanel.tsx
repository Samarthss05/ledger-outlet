import { useEffect, useState, type FormEvent } from 'react';
import type { Ledger, Supplier } from './types';
import { loadWhatsAppState, previewWhatsAppOrder, refreshWhatsAppLinkCode, saveSupplierWhatsApp, saveWhatsAppSettings,
  type WhatsAppPreview, type WhatsAppState } from './whatsappData';

const days = [{n:1,label:'Mon'},{n:2,label:'Tue'},{n:3,label:'Wed'},{n:4,label:'Thu'},
  {n:5,label:'Fri'},{n:6,label:'Sat'},{n:0,label:'Sun'}];
const date = (value:string) => new Date(value).toLocaleDateString('en-SG',{day:'numeric',month:'short',year:'numeric'});
const orderStatus:Record<string,string> = {
  needs_review:'Needs correction',awaiting_confirmation:'Waiting for your OK',sending:'Sending',
  sent:'Sent to suppliers',partial:'Check sending',cancelled:'Cancelled',expired:'Expired'
};
const supplierStatus:Record<string,string> = {
  draft:'Draft',sending:'Sending status unknown',sent:'Sent',confirmed:'Confirmed',
  issue:'Supplier issue',delivered_reported:'Supplier reports delivered',delivered:'Received by owner',failed:'Message failed'
};
const plannedNumber = '+65 9610 9538';
const initial:WhatsAppState = {settings:null,orders:[]};

export function WhatsAppOrdersPanel({accountId,accountName,token,ledger,onLedgerChange,onManageCatalog}:{
  accountId:string;accountName:string;token:string;ledger:Ledger;
  onLedgerChange:()=>Promise<void>;onManageCatalog:()=>void;
}) {
  const [state,setState] = useState<WhatsAppState>(initial);
  const [connected,setConnected] = useState(false);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const [sample,setSample] = useState('');
  const [preview,setPreview] = useState<WhatsAppPreview|null>(null);
  const [editingSupplier,setEditingSupplier] = useState<string|null>(null);
  const [channelMode,setChannelMode] = useState<'shared'|'dedicated'>('shared');
  async function refresh() { setState(await loadWhatsAppState(accountId)); }
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setPreview(null); setState(initial);
    Promise.all([loadWhatsAppState(accountId),fetch('/api/whatsapp-status').then(r => r.ok?r.json():{configured:false})])
      .then(([next,status]) => { if (active) {setState(next);setChannelMode(next.settings?.channel_mode||'shared');setConnected(Boolean(status.configured));} })
      .catch(err => {if (active) setError(err instanceof Error?err.message:'Could not load WhatsApp orders.');})
      .finally(() => {if (active) setLoading(false);});
    const interval = setInterval(() => {if (active) loadWhatsAppState(accountId).then(setState).catch(() => {});},30000);
    return () => {active=false;clearInterval(interval);};
  },[accountId]);
  const run = async (action:()=>Promise<void>,message:string) => {
    setBusy(true);setError('');setSuccess('');
    try {await action();await refresh();setSuccess(message);}
    catch (err) {setError(err instanceof Error?err.message:'Could not save changes.');}
    finally {setBusy(false);}
  };
  async function saveOutlet(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mode = String(form.get('channel_mode')) as 'shared'|'dedicated';
    await run(() => saveWhatsAppSettings(accountId,{
      owner_phone_e164:String(form.get('owner_phone_e164')).trim(),
      outlet_address:String(form.get('outlet_address')).trim(),
      channel_mode:mode,
      dedicated_phone_number_id:mode==='dedicated'?String(form.get('dedicated_phone_number_id')).trim()||null:null
    },state.settings),'Outlet WhatsApp setup saved.');
  }
  async function saveSupplier(event:FormEvent<HTMLFormElement>,supplier:Supplier) {
    event.preventDefault();const form = new FormData(event.currentTarget);
    const selected = days.filter(day => form.getAll('delivery_day').includes(String(day.n))).map(day => day.n);
    await run(async () => {
      await saveSupplierWhatsApp(accountId,supplier.id,{
        whatsapp_e164:String(form.get('whatsapp_e164')).trim()||null,
        cutoff_time:String(form.get('cutoff_time'))||null,
        delivery_days:selected,
        lead_time_days:form.get('lead_time_days')?Number(form.get('lead_time_days')):null
      });
      await onLedgerChange();
      setEditingSupplier(null);
    },`${supplier.name} order details saved.`);
  }
  async function runPreview(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');setPreview(null);
    try {setPreview(await previewWhatsAppOrder(accountId,token,sample));}
    catch (err) {setError(err instanceof Error?err.message:'Could not preview this order.');}
    finally {setBusy(false);}
  }
  const readySuppliers = ledger.suppliers.filter(supplier => supplier.whatsapp_e164 && supplier.delivery_days?.length && supplier.cutoff_time).length;
  const mappedItems = ledger.items.filter(item => item.active && item.supplier_id && item.unit).length;
  return <div className="wa-workspace">
    <header className="wa-heading"><div><p className="eyebrow">WHATSAPP ORDER DESK · {accountName.toUpperCase()}</p><h2>Orders start in a message</h2><p>Send one message. Ledger checks each line, splits it by supplier, and asks for approval before sending.</p></div>
      <span className={connected?'wa-connection live':'wa-connection'}>{connected?'Cloud API configured':'Awaiting Meta connection'}</span></header>
    <div className="wa-intro"><div><span className="wa-intro-kicker">PLANNED SHARED LINE</span><strong>{plannedNumber}</strong><p>This number is not active in Ledger until Meta onboarding and the approved message templates are complete.</p></div>
      <div className="wa-intro-flow"><span>1 · Message</span><span>2 · Review</span><span>3 · Confirm</span><span>4 · Track</span></div></div>
    {error && <p className="wa-feedback error" role="alert">{error}</p>}
    {success && <p className="wa-feedback" role="status">{success}</p>}
    {loading ? <p className="wa-loading">Loading order desk…</p> : <>
      <section className="wa-setup"><div className="wa-section-title"><div><h3>Outlet setup</h3><p>Set this up once before taking WhatsApp orders.</p></div></div>
        <div className="wa-checklist"><div><b>{state.settings?.verified_at?'✓':'—'}</b><span>Owner verified</span></div><div><b>{readySuppliers}/{ledger.suppliers.length}</b><span>Suppliers ready</span></div>
          <div><b>{mappedItems}</b><span>Items mapped</span></div><div><b>{connected?'✓':'—'}</b><span>Meta connected</span></div></div>
        <div className="wa-setup-grid"><form className="wa-card" onSubmit={saveOutlet} key={state.settings?.owner_phone_e164 || 'new'}>
          <h4>Outlet & owner</h4><p>Only a verified owner number can request or confirm an order.</p>
          <label>Owner WhatsApp number<input name="owner_phone_e164" type="tel" required placeholder="+6591234567" defaultValue={state.settings?.owner_phone_e164||''}/></label>
          <label>Address shown to suppliers<input name="outlet_address" maxLength={240} placeholder="Tampines Blk 201" defaultValue={state.settings?.outlet_address||''}/></label>
          <label>Ledger sending number<select name="channel_mode" value={channelMode} onChange={event => setChannelMode(event.target.value as 'shared'|'dedicated')}>
            <option value="shared">Shared Ledger number</option><option value="dedicated">Dedicated shop number (+S$15/month after activation)</option></select></label>
          {channelMode==='dedicated' && <label className="wa-advanced">Dedicated Meta phone number ID<input name="dedicated_phone_number_id" required placeholder="Only after Meta provisioning" defaultValue={state.settings?.dedicated_phone_number_id||''}/></label>}
          <button className="wa-primary" disabled={busy}>Save setup</button>
          {state.settings && <div className="wa-link"><strong>{state.settings.verified_at?'Owner number verified':'Verify the owner number'}</strong>
            {state.settings.verified_at ? <p>Linked on {date(state.settings.verified_at)}.</p> :
              <><p>Once the shared line is connected, send this from {state.settings.owner_phone_e164} to {plannedNumber}:</p><code>LINK {state.settings.link_code}</code>
                <small>Code expires {date(state.settings.link_code_expires_at)}.</small>
                <button type="button" disabled={busy} onClick={() => void run(() => refreshWhatsAppLinkCode(accountId),'New link code generated.')}>Generate new code</button></>}</div>}
        </form>
        <div className="wa-card"><div className="wa-card-header"><div><h4>Suppliers</h4><p>Add a WhatsApp number, delivery days and cut-off for each.</p></div></div>
          {!ledger.suppliers.length && <p className="wa-empty">No suppliers yet. Add one in the catalog.</p>}
          {ledger.suppliers.map(supplier => <div className="wa-supplier" key={supplier.id}>
            <button type="button" className="wa-supplier-head" onClick={() => setEditingSupplier(editingSupplier===supplier.id?null:supplier.id)}>
              <span><strong>{supplier.name}</strong><small>{supplier.whatsapp_e164||'Number needed'} · {supplier.cutoff_time?'Cut-off '+supplier.cutoff_time.slice(0,5):'Cut-off needed'}</small></span>
              <span className={supplier.whatsapp_e164&&supplier.delivery_days?.length&&supplier.cutoff_time?'wa-ready':''}>
                {supplier.whatsapp_e164&&supplier.delivery_days?.length&&supplier.cutoff_time?'Ready':'Set up'} →</span></button>
            {editingSupplier===supplier.id && <form className="wa-supplier-form" onSubmit={event => void saveSupplier(event,supplier)}>
              <label>Supplier WhatsApp number<input name="whatsapp_e164" type="tel" placeholder="+6591234567" defaultValue={supplier.whatsapp_e164||''}/></label>
              <label>Order cut-off (Singapore time)<input name="cutoff_time" type="time" defaultValue={supplier.cutoff_time?.slice(0,5)||''}/></label>
              <label>Lead time (days)<input name="lead_time_days" type="number" min="0" max="90" defaultValue={supplier.lead_time_days??''}/></label>
              <fieldset><legend>Delivery days</legend><div className="wa-days">{days.map(day => <label key={day.n}><input name="delivery_day" type="checkbox" value={day.n} defaultChecked={supplier.delivery_days?.includes(day.n)}/>{day.label}</label>)}</div></fieldset>
              <button className="wa-primary" disabled={busy}>Save supplier</button></form>}</div>)}
          <button className="wa-text-link" type="button" onClick={onManageCatalog}>Manage suppliers and mapped items →</button>
        </div></div>
      </section>
      <section className="wa-preview-section"><div className="wa-section-title"><div><h3>Test a message</h3><p>Check the AI match and supplier split. This preview does not create or send an order.</p></div></div>
        <form onSubmit={runPreview} className="wa-card wa-preview-form"><textarea value={sample} onChange={event => setSample(event.target.value)}
          minLength={3} maxLength={2000} required placeholder="tmr need rice 2 bag, oil 3 tin, egg 5 tray" />
          <button className="wa-primary" disabled={busy||!sample.trim()}>{busy?'Checking…':'Preview supplier split'}</button></form>
        {preview && <div className="wa-preview-result"><div className="wa-preview-top"><strong>{preview.ready?'Ready for owner confirmation':'Needs correction'}</strong>
          <span>{preview.requestedDeliveryOn?date(preview.requestedDeliveryOn):'Delivery date unclear'}{preview.deliveryNote?' · '+preview.deliveryNote:''}</span></div>
          {preview.groups.map(group => <div className="wa-preview-group" key={group.supplierId}><b>{group.supplierName}</b><ul>{group.lines.map((line,index) =>
            <li key={line.itemId+index}>{line.itemName} <span>×{line.quantity} {line.unit}</span></li>)}</ul></div>)}
          {!!preview.issues.length && <div className="wa-issues"><strong>Resolve before sending</strong><ul>{preview.issues.map((issue,index) => <li key={index}>{issue}</li>)}</ul></div>}
        </div>}
      </section>
      <section className="wa-activity"><div className="wa-section-title"><div><h3>Order activity</h3><p>WhatsApp requests and supplier replies appear here. Reply RECEIVED with an LO- order reference to confirm arrival.</p></div><button type="button" onClick={() => void refresh()}>Refresh</button></div>
        {!state.orders.length && <div className="wa-card wa-empty">No WhatsApp orders yet. Once the line is connected, the first owner message will appear here.</div>}
        {state.orders.map(order => <article className="wa-order" key={order.id}><div className="wa-order-head"><div><strong>{order.requested_delivery_on?date(order.requested_delivery_on):'Delivery date needs review'}</strong>
          <small>{date(order.created_at)} · {order.raw_text}</small></div><span className={'wa-status '+order.status}>{orderStatus[order.status]||order.status}</span></div>
          {!!order.issues.length && <ul className="wa-order-issues">{order.issues.map((issue,index) => <li key={index}>{issue}</li>)}</ul>}
          {order.supplierOrders.map(supplierOrder => <div className="wa-order-supplier" key={supplierOrder.id}>
            <div><b>{ledger.suppliers.find(supplier => supplier.id===supplierOrder.supplier_id)?.name||'Supplier'}</b><small>{supplierOrder.reference} · {supplierStatus[supplierOrder.status]||supplierOrder.status}</small></div>
            <p>{supplierOrder.lines.map(line => `${line.item_name} ×${line.quantity} ${line.pack_unit}`).join(', ')}</p>
            {supplierOrder.last_reply_text && <blockquote>Supplier: {supplierOrder.last_reply_text}</blockquote>}
            {supplierOrder.owner_alert_status==='failed' && <p className="wa-alert-failed">Owner WhatsApp alert failed. Check this reply here before acting.</p>}</div>)}
        </article>)}
      </section>
    </>}
  </div>;
}
