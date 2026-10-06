-- Explicitly deny browser reads even if someone grants table privileges later.
create policy ledger_wa_inbox_no_browser on public.ledger_wa_inbox
for select to authenticated using (false);
