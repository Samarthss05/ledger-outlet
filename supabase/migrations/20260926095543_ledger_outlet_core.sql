-- Ledger Outlet: account-owned operational records. All exposed tables use RLS.
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  demo_seeded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_user_id)
);
create index ledger_accounts_owner_idx on public.ledger_accounts(owner_user_id);

create table public.ledger_suppliers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  external_ref text,
  short_name text not null check (char_length(short_name) between 1 and 80),
  contact_name text not null default '',
  category text not null default '',
  cutoff_time time,
  delivery_days smallint[] not null default '{}',
  payment_terms text not null default '',
  created_at timestamptz not null default now(),
  unique (account_id, id),
  unique (account_id, name),
  unique (account_id, external_ref),
  constraint ledger_supplier_days check (delivery_days <@ array[0,1,2,3,4,5,6]::smallint[])
);
create index ledger_suppliers_account_idx on public.ledger_suppliers(account_id);

create table public.ledger_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  supplier_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  external_ref text,
  unit text not null check (char_length(unit) between 1 and 30),
  aliases text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (account_id, id),
  unique (account_id, id, supplier_id),
  unique (account_id, name),
  unique (account_id, external_ref),
  foreign key (account_id, supplier_id) references public.ledger_suppliers(account_id, id) on delete cascade
);
create index ledger_items_account_supplier_idx on public.ledger_items(account_id, supplier_id);

create table public.ledger_deliveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  supplier_id uuid not null,
  delivered_on date not null,
  external_ref text,
  order_channel text not null default 'ledger' check (order_channel in ('ledger','phone','other')),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (account_id, id),
  unique (account_id, id, supplier_id),
  unique (account_id, external_ref),
  foreign key (account_id, supplier_id) references public.ledger_suppliers(account_id, id) on delete restrict
);
create index ledger_deliveries_account_date_idx on public.ledger_deliveries(account_id, delivered_on desc, id);
create index ledger_deliveries_account_supplier_date_idx on public.ledger_deliveries(account_id, supplier_id, delivered_on desc);

create table public.ledger_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  delivery_id uuid not null,
  item_id uuid not null,
  supplier_id uuid not null,
  external_ref text,
  quantity_ordered numeric(12,3) not null check (quantity_ordered >= 0),
  quantity_delivered numeric(12,3) not null check (quantity_delivered >= 0),
  quantity_charged numeric(12,3) not null check (quantity_charged >= 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(16,2) generated always as (round(quantity_charged * unit_price, 2)) stored,
  short_value numeric(16,2) generated always as (round(greatest(quantity_charged - quantity_delivered, 0) * unit_price, 2)) stored,
  created_at timestamptz not null default now(),
  unique (account_id, id),
  unique (account_id, external_ref),
  foreign key (account_id, delivery_id, supplier_id) references public.ledger_deliveries(account_id, id, supplier_id) on delete cascade,
  foreign key (account_id, item_id, supplier_id) references public.ledger_items(account_id, id, supplier_id) on delete restrict
);
create index ledger_delivery_lines_account_delivery_idx on public.ledger_delivery_lines(account_id, delivery_id);
create index ledger_delivery_lines_account_item_idx on public.ledger_delivery_lines(account_id, item_id);

create table public.ledger_claims (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  delivery_line_id uuid not null,
  amount numeric(16,2) not null check (amount > 0),
  external_ref text,
  status text not null default 'open' check (status in ('open','asked','credited','refused')),
  updated_at timestamptz not null default now(),
  unique (account_id, delivery_line_id),
  unique (account_id, external_ref),
  foreign key (account_id, delivery_line_id) references public.ledger_delivery_lines(account_id, id) on delete cascade
);
create index ledger_claims_account_status_idx on public.ledger_claims(account_id, status);

create table public.ledger_order_drafts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  supplier_id uuid not null,
  source_text text not null default '',
  message_text text not null,
  estimated_total numeric(16,2) not null default 0 check (estimated_total >= 0),
  needs_review boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (account_id, supplier_id) references public.ledger_suppliers(account_id, id) on delete cascade
);
create index ledger_order_drafts_account_created_idx on public.ledger_order_drafts(account_id, created_at desc);

create table public.ledger_ai_usage (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ledger_ai_usage_account_time_idx on public.ledger_ai_usage(account_id, created_at desc);

-- This function runs with the caller's privileges and serializes quota checks per account.
create function public.ledger_consume_ai_quota(p_account_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ledger_accounts
    where id = p_account_id and owner_user_id = (select auth.uid())
  ) then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_account_id::text));
  if (select count(*) from public.ledger_ai_usage
      where account_id = p_account_id and created_at >= now() - interval '1 hour') >= 30 then
    return false;
  end if;
  insert into public.ledger_ai_usage(account_id, user_id) values (p_account_id, (select auth.uid()));
  return true;
end;
$$;
revoke all on function public.ledger_consume_ai_quota(uuid) from public, anon;
grant execute on function public.ledger_consume_ai_quota(uuid) to authenticated;

