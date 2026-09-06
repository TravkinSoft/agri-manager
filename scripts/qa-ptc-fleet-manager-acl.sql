do $contract$
declare
  fleet_actor public.profiles%rowtype;
  denied_actor public.profiles%rowtype;
  failure_message text;
begin
  select * into fleet_actor
  from public.profiles
  where status = 'active' and lower(role) = 'fleet_manager'
  order by id
  limit 1;
  if not found then
    raise exception 'CONTRACT_SETUP_NO_FLEET_MANAGER';
  end if;

  for denied_actor in
    select *
    from public.profiles
    where status = 'active'
      and lower(role) in ('agronomist', 'company_admin', 'global_admin')
    order by role, id
  loop
    begin
      perform public.ptc_set_vehicle_line_v1(
        denied_actor.id,
        coalesce(denied_actor.company_id, fleet_actor.company_id),
        null,
        true,
        null
      );
      raise exception 'CONTRACT_LINE_ROLE_BYPASS:%', denied_actor.role;
    exception when others then
      get stacked diagnostics failure_message = message_text;
      if position('PTC_LINE_FORBIDDEN' in failure_message) = 0 then
        raise;
      end if;
    end;

    begin
      perform public.fleet_set_vehicle_repair_v1(
        denied_actor.id,
        coalesce(denied_actor.company_id, fleet_actor.company_id),
        gen_random_uuid(),
        null,
        0
      );
      raise exception 'CONTRACT_REPAIR_ROLE_BYPASS:%', denied_actor.role;
    exception when others then
      get stacked diagnostics failure_message = message_text;
      if position('FLEET_REPAIR_FORBIDDEN' in failure_message) = 0 then
        raise;
      end if;
    end;
  end loop;

  begin
    perform public.ptc_set_vehicle_line_v1(
      fleet_actor.id,
      fleet_actor.company_id,
      null,
      true,
      null
    );
    raise exception 'CONTRACT_LINE_VALIDATION_MISSING';
  exception when others then
    get stacked diagnostics failure_message = message_text;
    if position('PTC_INVALID_FLEET' in failure_message) = 0 then
      raise;
    end if;
  end;

  begin
    perform public.fleet_set_vehicle_repair_v1(
      fleet_actor.id,
      fleet_actor.company_id,
      gen_random_uuid(),
      null,
      0
    );
    raise exception 'CONTRACT_REPAIR_VALIDATION_MISSING';
  exception when others then
    get stacked diagnostics failure_message = message_text;
    if position('FLEET_REPAIR_INVALID' in failure_message) = 0 then
      raise;
    end if;
  end;
end;
$contract$;

select 'PTC fleet-manager-only ACL PASS' as result;
