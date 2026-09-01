begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.resolve_actor_context_from_session_v1()') is null then
    raise exception 'TZ315 requires public.resolve_actor_context_from_session_v1()';
  end if;
  if pg_catalog.to_regprocedure('public.weighbridge_operator_session_state_v1(uuid,text)') is null then
    raise exception 'TZ315 requires public.weighbridge_operator_session_state_v1(uuid,text)';
  end if;
end
$$;

create or replace function public.weighbridge_initial_workspace_v1(
  p_company_id uuid,
  p_session_token text default null,
  p_include_workspace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor record;
  v_effective_role text;
  v_effective_status text;
  v_effective_company_id uuid;
  v_operator_state jsonb;
  v_season public.seasons%rowtype;
  v_fields jsonb := '[]'::jsonb;
  v_destinations jsonb := '[]'::jsonb;
  v_vehicles jsonb := '[]'::jsonb;
  v_people jsonb := '[]'::jsonb;
  v_legacy_drivers jsonb := '[]'::jsonb;
  v_profiles jsonb := '[]'::jsonb;
  v_allocations jsonb := '[]'::jsonb;
begin
  if p_company_id is null then
    raise exception 'Company is required' using errcode = '22023';
  end if;

  select * into v_actor
  from public.resolve_actor_context_from_session_v1()
  limit 1;

  if not found then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;

  if v_actor.impersonated_profile_id is not null then
    v_effective_role := v_actor.impersonated_role;
    v_effective_status := v_actor.impersonated_status;
    v_effective_company_id := v_actor.impersonated_company_id;
  else
    v_effective_role := v_actor.role;
    v_effective_status := v_actor.status;
    v_effective_company_id := v_actor.company_id;
  end if;

  if coalesce(v_effective_status, 'active') <> 'active'
     or v_effective_role not in (
       'global_admin', 'company_admin', 'director', 'weighman',
       'weighbridge_operator', 'agronomist', 'warehouse',
       'warehouse_operator', 'specialist'
     ) then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;

  if v_actor.impersonated_profile_id is not null then
    if v_effective_company_id is distinct from p_company_id then
      raise exception 'Cross-company access denied' using errcode = '42501';
    end if;
  elsif v_actor.role = 'global_admin' then
    if v_actor.context_company_id is distinct from p_company_id then
      raise exception 'Selected company does not match global admin context' using errcode = '42501';
    end if;
  elsif v_effective_company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;

  v_operator_state := public.weighbridge_operator_session_state_v1(
    p_company_id,
    nullif(p_session_token, '')
  );

  if not coalesce((v_operator_state ->> 'unlocked')::boolean, false)
     or not coalesce(p_include_workspace, false) then
    return jsonb_build_object(
      'operator_state', v_operator_state,
      'initial_workspace', null
    );
  end if;

  select s.* into v_season
  from public.seasons s
  where s.company_id = p_company_id
    and coalesce(s.archived, false) = false
  order by
    case when s.year = extract(year from timezone('Asia/Almaty', now()))::integer then 0 else 1 end,
    s.year desc,
    s.id
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'name', f.name,
    'area', coalesce(f.area, 0),
    'fieldCode', f.field_code
  ) order by f.name, f.id), '[]'::jsonb)
  into v_fields
  from public.fields f
  where f.company_id = p_company_id
    and coalesce(f.archived, false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id,
    'name', w.name,
    'name_ru', w.name_ru,
    'name_kz', w.name_kz,
    'name_en', w.name_en,
    'warehouseType', w.warehouse_type,
    'placeType', coalesce(w.place_type, 'WAREHOUSE')
  ) order by w.name, w.id), '[]'::jsonb)
  into v_destinations
  from public.warehouses w
  where w.company_id = p_company_id
    and coalesce(w.archived, false) = false
    and coalesce(w.is_archived, false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rv.id,
    'name', rv.name,
    'custom_name', rv.custom_name,
    'full_name', rv.full_name,
    'brand', rv.brand,
    'model', rv.model,
    'series', rv.series,
    'plate_number', rv.plate_number,
    'license_plate', rv.license_plate,
    'source_raw_name', rv.source_raw_name,
    'type', rv.type,
    'fleet_type', rv.fleet_type,
    'primary_responsible_personnel_id', rv.primary_responsible_personnel_id,
    'transport_model', case when tm.id is null then null else jsonb_build_object(
      'full_name', tm.full_name,
      'category', tm.category
    ) end
  ) order by rv.name, rv.id), '[]'::jsonb)
  into v_vehicles
  from public.reference_vehicles rv
  left join public.transport_models tm on tm.id = rv.transport_model_id
  where rv.company_id = p_company_id
    and coalesce(rv.is_active, false) = true
    and coalesce(rv.archived, false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cp.id,
    'full_name', cp.full_name,
    'role_type', cp.role_type,
    'position', cp.position,
    'department', cp.department,
    'status', cp.status,
    'deleted_at', cp.deleted_at
  ) order by cp.full_name, cp.id), '[]'::jsonb)
  into v_people
  from public.company_people cp
  where cp.company_id = p_company_id
    and cp.status = 'active'
    and cp.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rs.id,
    'person_id', rs.person_id,
    'full_name', rs.full_name,
    'name_ru', rs.name_ru,
    'name_kz', rs.name_kz,
    'name_en', rs.name_en
  ) order by coalesce(rs.name_ru, rs.full_name, rs.name_en, rs.name_kz), rs.id), '[]'::jsonb)
  into v_legacy_drivers
  from public.reference_specialists rs
  where rs.company_id = p_company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'email', p.email
  ) order by coalesce(p.full_name, p.email), p.id), '[]'::jsonb)
  into v_profiles
  from public.profiles p
  where p.company_id = p_company_id;

  if v_season.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'fieldId', ranked.field_id,
      'allocationId', ranked.id,
      'areaHa', coalesce(ranked.area, 0),
      'cropId', ranked.crop_id,
      'cropName', coalesce(ranked.crop_name_ru, ranked.crop_name, ''),
      'cropSlug', coalesce(ranked.crop_slug, ''),
      'cropCategorySlug', coalesce(ranked.category_slug, ''),
      'cropCategoryName', coalesce(ranked.category_name_ru, ''),
      'cropSubcategory', coalesce(ranked.crop_subcategory, ranked.crop_subcategory_legacy, ''),
      'varietyId', ranked.variety_id,
      'varietyName', coalesce(ranked.variety_name, ranked.variety_name_ru, ''),
      'reproductionId', ranked.reproduction_id,
      'reproductionName', coalesce(ranked.reproduction_name_ru, ranked.reproduction_name, ranked.reproduction_code, ''),
      'allocationCode', upper(left(ranked.id::text, 8)),
      'plotOrdinal', ranked.plot_ordinal,
      'plotCount', ranked.plot_count,
      'plotLabel', 'Посевная строка №' || ranked.plot_ordinal::text,
      'notes', coalesce(ranked.notes, ''),
      'isIncomplete', (
        ranked.variety_id is null
        or ranked.reproduction_id is null
        or ranked.variety_ref_id is null
        or ranked.reproduction_ref_id is null
      ),
      'debug', jsonb_build_object(
        'cropId', ranked.crop_id,
        'varietyId', ranked.variety_id,
        'reproductionId', ranked.reproduction_id,
        'hasVarietyRef', ranked.variety_ref_id is not null,
        'hasReproductionRef', ranked.reproduction_ref_id is not null
      )
    ) order by ranked.field_id, ranked.plot_ordinal), '[]'::jsonb)
    into v_allocations
    from (
      select
        cs.id,
        cs.field_id,
        cs.area,
        cs.notes,
        cs.crop_id,
        cs.variety_id,
        cs.reproduction_id,
        c.name as crop_name,
        c.name_ru as crop_name_ru,
        c.slug as crop_slug,
        c.subcategory as crop_subcategory,
        c.crop_subcategory as crop_subcategory_legacy,
        cc.slug as category_slug,
        cc.name_ru as category_name_ru,
        v.id as variety_ref_id,
        v.name as variety_name,
        v.name_ru as variety_name_ru,
        sr.id as reproduction_ref_id,
        sr.name as reproduction_name,
        sr.name_ru as reproduction_name_ru,
        sr.code as reproduction_code,
        row_number() over (partition by cs.field_id order by cs.id)::integer as plot_ordinal,
        count(*) over (partition by cs.field_id)::integer as plot_count
      from public.crop_structure cs
      join public.crops c on c.id = cs.crop_id
      left join public.crop_categories cc on cc.id = c.category_id
      left join public.varieties v on v.id = cs.variety_id
      left join public.seed_reproductions sr on sr.id = cs.reproduction_id
      where cs.company_id = p_company_id
        and cs.season_id = v_season.id
        and cs.land_use_type = 'crop'
        and cs.crop_id is not null
        and coalesce(cs.archived, false) = false
    ) ranked;
  end if;

  return jsonb_build_object(
    'operator_state', v_operator_state,
    'initial_workspace', jsonb_build_object(
      'seasonId', v_season.id,
      'seasonYear', v_season.year,
      'fields', v_fields,
      'destinations', v_destinations,
      'vehicles', v_vehicles,
      'people', v_people,
      'legacyDrivers', v_legacy_drivers,
      'profiles', v_profiles,
      'allocations', v_allocations
    )
  );
end
$function$;

revoke all on function public.weighbridge_initial_workspace_v1(uuid, text, boolean) from public, anon;
grant execute on function public.weighbridge_initial_workspace_v1(uuid, text, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
