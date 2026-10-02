import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { handleLiveAi } from '../server/liveAi.js';
import { runLedgerAgent } from '../server/ledgerAgent.js';

test('simple item requests always open review without relying on model classification', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY
  };
  process.env.SUPABASE_URL = 'https://preview.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'preview-public-key';
  process.env.OPENROUTER_API_KEY = 'preview-key';
  const accountId = '22222222-2222-4222-8222-222222222222';
  let modelCalls = 0;
  let ledgerWrites = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const respond = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/auth/v1/user')) return respond({ id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.com', aud: 'authenticated' });
    if (url.includes('/rest/v1/ledger_') && init?.method && !['GET', 'HEAD'].includes(init.method)) ledgerWrites++;
    if (url.includes('/rest/v1/rpc/ledger_consume_ai_quota')) return respond(true);
    if (url.includes('/rest/v1/ledger_accounts')) return respond({ id: accountId, name: 'Test Outlet' });
    if (url.includes('/rest/v1/ledger_suppliers') || url.includes('/rest/v1/ledger_products') || url.includes('/rest/v1/ledger_items') || url.includes('/rest/v1/ledger_claims') || url.includes('/rest/v1/rpc/')) return respond([]);
    if (url.includes('openrouter.ai')) {
      modelCalls++;
      const content = { kind: 'unsupported', itemId: null, supplierId: null, productId: null, name: null, unit: null, baseQuantity: null, baseUnit: null, active: null, category: null, grade: null, aliases: [], date: null, quantity: null, price: null, usageKind: null, leadDays: null, claimId: null, claimStatus: null, deliveryLines: [] };
      return respond({ choices: [{ message: { content: JSON.stringify(content) } }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    for (const question of ['can you add coke as an item', 'add coke as an item', 'Add coke', 'Please add coke to my items']) {
      const result = await handleLiveAi({ action: 'ask', accountId, question }, 'Bearer preview-session') as { proposal?: { kind: string; name: string | null } };
      assert.equal(result.proposal?.kind, 'create_item');
      assert.equal(result.proposal.name, 'coke');
    }
    assert.equal(modelCalls, 0);
    assert.equal(ledgerWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('agent answers follow-up questions from account-scoped ledger facts without saving changes', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY,OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY};
  process.env.SUPABASE_URL = 'https://preview.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'preview-public-key';
  process.env.OPENROUTER_API_KEY = 'preview-key';
  const accountId = '22222222-2222-4222-8222-222222222222';
  const supplierId = '33333333-3333-4333-8333-333333333333';
  const seenModels:string[] = [];
  let ledgerWrites = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const respond = (data:unknown) => new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
    if (url.includes('openrouter.ai')) {
      const body = JSON.parse(String(init?.body));
      seenModels.push(body.model);
      assert.equal(body.provider.require_parameters,true);
      if (seenModels.length === 1) {
        assert.equal(body.tool_choice,'required');
        return respond({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'read-1',type:'function',function:{name:'read_ledger',arguments:JSON.stringify({view:'overview',search:'Acme',from:null,to:null})}}]}}]});
      }
      assert.match(JSON.stringify(body.messages),/All-time supplier aggregate/);
      assert.match(JSON.stringify(body.messages),/Acme Foods/);
      return respond({choices:[{message:{role:'assistant',content:'Acme Foods has one recorded shortage [F2]. Check the delivery before making a claim.'}}]});
    }
    if (url.includes('/auth/v1/user')) return respond({id:'11111111-1111-4111-8111-111111111111',email:'preview@example.com',aud:'authenticated'});
    if (url.includes('/rest/v1/ledger_') && init?.method && !['GET','HEAD'].includes(init.method)) ledgerWrites++;
    if (url.includes('/rest/v1/rpc/ledger_consume_ai_quota')) return respond(true);
    if (url.includes('/rest/v1/ledger_accounts')) return respond({id:accountId,name:'Test Outlet'});
    if (url.includes('/rest/v1/rpc/ledger_supplier_stats')) return respond([{supplier_id:supplierId,delivery_count:2,total_spend:120,short_count:1}]);
    if (url.includes('/rest/v1/ledger_suppliers')) return respond([{id:supplierId,name:'Acme Foods',short_name:'Acme',contact_name:''}]);
    if (url.includes('/rest/v1/ledger_conversations')) return respond({id:'44444444-4444-4444-8444-444444444444'});
    if (url.includes('/rest/v1/ledger_conversation_messages')) return respond([{role:'user',body:'Tell me about Acme Foods'}]);
    if (url.includes('/rest/v1/rpc/ledger_claim_summary')) return respond([{outstanding:0,recovered:0,open_count:0,asked_count:0}]);
    if (url.includes('/rest/v1/rpc/ledger_spend_summary')) return respond([{total:120,delivery_count:2}]);
    if (url.includes('/rest/v1/ledger_') || url.includes('/rest/v1/rpc/')) {
      if (url.includes('/rest/v1/ledger_') && !url.includes('/rest/v1/ledger_conversation_messages')) assert.ok(url.includes(`account_id=eq.${accountId}`) || url.includes('/rest/v1/ledger_accounts'));
      return respond([]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const result = await handleLiveAi({action:'ask',accountId,question:'And how many shortages did they have?',conversationId:'44444444-4444-4444-8444-444444444444'},'Bearer preview-session') as {answer:string;evidence:string[];proposal?:unknown};
    assert.match(result.answer,/Acme Foods/);
    assert.equal(result.evidence.length,1);
    assert.match(result.evidence[0],/shortages/);
    assert.equal(result.proposal,undefined);
    assert.equal(ledgerWrites,0);
    assert.deepEqual(seenModels,['openai/gpt-5.4','openai/gpt-5.4']);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name,value] of Object.entries(originalEnv)) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});

