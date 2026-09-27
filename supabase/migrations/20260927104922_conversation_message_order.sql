-- Stable ordering for the two messages saved together in each chat turn.
alter table public.ledger_conversation_messages
  add column sequence_no bigint generated always as identity;
create unique index ledger_conversation_messages_sequence_idx
  on public.ledger_conversation_messages(sequence_no);
