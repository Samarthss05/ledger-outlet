-- Supabase's default public-schema privileges can include more than app users need.
revoke all on public.ledger_agent_memories from public, anon, authenticated;
grant select, insert, delete on public.ledger_agent_memories to authenticated;
