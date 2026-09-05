-- Atomic selected-row membership actions. Existing cargo and event history are untouched.
create function public.ptc_set_vehicle_line_v1(
  p_actor uuid, p_company uuid, p_vehicles uuid[], p_assigned boolean, p_expected_revision timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.profiles%rowtype; f public.ptc_flows%rowtype; vid uuid; wanted uuid[]; revision timestamptz;
begin
  select * into a from public.profiles where id=p_actor for share;
  if not found or a.status is distinct from 'active'
    or coalesce(a.role,'') not in ('fleet_manager','agronomist','company_admin','global_admin')
    or (a.role<>'global_admin' and a.company_id is distinct from p_company)
    then raise exception 'PTC_LINE_FORBIDDEN'; end if;
  if p_assigned is null or p_vehicles is null or cardinality(p_vehicles)<1 or cardinality(p_vehicles)>100
    or array_position(p_vehicles,null) is not null then raise exception 'PTC_INVALID_FLEET'; end if;
  select * into f from public.ptc_flows where company_id=p_company for update;
  if not found then
    if p_expected_revision is not null then raise exception 'PTC_LINE_CONFLICT'; end if;
    insert into public.ptc_flows(company_id) values(p_company) on conflict do nothing returning updated_at into revision;
    if not found then raise exception 'PTC_LINE_CONFLICT'; end if;
    select * into f from public.ptc_flows where company_id=p_company for update;
    -- A concurrent first configuration is detected by its state rows.
    if exists(select 1 from public.ptc_vehicle_states where company_id=p_company)
      then raise exception 'PTC_LINE_CONFLICT'; end if;
  elsif f.updated_at is distinct from p_expected_revision then
    raise exception 'PTC_LINE_CONFLICT';
  end if;
  -- Same lock order as loading: flow, repair advisory, vehicle/state. Sort multi-select locks.
  for vid in select distinct unnest(p_vehicles) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('fleet-repair:'||vid::text,0));
    perform 1 from public.reference_vehicles where id=vid and company_id=p_company for share;
    if not found then raise exception 'PTC_COMPANY_MISMATCH'; end if;
    if p_assigned and exists(select 1 from public.fleet_vehicle_repairs
      where company_id=p_company and vehicle_id=vid and in_repair)
      then raise exception 'FLEET_VEHICLE_IN_REPAIR'; end if;
  end loop;
  select coalesce(array_agg(vehicle_id order by vehicle_id),array[]::uuid[]) into wanted
    from public.ptc_vehicle_states where company_id=p_company and assigned
      and (p_assigned or not(vehicle_id=any(p_vehicles)));
  if p_assigned then
    select array_agg(id order by id) into wanted from (select distinct unnest(wanted||p_vehicles) id) all_ids;
  end if;
  perform public.ptc_configure_v1(p_company,case when p_assigned then true else f.enabled end,f.field_id,wanted);
  update public.ptc_flows set updated_at=greatest(clock_timestamp(),f.updated_at+interval '1 microsecond')
    where company_id=p_company returning updated_at into revision;
  return jsonb_build_object('companyId',p_company,'vehicleIds',p_vehicles,'assigned',p_assigned,'flowRevision',revision);
end $$;
revoke all on function public.ptc_set_vehicle_line_v1(uuid,uuid,uuid[],boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.ptc_set_vehicle_line_v1(uuid,uuid,uuid[],boolean,timestamptz) to service_role;
