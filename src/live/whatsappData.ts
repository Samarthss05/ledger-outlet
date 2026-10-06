import { needClient } from './supabase';

export type WhatsAppSettings = {
  account_id:string; owner_phone_e164:string; outlet_address:string; channel_mode:'shared'|'dedicated';
  dedicated_phone_number_id:string|null; link_code:string; link_code_expires_at:string; verified_at:string|null;
};
export type WhatsAppOrderLine = { id:string; supplier_order_id:string; item_name:string; quantity:number; pack_unit:string; raw_text:string };
export type WhatsAppSupplierOrder = { id:string; order_id:string; supplier_id:string; reference:string; status:string;
  message_text:string; message_delivery_status:string|null; sent_at:string|null; last_reply_text:string|null;
  owner_alert_status:string|null; owner_alert_error:string|null; lines:WhatsAppOrderLine[] };
export type WhatsAppOrder = { id:string; raw_text:string; requested_delivery_on:string|null; delivery_note:string; status:string;
  confirmation_code:string; issues:string[]; created_at:string; supplierOrders:WhatsAppSupplierOrder[] };
export type WhatsAppState = { settings:WhatsAppSettings|null; orders:WhatsAppOrder[] };
export type WhatsAppPreview = { requestedDeliveryOn:string|null; deliveryNote:string; groups:{
  supplierId:string; supplierName:string; supplierPhone:string|null;
  lines:{itemId:string;itemName:string;supplierId:string;quantity:number;unit:string;rawText:string}[]
}[]; issues:string[]; ready:boolean };
const fail = (error:{message:string}|null) => { if (error) throw new Error(error.message); };
const linkCode = () => [...crypto.getRandomValues(new Uint8Array(4))].map(value => value.toString(16).padStart(2,'0')).join('').toUpperCase();
export const validPhone = (phone:string) => /^\+[1-9]\d{7,14}$/.test(phone);

export async function loadWhatsAppState(accountId:string):Promise<WhatsAppState> {
  const db = needClient();
  const [settingsR,ordersR] = await Promise.all([
    db.from('ledger_wa_settings').select('*').eq('account_id',accountId).maybeSingle(),
    db.from('ledger_wa_orders').select('id,raw_text,requested_delivery_on,delivery_note,status,confirmation_code,issues,created_at')
      .eq('account_id',accountId).order('created_at',{ascending:false}).limit(40)
  ]);
  fail(settingsR.error); fail(ordersR.error);
  const orders = (ordersR.data || []) as Omit<WhatsAppOrder,'supplierOrders'>[];
  if (!orders.length) return {settings:settingsR.data as WhatsAppSettings|null,orders:[]};
  const ids = orders.map(order => order.id);
  const supplierR = await db.from('ledger_wa_supplier_orders').select('id,order_id,supplier_id,reference,status,message_text,message_delivery_status,sent_at,last_reply_text,owner_alert_status,owner_alert_error')
    .eq('account_id',accountId).in('order_id',ids).order('reference');
  fail(supplierR.error);
  const supplierOrders = (supplierR.data || []) as Omit<WhatsAppSupplierOrder,'lines'>[];
  const linesR = supplierOrders.length ? await db.from('ledger_wa_order_lines').select('id,supplier_order_id,item_name,quantity,pack_unit,raw_text')
    .eq('account_id',accountId).in('supplier_order_id',supplierOrders.map(order => order.id)).limit(500) : {data:[],error:null};
  fail(linesR.error);
  const lines = (linesR.data || []) as WhatsAppOrderLine[];
  return {settings:settingsR.data as WhatsAppSettings|null,orders:orders.map(order => ({
    ...order,supplierOrders:supplierOrders.filter(supplier => supplier.order_id === order.id).map(supplier => ({
      ...supplier,lines:lines.filter(line => line.supplier_order_id === supplier.id)
    }))
  }))};
}

export async function saveWhatsAppSettings(accountId:string,value:{
  owner_phone_e164:string;outlet_address:string;channel_mode:'shared'|'dedicated';dedicated_phone_number_id:string|null
},previous:WhatsAppSettings|null) {
  if (!validPhone(value.owner_phone_e164)) throw new Error('Use an international number such as +6591234567.');
  const changed = !previous || previous.owner_phone_e164 !== value.owner_phone_e164 ||
    previous.channel_mode !== value.channel_mode || previous.dedicated_phone_number_id !== value.dedicated_phone_number_id;
  const payload = {...value,
    link_code:changed ? linkCode() : previous.link_code,
    link_code_expires_at:changed ? new Date(Date.now()+24*3600000).toISOString() : previous.link_code_expires_at};
  if (previous) {
    const {error} = await needClient().from('ledger_wa_settings').update(payload).eq('account_id',accountId); fail(error);
  } else {
    const {error} = await needClient().from('ledger_wa_settings').insert({account_id:accountId,...payload}); fail(error);
  }
}
export async function refreshWhatsAppLinkCode(accountId:string) {
  const {error} = await needClient().from('ledger_wa_settings').update({
    link_code:linkCode(),link_code_expires_at:new Date(Date.now()+24*3600000).toISOString()
  }).eq('account_id',accountId); fail(error);
}
export async function saveSupplierWhatsApp(accountId:string,supplierId:string,value:{
  whatsapp_e164:string|null;cutoff_time:string|null;delivery_days:number[];lead_time_days:number|null
}) {
  if (value.whatsapp_e164 && !validPhone(value.whatsapp_e164)) throw new Error('Use an international supplier number such as +6591234567.');
  const {error} = await needClient().from('ledger_suppliers').update(value).eq('account_id',accountId).eq('id',supplierId)
    .select('id').single(); fail(error);
}
export async function previewWhatsAppOrder(accountId:string,token:string,text:string):Promise<WhatsAppPreview> {
  const response = await fetch('/api/whatsapp-preview',{method:'POST',headers:{
    'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({accountId,text})});
  const data = await response.json() as WhatsAppPreview & {error?:string};
  if (!response.ok) throw new Error(data.error || 'Could not preview that message.');
  return data;
}
