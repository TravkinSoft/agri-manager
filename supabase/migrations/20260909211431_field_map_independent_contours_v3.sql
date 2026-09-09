begin;

-- A contour is a map object; linking it to a business field is optional.
-- id remains the immutable version/CAS token. No fields or geometries are replaced.
alter table public.field_geometries alter column field_id drop not null;
alter table public.field_geometries drop constraint field_geometries_field_id_fkey;
alter table public.field_geometries add constraint field_geometries_field_id_fkey foreign key (field_id) references public.fields(id) on delete set null;
alter table public.field_geometries
  add column contour_id uuid,
  add column contour_version integer not null default 1,
  add column source_polygon_id text,
  add column source_polygon_name text,
  add column source_import_id uuid,
  add column source_geometry_geojson jsonb,
  add column display_name text,
  add column deleted_at timestamptz;

update public.field_geometries set contour_id = id, source_geometry_geojson = geometry_geojson, source_import_id = import_id;
-- Exact source matching only. Ambiguous historical provenance stays unknown.
with matches as (
  select g.id, p.value, count(*) over (partition by g.id) as matches
  from public.field_geometries g
  join public.field_map_imports i on i.id = g.import_id and i.company_id = g.company_id
  cross join lateral jsonb_array_elements(coalesce(i.preview_payload->'polygons', '[]'::jsonb)) p
  where coalesce(p.value->>'final_field_id', p.value->>'field_id') = g.field_id::text
    and p.value->'geometry' = g.geometry_geojson
)
update public.field_geometries g
set source_polygon_id = coalesce(m.value->>'polygon_id', m.value->>'id'),
    source_polygon_name = coalesce(m.value->>'polygon_name', m.value->>'name'),
    display_name = coalesce(m.value->>'polygon_name', m.value->>'name')
from matches m where m.id = g.id and m.matches = 1;
update public.field_geometries g set display_name = left(coalesce(
  nullif(btrim(g.display_name), ''),
  (select f.name from public.fields f where f.id = g.field_id and f.company_id = g.company_id),
  'Контур ' || left(g.id::text, 8)),200);
alter table public.field_geometries
  alter column contour_id set not null,
  alter column contour_id set default gen_random_uuid(),
  alter column display_name set not null,
  alter column display_name set default 'Новый контур',
  alter column source_geometry_geojson set not null,
  add constraint field_contour_version_positive check (contour_version > 0),
  add constraint field_contour_name_valid check (length(btrim(display_name)) between 1 and 200),
  add constraint field_contour_deleted_inactive check (deleted_at is null or not is_active);
create unique index field_contour_version_unique on public.field_geometries(company_id, contour_id, contour_version);
create unique index field_contour_active_unique on public.field_geometries(company_id, contour_id) where is_active;
create index field_contour_source_lookup on public.field_geometries(company_id, import_id, source_polygon_id);

create or replace function public.get_field_map_snapshot_v1(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_fields jsonb; v_active jsonb; v_imports jsonb; v_versions jsonb;
begin
  if p_company_id is null then raise exception 'FIELD_MAP_SCOPE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-map:' || p_company_id::text, 0));
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'area',f.area,'notes',f.notes) order by f.id::text),'[]')
  into v_fields from public.fields f where f.company_id=p_company_id and f.archived=false;
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'field_id',g.field_id,'import_id',g.import_id) order by g.id::text),'[]')
  into v_active from public.field_geometries g where g.company_id=p_company_id and g.is_active;
  select coalesce(jsonb_agg(i.id::text order by i.id::text),'[]') into v_imports
  from public.field_map_imports i where i.company_id=p_company_id and i.is_active;
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'contour_id',g.contour_id,'version',g.contour_version,'deleted_at',g.deleted_at) order by g.contour_id::text),'[]')
  into v_versions from (
    select distinct on (contour_id) id,contour_id,contour_version,deleted_at
    from public.field_geometries where company_id=p_company_id order by contour_id,contour_version desc
  ) g;
  return jsonb_build_object('fields',v_fields,'revision',jsonb_build_object(
    'fields',v_fields,'active_geometries',v_active,'active_import_ids',v_imports,'contour_versions',v_versions));
end; $$;

