import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { extractMetaEvents, verifyMetaSignature } from '../server/whatsappProvider.js';
import { formatOwnerPreview, validateOutletOrder, type ExtractedOrder, type OrderItem, type OrderSupplier } from '../server/whatsappOrder.js';
import { selectPendingBatch, selectSupplierReplyOrder } from '../server/whatsappWebhook.js';
import webhook from '../api/whatsapp-webhook.js';

const now = new Date('2026-10-06T04:00:00Z'); // Tuesday noon in Singapore
const suppliers:OrderSupplier[] = [
  {id:'dry',name:'Dry Goods',whatsapp_e164:'+6591111111',delivery_days:[3],cutoff_time:'16:00:00'},
  {id:'eggs',name:'Egg Farm',whatsapp_e164:'+6592222222',delivery_days:[3],cutoff_time:'16:00:00'}
];
const items:OrderItem[] = [
  {id:'rice',supplier_id:'dry',name:'Rice 25kg',unit:'bag',aliases:['rice'],order_unit_aliases:['sack'],active:true},
  {id:'oil',supplier_id:'dry',name:'Cooking oil 17L',unit:'tin',aliases:['oil'],order_unit_aliases:[],active:true},
  {id:'egg',supplier_id:'eggs',name:'Eggs (30)',unit:'tray',aliases:['egg'],order_unit_aliases:[],active:true}
];
const parsed:ExtractedOrder = {requestedDeliveryOn:'2026-10-07',deliveryNote:'before 9am',
  lines:[
    {itemId:'rice',quantity:2,rawUnit:'sack',rawText:'rice 2 sack',ambiguous:false},
    {itemId:'oil',quantity:3,rawUnit:'tin',rawText:'oil 3 tin',ambiguous:false},
    {itemId:'egg',quantity:5,rawUnit:'trays',rawText:'egg 5 trays',ambiguous:false}
  ],unmatched:[]};

test('splits a mixed supplier order and renders owner confirmation without sending', () => {
  const preview = validateOutletOrder(parsed,items,suppliers,now);
  assert.equal(preview.ready,true);
  assert.deepEqual(preview.groups.map(group => [group.supplierName,group.lines.length]),[['Dry Goods',2],['Egg Farm',1]]);
  assert.equal(preview.groups[0].lines[0].unit,'bag');
  const message = formatOwnerPreview('Test Outlet',preview,'A1B2C3');
  assert.match(message,/Dry Goods: Rice 25kg ×2 bag, Cooking oil 17L ×3 tin/);
  assert.match(message,/Reply OK A1B2C3 to send/);
});

test('unknown units, unmatched lines, missing supplier numbers and missed cutoffs block dispatch', () => {
  const bad = validateOutletOrder({...parsed,lines:[{...parsed.lines[0],rawUnit:'carton'}],
    unmatched:['mystery sauce 2']},[{...items[0]}],[{...suppliers[0],whatsapp_e164:null}],new Date('2026-10-06T10:00:00Z'));
  assert.equal(bad.ready,false);
  assert.ok(bad.issues.some(issue => issue.includes('mystery sauce')));
  assert.ok(bad.issues.some(issue => issue.includes('pack unit')));
  assert.ok(bad.issues.some(issue => issue.includes('No complete item lines')));
  const cutoff = validateOutletOrder({...parsed,lines:[parsed.lines[0]]},items,suppliers,new Date('2026-10-06T10:00:00Z'));
  assert.ok(cutoff.issues.some(issue => issue.includes('cut-off has passed')));
  const leadTime = validateOutletOrder({...parsed,lines:[parsed.lines[0]]},items,
    [{...suppliers[0],lead_time_days:2}],now);
  assert.ok(leadTime.issues.some(issue => issue.includes('2 days lead time')));
});

test('a shared spoken name across suppliers requires a precise pack or supplier', () => {
  const rival:OrderItem = {id:'rival-rice',supplier_id:'eggs',name:'Rice 50kg',unit:'bag',aliases:['rice'],order_unit_aliases:[],active:true};
  const ambiguous = validateOutletOrder({...parsed,lines:[parsed.lines[0]]},[...items,rival],suppliers,now);
  assert.equal(ambiguous.ready,false);
  assert.ok(ambiguous.issues.some(issue => issue.includes('more than one supplier item')));
  const precise = validateOutletOrder({...parsed,lines:[{...parsed.lines[0],rawText:'Rice 25kg 2 sack'}]},[...items,rival],suppliers,now);
  assert.equal(precise.ready,true);
});

test('chat drafts can omit supplier phone numbers but cannot accept an invented item match', () => {
  const chatSuppliers=suppliers.map(supplier=>({...supplier,whatsapp_e164:null}));
  const valid=validateOutletOrder(parsed,items,chatSuppliers,now,undefined,{channel:'chat'});
  assert.equal(valid.ready,true);
  const invented=validateOutletOrder({...parsed,lines:[{...parsed.lines[0],itemId:'oil'}]},items,chatSuppliers,now,undefined,{channel:'chat'});
  assert.equal(invented.ready,false);
  assert.ok(invented.issues.some(issue=>issue.includes('exact outlet item')));
});

test('confirmation and supplier replies require one unambiguous order', () => {
  const batches = [{confirmation_code:'ABC123',id:'one'},{confirmation_code:'DEF456',id:'two'}];
  assert.equal(selectPendingBatch(batches,null),null);
  assert.equal(selectPendingBatch(batches,'def456')?.id,'two');
  assert.equal(selectPendingBatch(batches,'wrong'),null);
  const orders = [{reference:'LO-AAAABBBBCCCC',provider_message_id:'wamid-1'},
    {reference:'LO-DDDDEEEEFFFF',provider_message_id:'wamid-2'}];
  assert.equal(selectSupplierReplyOrder(orders,null,null),null);
  assert.equal(selectSupplierReplyOrder(orders,'LO-DDDDEEEEFFFF',null)?.provider_message_id,'wamid-2');
  assert.equal(selectSupplierReplyOrder(orders,null,'wamid-1')?.reference,'LO-AAAABBBBCCCC');
});

test('Meta webhooks require a raw-body HMAC and read text messages plus delivery statuses', () => {
  const payload = {object:'whatsapp_business_account',entry:[{changes:[{value:{
    metadata:{phone_number_id:'123456789'},messages:[{id:'wamid-1',from:'6591234567',type:'text',
      text:{body:'rice 2 bag'},context:{id:'old-message'}}],statuses:[{id:'sent-message',status:'delivered'}]
  }}]}]};
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256='+createHmac('sha256','test-secret').update(raw).digest('hex');
  assert.equal(verifyMetaSignature(raw,signature,'test-secret'),true);
  assert.equal(verifyMetaSignature(Buffer.from('tampered'),signature,'test-secret'),false);
  assert.equal(verifyMetaSignature(raw,null,'test-secret'),false);
  const events = extractMetaEvents(payload);
  assert.equal(events.messages[0].from,'+6591234567');
  assert.equal(events.messages[0].contextMessageId,'old-message');
  assert.deepEqual(events.statuses,[{id:'sent-message',status:'delivered'}]);
});

test('webhook sending stays disabled until Meta and server secrets are configured', async () => {
  const previous = process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  try {
    const response = await webhook.fetch(new Request('https://ledger-outlet.vercel.app/api/whatsapp-webhook',{
      method:'POST',body:'{}',headers:{'Content-Type':'application/json'}
    }));
    assert.equal(response.status,503);
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = previous;
  }
});
