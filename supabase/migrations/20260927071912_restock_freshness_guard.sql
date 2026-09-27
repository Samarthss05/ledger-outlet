-- Suppress reorder estimates when counts or usage are stale.
create or replace function public.ledger_restock_insights(p_account_id uuid)
returns table(product_id uuid, counted_on date, stock_on_hand numeric, daily_usage numeric,
  usage_days bigint, days_cover numeric, lead_days integer, safety_days integer, suggested_quantity numeric)
language sql stable security invoker set search_path = '' as $$
  select p.id, c.counted_on,
    round(greatest(0, c.quantity_base + coalesce(receipts.quantity, 0) - coalesce(consumed.quantity, 0)), 3),
    round(coalesce(history.quantity, 0) / nullif(greatest(current_date - history.first_day + 1, 1), 0), 3),
    coalesce(history.days, 0),
    case when history.days >= 7 and history.quantity > 0 and c.counted_on between current_date - 14 and current_date and history.last_day >= current_date - 3 then
      round(greatest(0, c.quantity_base + coalesce(receipts.quantity, 0) - coalesce(consumed.quantity, 0)) /
        (history.quantity / greatest(current_date - history.first_day + 1, 1)), 1)
    else null end,
    s.lead_time_days, p.safety_days,
    case when history.days >= 7 and history.quantity > 0 and c.counted_on between current_date - 14 and current_date and history.last_day >= current_date - 3 and s.lead_time_days is not null then
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
    select sum(u.quantity_base) as quantity, min(u.used_on) as first_day, max(u.used_on) as last_day,
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