test('indirect item request becomes a reviewable proposal, never an immediate write', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY,OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY};
  process.env.SUPABASE_URL = 'https://preview.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'preview-public-key';
  process.env.OPENROUTER_API_KEY = 'preview-key';
  const accountId = '22222222-2222-4222-8222-222222222222';
  let modelCalls = 0, writes = 0;
  globalThis.fetch = async (input,init) => {
    const url = String(input);
    const respond = (data:unknown) => new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
    if (url.includes('openrouter.ai')) {
      modelCalls++;
      if (modelCalls === 1) return respond({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'change-1',type:'function',function:{name:'prepare_change',arguments:'{}'}}]}}]});
      return respond({choices:[{message:{content:JSON.stringify({kind:'create_item',itemId:null,supplierId:null,productId:null,name:'Coke',unit:null,baseQuantity:null,baseUnit:null,active:null,category:null,grade:null,aliases:[],date:null,quantity:null,price:null,usageKind:null,leadDays:null,claimId:null,claimStatus:null,deliveryLines:[]})}}]});
    }
    if (url.includes('/auth/v1/user')) return respond({id:'11111111-1111-4111-8111-111111111111',email:'preview@example.com',aud:'authenticated'});
    if (url.includes('/rest/v1/ledger_') && init?.method && !['GET','HEAD'].includes(init.method)) writes++;
    if (url.includes('/rest/v1/rpc/ledger_consume_ai_quota')) return respond(true);
    if (url.includes('/rest/v1/ledger_accounts')) return respond({id:accountId,name:'Test Outlet'});
    if (url.includes('/rest/v1/ledger_') || url.includes('/rest/v1/rpc/')) return respond([]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const result = await handleLiveAi({action:'ask',accountId,question:'Could we put Coke in the catalog?'},'Bearer preview-session') as {proposal?:{kind:string;name:string|null}};
    assert.equal(result.proposal?.kind,'create_item');
    assert.equal(result.proposal.name,'Coke');
    assert.equal(modelCalls,2);
    assert.equal(writes,0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name,value] of Object.entries(originalEnv)) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});