alter table public.ledger_accounts enable row level security;
alter table public.ledger_suppliers enable row level security;
alter table public.ledger_items enable row level security;
alter table public.ledger_deliveries enable row level security;
alter table public.ledger_delivery_lines enable row level security;
alter table public.ledger_claims enable row level security;
alter table public.ledger_order_drafts enable row level security;
alter table public.ledger_ai_usage enable row level security;

create policy ledger_accounts_owner on public.ledger_accounts
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy ledger_suppliers_owner on public.ledger_suppliers
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_items_owner on public.ledger_items
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_deliveries_owner on public.ledger_deliveries
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_delivery_lines_owner on public.ledger_delivery_lines
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_claims_owner on public.ledger_claims
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_ai_usage_owner on public.ledger_ai_usage
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid()))
         and user_id = (select auth.uid()))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid()))
              and user_id = (select auth.uid()));
create policy ledger_order_drafts_owner on public.ledger_order_drafts
  for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));

-- Opt in to the Data API explicitly; RLS still determines visible rows.
grant usage on schema public to authenticated;
revoke all on public.ledger_accounts, public.ledger_suppliers, public.ledger_items,
  public.ledger_deliveries, public.ledger_delivery_lines, public.ledger_claims,
  public.ledger_order_drafts, public.ledger_ai_usage from anon;
grant select, insert, update, delete on public.ledger_accounts, public.ledger_suppliers,
  public.ledger_items, public.ledger_deliveries, public.ledger_delivery_lines,
  public.ledger_claims, public.ledger_order_drafts, public.ledger_ai_usage to authenticated;

-- Aggregate functions keep large histories in Postgres instead of sending all rows to AI functions.
create function public.ledger_spend_summary(
  p_account_id uuid, p_item_id uuid default null, p_supplier_id uuid default null,
  p_start date default null, p_end date default null
) returns table(total numeric, delivery_count bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(l.line_total), 0), count(distinct d.id)
  from public.ledger_deliveries d
  join public.ledger_delivery_lines l on l.account_id = d.account_id and l.delivery_id = d.id
  where d.account_id = p_account_id
    and (p_item_id is null or l.item_id = p_item_id)
    and (p_supplier_id is null or d.supplier_id = p_supplier_id)
    and (p_start is null or d.delivered_on >= p_start)
    and (p_end is null or d.delivered_on <= p_end);
$$;

create function public.ledger_claim_summary(p_account_id uuid)
returns table(outstanding numeric, recovered numeric, open_count bigint, asked_count bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(amount) filter (where status in ('open','asked')), 0),
         coalesce(sum(amount) filter (where status = 'credited'), 0),
         count(*) filter (where status = 'open'),
         count(*) filter (where status = 'asked')
  from public.ledger_claims where account_id = p_account_id;
$$;

create function public.ledger_supplier_stats(p_account_id uuid)
returns table(supplier_id uuid, delivery_count bigint, short_count bigint, total_spend numeric)
language sql stable security invoker set search_path = '' as $$
  select s.id, count(d.id), count(d.id) filter (where coalesce(x.has_short, false)),
         coalesce(sum(x.total), 0)
  from public.ledger_suppliers s
  left join public.ledger_deliveries d on d.account_id = s.account_id and d.supplier_id = s.id
  left join lateral (
    select coalesce(sum(l.line_total), 0) as total, bool_or(l.short_value > 0) as has_short
    from public.ledger_delivery_lines l where l.account_id = d.account_id and l.delivery_id = d.id
  ) x on true
  where s.account_id = p_account_id
  group by s.id;
$$;

create function public.ledger_item_price_summary(p_account_id uuid, p_item_id uuid)
returns table(first_price numeric, last_price numeric, total_quantity numeric, total_spend numeric)
language sql stable security invoker set search_path = '' as $$
  select
    (select l.unit_price from public.ledger_delivery_lines l
     join public.ledger_deliveries d on d.account_id = l.account_id and d.id = l.delivery_id
     where l.account_id = p_account_id and l.item_id = p_item_id
     order by d.delivered_on asc, l.id asc limit 1),
    (select l.unit_price from public.ledger_delivery_lines l
     join public.ledger_deliveries d on d.account_id = l.account_id and d.id = l.delivery_id
     where l.account_id = p_account_id and l.item_id = p_item_id
     order by d.delivered_on desc, l.id desc limit 1),
    coalesce(sum(quantity_charged), 0), coalesce(sum(line_total), 0)
  from public.ledger_delivery_lines where account_id = p_account_id and item_id = p_item_id;
$$;

create function public.ledger_order_pattern(p_account_id uuid, p_weekday integer)
returns table(item_id uuid, average_quantity numeric, order_count bigint)
language sql stable security invoker set search_path = '' as $$
  select l.item_id, round(avg(l.quantity_ordered), 2), count(distinct d.id)
  from public.ledger_deliveries d
  join public.ledger_delivery_lines l on l.account_id = d.account_id and l.delivery_id = d.id
  where d.account_id = p_account_id and extract(dow from d.delivered_on) = p_weekday
  group by l.item_id order by count(distinct d.id) desc, l.item_id;
