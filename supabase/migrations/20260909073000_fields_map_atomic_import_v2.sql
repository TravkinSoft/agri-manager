begin;

create or replace function public.get_field_map_snapshot_v1(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fields jsonb;
  v_active_geometries jsonb;
  v_active_import_ids jsonb;
begin
  if p_company_id is null then
    raise exception 'FIELD_MAP_SCOPE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('field-map:' || p_company_id::text, 0));

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', field_row.id,
      'name', field_row.name,
      'area', field_row.area,
      'notes', field_row.notes
    ) order by field_row.id::text
  ), '[]'::jsonb)
  into v_fields
  from public.fields field_row
  where field_row.company_id = p_company_id
    and field_row.archived = false;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', geometry_row.id,
      'field_id', geometry_row.field_id,
      'import_id', geometry_row.import_id
    ) order by geometry_row.id::text
  ), '[]'::jsonb)
  into v_active_geometries
  from public.field_geometries geometry_row
  where geometry_row.company_id = p_company_id
    and geometry_row.is_active = true;

  select coalesce(jsonb_agg(import_row.id::text order by import_row.id::text), '[]'::jsonb)
  into v_active_import_ids
  from public.field_map_imports import_row
  where import_row.company_id = p_company_id
    and import_row.is_active = true;

  return jsonb_build_object(
    'fields', v_fields,
    'revision', jsonb_build_object(
      'fields', v_fields,
      'active_geometries', v_active_geometries,
      'active_import_ids', v_active_import_ids
    )
  );
end;
$$;

create or replace function public.confirm_field_map_import_v2(
  p_company_id uuid,
  p_import_id uuid,
  p_actor_id uuid,
  p_rows jsonb,
  p_preview_payload jsonb,
  p_total_polygons integer,
  p_unmatched_polygons integer,
  p_error_count integer,
  p_expected_revision jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_file_name text;
  v_status text;
  v_resolved_count integer;
  v_inserted_count integer;
  v_current_revision jsonb;
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

  if p_company_id is null or p_import_id is null then
    raise exception 'FIELD_MAP_SCOPE_REQUIRED';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 then
    raise exception 'FIELD_MAP_RESOLVED_ROWS_REQUIRED';
  end if;
  if jsonb_array_length(p_rows) > 300 then
    raise exception 'FIELD_MAP_RESOLVED_ROWS_LIMIT';
  end if;
  if jsonb_typeof(coalesce(p_preview_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'FIELD_MAP_PREVIEW_PAYLOAD_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('field-map:' || p_company_id::text, 0));

  v_current_revision := public.get_field_map_snapshot_v1(p_company_id) -> 'revision';
  if p_expected_revision is null or v_current_revision <> p_expected_revision then
    raise exception 'FIELD_MAP_PREVIEW_STALE';
  end if;

  select source_file_name, status
  into v_source_file_name, v_status
  from public.field_map_imports
  where id = p_import_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'FIELD_MAP_IMPORT_NOT_FOUND';
  end if;
  if v_status <> 'draft' then
    raise exception 'FIELD_MAP_IMPORT_NOT_DRAFT';
  end if;

  select count(*)
  into v_resolved_count
  from jsonb_to_recordset(p_rows) as source(
    polygon_id text,
    field_id uuid,
    geometry_geojson jsonb,
    area_from_kml_ha numeric
  );

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      polygon_id text,
      field_id uuid,
      geometry_geojson jsonb,
      area_from_kml_ha numeric
    )
    group by source.polygon_id
    having count(*) > 1
  ) then
    raise exception 'FIELD_MAP_DUPLICATE_POLYGON';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      polygon_id text,
      field_id uuid,
      geometry_geojson jsonb,
      area_from_kml_ha numeric
    )
    group by source.field_id
    having count(*) > 1
  ) then
    raise exception 'FIELD_MAP_DUPLICATE_FIELD';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      polygon_id text,
      field_id uuid,
      geometry_geojson jsonb,
      area_from_kml_ha numeric
    )
    where nullif(btrim(source.polygon_id), '') is null
      or source.field_id is null
      or jsonb_typeof(source.geometry_geojson) <> 'object'
      or source.geometry_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
      or (source.area_from_kml_ha is not null and source.area_from_kml_ha <= 0)
  ) then
    raise exception 'FIELD_MAP_RESOLVED_ROW_INVALID';
  end if;
  if (
    select count(*)
    from public.fields field_row
    where field_row.company_id = p_company_id
      and field_row.archived = false
      and field_row.id in (
        select source.field_id
        from jsonb_to_recordset(p_rows) as source(field_id uuid)
      )
  ) <> v_resolved_count then
    raise exception 'FIELD_MAP_FIELD_SCOPE_MISMATCH';
  end if;
  if p_total_polygons < v_resolved_count
    or p_unmatched_polygons <> p_total_polygons - v_resolved_count
    or p_error_count < 0
    or p_error_count > p_unmatched_polygons then
    raise exception 'FIELD_MAP_IMPORT_COUNTS_INVALID';
  end if;

  -- One company has one active import snapshot. Any error after this point
  -- rolls the entire transaction back, including these deactivations.
  update public.field_geometries
  set is_active = false
  where company_id = p_company_id
    and is_active = true;

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
  )
  select
    p_company_id,
    source.field_id,
    p_import_id,
    v_source_file_name,
    source.geometry_geojson,
    source.area_from_kml_ha,
    now(),
    p_actor_id,
    true
  from jsonb_to_recordset(p_rows) as source(
    polygon_id text,
    field_id uuid,
    geometry_geojson jsonb,
    area_from_kml_ha numeric
  );
  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_resolved_count then
    raise exception 'FIELD_MAP_INSERT_COUNT_MISMATCH';
  end if;

  update public.field_map_imports
  set is_active = false
  where company_id = p_company_id
    and id <> p_import_id
    and is_active = true;

  update public.field_map_imports
  set status = 'imported',
      total_polygons = p_total_polygons,
      matched_polygons = v_resolved_count,
      unmatched_polygons = p_unmatched_polygons,
      error_count = p_error_count,
      preview_payload = p_preview_payload,
      imported_at = now(),
      imported_by = p_actor_id,
      is_active = true
  where id = p_import_id
    and company_id = p_company_id
    and status = 'draft';
  if not found then
    raise exception 'FIELD_MAP_IMPORT_CAS_FAILED';
  end if;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, new_values, reason
  ) values (
    p_company_id,
    p_actor_id,
    'field_map_import',
    p_import_id::text,
    'confirm_atomic_v2',
    jsonb_build_object(
      'source_file_name', v_source_file_name,
      'total_polygons', p_total_polygons,
      'matched_polygons', v_resolved_count,
      'unmatched_polygons', p_unmatched_polygons,
      'active', true
    ),
    'Validated KML import confirmation'
  );

  return jsonb_build_object(
    'import_id', p_import_id,
    'status', 'imported',
    'saved_polygons', v_resolved_count,
    'skipped_polygons', p_unmatched_polygons
  );
