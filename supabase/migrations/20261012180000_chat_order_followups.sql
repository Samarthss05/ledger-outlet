-- Keep a short clarification tied to the same review draft and idempotent on retry.
alter table public.ledger_chat_orders
  add column last_followup_request_id uuid;
