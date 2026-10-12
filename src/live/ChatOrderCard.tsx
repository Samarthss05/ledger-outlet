import { useEffect, useState, type FormEvent } from 'react';
import type { Ledger } from './types';
import type { ChatOrderLine, ChatOrderView } from './chatOrders';

type Action = 'revise'|'confirm'|'cancel'|'supplier_reply'|'review_reply'|'receive';
type Props = {order:ChatOrderView;ledger:Ledger|null;busy:boolean;onAction:(action:Action,payload:Record<string,unknown>,userText?:string)=>Promise<boolean>};

export function ChatOrderCard({order,ledger,busy,onAction}:Props) {
  const [editing,setEditing]=useState(false);
  const [lines,setLines]=useState<ChatOrderLine[]>(order.lines);
  const [deliveryDate,setDeliveryDate]=useState(order.requested_delivery_on || '');
  const [deliveryNote,setDeliveryNote]=useState(order.delivery_note);
  const [replyText,setReplyText]=useState<Record<string,string>>({});
  const [replyStatus,setReplyStatus]=useState<Record<string,string>>({});
  useEffect(()=>{setLines(order.lines);setDeliveryDate(order.requested_delivery_on || '');setDeliveryNote(order.delivery_note);setEditing(false);},[order.id,order.version]);
  const itemOptions=(ledger?.items || []).filter(item=>item.active);
  const revise=(event:FormEvent)=>{event.preventDefault();void onAction('revise',{lines:lines.map(line=>({...line,itemId:line.itemId || null,quantity:line.quantity || null,rawUnit:line.rawUnit || null})),requestedDeliveryOn:deliveryDate || null,deliveryNote});};
  const status=order.status.replaceAll('_',' ');
  return <article className="chat-order-card" aria-label="Chat order review">
    <header className="chat-order-head"><div><span className="chat-order-kicker">ORDER REVIEW · CHAT PILOT</span><h4>{order.source_kind==='usual'?'Stock-based order':order.source_kind==='repeat'?'Repeat last order':'Supplier split'}</h4></div><span className={`chat-order-status ${order.status}`}>{status}</span></header>
    <p className="chat-order-disclaimer">Supplier messages stay inside this app for now. Confirming here does not send WhatsApp or place an external order.</p>
    {order.status==='awaiting_review' && editing ? <form onSubmit={revise} className="chat-order-edit">
      <label>Delivery date<input type="date" value={deliveryDate} onChange={event=>setDeliveryDate(event.target.value)} required /></label>
      <label>Delivery window or note<input value={deliveryNote} maxLength={160} onChange={event=>setDeliveryNote(event.target.value)} placeholder="Before 9am" /></label>
      <div className="chat-order-line-list">{lines.map((line,index)=>{
        const selected=itemOptions.find(item=>item.id===line.itemId);
        return <div className="chat-order-edit-line" key={index}><small>Message said: {line.rawText}</small><label>Exact item<select value={line.itemId || ''} onChange={event=>setLines(previous=>previous.map((row,i)=>i===index?{...row,itemId:event.target.value || null}:row))} required><option value="">Choose from this outlet</option>{itemOptions.map(item=><option key={item.id} value={item.id}>{item.name} · {ledger?.suppliers.find(supplier=>supplier.id===item.supplier_id)?.name} · {item.unit}</option>)}</select></label><label>Quantity<input type="number" min="0.001" max="10000" step="0.001" value={line.quantity ?? ''} onChange={event=>setLines(previous=>previous.map((row,i)=>i===index?{...row,quantity:event.target.value?Number(event.target.value):null}:row))} required /></label><span>Pack unit: {selected?.unit || 'Select an item'}</span>{lines.length>1 && <button type="button" onClick={()=>setLines(previous=>previous.filter((_,i)=>i!==index))}>Remove line</button>}</div>;
      })}</div>
      <button type="button" className="chat-order-link" onClick={()=>setLines(previous=>[...previous,{itemId:null,quantity:null,rawUnit:null,rawText:'Added in review',ambiguous:true}])}>＋ Add item</button>
      <div className="chat-order-controls"><button type="button" onClick={()=>setEditing(false)} disabled={busy}>Back</button><button type="submit" className="primary" disabled={busy}>Save new version</button></div>
    </form> : <>
      <div className="chat-order-date">{order.preview.requestedDeliveryOn ? `Delivery: ${order.preview.requestedDeliveryOn}${order.preview.deliveryNote?' · '+order.preview.deliveryNote:''}` : 'Choose a delivery date before confirming'}</div>
      {order.preview.groups.map(group=><section className="chat-order-group" key={group.supplierId}><strong>{group.supplierName}</strong><ul>{group.lines.map((line,index)=><li key={`${line.itemId}-${index}`}><span>{line.itemName}</span><b>×{line.quantity} {line.unit}</b></li>)}</ul></section>)}
      {order.preview.issues.length>0 && order.status==='awaiting_review' && <div className="chat-order-issues"><strong>Needs your attention</strong><ul>{order.preview.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul></div>}
      {order.status==='awaiting_review' && <div className="chat-order-controls"><button type="button" disabled={busy} onClick={()=>void onAction('cancel',{})}>Cancel draft</button><button type="button" disabled={busy} onClick={()=>setEditing(true)}>Edit details</button><button type="button" className="primary" disabled={busy || !order.preview.ready} onClick={()=>void onAction('confirm',{})}>Confirm order</button></div>}
    </>}
    {order.status==='confirmed' && <div className="chat-order-suppliers"><h5>Supplier conversation simulator</h5><p>These messages are prepared from your confirmed order. Paste a supplier reply to test how the agent would read it.</p>
      {order.supplierMessages.map(message=>{
        const update=order.supplier_updates[message.supplierId];
        return <div className="chat-order-supplier-thread" key={message.supplierId}><strong>{message.supplierName}</strong><pre>{message.text}</pre>{update && <div className="chat-order-reply"><small>Simulated supplier reply</small><p>{update.text}</p><small>Agent suggested: {update.suggestedStatus} · {update.note}</small>{update.status==='needs_review' ? <div className="chat-order-reply-review"><select aria-label={`Status for ${message.supplierName}`} value={replyStatus[message.supplierId] || ''} onChange={event=>setReplyStatus(previous=>({...previous,[message.supplierId]:event.target.value}))}><option value="">Choose the correct status</option><option value="accepted">Accepted</option><option value="partial">Partly available or changed</option><option value="rejected">Rejected</option></select><button type="button" disabled={busy || !replyStatus[message.supplierId]} onClick={()=>void onAction('review_reply',{supplierId:message.supplierId,replyStatus:replyStatus[message.supplierId]})}>Confirm interpretation</button></div> : <b>{update.status}</b>}</div>}
          <form onSubmit={event=>{event.preventDefault();const text=replyText[message.supplierId]?.trim();if(text) void onAction('supplier_reply',{supplierId:message.supplierId,text},`Supplier simulator · ${message.supplierName}: ${text}`).then(saved=>{if(saved)setReplyText(previous=>({...previous,[message.supplierId]:''}));});}}><input aria-label={`Paste a reply from ${message.supplierName}`} value={replyText[message.supplierId] || ''} onChange={event=>setReplyText(previous=>({...previous,[message.supplierId]:event.target.value}))} placeholder="Paste supplier reply, e.g. eggs out of stock" maxLength={1000} /><button type="submit" disabled={busy || !replyText[message.supplierId]?.trim()}>Review reply</button></form>
        </div>;
      })}
      <div className="chat-order-controls"><button type="button" disabled={busy} onClick={()=>void onAction('cancel',{})}>Request cancellation</button><button type="button" className="primary" disabled={busy} onClick={()=>void onAction('receive',{})}>Mark arrived</button></div>
    </div>}
    {order.status==='received' && <p className="chat-order-footnote">Record actual quantities and prices in Delivery records to update spend, claims and stock.</p>}
    {order.status==='cancel_requested' && <p className="chat-order-footnote">This is only a request. No supplier was contacted through this simulator.</p>}
  </article>;
}
