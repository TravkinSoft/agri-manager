-- Keep canonical warehouse quantity and mass aligned when a single-line
-- weighbridge ticket switches from gross input to its final net quantity.
create or replace function public.finalize_weighbridge_ticket_for_session_v1(
  p_ticket_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_role text;
  v_line_count integer;
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  select p.*
    into v_actor
  from public.profiles p
  where p.id = v_auth_user_id
  limit 1;

  if not found or coalesce(v_actor.status, 'active') <> 'active' then
    raise exception 'Active actor profile not found';
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  v_role := coalesce(v_actor.role, '');
  if v_role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;

  if v_role not in (
    'global_admin', 'admin', 'company_admin', 'director',
    'warehouse', 'warehouse_operator', 'warehouse_manager',
    'weighman', 'weighbridge_operator'
  ) then
    raise exception 'Actor role is not allowed to finalize weighbridge tickets';
  end if;

  select count(*)
    into v_line_count
  from public.ticket_lines tl
  where tl.ticket_id = p_ticket_id;

  if v_line_count = 1
     and coalesce(v_ticket.weigh_method::text, '') <> 'manual_override_with_reason'
     and coalesce(v_ticket.net_weight_kg, 0) > 0
     and exists (
       select 1
       from public.ticket_lines tl
       where tl.ticket_id = p_ticket_id
         and public.canonical_stock_uom(tl.uom) = 'kg'
     ) then
    update public.ticket_lines
    set quantity = v_ticket.net_weight_kg,
        net_line_weight_kg = v_ticket.net_weight_kg,
        mass_kg = v_ticket.net_weight_kg
    where ticket_id = p_ticket_id;
  end if;

  perform public.finalize_weighbridge_ticket_v2(p_ticket_id, v_actor.id);
  perform public.backfill_ticket_operation_line_links_v1(p_ticket_id);
  return p_ticket_id;
end;
$$;

revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from public;
revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from anon;
grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to authenticated;
grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to service_role;
