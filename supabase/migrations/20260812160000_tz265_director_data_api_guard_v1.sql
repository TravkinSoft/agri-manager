create or replace function public.enforce_director_read_only_request_v1()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  request_method text := upper(coalesce(current_setting('request.method', true), ''));
begin
  if request_method in ('POST', 'PUT', 'PATCH', 'DELETE')
     and public.is_current_user_director_v1() then
    raise insufficient_privilege using message = 'Director access is read-only';
  end if;
end;
$$;

revoke all on function public.enforce_director_read_only_request_v1() from public;
grant execute on function public.enforce_director_read_only_request_v1() to authenticator;

alter role authenticator
  set pgrst.db_pre_request = 'public.enforce_director_read_only_request_v1';

notify pgrst, 'reload config';
