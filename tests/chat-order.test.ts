import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsualLines, classify, routeChatMessage } from '../server/chatOrders.js';
import { groundExtractedOrder, validateOutletOrder, type OrderItem, type OrderSupplier } from '../server/whatsappOrder.js';

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

test('explicit orders and bulk catalog requests reach the right workflow',async()=>{
  assert.equal((await classify('i need to order 10 cartons of milk and one bag of rice')).intent,'ORDER');
  assert.equal((await classify('order Bean sprout')).intent,'ORDER');
  assert.equal((await classify('I want to bulk add 50 item')).intent,'OTHER');
  assert.equal((await classify('what is my order status?')).intent,'ORDER_STATUS');
});

test('model supplied quantities and dates need evidence in the owner message',()=>{
  const rice={...item,name:'Rice 25kg',unit:'bag',aliases:['rice']};
  const noQuantity=groundExtractedOrder('order Rice 25kg',{requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines:[{itemId:rice.id,quantity:25,rawUnit:'bag',rawText:'Rice 25kg',ambiguous:false}],unmatched:[]},[rice],now);
  assert.equal(noQuantity.lines[0].quantity,null);
  assert.equal(noQuantity.lines[0].rawUnit,null);
  assert.equal(noQuantity.requestedDeliveryOn,null);
  const spacedPack=groundExtractedOrder('order Rice 25 kg',{requestedDeliveryOn:null,deliveryNote:'',lines:[{itemId:rice.id,quantity:25,rawUnit:'kg',rawText:'Rice 25 kg',ambiguous:false}],unmatched:[]},[rice],now);
  assert.equal(spacedPack.lines[0].quantity,null);
  assert.equal(spacedPack.lines[0].rawUnit,null);
  const wrongTomorrow=groundExtractedOrder('rice 2 bags tomorrow',{requestedDeliveryOn:'2026-10-14',deliveryNote:'',lines:[{itemId:rice.id,quantity:2,rawUnit:'bags',rawText:'rice 2 bags',ambiguous:false}],unmatched:[]},[rice],now);
  assert.equal(wrongTomorrow.requestedDeliveryOn,null);
  assert.equal(wrongTomorrow.lines[0].quantity,2);
  assert.equal(wrongTomorrow.lines[0].rawUnit,'bags');
  const decimal=groundExtractedOrder('rice 1.5 bags tomorrow',{requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines:[{itemId:rice.id,quantity:1.5,rawUnit:'bags',rawText:'rice 1.5 bags',ambiguous:false}],unmatched:[]},[rice],now);
  assert.equal(decimal.lines[0].quantity,1.5);
  assert.equal(decimal.requestedDeliveryOn,'2026-10-13');
  const spoken=groundExtractedOrder('one bag of rice tomorrow',{requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines:[{itemId:rice.id,quantity:1,rawUnit:'bag',rawText:'one bag of rice',ambiguous:false}],unmatched:[]},[rice],now);
  assert.equal(spoken.lines[0].quantity,1);
  const compact=groundExtractedOrder('kangkong 10kg tomorrow',{requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines:[{itemId:'veg',quantity:10,rawUnit:'kg',rawText:'kangkong 10kg',ambiguous:false}],unmatched:[]},[{...rice,id:'veg',name:'Kangkong',unit:'kg',aliases:[]}],now);
  assert.equal(compact.lines[0].quantity,10);
  assert.equal(compact.lines[0].rawUnit,'kg');
  const missedId=groundExtractedOrder('rice 2 bags tomorrow',{requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines:[{itemId:null,quantity:2,rawUnit:'bags',rawText:'rice 2 bags',ambiguous:true}],unmatched:[]},[rice],now);
  assert.equal(missedId.lines[0].itemId,rice.id);
  assert.equal(missedId.lines[0].ambiguous,false);
  const rival={...rice,id:'rival',supplier_id:'second-supplier'};
  const ambiguous=groundExtractedOrder('rice 2 bags tomorrow',{requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines:[{itemId:null,quantity:2,rawUnit:'bags',rawText:'rice 2 bags',ambiguous:true}],unmatched:[]},[rice,rival],now);
  assert.equal(ambiguous.lines[0].itemId,null);
  const missedLine=groundExtractedOrder('order rice',{requestedDeliveryOn:null,deliveryNote:'',lines:[],unmatched:['rice']},[rice],now);
  assert.equal(missedLine.lines[0].itemId,rice.id);
  assert.deepEqual(missedLine.unmatched,[]);
  const emptyModel=groundExtractedOrder('order rice',{requestedDeliveryOn:null,deliveryNote:'',lines:[],unmatched:[]},[rice],now);
  assert.equal(emptyModel.lines[0].itemId,rice.id);
});

