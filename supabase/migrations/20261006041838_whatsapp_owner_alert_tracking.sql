alter table public.ledger_wa_supplier_orders
  add column owner_alert_status text
    check (owner_alert_status in ('pending','sent','failed')),
  add column owner_alert_message_id text,
  add column owner_alert_error text;
