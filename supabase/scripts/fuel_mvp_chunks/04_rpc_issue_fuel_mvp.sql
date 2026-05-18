-- 04: RPC issue_fuel_mvp

create or replace function public.issue_fuel_mvp(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_fuel_source_id uuid,
  p_vehicle_id uuid,
  p_mechanizator_id uuid default null,
  p_liters numeric default 0,
  p_issued_at timestamptz default now(),
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_source public.fuel_sources%rowtype;
  v_vehicle public.reference_vehicles%rowtype;
  v_specialist public.reference_specialists%rowtype;
  v_issue_id uuid;
begin
  if p_liters is null or p_liters <= 0 then
    raise exception 'Issued liters must be greater than zero';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_user_id
  limit 1;

  if not found then
    raise exception 'Actor profile not found';
  end if;
  if v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to company';
  end if;
  if coalesce(v_actor.status, 'active') <> 'active' then
    raise exception 'Actor profile is not active';
  end if;
  if coalesce(v_actor.role, '') not in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator') then
    raise exception 'Actor role cannot issue fuel';
  end if;

  select * into v_source
  from public.fuel_sources
  where id = p_fuel_source_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Fuel source not found';
  end if;
  if v_source.archived or not v_source.is_active then
    raise exception 'Fuel source is not active';
  end if;
  if v_source.current_balance_liters < p_liters then
    raise exception 'Insufficient fuel balance. Available %, requested %', v_source.current_balance_liters, p_liters;
  end if;

  select * into v_vehicle
  from public.reference_vehicles
  where id = p_vehicle_id
    and company_id = p_company_id
  limit 1;
  if not found then
    raise exception 'Vehicle not found in company';
  end if;
  if coalesce(v_vehicle.archived, false) then
    raise exception 'Vehicle is archived';
  end if;

  if p_mechanizator_id is not null then
    select * into v_specialist
    from public.reference_specialists
    where id = p_mechanizator_id
      and company_id = p_company_id
    limit 1;
    if not found then
      raise exception 'Mechanizator/responsible person not found in company';
    end if;
    if coalesce(v_specialist.archived, false) then
      raise exception 'Mechanizator/responsible person is archived';
    end if;
  end if;

  insert into public.fuel_issues (
    company_id,
    issued_at,
    fuel_source_id,
    fuel_type,
    vehicle_id,
    mechanizator_id,
    liters,
    comment,
    created_by_user_id
  ) values (
    p_company_id,
    coalesce(p_issued_at, now()),
    p_fuel_source_id,
    v_source.fuel_type,
    p_vehicle_id,
    p_mechanizator_id,
    p_liters,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_actor_user_id
  )
  returning id into v_issue_id;

  update public.fuel_sources
  set
    current_balance_liters = current_balance_liters - p_liters,
    updated_by_user_id = p_actor_user_id,
    updated_at = now()
  where id = p_fuel_source_id;

  return v_issue_id;
end;
$$;
