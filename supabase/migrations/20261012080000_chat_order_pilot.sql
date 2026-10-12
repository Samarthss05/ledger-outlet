-- Chat-first order pilot. These rows never enter the WhatsApp send queue.
-- Owners review exact outlet item matches and explicitly confirm each version.
create table public.ledger_chat_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  request_id uuid not null,
  raw_text text not null check (char_length(raw_text) between 1 and 2000),
  source_kind text not null default 'message' check (source_kind in ('message','usual','repeat')),
  requested_delivery_on date,
  delivery_note text not null default '' check (char_length(delivery_note) <= 160),
  lines jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 30),
  issues text[] not null default '{}',
  supplier_updates jsonb not null default '{}'::jsonb check (jsonb_typeof(supplier_updates) = 'object'),
  status text not null default 'awaiting_review'
    check (status in ('awaiting_review','confirmed','cancelled','cancel_requested','received')),
  version integer not null default 1 check (version > 0),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id,id),
  unique (account_id,request_id)
);
create index ledger_chat_orders_recent on public.ledger_chat_orders(account_id,created_at desc);
create index ledger_chat_orders_status on public.ledger_chat_orders(account_id,status,updated_at desc);

alter table public.ledger_chat_orders enable row level security;
create policy ledger_chat_orders_owner_select on public.ledger_chat_orders
  for select to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_chat_orders_owner_insert on public.ledger_chat_orders
  for insert to authenticated
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_chat_orders_owner_update on public.ledger_chat_orders
  for update to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
revoke all on public.ledger_chat_orders from anon,authenticated;
grant select,insert,update on public.ledger_chat_orders to authenticated;
