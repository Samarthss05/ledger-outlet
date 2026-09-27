-- Each conversation belongs to one outlet. Its messages stay private to the outlet owner.
create table public.ledger_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);
create index ledger_conversations_recent_idx on public.ledger_conversations(account_id, updated_at desc, id desc);

create table public.ledger_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  body text not null check (char_length(body) between 1 and 4000),
  evidence text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (account_id, conversation_id) references public.ledger_conversations(account_id, id) on delete cascade
);
create index ledger_conversation_messages_order_idx on public.ledger_conversation_messages(account_id, conversation_id, created_at, id);

alter table public.ledger_conversations enable row level security;
alter table public.ledger_conversation_messages enable row level security;

create policy ledger_conversations_owner on public.ledger_conversations
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_conversation_messages_owner on public.ledger_conversation_messages
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));

revoke all on public.ledger_conversations, public.ledger_conversation_messages from anon;
grant select, insert, update, delete on public.ledger_conversations to authenticated;
grant select, insert on public.ledger_conversation_messages to authenticated;
