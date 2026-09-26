-- Cover composite foreign keys used by deletion checks and tenant-specific joins.
create index ledger_ai_usage_user_idx on public.ledger_ai_usage(user_id);
create index ledger_delivery_lines_delivery_supplier_idx on public.ledger_delivery_lines(account_id, delivery_id, supplier_id);
create index ledger_delivery_lines_item_supplier_idx on public.ledger_delivery_lines(account_id, item_id, supplier_id);
create index ledger_order_drafts_supplier_idx on public.ledger_order_drafts(account_id, supplier_id);
