import { needClient } from './supabase';

export type Conversation = { id: string; account_id: string; title: string; created_at: string; updated_at: string };
export type ConversationMessage = { id: string; role: 'user' | 'assistant'; body: string; evidence: string[]; sequence_no: number };

function checked(error: { message: string } | null) { if (error) throw new Error(error.message); }

export async function listConversations(accountId: string, from = 0, pageSize = 40) {
  const { data, error } = await needClient().from('ledger_conversations')
    .select('id,account_id,title,created_at,updated_at').eq('account_id', accountId)
    .order('updated_at', { ascending: false }).order('id', { ascending: false })
    .range(from, from + pageSize);
  checked(error);
  const rows = (data || []) as Conversation[];
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

export async function loadConversation(accountId: string, conversationId: string) {
  const { data, error } = await needClient().from('ledger_conversation_messages')
    .select('id,role,body,evidence,sequence_no').eq('account_id', accountId)
    .eq('conversation_id', conversationId).order('sequence_no', { ascending: false }).limit(500);
  checked(error);
  return ((data || []) as ConversationMessage[]).reverse();
}

export async function createConversation(accountId: string, title: string) {
  const { data, error } = await needClient().from('ledger_conversations')
    .insert({ account_id: accountId, title: title.slice(0, 120) })
    .select('id,account_id,title,created_at,updated_at').single();
  checked(error);
  return data as Conversation;
}

export async function saveTurn(accountId: string, conversationId: string, question: string, answer: string, evidence: string[]) {
  const { data, error } = await needClient().from('ledger_conversation_messages').insert([
    { account_id: accountId, conversation_id: conversationId, role: 'user', body: question, evidence: [] },
    { account_id: accountId, conversation_id: conversationId, role: 'assistant', body: answer, evidence }
  ]).select('id,role,body,evidence,sequence_no');
  checked(error);
  const { data: updated, error: updateError } = await needClient().from('ledger_conversations')
    .update({ updated_at: new Date().toISOString() }).eq('account_id', accountId).eq('id', conversationId)
    .select('id,account_id,title,created_at,updated_at').single();
  checked(updateError);
  return { conversation: updated as Conversation, messages: ((data || []) as ConversationMessage[]).sort((a, b) => a.sequence_no - b.sequence_no) };
}

export async function saveActionResult(accountId: string, conversationId: string, body: string) {
  const { data, error } = await needClient().from('ledger_conversation_messages')
    .insert({ account_id: accountId, conversation_id: conversationId, role: 'assistant', body, evidence: [] })
    .select('id,role,body,evidence,sequence_no').single();
  checked(error);
  const { error: updateError } = await needClient().from('ledger_conversations')
    .update({ updated_at: new Date().toISOString() }).eq('account_id', accountId).eq('id', conversationId);
  checked(updateError);
  return data as ConversationMessage;
}

export async function deleteConversation(accountId: string, conversationId: string) {
  const { error } = await needClient().from('ledger_conversations').delete().eq('account_id', accountId).eq('id', conversationId);
  checked(error);
}
