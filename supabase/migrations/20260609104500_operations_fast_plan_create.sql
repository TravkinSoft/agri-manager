begin;

create or replace function public.create_operation_plan_fast_v1(
  p_company_id uuid,
  p_field_id uuid,
  p_crop_structure_id uuid,
  p_operation_category_slug text,
  p_operation_type_slug text,
  p_operation_type text,
  p_operation_config jsonb,
  p_operation_date date,
  p_responsible_user_id uuid default null,
  p_notes text default null,
  p_user_id uuid default null,
  p_idempotency_key text default null,
  p_request_fingerprint text default null,
  p_planned_area_ha numeric default null
)
returns table (
  operation_row jsonb,
  operation_line_row jsonb,
  idempotent_replay boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.operations%rowtype;
  v_operation public.operations%rowtype;
  v_line public.operation_lines%rowtype;
  v_structure public.crop_structure%rowtype;
  v_effective_area numeric;
  v_existing_fingerprint text;
  v_operation_config jsonb;
  v_season_year integer;
begin
  if p_idempotency_key is not null then
    select *
      into v_existing
    from public.operations
    where company_id = p_company_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if found then
      v_existing_fingerprint := coalesce(
        v_existing.request_fingerprint,
        v_existing.operation_config ->> 'request_fingerprint'
      );
      if v_existing_fingerprint is not null
         and p_request_fingerprint is not null
         and v_existing_fingerprint <> p_request_fingerprint then
        raise exception 'Idempotency-Key was already used with a different operation payload';
      end if;

      select *
        into v_line
      from public.operation_lines
      where operation_id = v_existing.id
      order by created_at asc
      limit 1;

      operation_row := to_jsonb(v_existing);
      operation_line_row := case when v_line.id is null then null else to_jsonb(v_line) end;
      idempotent_replay := true;
      return next;
      return;
    end if;
  end if;

  select *
    into v_structure
  from public.crop_structure
  where id = p_crop_structure_id
    and company_id = p_company_id
    and archived = false
  limit 1;

  if not found then
    raise exception 'crop_structure_id does not belong to this company';
  end if;
  if v_structure.field_id <> p_field_id then
    raise exception 'crop_structure_id must belong to selected field';
  end if;

  v_effective_area := coalesce(nullif(p_planned_area_ha, 0), v_structure.area, 0);
  select s.year
    into v_season_year
  from public.seasons s
  where s.id = v_structure.season_id
  limit 1;

  v_operation_config := coalesce(p_operation_config, '{}'::jsonb) || jsonb_build_object(
    'planned_area_ha', v_effective_area,
    'crop_id', v_structure.crop_id,
    'variety_id', v_structure.variety_id,
    'reproduction_id', v_structure.reproduction_id,
    'season_id', v_structure.season_id,
    'season_year', v_season_year
  );

  begin
    insert into public.operations (
      company_id,
      field_id,
      crop_structure_id,
      operation_category_slug,
      operation_type_slug,
      operation_type,
      operation_config,
      date,
      responsible_user_id,
      notes,
      status,
      work_status,
      user_id,
      idempotency_key,
      request_fingerprint
    )
    values (
      p_company_id,
      p_field_id,
      p_crop_structure_id,
      p_operation_category_slug,
      p_operation_type_slug,
      p_operation_type,
      v_operation_config,
      p_operation_date,
      p_responsible_user_id,
      p_notes,
      'planned',
      'active',
      p_user_id,
      p_idempotency_key,
      p_request_fingerprint
    )
    returning * into v_operation;
  exception
    when unique_violation then
      select *
        into v_existing
      from public.operations
      where company_id = p_company_id
        and idempotency_key = p_idempotency_key
      limit 1;

      if not found then
        raise;
      end if;

      v_existing_fingerprint := coalesce(
        v_existing.request_fingerprint,
        v_existing.operation_config ->> 'request_fingerprint'
      );
      if v_existing_fingerprint is not null
         and p_request_fingerprint is not null
         and v_existing_fingerprint <> p_request_fingerprint then
        raise exception 'Idempotency-Key was already used with a different operation payload';
      end if;

      select *
        into v_line
      from public.operation_lines
      where operation_id = v_existing.id
      order by created_at asc
      limit 1;

      operation_row := to_jsonb(v_existing);
      operation_line_row := case when v_line.id is null then null else to_jsonb(v_line) end;
      idempotent_replay := true;
      return next;
      return;
  end;

  insert into public.operation_lines (
    company_id,
    operation_id,
    field_id,
    crop_id,
    variety_id,
    reproduction_id,
    planned_area_ha,
    actual_area_ha,
    notes,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    p_company_id,
    v_operation.id,
    p_field_id,
    v_structure.crop_id,
    v_structure.variety_id,
    v_structure.reproduction_id,
    v_effective_area,
    null,
    'Auto-created from operation crop structure',
    p_user_id,
    p_user_id
  )
  returning * into v_line;

  operation_row := to_jsonb(v_operation);
  operation_line_row := to_jsonb(v_line);
  idempotent_replay := false;
  return next;
end;
$$;

grant execute on function public.create_operation_plan_fast_v1(
  uuid, uuid, uuid, text, text, text, jsonb, date, uuid, text, uuid, text, text, numeric
) to authenticated;
grant execute on function public.create_operation_plan_fast_v1(
  uuid, uuid, uuid, text, text, text, jsonb, date, uuid, text, uuid, text, text, numeric
) to service_role;

commit;

notify pgrst, 'reload schema';