create or replace function public.get_field_map_contours_v3(p_company_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(g) - 'source_geometry_geojson' order by g.display_name,g.contour_id),'[]')
  from (
    select distinct on (contour_id) * from public.field_geometries
    where company_id=p_company_id order by contour_id,contour_version desc
  ) g where g.is_active or (g.deleted_at is not null and (g.import_id is null or exists(
    select 1 from public.field_map_imports i where i.id=g.import_id and i.company_id=p_company_id and i.is_active)));
$$;

create or replace function public.confirm_field_map_import_v3(
  p_company_id uuid, p_import_id uuid, p_actor_id uuid, p_rows jsonb,
  p_preview_payload jsonb, p_total_polygons integer, p_unmatched_polygons integer,
  p_error_count integer, p_expected_revision jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_import public.field_map_imports%rowtype; v_saved integer; v_linked integer; v_inserted integer;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='global_admin' and status='active') then
    raise exception 'FIELD_MAP_GLOBAL_ADMIN_REQUIRED'; end if;
  if p_company_id is null or p_import_id is null then raise exception 'FIELD_MAP_SCOPE_REQUIRED'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 300 then
    raise exception 'FIELD_MAP_RESOLVED_ROWS_REQUIRED'; end if;
  if p_preview_payload is null or jsonb_typeof(p_preview_payload)<>'object' then raise exception 'FIELD_MAP_PREVIEW_PAYLOAD_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-map:'||p_company_id::text,0));
  if p_expected_revision is null or public.get_field_map_snapshot_v1(p_company_id)->'revision' <> p_expected_revision then
    raise exception 'FIELD_MAP_PREVIEW_STALE'; end if;
  select * into v_import from public.field_map_imports where id=p_import_id and company_id=p_company_id for update;
  if not found then raise exception 'FIELD_MAP_IMPORT_NOT_FOUND'; end if;
  if v_import.status <> 'draft' then raise exception 'FIELD_MAP_IMPORT_NOT_DRAFT'; end if;
  select count(*),count(field_id) into v_saved,v_linked from jsonb_to_recordset(p_rows) s(field_id uuid);
  if exists(select 1 from jsonb_to_recordset(p_rows) s(polygon_id text) group by polygon_id having count(*)>1) then
    raise exception 'FIELD_MAP_DUPLICATE_POLYGON'; end if;
  if exists(select 1 from jsonb_to_recordset(p_rows) s(field_id uuid) where field_id is not null group by field_id having count(*)>1) then
    raise exception 'FIELD_MAP_DUPLICATE_FIELD'; end if;
  if exists(select 1 from jsonb_to_recordset(p_rows) s(polygon_id text,geometry_geojson jsonb,area_from_kml_ha numeric)
    where nullif(btrim(polygon_id),'') is null or geometry_geojson is null
      or jsonb_typeof(geometry_geojson)<>'object' or coalesce(geometry_geojson->>'type','') not in ('Polygon','MultiPolygon')
      or area_from_kml_ha is null or area_from_kml_ha<=0) then raise exception 'FIELD_MAP_RESOLVED_ROW_INVALID'; end if;
  -- A source identity and geometry must exist in the immutable server-parsed draft.
  if exists(select 1 from jsonb_to_recordset(p_rows) s(polygon_id text,geometry_geojson jsonb)
    where (select count(*) from jsonb_array_elements(v_import.preview_payload->'polygons') p
      where p->>'polygon_id'=s.polygon_id and p->'geometry'=s.geometry_geojson) <> 1) then
    raise exception 'FIELD_MAP_SOURCE_MISMATCH'; end if;
  if (select count(*) from public.fields f where f.company_id=p_company_id and not f.archived
    and f.id in(select field_id from jsonb_to_recordset(p_rows) s(field_id uuid))) <> v_linked then
    raise exception 'FIELD_MAP_FIELD_SCOPE_MISMATCH'; end if;
  if p_total_polygons is null or p_total_polygons <> jsonb_array_length(v_import.preview_payload->'polygons')
    or p_total_polygons < v_saved or p_unmatched_polygons is distinct from p_total_polygons-v_linked
    or p_error_count is distinct from p_total_polygons-v_saved then raise exception 'FIELD_MAP_IMPORT_COUNTS_INVALID'; end if;
  update public.field_geometries set is_active=false where company_id=p_company_id and is_active;
  insert into public.field_geometries(company_id,field_id,import_id,source_import_id,source_file_name,source_polygon_id,source_polygon_name,
    display_name,geometry_geojson,source_geometry_geojson,area_from_kml_ha,imported_at,imported_by,is_active)
  select p_company_id,s.field_id,p_import_id,p_import_id,v_import.source_file_name,s.polygon_id,
    coalesce(nullif(p->>'polygon_name',''),s.polygon_id),
    left(coalesce(nullif(p->>'polygon_name',''),s.polygon_id),200),
    s.geometry_geojson,s.geometry_geojson,s.area_from_kml_ha,now(),p_actor_id,true
  from jsonb_to_recordset(p_rows) s(polygon_id text,field_id uuid,geometry_geojson jsonb,area_from_kml_ha numeric)
  join lateral jsonb_array_elements(v_import.preview_payload->'polygons') p on p->>'polygon_id'=s.polygon_id;
  get diagnostics v_inserted = row_count;
  if v_inserted<>v_saved then raise exception 'FIELD_MAP_INSERT_COUNT_MISMATCH'; end if;
  update public.field_map_imports set is_active=false where company_id=p_company_id and id<>p_import_id and is_active;
  update public.field_map_imports set status='imported',total_polygons=p_total_polygons,matched_polygons=v_linked,
    unmatched_polygons=p_unmatched_polygons,error_count=p_error_count,preview_payload=p_preview_payload,
    imported_at=now(),imported_by=p_actor_id,is_active=true where id=p_import_id and company_id=p_company_id;
  insert into public.audit_log(company_id,who,entity_type,entity_id,action,new_values,reason)
  values(p_company_id,p_actor_id,'field_map_import',p_import_id::text,'confirm_atomic_v3',
    jsonb_build_object('saved',v_saved,'linked',v_linked,'unlinked',v_saved-v_linked,'skipped',p_total_polygons-v_saved),
    'All approved source contours; no inferred business fields');
  return jsonb_build_object('import_id',p_import_id,'status','imported','saved_polygons',v_saved,
    'linked_polygons',v_linked,'unlinked_polygons',v_saved-v_linked,'skipped_polygons',p_total_polygons-v_saved);