end;
$$;

create or replace function public.set_field_map_import_state_v2(
  p_company_id uuid,
  p_import_id uuid,
  p_actor_id uuid,
  p_action text,
  p_expected_revision jsonb,
  p_expected_target_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_was_active boolean;
  v_geometry_count integer;
  v_target_updated_at timestamptz;
  v_current_revision jsonb;
  v_action text := lower(btrim(coalesce(p_action, '')));
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
  if v_action not in ('activate', 'deactivate', 'archive') then
    raise exception 'FIELD_MAP_ACTION_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('field-map:' || p_company_id::text, 0));

  v_current_revision := public.get_field_map_snapshot_v1(p_company_id) -> 'revision';
  if p_expected_revision is null or v_current_revision <> p_expected_revision then
    raise exception 'FIELD_MAP_STATE_STALE';
  end if;

  select status, is_active, updated_at
  into v_status, v_was_active, v_target_updated_at
  from public.field_map_imports
  where id = p_import_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'FIELD_MAP_IMPORT_NOT_FOUND';
  end if;
  if p_expected_target_updated_at is null or v_target_updated_at <> p_expected_target_updated_at then
    raise exception 'FIELD_MAP_STATE_STALE';
  end if;

  if v_action = 'activate' then
    if v_status <> 'imported' then
      raise exception 'FIELD_MAP_IMPORT_NOT_ACTIVATABLE';
    end if;
    select count(*) into v_geometry_count
    from public.field_geometries
    where company_id = p_company_id
      and import_id = p_import_id;
    if v_geometry_count < 1 then
      raise exception 'FIELD_MAP_IMPORT_HAS_NO_GEOMETRIES';
    end if;

    update public.field_geometries
    set is_active = false
    where company_id = p_company_id
      and is_active = true;

    with latest as (
      select distinct on (field_id) id
      from public.field_geometries
      where company_id = p_company_id
        and import_id = p_import_id
      order by field_id, created_at desc, id desc
    )
    update public.field_geometries geometry_row
    set is_active = true
    where geometry_row.id in (select id from latest);

    update public.field_map_imports
    set is_active = false
    where company_id = p_company_id
      and id <> p_import_id
      and is_active = true;
    update public.field_map_imports
    set is_active = true
    where id = p_import_id
      and company_id = p_company_id;
  elsif v_action = 'deactivate' then
    update public.field_geometries
    set is_active = false
    where company_id = p_company_id
      and (import_id = p_import_id or v_was_active)
      and is_active = true;
    update public.field_map_imports
    set is_active = false
    where id = p_import_id
      and company_id = p_company_id;
  else
    update public.field_geometries
    set is_active = false
    where company_id = p_company_id
      and (import_id = p_import_id or v_was_active)
      and is_active = true;
    update public.field_map_imports
    set status = 'archived', is_active = false
    where id = p_import_id
      and company_id = p_company_id;
  end if;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, old_values, new_values
  ) values (
    p_company_id,
    p_actor_id,
    'field_map_import',
    p_import_id::text,
    'state_' || v_action || '_atomic_v2',
    jsonb_build_object('status', v_status, 'active', v_was_active),
    jsonb_build_object('status', case when v_action = 'archive' then 'archived' else v_status end,
      'active', v_action = 'activate')
  );

  return jsonb_build_object(
    'import_id', p_import_id,
    'action', v_action,
    'status', case when v_action = 'archive' then 'archived' else v_status end,
    'active', v_action = 'activate'
  );
end;
$$;

revoke all on function public.confirm_field_map_import_v2(
  uuid, uuid, uuid, jsonb, jsonb, integer, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.confirm_field_map_import_v2(
  uuid, uuid, uuid, jsonb, jsonb, integer, integer, integer, jsonb
) to service_role;

revoke all on function public.set_field_map_import_state_v2(
  uuid, uuid, uuid, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.set_field_map_import_state_v2(
  uuid, uuid, uuid, text, jsonb, timestamptz
) to service_role;

revoke all on function public.get_field_map_snapshot_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_field_map_snapshot_v1(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
