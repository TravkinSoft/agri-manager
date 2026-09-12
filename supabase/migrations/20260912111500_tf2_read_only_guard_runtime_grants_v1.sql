begin;

-- PostgREST invokes db_pre_request after switching into the request JWT role.
-- The guard itself exposes no data and only rejects writes for read-only roles.
revoke execute on function public.enforce_read_only_cabinet_request_v1()
  from public;
grant execute on function public.enforce_read_only_cabinet_request_v1()
  to anon, authenticated, service_role, authenticator;

commit;
