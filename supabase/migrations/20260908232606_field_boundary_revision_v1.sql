begin;

-- Boundary and import writes are server-only. The original MVP policies let
-- every authenticated member of the company mutate these tables directly,
-- bypassing the global-admin API gate.
drop policy if exists "Users can insert company field map imports" on public.field_map_imports;
drop policy if exists "Users can update company field map imports" on public.field_map_imports;
drop policy if exists "Users can delete company field map imports" on public.field_map_imports;
drop policy if exists "Users can insert company field geometries" on public.field_geometries;
drop policy if exists "Users can update company field geometries" on public.field_geometries;
drop policy if exists "Users can delete company field geometries" on public.field_geometries;

revoke insert, update, delete on table public.field_map_imports from public, anon, authenticated;
revoke insert, update, delete on table public.field_geometries from public, anon, authenticated;
grant select, insert, update, delete on table public.field_map_imports to service_role;
grant select, insert, update, delete on table public.field_geometries to service_role;

-- Fail the migration instead of silently leaving a direct-write bypass behind.
-- These checks include privileges inherited through PUBLIC or another role.
do $$
begin
  if pg_catalog.has_table_privilege('anon', 'public.field_map_imports', 'INSERT')
    or pg_catalog.has_table_privilege('anon', 'public.field_map_imports', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.field_map_imports', 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', 'public.field_map_imports', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.field_map_imports', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.field_map_imports', 'DELETE')
    or pg_catalog.has_table_privilege('anon', 'public.field_geometries', 'INSERT')
    or pg_catalog.has_table_privilege('anon', 'public.field_geometries', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.field_geometries', 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', 'public.field_geometries', 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', 'public.field_geometries', 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', 'public.field_geometries', 'DELETE')
  then
    raise exception 'FIELD_MAP_DIRECT_DML_STILL_GRANTED';
  end if;
end;
$$;

