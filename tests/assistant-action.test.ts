import assert from 'node:assert/strict';
import test from 'node:test';
import { handleLiveAi } from '../server/liveAi.js';

const accountId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const supplierId = '44444444-4444-4444-8444-444444444444';
const respond = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const action = (kind: string, overrides: Record<string, unknown> = {}) => ({
  kind, itemId: null, supplierId: null, productId: null, name: null, unit: null, baseQuantity: null,
  baseUnit: null, active: null, category: null, grade: null, aliases: [], date: null, quantity: null,
  price: null, usageKind: null, leadDays: null, claimId: null, claimStatus: null, deliveryLines: [],
  market: null, sourceName: null, sourceUrl: null, note: null, ...overrides
});

async function withMockedServer(mock: (url: string, body: any) => unknown, run: (state: { calls: string[]; writes: string[] }) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const originalEnv = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  process.env.SUPABASE_URL = 'https://preview.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'preview-public-key';
  process.env.OPENAI_API_KEY = 'preview-key';
  const state = { calls: [] as string[], writes: [] as string[] };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('api.openai.com')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(body.model, 'gpt-5.4-mini');
      assert.equal(body.reasoning_effort, 'low');
      assert.equal(body.provider, undefined);
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer preview-key');
      const name = body.response_format?.json_schema?.name || 'unknown';
      state.calls.push(name);
      return respond(mock(url, body));
    }
    if (url.includes('/auth/v1/user')) return respond({ id: '11111111-1111-4111-8111-111111111111', email: 'preview@example.com', aud: 'authenticated' });
    if (url.includes('/rest/v1/rpc/ledger_consume_ai_quota')) return respond(true);
    if (url.includes('/rest/v1/ledger_accounts')) return respond({ id: accountId, name: 'Test Outlet' });
    if (url.includes('/rest/v1/ledger_') && init?.method && !['GET', 'HEAD'].includes(init.method)) state.writes.push(url);
    if (url.includes('/rest/v1/ledger_') && !url.includes('/rest/v1/ledger_accounts')) assert.ok(url.includes(`account_id=eq.${accountId}`), `Account scope missing: ${url}`);
    if (url.includes('/rest/v1/ledger_products')) return respond([{ id: productId, name: 'Coke', base_unit: 'each', singstat_series_no: null }]);
    if (url.includes('/rest/v1/ledger_agent_memories')) return respond([{ content: 'Coke is sold by the carton of 24.' }]);
    if (url.includes('/rest/v1/ledger_suppliers')) return respond([{ id: supplierId, name: 'Acme Drinks', short_name: 'Acme', contact_name: '' }]);
    if (url.includes('/rest/v1/rpc/ledger_price_insights')) return respond([{ product_id: productId, supplier_id: supplierId, source_kind: 'paid', observed_on: '2026-10-01', price_per_base: 1.8 }]);
    if (url.includes('/rest/v1/rpc/ledger_restock_insights')) return respond([{ product_id: productId, stock_on_hand: 5, days_cover: 2, lead_days: 3, safety_days: 2, suggested_quantity: 12 }]);
    if (url.includes('/rest/v1/rpc/ledger_claim_summary')) return respond([{ outstanding: 0, recovered: 0, open_count: 0 }]);
    if (url.includes('/rest/v1/rpc/ledger_spend_summary')) return respond([{ total: 0, delivery_count: 0 }]);
    if (url.includes('/rest/v1/ledger_') || url.includes('/rest/v1/rpc/')) return respond([]);
    throw new Error(`Unexpected request: ${url}`);
  };
  try { await run(state); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
}

test('direct item commands prepare review cards without a model call or ledger write', async () => {
  await withMockedServer(() => { throw new Error('A direct catalog command should not need an LLM.'); }, async state => {
    for (const question of ['can you add coke as an item', 'add coke as an item', 'Add coke', 'Please add coke to my items']) {
      const result = await handleLiveAi({ action: 'ask', accountId, question }, 'Bearer preview-session') as { proposals: { kind: string; name: string | null }[] };
      assert.equal(result.proposals[0]?.kind, 'create_item');
      assert.equal(result.proposals[0]?.name, 'coke');
    }
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.writes, []);
  });
});

test('outlet memory is an explicit reviewable action', async () => {
  await withMockedServer(() => { throw new Error('A direct memory command should not need an LLM.'); }, async state => {
    const result = await handleLiveAi({ action: 'ask', accountId, question: 'Remember that Coke comes in cartons of 24' }, 'Bearer preview-session') as { proposals: { kind: string; note: string }[] };
    assert.equal(result.proposals[0]?.kind, 'remember_fact');
    assert.equal(result.proposals[0]?.note, 'Coke comes in cartons of 24');
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.writes, []);
  });
});

