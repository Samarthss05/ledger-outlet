-- Products are independent of suppliers, so like-for-like quotes can be compared.
create table public.ledger_products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  category text not null default '',
  grade text not null default '',
  base_unit text not null check (base_unit in ('kg', 'l', 'each')),
  safety_days integer not null default 2 check (safety_days between 0 and 30),
  singstat_series_no integer check (singstat_series_no between 1 and 40),
  external_ref text,
  legacy_item_id uuid unique,
  created_at timestamptz not null default now(),
  unique (account_id, id),
  unique (account_id, external_ref)
);
create index ledger_products_account_name_idx on public.ledger_products(account_id, name);

alter table public.ledger_suppliers
  add column lead_time_days integer check (lead_time_days between 0 and 90);
alter table public.ledger_items
  add column product_id uuid,
  add column base_quantity numeric(12,4) check (base_quantity > 0);

-- Preserve every existing supplier item. Ambiguous packs remain unconverted until reviewed.
insert into public.ledger_products(account_id, name, base_unit, legacy_item_id)
select account_id, name,
  case when lower(unit) in ('kg','g') then 'kg'
       when lower(unit) in ('l','litre','liter','ml') then 'l'
       else 'each' end,
  id
from public.ledger_items;
update public.ledger_items i set product_id = p.id,
  base_quantity = case when lower(i.unit) in ('kg','l','litre','liter','each','piece','pc') then 1
                       when lower(i.unit) = 'g' then 0.001
                       when lower(i.unit) = 'ml' then 0.001
                       else null end
from public.ledger_products p where p.legacy_item_id = i.id;
alter table public.ledger_items alter column product_id set not null;
alter table public.ledger_items
  add constraint ledger_items_product_fk foreign key (account_id, product_id)
  references public.ledger_products(account_id, id) on delete restrict;
create index ledger_items_account_product_idx on public.ledger_items(account_id, product_id);

create table public.ledger_supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  item_id uuid not null,
  quoted_on date not null,
  valid_until date,
  price_per_pack numeric(12,2) not null check (price_per_pack > 0),
  min_packs numeric(12,3) not null default 1 check (min_packs > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  foreign key (account_id, item_id) references public.ledger_items(account_id, id) on delete cascade,
  check (valid_until is null or valid_until >= quoted_on)
);
create index ledger_supplier_quotes_lookup_idx on public.ledger_supplier_quotes(account_id, item_id, quoted_on desc);

create table public.ledger_stock_counts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  product_id uuid not null,
  counted_on date not null,
  quantity_base numeric(12,3) not null check (quantity_base >= 0),
  created_at timestamptz not null default now(),
  unique (account_id, product_id, counted_on),
  foreign key (account_id, product_id) references public.ledger_products(account_id, id) on delete cascade
);
create index ledger_stock_counts_latest_idx on public.ledger_stock_counts(account_id, product_id, counted_on desc);

create table public.ledger_usage_records (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  product_id uuid not null,
  used_on date not null,
  quantity_base numeric(12,3) not null check (quantity_base > 0),
  kind text not null check (kind in ('used', 'waste')),
  note text not null default '',
  created_at timestamptz not null default now(),
  foreign key (account_id, product_id) references public.ledger_products(account_id, id) on delete cascade
);
create index ledger_usage_product_date_idx on public.ledger_usage_records(account_id, product_id, used_on desc);

-- Provenance is mandatory; only equivalent wholesale records are procurement benchmarks.
create table public.ledger_market_benchmarks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  product_id uuid not null,
  market text not null check (char_length(market) between 2 and 100),
  source_name text not null check (char_length(source_name) between 2 and 160),
  source_url text not null default '',
  observed_on date not null,
  price_per_base numeric(12,3) not null check (price_per_base > 0),
  currency text not null default 'SGD' check (currency = 'SGD'),
  basis text not null check (basis in ('wholesale', 'retail_reference')),
  note text not null default '',
  created_at timestamptz not null default now(),
  foreign key (account_id, product_id) references public.ledger_products(account_id, id) on delete cascade,
  check (source_url = '' or source_url ~ '^https://')
);
create index ledger_market_benchmarks_latest_idx on public.ledger_market_benchmarks(account_id, product_id, observed_on desc);

alter table public.ledger_products enable row level security;
alter table public.ledger_supplier_quotes enable row level security;
alter table public.ledger_stock_counts enable row level security;
alter table public.ledger_usage_records enable row level security;
alter table public.ledger_market_benchmarks enable row level security;

create policy ledger_products_owner on public.ledger_products for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_supplier_quotes_owner on public.ledger_supplier_quotes for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_stock_counts_owner on public.ledger_stock_counts for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_usage_records_owner on public.ledger_usage_records for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));
create policy ledger_market_benchmarks_owner on public.ledger_market_benchmarks for all to authenticated
  using (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())))
  with check (account_id in (select id from public.ledger_accounts where owner_user_id = (select auth.uid())));

revoke all on public.ledger_products, public.ledger_supplier_quotes, public.ledger_stock_counts,
  public.ledger_usage_records, public.ledger_market_benchmarks from anon;
grant select, insert, update, delete on public.ledger_products, public.ledger_supplier_quotes,
  public.ledger_stock_counts, public.ledger_usage_records, public.ledger_market_benchmarks to authenticated;