test('assistant combines price and stock tools before recommending a buying check', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'preview-key';
  const accountId='22222222-2222-4222-8222-222222222222';
  const productId='33333333-3333-4333-8333-333333333333';
  const supplierId='44444444-4444-4444-8444-444444444444';
  let modelTurns=0, writes=0;
  globalThis.fetch = async (input,init) => {
    const url=String(input);
    const respond=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
    if(url.includes('openrouter.ai')) {
      modelTurns++;
      const body=JSON.parse(String(init?.body));
      if(modelTurns===1) return respond({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'price-1',type:'function',function:{name:'read_ledger',arguments:JSON.stringify({view:'prices',search:'Coke',from:null,to:null})}}]}}]});
      if(modelTurns===2) {
        assert.match(JSON.stringify(body.messages),/pricePerBase/);
        return respond({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'stock-1',type:'function',function:{name:'read_ledger',arguments:JSON.stringify({view:'stock',search:'Coke',from:null,to:null})}}]}}]});
      }
      assert.match(JSON.stringify(body.messages),/countedQuantity/);
      return respond({choices:[{message:{role:'assistant',content:'Coke is at S$1.80 per unit [F1]. With two days of cover against three days of lead time [F2], review stock and ask the supplier to confirm availability.'}}]});
    }
    if(url.includes('/rest/v1/ledger_') && init?.method && !['GET','HEAD'].includes(init.method)) writes++;
    if(url.includes('/rest/v1/ledger_')) assert.ok(url.includes(`account_id=eq.${accountId}`));
    if(url.includes('/rest/v1/ledger_products')) return respond([{id:productId,name:'Coke',base_unit:'each',singstat_series_no:null}]);
    if(url.includes('/rest/v1/ledger_suppliers')) return respond([{id:supplierId,name:'Acme Drinks'}]);
    if(url.includes('/rest/v1/ledger_stock_counts')) return respond([{product_id:productId,counted_on:'2026-09-29',quantity_base:0}]);
    if(url.includes('/rest/v1/rpc/ledger_price_insights')) return respond([{product_id:productId,supplier_id:supplierId,source_kind:'paid',observed_on:'2026-09-28',price_per_base:1.8}]);
    if(url.includes('/rest/v1/rpc/ledger_restock_insights')) return respond([{product_id:productId,stock_on_hand:5,days_cover:2,lead_days:3,safety_days:2,suggested_quantity:12}]);
    if(url.includes('/rest/v1/ledger_') || url.includes('/rest/v1/rpc/')) return respond([]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const db=createClient<any,'public','public'>('https://preview.supabase.co','preview-public-key',{auth:{persistSession:false}});
    const result=await runLedgerAgent(db,accountId,'Test Outlet','Should I buy Coke now?',[]);
    assert.equal(result.mode,'answer');
    if(result.mode==='answer') { assert.match(result.answer,/review stock/i); assert.equal(result.evidence.length,2); assert.match(result.evidence[1],/countedQuantity":0/); }
    assert.equal(modelTurns,3);
    assert.equal(writes,0);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY=originalKey;
  }
});