test('coordinator delegates pricing and stock analysis, then review agent checks the answer', async () => {
  await withMockedServer((_url, body) => {
    const name = body.response_format.json_schema.name;
    if (name === 'ledger_team_plan') {
      assert.match(JSON.stringify(body.messages), /carton of 24/);
      return { choices: [{ message: { content: JSON.stringify({ views: ['prices', 'stock'], search: 'Coke', from: null, to: null, prepareChange: false }) } }] };
    }
    if (name === 'ledger_specialist_finding') {
      const pricing = body.messages[0].content.includes('Pricing agent');
      assert.match(JSON.stringify(body.messages), pricing ? /pricePerBase/ : /daysCover/);
      return { choices: [{ message: { content: JSON.stringify({ summary: pricing ? 'Coke costs S$1.80 per each.' : 'Coke has two days of cover and a three day lead time.', factIds: [pricing ? 'F1' : 'F2'] }) } }] };
    }
    if (name === 'ledger_team_answer' || name === 'ledger_team_review') return { choices: [{ message: { content: JSON.stringify({ answer: 'Coke costs S$1.80 each and has two days of cover against a three day lead time. Review a restock now.', factIds: ['F1', 'F2'] }) } }] };
    throw new Error(`Unexpected model role: ${name}`);
  }, async state => {
    const result = await handleLiveAi({ action: 'ask', accountId, question: 'Should I buy Coke now?' }, 'Bearer preview-session') as { answer: string; evidence: string[]; proposals?: unknown[] };
    assert.match(result.answer, /Review a restock/);
    assert.equal(result.proposals, undefined);
    assert.ok(result.evidence.some(line => line.startsWith('Agent · Pricing:')));
    assert.ok(result.evidence.some(line => line.startsWith('Agent · Stock:')));
    assert.ok(result.evidence.some(line => line.startsWith('F1 ·')));
    assert.deepEqual(state.calls.sort(), ['ledger_team_plan', 'ledger_specialist_finding', 'ledger_specialist_finding', 'ledger_team_answer', 'ledger_team_review'].sort());
    assert.deepEqual(state.writes, []);
  });
});

test('partial specialist failure is disclosed instead of presenting a complete analysis', async () => {
  await withMockedServer((_url, body) => {
    const name = body.response_format.json_schema.name;
    if (name === 'ledger_team_plan') return { choices: [{ message: { content: JSON.stringify({ views: ['prices', 'stock'], search: 'Coke', from: null, to: null, prepareChange: false }) } }] };
    if (name === 'ledger_specialist_finding') {
      if (body.messages[0].content.includes('Pricing agent')) return { choices: [{ message: { content: '' } }] };
      return { choices: [{ message: { content: JSON.stringify({ summary: 'Coke has two days of cover.', factIds: ['F2'] }) } }] };
    }
    if (name === 'ledger_team_answer' || name === 'ledger_team_review') {
      const prompt = body.messages[1].content;
      assert.deepEqual(JSON.parse(prompt).unavailable, ['Pricing']);
      return { choices: [{ message: { content: JSON.stringify({ answer: 'Coke has two days of cover, so review stock now.', factIds: ['F2'] }) } }] };
    }
    throw new Error(`Unexpected model role: ${name}`);
  }, async state => {
    const result = await handleLiveAi({ action: 'ask', accountId, question: 'Should I buy Coke now?' }, 'Bearer preview-session') as { answer: string; evidence: string[] };
    assert.match(result.answer, /could not complete the Pricing analysis/);
    assert.ok(result.evidence.includes('Agent unavailable · Pricing'));
    assert.ok(result.evidence.some(line => line.startsWith('Agent · Stock:')));
    assert.deepEqual(state.writes, []);
  });
});

test('agents prepare multiple independent changes and require an independent action review', async () => {
  await withMockedServer((_url, body) => {
    const name = body.response_format.json_schema.name;
    if (name === 'ledger_team_plan') return { choices: [{ message: { content: JSON.stringify({ views: ['catalog', 'stock'], search: 'Coke', from: null, to: null, prepareChange: false }) } }] };
    if (name === 'ledger_specialist_finding') return { choices: [{ message: { content: JSON.stringify({ summary: 'The requested record should be reviewed before saving.', factIds: [] }) } }] };
    if (name === 'ledger_team_answer' || name === 'ledger_team_review') return { choices: [{ message: { content: JSON.stringify({ answer: 'I will prepare the catalog and stock changes for review.', factIds: [] }) } }] };
    if (name === 'ledger_action_batch') return { choices: [{ message: { content: JSON.stringify({ actions: [action('create_item', { name: 'Coke' }), action('record_stock', { productId, quantity: 10, date: '2026-10-06' })] }) } }] };
    if (name === 'ledger_action_review') {
      assert.match(JSON.stringify(body.messages), /record_stock/);
      return { choices: [{ message: { content: JSON.stringify({ approved: true, reason: '' }) } }] };
    }
    throw new Error(`Unexpected model role: ${name}`);
  }, async state => {
    const result = await handleLiveAi({ action: 'ask', accountId, question: 'Add Coke as an item and record 10 in stock today' }, 'Bearer preview-session') as { proposals: { kind: string }[]; answer: string };
    assert.deepEqual(result.proposals.map(proposal => proposal.kind), ['create_item', 'record_stock']);
    assert.match(result.answer, /2 changes/);
    assert.ok(state.calls.includes('ledger_action_review'));
    assert.deepEqual(state.writes, []);
  });
});

test('morning brief consults stock, pricing, and supplier specialists', async () => {
  await withMockedServer((_url, body) => {
    const name = body.response_format.json_schema.name;
    if (name === 'ledger_team_plan') return { choices: [{ message: { content: JSON.stringify({ views: ['overview'], search: null, from: null, to: null, prepareChange: false }) } }] };
    if (name === 'ledger_specialist_finding') return { choices: [{ message: { content: JSON.stringify({ summary: 'Review current records before purchasing.', factIds: [] }) } }] };
    if (name === 'ledger_team_answer' || name === 'ledger_team_review') return { choices: [{ message: { content: JSON.stringify({ answer: 'Review Coke stock first, then check supplier prices and open claims.', factIds: [] }) } }] };
    throw new Error(`Unexpected model role: ${name}`);
  }, async state => {
    const result = await handleLiveAi({ action: 'brief', accountId }, 'Bearer preview-session') as { brief: string; evidence: string[] };
    assert.match(result.brief, /Coke stock/);
    assert.ok(result.evidence.some(line => line.startsWith('Agent · Stock:')));
    assert.ok(result.evidence.some(line => line.startsWith('Agent · Pricing:')));
    assert.ok(result.evidence.some(line => line.startsWith('Agent · Supplier operations:')));
    assert.deepEqual(state.writes, []);
  });
});
