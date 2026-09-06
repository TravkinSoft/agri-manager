-- PTC management belongs exclusively to the active fleet manager.
-- Keep the existing, already deployed implementations intact (including
-- notifications and idempotency) behind role-checking public wrappers.
create schema if not exists private;
grant usage on schema private to service_role;

alter function public.fleet_set_vehicle_repair_v1(uuid, uuid, uuid, boolean, integer)
  set schema private;
alter function private.fleet_set_vehicle_repair_v1(uuid, uuid, uuid, boolean, integer)
  rename to fleet_set_vehicle_repair_internal_v1;

create function public.fleet_set_vehicle_repair_v1(
  p_actor uuid,
  p_company uuid,
  p_vehicle uuid,
  p_in_repair boolean,
  p_expected_version integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_profile public.profiles%rowtype;
begin
  select * into actor_profile
  from public.profiles
  where id = p_actor
  for share;

  if not found
     or actor_profile.status is distinct from 'active'
     or coalesce(actor_profile.role, '') <> 'fleet_manager'
     or actor_profile.company_id is distinct from p_company then
    raise exception 'FLEET_REPAIR_FORBIDDEN';
  end if;

  return private.fleet_set_vehicle_repair_internal_v1(
    p_actor,
    p_company,
    p_vehicle,
    p_in_repair,
    p_expected_version
  );
end;
$$;

revoke all on function private.fleet_set_vehicle_repair_internal_v1(
  uuid, uuid, uuid, boolean, integer
) from public, anon, authenticated;
grant execute on function private.fleet_set_vehicle_repair_internal_v1(
  uuid, uuid, uuid, boolean, integer
) to service_role;
revoke all on function public.fleet_set_vehicle_repair_v1(
  uuid, uuid, uuid, boolean, integer
) from public, anon, authenticated;
grant execute on function public.fleet_set_vehicle_repair_v1(
  uuid, uuid, uuid, boolean, integer
) to service_role;

alter function public.ptc_set_vehicle_line_v1(uuid, uuid, uuid[], boolean, timestamptz)
  set schema private;
alter function private.ptc_set_vehicle_line_v1(uuid, uuid, uuid[], boolean, timestamptz)
  rename to ptc_set_vehicle_line_internal_v1;

create function public.ptc_set_vehicle_line_v1(
  p_actor uuid,
  p_company uuid,
  p_vehicles uuid[],
  p_assigned boolean,
  p_expected_revision timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_profile public.profiles%rowtype;
begin
  select * into actor_profile
  from public.profiles
  where id = p_actor
  for share;

  if not found
     or actor_profile.status is distinct from 'active'
     or coalesce(actor_profile.role, '') <> 'fleet_manager'
     or actor_profile.company_id is distinct from p_company then
    raise exception 'PTC_LINE_FORBIDDEN';
  end if;

  return private.ptc_set_vehicle_line_internal_v1(
    p_actor,
    p_company,
    p_vehicles,
    p_assigned,
    p_expected_revision
  );
end;
$$;

revoke all on function private.ptc_set_vehicle_line_internal_v1(
  uuid, uuid, uuid[], boolean, timestamptz
) from public, anon, authenticated;
grant execute on function private.ptc_set_vehicle_line_internal_v1(
  uuid, uuid, uuid[], boolean, timestamptz
) to service_role;
revoke all on function public.ptc_set_vehicle_line_v1(
  uuid, uuid, uuid[], boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.ptc_set_vehicle_line_v1(
  uuid, uuid, uuid[], boolean, timestamptz
) to service_role;
