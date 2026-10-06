import { needClient } from './supabase';

export type AgentMemory = { id: string; content: string; created_at: string };

export async function listAgentMemories(accountId: string): Promise<AgentMemory[]> {
  const { data, error } = await needClient().from('ledger_agent_memories')
    .select('id,content,created_at').eq('account_id', accountId).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data || []) as AgentMemory[];
}

export async function addAgentMemory(accountId: string, content: string) {
  const { error } = await needClient().from('ledger_agent_memories').insert({ account_id: accountId, content });
  if (error) throw new Error(error.message);
}

export async function deleteAgentMemory(accountId: string, memoryId: string) {
  const { error } = await needClient().from('ledger_agent_memories').delete().eq('account_id', accountId).eq('id', memoryId);
  if (error) throw new Error(error.message);
}