-- Summaries run under the caller's RLS and never expose another outlet's records.
create function public.ledger_price_insights(p_account_id uuid)
returns table(product_id uuid, item_id uuid, supplier_id uuid, source_kind text, observed_on date,
  price_per_base numeric, base_unit text, source_id uuid)
language sql stable security invoker set search_path = '' as $$
  select p.id, i.id, i.supplier_id, 'paid'::text, d.delivered_on,
    round(l.unit_price / i.base_quantity, 3), p.base_unit, l.id
  from public.ledger_products p
  join public.ledger_items i on i.account_id = p.account_id and i.product_id = p.id
  join lateral (
    select dl.id, dl.unit_price, dl.delivery_id from public.ledger_delivery_lines dl
    join public.ledger_deliveries dd on dd.account_id = dl.account_id and dd.id = dl.delivery_id
    where dl.account_id = i.account_id and dl.item_id = i.id
    order by dd.delivered_on desc, dl.id desc limit 1
  ) l on true
  join public.ledger_deliveries d on d.account_id = p.account_id and d.id = l.delivery_id
  where p.account_id = p_account_id and i.base_quantity is not null
  union all
  select p.id, i.id, i.supplier_id, 'quote'::text, q.quoted_on,
    round(q.price_per_pack / i.base_quantity, 3), p.base_unit, q.id
  from public.ledger_products p
  join public.ledger_items i on i.account_id = p.account_id and i.product_id = p.id
  join lateral (
    select sq.id, sq.quoted_on, sq.valid_until, sq.price_per_pack
    from public.ledger_supplier_quotes sq
    where sq.account_id = i.account_id and sq.item_id = i.id
    order by sq.quoted_on desc, sq.id desc limit 1
  ) q on true
  where p.account_id = p_account_id and i.base_quantity is not null
    and (q.valid_until is null or q.valid_until >= current_date);
$$;
revoke all on function public.ledger_price_insights(uuid) from public, anon;
grant execute on function public.ledger_price_insights(uuid) to authenticated;

create function public.ledger_restock_insights(p_account_id uuid)
returns table(product_id uuid, counted_on date, stock_on_hand numeric, daily_usage numeric,
  usage_days bigint, days_cover numeric, lead_days integer, safety_days integer, suggested_quantity numeric)
language sql stable security invoker set search_path = '' as $$
  select p.id, c.counted_on,
    round(greatest(0, c.quantity_base + coalesce(receipts.quantity, 0) - coalesce(consumed.quantity, 0)), 3),
    round(coalesce(history.quantity, 0) / nullif(greatest(current_date - history.first_day + 1, 1), 0), 3),
    coalesce(history.days, 0),
    case when history.days >= 7 and history.quantity > 0 then
      round(greatest(0, c.quantity_base + coalesce(receipts.quantity, 0) - coalesce(consumed.quantity, 0)) /
        (history.quantity / greatest(current_date - history.first_day + 1, 1)), 1)
    else null end,
    s.lead_time_days, p.safety_days,
    case when history.days >= 7 and history.quantity > 0 and s.lead_time_days is not null then
      round(greatest(0, (history.quantity / greatest(current_date - history.first_day + 1, 1)) *
        (s.lead_time_days + p.safety_days + 7) -
        greatest(0, c.quantity_base + coalesce(receipts.quantity, 0) - coalesce(consumed.quantity, 0))), 3)
    else null end
  from public.ledger_products p
  left join lateral (
    select sc.counted_on, sc.quantity_base from public.ledger_stock_counts sc
    where sc.account_id = p.account_id and sc.product_id = p.id
    order by sc.counted_on desc, sc.id desc limit 1
  ) c on true
  left join lateral (
    select sum(dl.quantity_delivered * i.base_quantity) as quantity
    from public.ledger_delivery_lines dl
    join public.ledger_items i on i.account_id = dl.account_id and i.id = dl.item_id
    join public.ledger_deliveries d on d.account_id = dl.account_id and d.id = dl.delivery_id
    where dl.account_id = p.account_id and i.product_id = p.id and d.delivered_on > c.counted_on
      and i.base_quantity is not null
  ) receipts on true
  left join lateral (
    select sum(u.quantity_base) as quantity from public.ledger_usage_records u
    where u.account_id = p.account_id and u.product_id = p.id and u.used_on > c.counted_on
  ) consumed on true
  left join lateral (
    select sum(u.quantity_base) as quantity, min(u.used_on) as first_day,
      count(distinct u.used_on) filter (where u.kind = 'used') as days
    from public.ledger_usage_records u
    where u.account_id = p.account_id and u.product_id = p.id and u.kind = 'used'
      and u.used_on between current_date - 27 and current_date
  ) history on true
  left join lateral (
    select min(su.lead_time_days) as lead_time_days
    from public.ledger_items i
    join public.ledger_suppliers su on su.account_id = i.account_id and su.id = i.supplier_id
    where i.account_id = p.account_id and i.product_id = p.id and i.active and su.lead_time_days is not null
  ) s on true
  where p.account_id = p_account_id and c.counted_on is not null;
$$;
revoke all on function public.ledger_restock_insights(uuid) from public, anon;
grant execute on function public.ledger_restock_insights(uuid) to authenticated;
