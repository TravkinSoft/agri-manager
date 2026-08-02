-- Runtime uses the authenticated user JWT. Keep the legacy finalizer private and expose
-- a guarded entrypoint that binds the actor, company and ticket before finalization.

create or replace function public.finalize_weighbridge_ticket_authenticated_v1(
  p_ticket_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  select t.company_id into v_company_id
  from public.tickets t
  where t.id = p_ticket_id
  for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  perform public.assert_operation_mutation_actor_v1(
    v_company_id,
    p_actor_user_id,
    array[
      'global_admin', 'admin', 'company_admin', 'director',
      'warehouse', 'warehouse_operator', 'warehouse_manager',
      'weighman', 'weighbridge_operator'
    ]::text[]
  );

  return public.finalize_weighbridge_ticket_v2(p_ticket_id, p_actor_user_id);
end;
$$;

revoke all on function public.finalize_weighbridge_ticket_authenticated_v1(uuid, uuid)
  from public, anon;
grant execute on function public.finalize_weighbridge_ticket_authenticated_v1(uuid, uuid)
  to authenticated;

comment on function public.finalize_weighbridge_ticket_authenticated_v1(uuid, uuid)
  is 'JWT-bound authenticated entrypoint for the private atomic weighbridge ticket finalizer.';
