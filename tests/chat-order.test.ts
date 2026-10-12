import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsualLines, routeChatMessage } from '../server/chatOrders.js';
import { validateOutletOrder, type OrderItem, type OrderSupplier } from '../server/whatsappOrder.js';

const supplier:OrderSupplier={id:'supplier',name:'Main Supplier',whatsapp_e164:null,delivery_days:[2],cutoff_time:null,lead_time_days:1};
const item:OrderItem={id:'item',supplier_id:'supplier',product_id:'product',base_quantity:24,name:'Coke carton of 24',unit:'carton',aliases:['Coke'],order_unit_aliases:[],active:true};
const now=new Date('2026-10-12T03:00:00Z'); // Monday 11am Singapore

test('usual order uses fresh computed need converted into whole supplier packs',()=>{
  const lines=buildUsualLines([{product_id:'product',suggested_quantity:50,usage_days:7,counted_on:'2026-10-12'}],[item]);
  assert.equal(lines.length,1);
  assert.equal(lines[0].quantity,3);
  const preview=validateOutletOrder({requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines,unmatched:[]},[item],[supplier],now,undefined,{channel:'chat'});
  assert.equal(preview.ready,true);
  assert.equal(preview.groups[0].lines[0].quantity,3);
});

test('usual order refuses stale estimates and ambiguous supplier mappings',()=>{
  assert.deepEqual(buildUsualLines([{product_id:'product',suggested_quantity:null,usage_days:7,counted_on:'2026-10-12'}],[item]),[]);
  assert.deepEqual(buildUsualLines([{product_id:'product',suggested_quantity:50,usage_days:3,counted_on:'2026-10-12'}],[item]),[]);
  assert.deepEqual(buildUsualLines([{product_id:'product',suggested_quantity:50,usage_days:7,counted_on:'2026-10-12'}],[item,{...item,id:'rival',supplier_id:'other'}]),[]);
});

test('typed OK only reopens the latest draft for explicit confirmation',async()=>{
  const accountId='11111111-1111-4111-8111-111111111111';
  const orderId='22222222-2222-4222-8222-222222222222';
  const itemId='33333333-3333-4333-8333-333333333333';
  const supplierId='44444444-4444-4444-8444-444444444444';
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
  const row={id:orderId,account_id:accountId,request_id:'55555555-5555-4555-8555-555555555555',raw_text:'rice 2 bags tomorrow',source_kind:'message' as const,
    requested_delivery_on:date,delivery_note:'',lines:[{itemId,quantity:2,rawUnit:'bag',rawText:'Rice 25kg 2 bags',ambiguous:false}],issues:[],supplier_updates:{},status:'awaiting_review' as const,version:1,confirmed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  let writes=0;
  const db={from(table:string){return {
    select(){return this;},eq(){return this;},order(){return this;},limit(){return Promise.resolve({data:table==='ledger_chat_orders'?[row]:table==='ledger_items'?[{id:itemId,supplier_id:supplierId,name:'Rice 25kg',unit:'bag',aliases:['rice'],order_unit_aliases:[],active:true}]:[{id:supplierId,name:'Dry Goods',whatsapp_e164:null,delivery_days:[0,1,2,3,4,5,6],cutoff_time:null,lead_time_days:0}],error:null});},
    maybeSingle(){return Promise.resolve({data:null,error:null});},single(){return Promise.resolve({data:{name:'Test Outlet'},error:null});},
    update(){writes++;throw Error('Typed OK must not update the database.');}
  };}};
  const result=await routeChatMessage(db as unknown as Parameters<typeof routeChatMessage>[0],accountId,'OK');
  assert.equal(result?.order?.id,orderId);
  assert.match(result?.answer || '',/typed “OK” never confirms/);
  assert.equal(writes,0);
});

test('a short reply completes the existing Kangkong draft without creating another order',async()=>{
  const accountId='11111111-1111-4111-8111-111111111111';
  const orderId='22222222-2222-4222-8222-222222222222';
  const itemId='33333333-3333-4333-8333-333333333333';
  const supplierId='44444444-4444-4444-8444-444444444444';
  const requestId='55555555-5555-4555-8555-555555555555';
  const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
  const originalFetch=globalThis.fetch;
  const originalKey=process.env.OPENAI_API_KEY;
  let writes=0;
  let row={id:orderId,account_id:accountId,request_id:'66666666-6666-4666-8666-666666666666',raw_text:'order kangkong',source_kind:'message',
    requested_delivery_on:null as string|null,delivery_note:'',lines:[{itemId,quantity:null as number|null,rawUnit:null as string|null,rawText:'order kangkong',ambiguous:true}],issues:[],supplier_updates:{},status:'awaiting_review',version:1,last_followup_request_id:null as string|null,confirmed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const db={from(table:string){const query={
    select(){return this;},eq(){return this;},order(){return this;},limit(){return Promise.resolve({data:table==='ledger_items'?[{id:itemId,supplier_id:supplierId,name:'Kangkong',unit:'kg',aliases:['kangkong'],order_unit_aliases:[],active:true}]:[{id:supplierId,name:'Vegetable Supplier',whatsapp_e164:null,delivery_days:[0,1,2,3,4,5,6],cutoff_time:null,lead_time_days:0}],error:null});},
    maybeSingle(){return Promise.resolve({data:table==='ledger_chat_orders'?row:null,error:null});},single(){return Promise.resolve({data:{name:'Test Outlet'},error:null});},
    update(changes:Record<string,unknown>){writes++;row={...row,...changes} as typeof row;return this;}
  };return query;}};
  process.env.OPENAI_API_KEY='preview-key';
  globalThis.fetch=async (_input,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.response_format.json_schema.name,'restock_order_followup_v1');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({isFollowup:true,lineIndex:0,quantity:10,rawUnit:'kg',requestedDeliveryOn:tomorrow,confidence:0.98})}}]}),{headers:{'content-type':'application/json'}});
  };
  try {
    const result=await routeChatMessage(db as unknown as Parameters<typeof routeChatMessage>[0],accountId,'10 kg tomorrow',requestId,orderId);
    assert.equal(result?.order?.id,orderId);
    assert.equal(result?.order?.version,2);
    assert.equal(result?.order?.preview.ready,true);
    assert.match(result?.answer || '',/Review the order card/);
    assert.equal(writes,1);
    const retry=await routeChatMessage(db as unknown as Parameters<typeof routeChatMessage>[0],accountId,'10 kg tomorrow',requestId,orderId);
    assert.equal(retry?.order?.version,2);
    assert.equal(writes,1);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=originalKey;
  }
});