test('assistant calculates period spend from delivery lines with account and date filters', async () => {
  const originalFetch=globalThis.fetch, originalKey=process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY='preview-key';
  const accountId='22222222-2222-4222-8222-222222222222';
  const supplierId='33333333-3333-4333-8333-333333333333';
  const itemId='44444444-4444-4444-8444-444444444444';
  const deliveryId='55555555-5555-4555-8555-555555555555';
  let calls=0;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    const respond=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
    if(url.includes('openrouter.ai')) {
      calls++;
      if(calls===1) return respond({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'spend-1',type:'function',function:{name:'read_ledger',arguments:JSON.stringify({view:'spend',search:'Acme',from:'2026-09-01',to:'2026-09-30'})}}]}}]});
      assert.match(JSON.stringify(JSON.parse(String(init?.body)).messages),/S\$20.00/);
      return respond({choices:[{message:{role:'assistant',content:'You spent S$20.00 with Acme in September [F1].'}}]});
    }
    if(url.includes('/rest/v1/ledger_')) assert.ok(url.includes(`account_id=eq.${accountId}`));
    if(url.includes('/rest/v1/ledger_suppliers')) return respond([{id:supplierId,name:'Acme Foods'}]);
    if(url.includes('/rest/v1/ledger_items')) return respond([{id:itemId,name:'Rice',supplier_id:supplierId,unit:'bag'}]);
    if(url.includes('/rest/v1/ledger_deliveries')) {
      assert.match(url,/delivered_on=gte.2026-09-01/);
      assert.match(url,/delivered_on=lte.2026-09-30/);
      return respond([{id:deliveryId,supplier_id:supplierId,delivered_on:'2026-09-10',order_channel:'phone'}]);
    }
    if(url.includes('/rest/v1/ledger_delivery_lines')) return respond([{delivery_id:deliveryId,item_id:itemId,quantity_delivered:2,quantity_charged:2,unit_price:10,line_total:20,short_value:0}]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const db=createClient<any,'public','public'>('https://preview.supabase.co','preview-public-key',{auth:{persistSession:false}});
    const result=await runLedgerAgent(db,accountId,'Test Outlet','How much did we spend with Acme last month?',[]);
    assert.equal(result.mode,'answer');
    if(result.mode==='answer') { assert.match(result.answer,/S\$20.00/); assert.match(result.evidence[0],/S\$20.00/); }
    assert.equal(calls,2);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY=originalKey;
  }
});

test('morning brief uses the ledger agent rather than a fixed totals summary', async () => {
  const originalFetch=globalThis.fetch;
  const originalEnv={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY,OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY};
  process.env.SUPABASE_URL='https://preview.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='preview-public-key';
  process.env.OPENROUTER_API_KEY='preview-key';
  const accountId='22222222-2222-4222-8222-222222222222';
  const productId='33333333-3333-4333-8333-333333333333';
  let modelTurns=0;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    const respond=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
    if(url.includes('openrouter.ai')) {
      modelTurns++;
      if(modelTurns===1) return respond({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'stock-brief',type:'function',function:{name:'read_ledger',arguments:JSON.stringify({view:'stock',search:null,from:null,to:null})}}]}}]});
      return respond({choices:[{message:{role:'assistant',content:'Review Coke first: two days of cover against three days of lead time [F1].'}}]});
    }
    if(url.includes('/auth/v1/user')) return respond({id:'11111111-1111-4111-8111-111111111111',email:'preview@example.com',aud:'authenticated'});
    if(url.includes('/rest/v1/rpc/ledger_consume_ai_quota')) return respond(true);
    if(url.includes('/rest/v1/ledger_accounts')) return respond({id:accountId,name:'Test Outlet'});
    if(url.includes('/rest/v1/ledger_products')) return respond([{id:productId,name:'Coke',base_unit:'each'}]);
    if(url.includes('/rest/v1/rpc/ledger_restock_insights')) return respond([{product_id:productId,stock_on_hand:4,days_cover:2,lead_days:3,safety_days:2,suggested_quantity:10}]);
    if(url.includes('/rest/v1/ledger_') || url.includes('/rest/v1/rpc/')) return respond([]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const result=await handleLiveAi({action:'brief',accountId},'Bearer preview-session') as {brief:string;evidence:string[]};
    assert.match(result.brief,/Coke/);
    assert.equal(result.evidence.length,1);
    assert.equal(modelTurns,2);
  } finally {
    globalThis.fetch=originalFetch;
    for(const [name,value] of Object.entries(originalEnv)) value===undefined ? delete process.env[name] : process.env[name]=value;
  }
});
