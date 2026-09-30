import assert from 'node:assert/strict';
import test from 'node:test';
import { handleLiveAi } from '../server/liveAi.js';

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
    for (const question of ['can you add coke as an item', 'add coke as an item']) {
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
      if (seenModels.length === 1) return respond({choices:[{message:{content:JSON.stringify({mode:'answer',topic:'general',clarification:null})}}]});
      assert.match(String(body.messages[1].content),/Supplier aggregate/);
      assert.match(String(body.messages[1].content),/Acme Foods/);
      return respond({choices:[{message:{content:JSON.stringify({answer:'Acme Foods has one recorded shortage. Check the delivery before making a claim.',evidenceIds:[1,999]})}}]});
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
    assert.match(result.evidence[0],/short_count/);
    assert.equal(result.proposal,undefined);
    assert.equal(ledgerWrites,0);
    assert.deepEqual(seenModels,['openai/gpt-5.4-mini','openai/gpt-5.4-mini']);
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
      if (modelCalls === 1) return respond({choices:[{message:{content:JSON.stringify({mode:'change',topic:'general',clarification:null})}}]});
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
