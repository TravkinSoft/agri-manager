-- 05: RPC transfer_fuel_mvp

create or replace function public.transfer_fuel_mvp(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_from_fuel_source_id uuid,
  p_to_fuel_source_id uuid,
  p_liters numeric default 0,
  p_transferred_at timestamptz default now(),
  p_operator_personnel_id uuid default null,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_from public.fuel_sources%rowtype;
  v_to public.fuel_sources%rowtype;
  v_specialist public.reference_specialists%rowtype;
  v_transfer_id uuid;
begin
  if p_from_fuel_source_id = p_to_fuel_source_id then
    raise exception 'Source and destination fuel sources must be different';
  end if;
  if p_liters is null or p_liters <= 0 then
    raise exception 'Transfer liters must be greater than zero';
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
    raise exception 'Actor role cannot transfer fuel';
  end if;

  select * into v_from
  from public.fuel_sources
  where id = p_from_fuel_source_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Source fuel tank not found';
  end if;

  select * into v_to
  from public.fuel_sources
  where id = p_to_fuel_source_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Destination fuel tank not found';
  end if;

  if v_from.archived or not v_from.is_active then
    raise exception 'Source fuel tank is not active';
  end if;
  if v_to.archived or not v_to.is_active then
    raise exception 'Destination fuel tank is not active';
  end if;
  if v_from.fuel_type <> v_to.fuel_type then
    raise exception 'Fuel type mismatch between tanks (% vs %)', v_from.fuel_type, v_to.fuel_type;
  end if;
  if v_from.current_balance_liters < p_liters then
    raise exception 'Insufficient source balance. Available %, requested %', v_from.current_balance_liters, p_liters;
  end if;

  if p_operator_personnel_id is not null then
    select * into v_specialist
    from public.reference_specialists
    where id = p_operator_personnel_id
      and company_id = p_company_id
    limit 1;
    if not found then
      raise exception 'Operator person not found in company';
    end if;
    if coalesce(v_specialist.archived, false) then
      raise exception 'Operator person is archived';
    end if;
  end if;

  insert into public.fuel_transfers (
    company_id,
    transferred_at,
    from_fuel_source_id,
    to_fuel_source_id,
    fuel_type,
    liters,
    operator_personnel_id,
    comment,
    created_by_user_id
  ) values (
    p_company_id,
    coalesce(p_transferred_at, now()),
    p_from_fuel_source_id,
    p_to_fuel_source_id,
    v_from.fuel_type,
    p_liters,
    p_operator_personnel_id,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_actor_user_id
  )
  returning id into v_transfer_id;

  update public.fuel_sources
  set
    current_balance_liters = current_balance_liters - p_liters,
    updated_by_user_id = p_actor_user_id,
    updated_at = now()
  where id = p_from_fuel_source_id;

  update public.fuel_sources
  set
    current_balance_liters = current_balance_liters + p_liters,
    updated_by_user_id = p_actor_user_id,
    updated_at = now()
  where id = p_to_fuel_source_id;

  return v_transfer_id;
end;
$$;
