-- TZ315: make the reversal receipt read-only outside its canonical
-- SECURITY DEFINER RPC. Re-running these ACL statements is safe.
revoke all privileges
  on table public.batch_processing_reversals
  from public, anon, authenticated, service_role;

grant select
  on table public.batch_processing_reversals
  to authenticated, service_role;