end; $$;

create or replace function public.mutate_field_contour_v3(
  p_company_id uuid,p_actor_id uuid,p_action text,p_field_id uuid,p_expected_geometry_id uuid,
  p_target_field_id uuid,p_geometry_geojson jsonb,p_area_from_kml_ha numeric,p_display_name text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.field_geometries%rowtype; n public.field_geometries%rowtype;
  v_action text:=lower(btrim(coalesce(p_action,''))); v_field uuid; v_deleted timestamptz;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='global_admin' and status='active') then
    raise exception 'FIELD_MAP_GLOBAL_ADMIN_REQUIRED'; end if;
  if p_company_id is null then raise exception 'FIELD_MAP_SCOPE_REQUIRED'; end if;
  if v_action not in ('replace','relink','unlink','rename','delete','restore') then raise exception 'FIELD_BOUNDARY_ACTION_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-map:'||p_company_id::text,0));
  if p_expected_geometry_id is not null then
    select * into s from public.field_geometries where id=p_expected_geometry_id and company_id=p_company_id for update;
    if not found then raise exception 'FIELD_BOUNDARY_SOURCE_NOT_FOUND'; end if;
    if exists(select 1 from public.field_geometries g where g.company_id=p_company_id and g.contour_id=s.contour_id
      and g.contour_version>s.contour_version) then raise exception 'FIELD_BOUNDARY_CAS_FAILED'; end if;
    if (v_action='restore' and s.deleted_at is null) or (v_action<>'restore' and (not s.is_active or s.deleted_at is not null)) then
      raise exception 'FIELD_BOUNDARY_CAS_FAILED'; end if;
    if p_field_id is not null and s.field_id is distinct from p_field_id then raise exception 'FIELD_BOUNDARY_CAS_FAILED'; end if;
    -- Do not restore a deleted contour from an inactive/archived snapshot.
    if s.import_id is not null and not exists(select 1 from public.field_map_imports i
      where i.id=s.import_id and i.company_id=p_company_id and i.is_active and i.status='imported') then
      raise exception 'FIELD_BOUNDARY_CAS_FAILED'; end if;
  elsif v_action<>'replace' or p_field_id is null then raise exception 'FIELD_BOUNDARY_EXPECTED_ID_REQUIRED';
  end if;
  v_field:=case when v_action='unlink' then null when v_action='relink' then p_target_field_id
    when s.id is not null then s.field_id else p_field_id end;
  if v_action='relink' and p_target_field_id is null then raise exception 'FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH'; end if;
  if v_field is not null then
    if not exists(select 1 from public.fields where id=v_field and company_id=p_company_id and not archived) then
      raise exception 'FIELD_BOUNDARY_FIELD_SCOPE_MISMATCH'; end if;
    if exists(select 1 from public.field_geometries g where g.company_id=p_company_id and g.field_id=v_field
      and g.is_active and g.id is distinct from s.id) then raise exception 'FIELD_BOUNDARY_TARGET_OCCUPIED'; end if;
  end if;
  if v_action='replace' and (p_geometry_geojson is null or jsonb_typeof(p_geometry_geojson)<>'object'
    or coalesce(p_geometry_geojson->>'type','') not in ('Polygon','MultiPolygon')
    or p_area_from_kml_ha is null or p_area_from_kml_ha<=0) then raise exception 'FIELD_BOUNDARY_GEOMETRY_INVALID'; end if;
  if v_action='rename' and (p_display_name is null or length(btrim(p_display_name)) not between 1 and 200) then
    raise exception 'FIELD_BOUNDARY_NAME_INVALID'; end if;
  v_deleted:=case when v_action='delete' then now() else null end;
  if s.id is not null then update public.field_geometries set is_active=false where id=s.id; end if;
  insert into public.field_geometries(company_id,field_id,contour_id,contour_version,import_id,source_import_id,source_file_name,
    source_polygon_id,source_polygon_name,source_geometry_geojson,display_name,geometry_geojson,area_from_kml_ha,
    imported_at,imported_by,is_active,deleted_at)
  values(p_company_id,v_field,coalesce(s.contour_id,gen_random_uuid()),coalesce(s.contour_version,0)+1,
    s.import_id,s.source_import_id,coalesce(s.source_file_name,'manual-boundary-v3'),s.source_polygon_id,s.source_polygon_name,
    coalesce(s.source_geometry_geojson,p_geometry_geojson),
    case when v_action='rename' then btrim(p_display_name) else coalesce(s.display_name,
      (select left(name,200) from public.fields where id=v_field and company_id=p_company_id),'Новый контур') end,
    case when v_action='replace' then p_geometry_geojson else s.geometry_geojson end,
    case when v_action='replace' then p_area_from_kml_ha else s.area_from_kml_ha end,
    now(),p_actor_id,v_deleted is null,v_deleted) returning * into n;
  insert into public.audit_log(company_id,who,entity_type,entity_id,action,old_values,new_values,reason)
  values(p_company_id,p_actor_id,'field_boundary',n.contour_id::text,'contour_'||v_action||'_atomic_v3',
    jsonb_build_object('geometry_id',s.id,'field_id',s.field_id,'display_name',s.display_name,'deleted_at',s.deleted_at),
    jsonb_build_object('geometry_id',n.id,'field_id',n.field_id,'display_name',n.display_name,'deleted_at',n.deleted_at,
      'source_import_id',n.source_import_id,'source_polygon_id',n.source_polygon_id,'version',n.contour_version),
    'Explicit contour edit; source geometry and identity preserved');
  return jsonb_build_object('action',v_action,'contour_id',n.contour_id,'geometry_id',n.id,
    'previous_geometry_id',s.id,'field_id',n.field_id,'deleted_at',n.deleted_at);
