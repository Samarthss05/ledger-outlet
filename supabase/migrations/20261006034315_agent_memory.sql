-- Explicit, reviewable outlet memory for the agent team. Chat alone never writes here.
create table public.ledger_agent_memories (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  content text not null check (char_length(content) between 2 and 500),
  created_at timestamptz not null default now(),
  unique (account_id, content)
);
create index ledger_agent_memories_recent_idx on public.ledger_agent_memories(account_id, created_at desc);

alter table public.ledger_agent_memories enable row level security;
create policy ledger_agent_memories_owner on public.ledger_agent_memories
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));

revoke all on public.ledger_agent_memories from anon;
grant select, insert, update, delete on public.ledger_agent_memories to authenticated;
