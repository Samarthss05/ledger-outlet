alter table public.ledger_wa_supplier_orders
  drop constraint ledger_wa_supplier_orders_status_check;
alter table public.ledger_wa_supplier_orders
  add constraint ledger_wa_supplier_orders_status_check
  check (status in ('draft','sending','sent','confirmed','issue','delivered_reported','delivered','failed')),
  add column received_at timestamptz;