end; $$;

create or replace function public.set_field_map_import_state_v3(
  p_company_id uuid,p_import_id uuid,p_actor_id uuid,p_action text,
  p_expected_revision jsonb,p_expected_target_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.field_map_imports%rowtype; v_action text:=lower(btrim(coalesce(p_action,'')));
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='global_admin' and status='active') then
    raise exception 'FIELD_MAP_GLOBAL_ADMIN_REQUIRED'; end if;
  if p_company_id is null or p_import_id is null then raise exception 'FIELD_MAP_SCOPE_REQUIRED'; end if;
  if v_action not in ('activate','deactivate','archive') then raise exception 'FIELD_MAP_ACTION_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-map:'||p_company_id::text,0));
  if p_expected_revision is null or public.get_field_map_snapshot_v1(p_company_id)->'revision'<>p_expected_revision then
    raise exception 'FIELD_MAP_STATE_STALE'; end if;
  select * into i from public.field_map_imports where id=p_import_id and company_id=p_company_id for update;
  if not found then raise exception 'FIELD_MAP_IMPORT_NOT_FOUND'; end if;
  if p_expected_target_updated_at is null or i.updated_at<>p_expected_target_updated_at then raise exception 'FIELD_MAP_STATE_STALE'; end if;
  if v_action='activate' then
    if i.status<>'imported' then raise exception 'FIELD_MAP_IMPORT_NOT_ACTIVATABLE'; end if;
    if not exists(select 1 from public.field_geometries where company_id=p_company_id and import_id=p_import_id) then
      raise exception 'FIELD_MAP_IMPORT_HAS_NO_GEOMETRIES'; end if;
    update public.field_geometries set is_active=false where company_id=p_company_id and is_active;
    -- Select latest by stable contour, including tombstones BEFORE filtering.
    with latest as (select distinct on (contour_id) id,deleted_at from public.field_geometries
      where company_id=p_company_id and import_id=p_import_id order by contour_id,contour_version desc)
    update public.field_geometries set is_active=true where id in(select id from latest where deleted_at is null);
    update public.field_map_imports set is_active=false where company_id=p_company_id and is_active and id<>p_import_id;
    update public.field_map_imports set is_active=true where id=p_import_id and company_id=p_company_id;
  else
    update public.field_geometries set is_active=false where company_id=p_company_id and is_active and (import_id=p_import_id or i.is_active);
    update public.field_map_imports set is_active=false,status=case when v_action='archive' then 'archived' else status end
    where id=p_import_id and company_id=p_company_id;
  end if;
  insert into public.audit_log(company_id,who,entity_type,entity_id,action,old_values,new_values)
  values(p_company_id,p_actor_id,'field_map_import',p_import_id::text,'state_'||v_action||'_atomic_v3',
    jsonb_build_object('status',i.status,'active',i.is_active),jsonb_build_object('active',v_action='activate'));
  return jsonb_build_object('import_id',p_import_id,'action',v_action,'active',v_action='activate',
    'status',case when v_action='archive' then 'archived' else i.status end);
