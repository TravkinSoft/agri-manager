create or replace function public.void_finalized_weighbridge_ticket_for_session_v1(
  p_ticket_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  return public.void_ticket_with_storno_v2(
    p_ticket_id,
    v_auth_user_id,
    p_reason
  );
end;
$$;

revoke all on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid, text) from public;
revoke all on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid, text) from anon;
grant execute on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid, text) to authenticated;
grant execute on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid, text) to service_role;
