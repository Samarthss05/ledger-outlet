-- WhatsApp ordering pilot. Webhooks write with a server-only Supabase secret;
-- signed-in outlet owners can read their own activity and edit setup fields.
alter table public.ledger_suppliers
  add column whatsapp_e164 text check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$');
alter table public.ledger_items
  add column order_unit_aliases text[] not null default '{}';

create table public.ledger_wa_settings (
  account_id uuid primary key references public.ledger_accounts(id) on delete cascade,
  owner_phone_e164 text not null unique check (owner_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  outlet_address text not null default '' check (char_length(outlet_address) <= 240),
  channel_mode text not null default 'shared' check (channel_mode in ('shared','dedicated')),
  dedicated_phone_number_id text unique,
  link_code text not null check (link_code ~ '^[A-F0-9]{8}$'),
  link_code_expires_at timestamptz not null default (now() + interval '24 hours'),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel_mode = 'shared' or dedicated_phone_number_id is not null)
);

create function public.ledger_wa_reset_verification()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.owner_phone_e164 is distinct from old.owner_phone_e164
    or new.channel_mode is distinct from old.channel_mode
    or new.dedicated_phone_number_id is distinct from old.dedicated_phone_number_id then
    new.verified_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger ledger_wa_settings_reset before update on public.ledger_wa_settings
for each row execute function public.ledger_wa_reset_verification();

create table public.ledger_wa_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  inbound_message_id text not null unique,
  owner_phone_e164 text not null,
  phone_number_id text not null,
  raw_text text not null check (char_length(raw_text) between 1 and 2000),
  requested_delivery_on date,
  delivery_note text not null default '' check (char_length(delivery_note) <= 240),
  status text not null default 'needs_review'
    check (status in ('needs_review','awaiting_confirmation','sending','sent','partial','cancelled','expired')),
  confirmation_code text not null check (confirmation_code ~ '^[A-F0-9]{6}$'),
  confirmation_message_id text,
  issues text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  confirmed_at timestamptz,
  unique (account_id,id)
);
create index ledger_wa_orders_account_created on public.ledger_wa_orders(account_id,created_at desc);
create index ledger_wa_orders_owner_pending on public.ledger_wa_orders(owner_phone_e164,status,created_at desc);

create table public.ledger_wa_supplier_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  order_id uuid not null,
  supplier_id uuid not null,
  reference text not null unique check (reference ~ '^LO-[A-F0-9]{12}$'),
  status text not null default 'draft'
    check (status in ('draft','sending','sent','confirmed','issue','delivered_reported','failed')),
  message_text text not null default '',
  provider_message_id text unique,
  message_delivery_status text,
  sent_at timestamptz,
  last_reply_at timestamptz,
  last_reply_text text,
  updated_at timestamptz not null default now(),
  unique (account_id,id),
  unique (account_id,order_id,supplier_id),
  foreign key (account_id,order_id) references public.ledger_wa_orders(account_id,id) on delete cascade,
  foreign key (account_id,supplier_id) references public.ledger_suppliers(account_id,id) on delete restrict
);
create index ledger_wa_supplier_orders_account_status on public.ledger_wa_supplier_orders(account_id,status,updated_at desc);
create index ledger_wa_supplier_orders_supplier_recent on public.ledger_wa_supplier_orders(supplier_id,sent_at desc);

create table public.ledger_wa_order_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  supplier_order_id uuid not null,
  item_id uuid not null,
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 10000),
  pack_unit text not null check (char_length(pack_unit) between 1 and 30),
  item_name text not null check (char_length(item_name) between 1 and 160),
  raw_text text not null default '' check (char_length(raw_text) <= 240),
  foreign key (account_id,supplier_order_id) references public.ledger_wa_supplier_orders(account_id,id) on delete cascade,
  foreign key (account_id,item_id) references public.ledger_items(account_id,id) on delete restrict
);
create index ledger_wa_order_lines_supplier_order on public.ledger_wa_order_lines(account_id,supplier_order_id);

-- Inbound receipts are private to the webhook worker; no browser role has grants.
create table public.ledger_wa_inbox (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  account_id uuid references public.ledger_accounts(id) on delete set null,
  phone_number_id text not null,
  sender_e164 text not null,
  body text not null default '',
  context_message_id text,
  status text not null default 'queued' check (status in ('queued','processing','processed','failed','unmatched')),
  error_text text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index ledger_wa_inbox_status_created on public.ledger_wa_inbox(status,received_at);

alter table public.ledger_wa_settings enable row level security;
alter table public.ledger_wa_orders enable row level security;
alter table public.ledger_wa_supplier_orders enable row level security;
alter table public.ledger_wa_order_lines enable row level security;
alter table public.ledger_wa_inbox enable row level security;

create policy ledger_wa_settings_owner on public.ledger_wa_settings for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_wa_orders_owner on public.ledger_wa_orders for select to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_wa_supplier_orders_owner on public.ledger_wa_supplier_orders for select to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_wa_order_lines_owner on public.ledger_wa_order_lines for select to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));

revoke all on public.ledger_wa_settings,public.ledger_wa_orders,public.ledger_wa_supplier_orders,
  public.ledger_wa_order_lines,public.ledger_wa_inbox from anon,authenticated;
grant select on public.ledger_wa_settings,public.ledger_wa_orders,
  public.ledger_wa_supplier_orders,public.ledger_wa_order_lines to authenticated;
grant insert(account_id,owner_phone_e164,outlet_address,channel_mode,dedicated_phone_number_id,link_code,link_code_expires_at)
  on public.ledger_wa_settings to authenticated;
grant update(owner_phone_e164,outlet_address,channel_mode,dedicated_phone_number_id,link_code,link_code_expires_at)
  on public.ledger_wa_settings to authenticated;
grant select,insert,update,delete on public.ledger_wa_settings,public.ledger_wa_orders,
  public.ledger_wa_supplier_orders,public.ledger_wa_order_lines,public.ledger_wa_inbox to service_role;