$$;

revoke all on function public.ledger_spend_summary(uuid,uuid,uuid,date,date),
  public.ledger_claim_summary(uuid), public.ledger_supplier_stats(uuid),
  public.ledger_item_price_summary(uuid,uuid), public.ledger_order_pattern(uuid,integer)
  from public, anon;
grant execute on function public.ledger_spend_summary(uuid,uuid,uuid,date,date),
  public.ledger_claim_summary(uuid), public.ledger_supplier_stats(uuid),
  public.ledger_item_price_summary(uuid,uuid), public.ledger_order_pattern(uuid,integer)
  to authenticated;

create function public.ledger_all_item_stats(p_account_id uuid)
returns table(item_id uuid, first_price numeric, last_price numeric, total_quantity numeric, total_spend numeric)
language sql stable security invoker set search_path = '' as $$
  select i.id, first_line.unit_price, last_line.unit_price,
         coalesce(totals.quantity, 0), coalesce(totals.spend, 0)
  from public.ledger_items i
  left join lateral (
    select l.unit_price from public.ledger_delivery_lines l
    join public.ledger_deliveries d on d.account_id = l.account_id and d.id = l.delivery_id
    where l.account_id = i.account_id and l.item_id = i.id
    order by d.delivered_on asc, l.id asc limit 1
  ) first_line on true
  left join lateral (
    select l.unit_price from public.ledger_delivery_lines l
    join public.ledger_deliveries d on d.account_id = l.account_id and d.id = l.delivery_id
    where l.account_id = i.account_id and l.item_id = i.id
    order by d.delivered_on desc, l.id desc limit 1
  ) last_line on true
  left join lateral (
    select sum(l.quantity_charged) as quantity, sum(l.line_total) as spend
    from public.ledger_delivery_lines l
    where l.account_id = i.account_id and l.item_id = i.id
  ) totals on true
  where i.account_id = p_account_id;
$$;
revoke all on function public.ledger_all_item_stats(uuid) from public, anon;
grant execute on function public.ledger_all_item_stats(uuid) to authenticated;

-- One transaction for delivery, lines, and automatically opened shortage claims.
create function public.ledger_create_delivery(
  p_account_id uuid, p_supplier_id uuid, p_delivered_on date,
  p_order_channel text, p_note text, p_lines jsonb,
  p_external_ref text default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_delivery_id uuid;
  v_line_id uuid;
  v_short numeric;
  v_line jsonb;
  v_item_id uuid;
  v_ordinal integer := 0;
begin
  if not exists (select 1 from public.ledger_accounts where id = p_account_id and owner_user_id = (select auth.uid())) then
    raise exception 'Account is not accessible';
  end if;
  if pg_catalog.jsonb_typeof(p_lines) <> 'array' or pg_catalog.jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'A delivery needs 1 to 100 lines';
  end if;
  insert into public.ledger_deliveries(account_id, supplier_id, delivered_on, order_channel, note, external_ref)
    values (p_account_id, p_supplier_id, p_delivered_on, p_order_channel, coalesce(p_note, ''), p_external_ref)
    returning id into v_delivery_id;
  for v_line in select value from pg_catalog.jsonb_array_elements(p_lines) loop
    v_ordinal := v_ordinal + 1;
    v_item_id := (v_line->>'item_id')::uuid;
    if not exists (select 1 from public.ledger_items where account_id = p_account_id and id = v_item_id and supplier_id = p_supplier_id) then
      raise exception 'Item does not belong to this supplier';
    end if;
    insert into public.ledger_delivery_lines(
      account_id, delivery_id, supplier_id, item_id, quantity_ordered,
      quantity_delivered, quantity_charged, unit_price, external_ref
    ) values (
      p_account_id, v_delivery_id, p_supplier_id, v_item_id,
      (v_line->>'quantity_ordered')::numeric, (v_line->>'quantity_delivered')::numeric,
      (v_line->>'quantity_charged')::numeric, (v_line->>'unit_price')::numeric,
      case when p_external_ref is null then null else p_external_ref || ':' || v_ordinal end
    ) returning id, short_value into v_line_id, v_short;
    if v_short > 0 then
      insert into public.ledger_claims(account_id, delivery_line_id, amount, status, external_ref)
      values (p_account_id, v_line_id, v_short, 'open',
        case when p_external_ref is null then null else p_external_ref || ':' || v_ordinal end);
    end if;
  end loop;
  return v_delivery_id;
end;
$$;
revoke all on function public.ledger_create_delivery(uuid,uuid,date,text,text,jsonb,text) from public, anon;
grant execute on function public.ledger_create_delivery(uuid,uuid,date,text,text,jsonb,text) to authenticated;
