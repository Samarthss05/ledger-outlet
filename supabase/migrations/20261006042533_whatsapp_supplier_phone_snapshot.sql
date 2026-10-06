-- Keep the reviewed supplier recipient fixed between owner preview and OK.
alter table public.ledger_wa_supplier_orders
  add column recipient_phone_e164 text
  check (recipient_phone_e164 is null or recipient_phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
