insert into public.seed_reproductions (
  name,
  name_ru,
  name_en,
  code,
  level_order,
  description,
  company_id,
  archived,
  is_active
)
select
  'F1',
  'F1',
  'F1 Hybrid',
  'F1',
  90,
  'Гибрид первого поколения',
  null,
  false,
  true
where not exists (
  select 1
  from public.seed_reproductions sr
  where sr.company_id is null
    and coalesce(sr.archived, false) = false
    and lower(coalesce(nullif(sr.code, ''), sr.name)) = 'f1'
);

create or replace function public.save_crop_structure_field_v5(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_actor_auth_user_id uuid,
  p_field_id uuid,
  p_season_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field public.fields%rowtype;
  v_row jsonb;
  v_component jsonb;
  v_existing public.crop_structure%rowtype;
  v_row_id uuid;
  v_land_use_type text;
  v_area numeric;
  v_total_area numeric;
  v_component_count integer;
  v_current_component_count integer;
  v_structure_changed boolean;
  v_components_changed boolean;
  v_result jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'rows must be an array with at most 100 items' using errcode = '22023';
  end if;

  select f.* into v_field
  from public.fields f
  where f.id = p_field_id and f.company_id = p_company_id and coalesce(f.archived, false) = false
  for update;
  if not found then
    raise exception 'Field is not available' using errcode = '23503';
  end if;

  perform 1 from public.seasons s
  where s.id = p_season_id and s.company_id = p_company_id and coalesce(s.archived, false) = false
  for share;
  if not found then
    raise exception 'Closed season is read-only' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) a
    where nullif(a ->> 'id', '') is not null
    group by a ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'Duplicate crop structure row id is not allowed' using errcode = '23505';
  end if;

  select coalesce(sum((r ->> 'area')::numeric), 0) into v_total_area
  from jsonb_array_elements(p_rows) r;
  if v_total_area > v_field.area + 0.0001 then
    raise exception 'Total crop structure area exceeds field area' using errcode = '23514';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_land_use_type := lower(coalesce(nullif(v_row ->> 'land_use_type', ''), 'crop'));
    v_area := nullif(v_row ->> 'area', '')::numeric;
    if v_land_use_type not in ('crop', 'crop_mix', 'fallow') then
      raise exception 'Unsupported land_use_type' using errcode = '22023';
    end if;
    if v_area is null or v_area <= 0 then
      raise exception 'Crop structure area must be positive' using errcode = '23514';
    end if;

    if v_land_use_type = 'crop' then
      if nullif(v_row ->> 'crop_id', '') is null then
        raise exception 'Crop row requires crop and area' using errcode = '23514';
      end if;
      if nullif(v_row ->> 'variety_id', '') is not null and not exists (
        select 1 from public.varieties v
        where v.id = (v_row ->> 'variety_id')::uuid
          and v.crop_id = (v_row ->> 'crop_id')::uuid
          and coalesce(v.archived, false) = false
          and coalesce(v.is_active, true) = true
          and (v.company_id is null or v.company_id = p_company_id)
      ) then
        raise exception 'Selected variety does not belong to the crop' using errcode = '23514';
      end if;
    elsif nullif(v_row ->> 'crop_id', '') is not null
       or nullif(v_row ->> 'variety_id', '') is not null
       or nullif(v_row ->> 'reproduction_id', '') is not null then
      raise exception 'Crop mix and fallow roots cannot contain crop identity' using errcode = '23514';
    end if;

    v_component_count := jsonb_array_length(coalesce(v_row -> 'mix_components', '[]'::jsonb));
    if v_land_use_type = 'crop_mix' and (v_component_count < 2 or v_component_count > 10) then
      raise exception 'Crop mix requires between 2 and 10 components' using errcode = '23514';
    end if;
    if v_land_use_type <> 'crop_mix' and v_component_count <> 0 then
      raise exception 'Only crop_mix rows may contain mix components' using errcode = '23514';
    end if;

    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      where nullif(c ->> 'crop_id', '') is null
         or nullif(c ->> 'variety_id', '') is null
         or nullif(c ->> 'reproduction_id', '') is null
         or coalesce(nullif(c ->> 'seed_rate_kg_ha', '')::numeric, 0) <= 0
    ) then
      raise exception 'Every crop mix component requires crop, variety, reproduction and positive rate'
        using errcode = '23514';
    end if;
    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      left join public.varieties v on v.id = (c ->> 'variety_id')::uuid
      where v.id is null
         or v.crop_id <> (c ->> 'crop_id')::uuid
         or coalesce(v.archived, false)
         or not coalesce(v.is_active, true)
         or (v.company_id is not null and v.company_id <> p_company_id)
    ) then
      raise exception 'Crop mix variety does not belong to its crop' using errcode = '23514';
    end if;
    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      group by c ->> 'crop_id', c ->> 'variety_id', c ->> 'reproduction_id'
      having count(*) > 1
    ) then
      raise exception 'Exact duplicate crop mix component is not allowed' using errcode = '23505';
    end if;

    v_row_id := coalesce(nullif(v_row ->> 'id', '')::uuid, gen_random_uuid());
    select cs.* into v_existing
    from public.crop_structure cs
    where cs.id = v_row_id
    for update;

    if found and (
      v_existing.company_id is distinct from p_company_id
      or v_existing.field_id <> p_field_id
      or v_existing.season_id <> p_season_id
    ) then
      raise exception 'Crop structure row belongs to another scope' using errcode = '42501';
    end if;

    v_structure_changed := found and (
      v_existing.land_use_type is distinct from v_land_use_type
      or v_existing.crop_id is distinct from nullif(v_row ->> 'crop_id', '')::uuid
      or v_existing.variety_id is distinct from nullif(v_row ->> 'variety_id', '')::uuid
      or v_existing.reproduction_id is distinct from nullif(v_row ->> 'reproduction_id', '')::uuid
      or v_existing.area is distinct from v_area
    );
    select count(*) into v_current_component_count
    from public.crop_structure_mix_components mc
    where mc.crop_structure_id = v_row_id;
    v_components_changed := v_current_component_count <> v_component_count;
    if not v_components_changed and v_land_use_type = 'crop_mix' then
      v_components_changed := exists (
        select 1
        from jsonb_array_elements(v_row -> 'mix_components') with ordinality c(value, ordinality)
        where not exists (
          select 1 from public.crop_structure_mix_components mc
          where mc.crop_structure_id = v_row_id
            and mc.crop_id = (c.value ->> 'crop_id')::uuid
            and mc.variety_id = (c.value ->> 'variety_id')::uuid
            and mc.reproduction_id = (c.value ->> 'reproduction_id')::uuid
            and mc.seed_rate_kg_ha = (c.value ->> 'seed_rate_kg_ha')::numeric
            and mc.sort_order = c.ordinality
        )
      );
    end if;

    if found and (v_structure_changed or v_components_changed) and exists (
      select 1 from public.operations o
      where o.company_id = p_company_id and o.crop_structure_id = v_row_id and coalesce(o.archived, false) = false
    ) then
      raise exception 'Crop mix composition is locked after operation creation' using errcode = '23514';
    end if;

    insert into public.crop_structure (
      id, company_id, user_id, field_id, season_id, land_use_type,
      crop_id, variety_id, reproduction_id, notes, area, status, archived,
      irrigation_type, row_spacing_m, seed_spacing_cm, updated_at
    ) values (
      v_row_id, p_company_id, p_actor_auth_user_id, p_field_id, p_season_id, v_land_use_type,
      nullif(v_row ->> 'crop_id', '')::uuid,
      nullif(v_row ->> 'variety_id', '')::uuid,
      nullif(v_row ->> 'reproduction_id', '')::uuid,
      nullif(v_row ->> 'notes', ''), v_area, 'planned', false,
      coalesce(nullif(v_row ->> 'irrigation_type', ''), 'unknown'),
      nullif(v_row ->> 'row_spacing_m', '')::numeric,
      nullif(v_row ->> 'seed_spacing_cm', '')::numeric,
      now()
    )
    on conflict (id) do update set
      land_use_type = excluded.land_use_type,
      crop_id = excluded.crop_id,
      variety_id = excluded.variety_id,
      reproduction_id = excluded.reproduction_id,
      notes = excluded.notes,
      area = excluded.area,
      irrigation_type = excluded.irrigation_type,
      row_spacing_m = excluded.row_spacing_m,
      seed_spacing_cm = excluded.seed_spacing_cm,
      updated_at = now();

    if v_components_changed then
      delete from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_row_id and mc.company_id = p_company_id;
      if v_land_use_type = 'crop_mix' then
        for v_component in
          select value || jsonb_build_object('sort_order', ordinality)
          from jsonb_array_elements(v_row -> 'mix_components') with ordinality
        loop
          insert into public.crop_structure_mix_components (
            company_id, crop_structure_id, crop_id, variety_id, reproduction_id,
            seed_rate_kg_ha, sort_order
          ) values (
            p_company_id, v_row_id,
            (v_component ->> 'crop_id')::uuid,
            (v_component ->> 'variety_id')::uuid,
            (v_component ->> 'reproduction_id')::uuid,
            (v_component ->> 'seed_rate_kg_ha')::numeric,
            (v_component ->> 'sort_order')::smallint
          );
        end loop;
      end if;
    end if;
  end loop;

  if exists (
    select 1 from public.crop_structure cs
    where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
      and coalesce(cs.archived, false) = false
      and not exists (
        select 1 from jsonb_array_elements(p_rows) r
        where nullif(r ->> 'id', '')::uuid = cs.id
      )
      and (
        exists (select 1 from public.operations o where o.crop_structure_id = cs.id and coalesce(o.archived, false) = false)
        or exists (select 1 from public.field_material_consumptions fmc where fmc.crop_structure_row_id = cs.id)
      )
  ) then
    raise exception 'Crop structure row with operations or materials cannot be deleted' using errcode = '23514';
  end if;

  delete from public.crop_structure cs
  where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
    and coalesce(cs.archived, false) = false
    and not exists (
      select 1 from jsonb_array_elements(p_rows) r
      where nullif(r ->> 'id', '')::uuid = cs.id
    );

  select coalesce(jsonb_agg(row_payload order by row_payload ->> 'id'), '[]'::jsonb)
    into v_result
  from (
    select to_jsonb(cs) || jsonb_build_object(
      'mix_components', coalesce((
        select jsonb_agg(to_jsonb(mc) order by mc.sort_order)
        from public.crop_structure_mix_components mc
        where mc.crop_structure_id = cs.id
      ), '[]'::jsonb)
    ) as row_payload
    from public.crop_structure cs
    where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
      and coalesce(cs.archived, false) = false
  ) rows;

  return jsonb_build_object('companyId', p_company_id, 'fieldId', p_field_id, 'seasonId', p_season_id, 'rows', v_result);
end;
$$;

revoke all on function public.save_crop_structure_field_v5(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_crop_structure_field_v5(uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated, service_role;
