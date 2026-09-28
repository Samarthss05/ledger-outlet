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
