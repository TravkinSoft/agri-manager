create or replace function public.finalize_batch_transformation_for_session_v1(
  p_transformation_id uuid
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

  return public.finalize_batch_transformation(p_transformation_id, v_auth_user_id);
end;
$$;

revoke all on function public.finalize_batch_transformation_for_session_v1(uuid) from public;
revoke all on function public.finalize_batch_transformation_for_session_v1(uuid) from anon;
grant execute on function public.finalize_batch_transformation_for_session_v1(uuid) to authenticated;
grant execute on function public.finalize_batch_transformation_for_session_v1(uuid) to service_role;