test('spoken kilogram names can match a kg catalog unit without a conversion',()=>{
  const vegetable={...item,name:'Kangkong',unit:'kg',aliases:['kang kong']};
  const preview=validateOutletOrder({requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines:[{itemId:vegetable.id,quantity:10,rawUnit:'kilograms',rawText:'Kangkong 10 kilograms',ambiguous:false}],unmatched:[]},[vegetable],[supplier],now,undefined,{channel:'chat'});
  assert.equal(preview.ready,true);
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

test('an item omitted by model matching is recovered from the outlet catalog',async()=>{
  const accountId='11111111-1111-4111-8111-111111111111';
  const itemId='33333333-3333-4333-8333-333333333333';
  const supplierId='44444444-4444-4444-8444-444444444444';
  const originalFetch=globalThis.fetch;
  const originalKey=process.env.OPENAI_API_KEY;
  let inserted:Record<string,unknown>|null=null;
  const db={from(table:string){const query={
    select(){return this;},eq(){return this;},limit(){return Promise.resolve({data:table==='ledger_items'?
      [{id:itemId,supplier_id:supplierId,name:'Milk carton',unit:'Carton',aliases:['milk'],order_unit_aliases:[],active:true}]:
      [{id:supplierId,name:'Dairy Supplier',whatsapp_e164:null,delivery_days:[0,1,2,3,4,5,6],cutoff_time:null,lead_time_days:0}],error:null});},
    maybeSingle(){return Promise.resolve({data:null,error:null});},
    insert(values:Record<string,unknown>){inserted=values;return this;},
    single(){return Promise.resolve({data:table==='ledger_accounts'?{name:'Test Outlet'}:{...inserted,id:'22222222-2222-4222-8222-222222222222',status:'awaiting_review',version:1,supplier_updates:{},confirmed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()},error:null});}
  };return query;}};
  process.env.OPENAI_API_KEY='preview-key';
  globalThis.fetch=async (_input,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.response_format.json_schema.name,'ledger_whatsapp_order');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({requestedDeliveryOn:null,deliveryNote:'',lines:[],unmatched:['milk']})}}]}),{headers:{'content-type':'application/json'}});
  };
  try {
    const result=await routeChatMessage(db as unknown as Parameters<typeof routeChatMessage>[0],accountId,'order milk','55555555-5555-4555-8555-555555555555');
    assert.equal(result?.order?.lines[0].itemId,itemId);
    assert.match(result?.answer || '',/How many Carton/);
    assert.equal(result?.order?.preview.ready,false);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=originalKey;
  }
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
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({kind:'details',lineIndex:0,quantity:10,rawUnit:'kg',requestedDeliveryOn:tomorrow,confidence:0.98})}}]}),{headers:{'content-type':'application/json'}});
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

test('adding another item updates the pending draft instead of creating a new order',async()=>{
  const accountId='11111111-1111-4111-8111-111111111111';
  const orderId='22222222-2222-4222-8222-222222222222';
  const vegetableId='33333333-3333-4333-8333-333333333333';
  const milkId='77777777-7777-4777-8777-777777777777';
  const supplierId='44444444-4444-4444-8444-444444444444';
  const requestId='55555555-5555-4555-8555-555555555555';
  const originalFetch=globalThis.fetch;
  const originalKey=process.env.OPENAI_API_KEY;
  let inserts=0;
  let row={id:orderId,account_id:accountId,request_id:'66666666-6666-4666-8666-666666666666',raw_text:'order kangkong',source_kind:'message',
    requested_delivery_on:null as string|null,delivery_note:'',lines:[{itemId:vegetableId,quantity:null as number|null,rawUnit:null as string|null,rawText:'order kangkong',ambiguous:true}],issues:[],supplier_updates:{},status:'awaiting_review',version:1,last_followup_request_id:null as string|null,confirmed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const db={from(table:string){const query={
    select(){return this;},eq(){return this;},order(){return this;},limit(){return Promise.resolve({data:table==='ledger_items'?
      [{id:vegetableId,supplier_id:supplierId,name:'Kangkong',unit:'kg',aliases:['kangkong'],order_unit_aliases:[],active:true},{id:milkId,supplier_id:supplierId,name:'Milk carton',unit:'carton',aliases:['milk'],order_unit_aliases:[],active:true}]:
      [{id:supplierId,name:'Main Supplier',whatsapp_e164:null,delivery_days:[0,1,2,3,4,5,6],cutoff_time:null,lead_time_days:0}],error:null});},
    maybeSingle(){return Promise.resolve({data:table==='ledger_chat_orders'?row:null,error:null});},single(){return Promise.resolve({data:{name:'Test Outlet'},error:null});},
    update(changes:Record<string,unknown>){row={...row,...changes} as typeof row;return this;},
    insert(){inserts++;throw Error('A second draft must not be created.');}
  };return query;}};
  process.env.OPENAI_API_KEY='preview-key';
  globalThis.fetch=async (_input,init)=>{
    const body=JSON.parse(String(init?.body));
    const result=body.response_format.json_schema.name==='restock_order_followup_v1'?
      {kind:'add',lineIndex:null,quantity:null,rawUnit:null,requestedDeliveryOn:null,confidence:0.97}:
      {requestedDeliveryOn:null,deliveryNote:'',lines:[{itemId:milkId,quantity:2,rawUnit:'cartons',rawText:'milk 2 cartons',ambiguous:false}],unmatched:[]};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{headers:{'content-type':'application/json'}});
  };
  try {
    const result=await routeChatMessage(db as unknown as Parameters<typeof routeChatMessage>[0],accountId,'add milk 2 cartons',requestId,orderId);
    assert.equal(result?.order?.id,orderId);
    assert.equal(result?.order?.lines.length,2);
    assert.equal(result?.order?.lines[1].itemId,milkId);
    assert.equal(result?.order?.version,2);
    assert.equal(inserts,0);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=originalKey;
  }
});