end; $$;

-- Compatibility entrypoints cannot silently collapse NULL field links or hide unlink.
create or replace function public.set_field_map_import_state_v2(p_company_id uuid,p_import_id uuid,p_actor_id uuid,p_action text,p_expected_revision jsonb,p_expected_target_updated_at timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select public.set_field_map_import_state_v3($1,$2,$3,$4,$5,$6); $$;
create or replace function public.mutate_field_boundary_v1(p_company_id uuid,p_actor_id uuid,p_action text,p_field_id uuid,p_expected_geometry_id uuid,p_target_field_id uuid,p_geometry_geojson jsonb,p_area_from_kml_ha numeric)
returns jsonb language sql security definer set search_path = '' as $$
  select public.mutate_field_contour_v3($1,$2,$3,$4,$5,$6,$7,$8,null); $$;
create or replace function public.confirm_field_map_import_v2(p_company_id uuid,p_import_id uuid,p_actor_id uuid,p_rows jsonb,p_preview_payload jsonb,p_total_polygons integer,p_unmatched_polygons integer,p_error_count integer,p_expected_revision jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select public.confirm_field_map_import_v3($1,$2,$3,$4,$5,$6,$7,$8,$9); $$;

revoke all on function public.confirm_field_map_import_v3(uuid,uuid,uuid,jsonb,jsonb,integer,integer,integer,jsonb) from public,anon,authenticated;
revoke all on function public.get_field_map_contours_v3(uuid) from public,anon,authenticated;
grant execute on function public.get_field_map_contours_v3(uuid) to service_role;
revoke all on function public.mutate_field_contour_v3(uuid,uuid,text,uuid,uuid,uuid,jsonb,numeric,text) from public,anon,authenticated;
revoke all on function public.set_field_map_import_state_v3(uuid,uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.confirm_field_map_import_v3(uuid,uuid,uuid,jsonb,jsonb,integer,integer,integer,jsonb) to service_role;
grant execute on function public.mutate_field_contour_v3(uuid,uuid,text,uuid,uuid,uuid,jsonb,numeric,text) to service_role;
grant execute on function public.set_field_map_import_state_v3(uuid,uuid,uuid,text,jsonb,timestamptz) to service_role;
commit;
notify pgrst, 'reload schema';
