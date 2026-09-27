-- A file digest and row index make repeated CSV uploads safe to retry.
alter table public.ledger_usage_records add column external_ref text;
alter table public.ledger_usage_records add constraint ledger_usage_external_ref_unique unique (account_id, external_ref);
alter table public.ledger_supplier_quotes add column external_ref text;
alter table public.ledger_supplier_quotes add constraint ledger_quotes_external_ref_unique unique (account_id, external_ref);