create or replace function public.mutate_field_boundary_v1(
  p_company_id uuid,
  p_actor_id uuid,
  p_action text,
  p_field_id uuid,
  p_expected_geometry_id uuid,
  p_target_field_id uuid,
  p_geometry_geojson jsonb,
  p_area_from_kml_ha numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_source public.field_geometries%rowtype;
  v_new_geometry_id uuid;
  v_result_field_id uuid;
  v_affected integer := 0;
  v_latest_boundary_action text;
  v_latest_boundary_entity_id text;
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
      and profile.role = 'global_admin'
      and profile.status = 'active'
  ) then
    raise exception 'FIELD_MAP_GLOBAL_ADMIN_REQUIRED';
  end if;

  if v_action not in ('replace', 'relink', 'unlink', 'restore') then
    raise exception 'FIELD_BOUNDARY_ACTION_INVALID';
  end if;
  if p_company_id is null or p_field_id is null then
    raise exception 'FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('field-map:' || p_company_id::text, 0)
  );

  if not exists (
    select 1
    from public.fields field_row
    where field_row.id = p_field_id
      and field_row.company_id = p_company_id
      and field_row.archived = false
  ) then
    raise exception 'FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH';
  end if;

  if v_action in ('relink', 'restore') then
    if p_target_field_id is null then
      raise exception 'FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH';
    end if;
    if not exists (
      select 1
      from public.fields target_field
      where target_field.id = p_target_field_id
        and target_field.company_id = p_company_id
        and target_field.archived = false
    ) then
      raise exception 'FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH';
    end if;
  end if;

  if v_action = 'replace' then
    if p_geometry_geojson is null
      or pg_catalog.jsonb_typeof(p_geometry_geojson) <> 'object'
      or p_geometry_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
      or p_area_from_kml_ha is null
      or p_area_from_kml_ha <= 0 then
      raise exception 'FIELD_BOUNDARY_GEOMETRY_INVALID';
    end if;

    if p_expected_geometry_id is null then
      if exists (
        select 1
        from public.field_geometries geometry_row
        where geometry_row.company_id = p_company_id
          and geometry_row.field_id = p_field_id
          and geometry_row.is_active = true
      ) then
        raise exception 'FIELD_BOUNDARY_CAS_FAILED';
      end if;
    else
      select *
      into v_source
      from public.field_geometries geometry_row
      where geometry_row.id = p_expected_geometry_id
        and geometry_row.company_id = p_company_id
        and geometry_row.field_id = p_field_id
        and geometry_row.is_active = true
      for update;
      if not found then
        raise exception 'FIELD_BOUNDARY_CAS_FAILED';
      end if;

      update public.field_geometries
      set is_active = false
      where id = p_expected_geometry_id
        and company_id = p_company_id
        and is_active = true;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 then
        raise exception 'FIELD_BOUNDARY_CAS_FAILED';
      end if;
    end if;

    insert into public.field_geometries(
      company_id,
      field_id,
      import_id,
      source_file_name,
      geometry_geojson,
      area_from_kml_ha,
      imported_at,
      imported_by,
      is_active
    ) values (
      p_company_id,
      p_field_id,
      null,
      coalesce(v_source.source_file_name, 'manual-boundary-v1'),
      p_geometry_geojson,
      p_area_from_kml_ha,
      pg_catalog.now(),
      p_actor_id,
      true
    )
    returning id into v_new_geometry_id;
    v_result_field_id := p_field_id;

  elsif v_action = 'relink' then
    if p_expected_geometry_id is null or p_target_field_id is null then
      raise exception 'FIELD_BOUNDARY_EXPECTED_ID_REQUIRED';
    end if;
    if p_target_field_id = p_field_id then
      raise exception 'FIELD_BOUNDARY_ACTION_INVALID';
    end if;

    select *
    into v_source
    from public.field_geometries geometry_row
    where geometry_row.id = p_expected_geometry_id
      and geometry_row.company_id = p_company_id
      and geometry_row.field_id = p_field_id
      and geometry_row.is_active = true
    for update;
    if not found then
      raise exception 'FIELD_BOUNDARY_CAS_FAILED';
    end if;
    if exists (
      select 1
      from public.field_geometries geometry_row
      where geometry_row.company_id = p_company_id
        and geometry_row.field_id = p_target_field_id
        and geometry_row.is_active = true
    ) then
      raise exception 'FIELD_BOUNDARY_TARGET_OCCUPIED';
    end if;

    update public.field_geometries
    set is_active = false
    where id = p_expected_geometry_id
      and company_id = p_company_id
      and is_active = true;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'FIELD_BOUNDARY_CAS_FAILED';
    end if;

    insert into public.field_geometries(
      company_id, field_id, import_id, source_file_name, geometry_geojson,
      area_from_kml_ha, imported_at, imported_by, is_active
    ) values (
      p_company_id, p_target_field_id, null, v_source.source_file_name,
      v_source.geometry_geojson, v_source.area_from_kml_ha, pg_catalog.now(), p_actor_id, true
    )
    returning id into v_new_geometry_id;
    v_result_field_id := p_target_field_id;

  elsif v_action = 'unlink' then
    if p_expected_geometry_id is null then
      raise exception 'FIELD_BOUNDARY_EXPECTED_ID_REQUIRED';
    end if;

    select *
    into v_source
    from public.field_geometries geometry_row
    where geometry_row.id = p_expected_geometry_id
      and geometry_row.company_id = p_company_id
      and geometry_row.field_id = p_field_id
      and geometry_row.is_active = true
    for update;
    if not found then
      raise exception 'FIELD_BOUNDARY_CAS_FAILED';
    end if;

    update public.field_geometries
    set is_active = false
    where id = p_expected_geometry_id
      and company_id = p_company_id
      and is_active = true;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'FIELD_BOUNDARY_CAS_FAILED';
    end if;
    v_new_geometry_id := null;
    v_result_field_id := null;

  else
    if p_expected_geometry_id is null or p_target_field_id is null then
      raise exception 'FIELD_BOUNDARY_EXPECTED_ID_REQUIRED';
    end if;
    if p_target_field_id <> p_field_id then
      raise exception 'FIELD_BOUNDARY_RESTORE_TARGET_MISMATCH';
    end if;

    select *
    into v_source
    from public.field_geometries geometry_row
    where geometry_row.id = p_expected_geometry_id
      and geometry_row.company_id = p_company_id
      and geometry_row.field_id = p_field_id
      and geometry_row.is_active = false
    for update;
    if not found then
      raise exception 'FIELD_BOUNDARY_SOURCE_NOT_FOUND';
    end if;
    select audit_row.action, audit_row.entity_id
    into v_latest_boundary_action, v_latest_boundary_entity_id
    from public.audit_log audit_row
    where audit_row.company_id = p_company_id
      and audit_row.entity_type = 'field_boundary'
    order by audit_row.when_at desc, audit_row.id desc
    limit 1;
    if not found
      or v_latest_boundary_action <> 'boundary_unlink_atomic_v1'
      or v_latest_boundary_entity_id <> p_expected_geometry_id::text then
      raise exception 'FIELD_BOUNDARY_RESTORE_NOT_ALLOWED';
    end if;
    if exists (
      select 1
      from public.audit_log audit_row
      where audit_row.company_id = p_company_id
        and audit_row.entity_type = 'field_boundary'
        and audit_row.action = 'boundary_restore_atomic_v1'
        and audit_row.old_values ->> 'source_geometry_id' = p_expected_geometry_id::text
    ) then
      raise exception 'FIELD_BOUNDARY_RESTORE_ALREADY_USED';
    end if;
    if exists (
      select 1
      from public.field_geometries geometry_row
      where geometry_row.company_id = p_company_id
        and geometry_row.field_id = p_target_field_id
        and geometry_row.is_active = true
    ) then
      raise exception 'FIELD_BOUNDARY_TARGET_OCCUPIED';
    end if;

    insert into public.field_geometries(
      company_id, field_id, import_id, source_file_name, geometry_geojson,
      area_from_kml_ha, imported_at, imported_by, is_active
    ) values (
      p_company_id, p_target_field_id, null, v_source.source_file_name,
      v_source.geometry_geojson, v_source.area_from_kml_ha, pg_catalog.now(), p_actor_id, true
    )
    returning id into v_new_geometry_id;
    v_result_field_id := p_target_field_id;
  end if;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    p_company_id,
    p_actor_id,
    'field_boundary',
    coalesce(v_new_geometry_id, p_expected_geometry_id)::text,
    'boundary_' || v_action || '_atomic_v1',
    pg_catalog.jsonb_build_object(
      'source_geometry_id', p_expected_geometry_id,
      'source_field_id', case when p_expected_geometry_id is null then null else v_source.field_id end,
      'source_import_id', case when p_expected_geometry_id is null then null else v_source.import_id end,
      'source_active', case when p_expected_geometry_id is null then null else v_source.is_active end
    ),
    pg_catalog.jsonb_build_object(
      'geometry_id', v_new_geometry_id,
      'field_id', v_result_field_id,
      'import_id', null,
      'active', v_new_geometry_id is not null
    ),
    case
      when v_action = 'replace' then 'Validated full boundary revision'
      when v_action = 'relink' then 'Explicit boundary field reassignment'
      when v_action = 'unlink' then 'Explicit boundary unlink'
      else 'One-time undo of explicit boundary unlink'
    end
  );

  return pg_catalog.jsonb_build_object(
    'action', v_action,
    'geometry_id', v_new_geometry_id,
    'previous_geometry_id', p_expected_geometry_id,
    'field_id', v_result_field_id
  );
end;
$$;

revoke all on function public.mutate_field_boundary_v1(
  uuid, uuid, text, uuid, uuid, uuid, jsonb, numeric
) from public, anon, authenticated;
grant execute on function public.mutate_field_boundary_v1(
  uuid, uuid, text, uuid, uuid, uuid, jsonb, numeric
) to service_role;

commit;

notify pgrst, 'reload schema';
