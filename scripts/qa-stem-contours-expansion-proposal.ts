/** Prints a guarded SQL proposal only. No connection, execution, env or credentials. */
export function buildStemContourExpansionSql(input: {
  actorId: string; revisionMd5: string; geometryMd5: string; previewMd5: string; fieldsMd5: string; targetUpdatedAt: string;
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.actorId)) throw new Error("Explicit verified QA global-admin UUID required");
  for (const key of ["revisionMd5", "geometryMd5", "previewMd5", "fieldsMd5"] as const) {
    if (!/^[0-9a-f]{32}$/iu.test(input[key])) throw new Error(`Recorded post-migration ${key} required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/u.test(input.targetUpdatedAt)) throw new Error("Recorded import timestamp required");
  return `-- REVIEW ONLY: QA gsglkmudcwkdetqtocae. ROOT owns execution; never run on Product.
-- Existing 18 IDs, geometries and links remain byte-for-byte unchanged; insert exactly 112 unlinked.
begin;
do $expand$
declare
  c constant uuid := '8a0f2c0e-6638-4a31-99a8-cab4237d287d';
  imp constant uuid := '097b2646-4adc-4842-b988-b3603889e271';
  actor constant uuid := '${input.actorId}';
  i public.field_map_imports%rowtype; old_ids uuid[]; n integer; finalized jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('field-map:'||c::text,0));
  if not exists(select 1 from public.companies where id=c and name ilike '%QA%') then raise exception 'QA_SCOPE_MISMATCH'; end if;
  if not exists(select 1 from public.profiles where id=actor and role='global_admin' and status='active') then raise exception 'QA_ACTOR_MISMATCH'; end if;
  select * into i from public.field_map_imports where id=imp and company_id=c for update;
  if not found or i.status<>'imported' or not i.is_active then raise exception 'QA_IMPORT_STATE_MISMATCH'; end if;
  if i.updated_at is distinct from '${input.targetUpdatedAt}'::timestamptz or md5(i.preview_payload::text) is distinct from '${input.previewMd5}' then raise exception 'QA_IMPORT_CAS_FAILED'; end if;
  if md5((public.get_field_map_snapshot_v1(c)->'revision')::text) is distinct from '${input.revisionMd5}' then raise exception 'QA_REVISION_MISMATCH'; end if;
  if (select md5(string_agg(to_jsonb(g)::text,'' order by g.id)) from public.field_geometries g where company_id=c) is distinct from '${input.geometryMd5}' then raise exception 'QA_GEOMETRY_FINGERPRINT_MISMATCH'; end if;
  if (select md5(string_agg(to_jsonb(f)::text,'' order by f.id)) from public.fields f where company_id=c) is distinct from '${input.fieldsMd5}' then raise exception 'QA_FIELDS_FINGERPRINT_MISMATCH'; end if;
  if i.source_kml_text is null or octet_length(i.source_kml_text)<>3527503 or md5(i.source_kml_text)<>'2ada75e9b094db93ef8cea680be35ace'
    or encode(sha256(convert_to(i.source_kml_text,'UTF8')),'hex')<>'51abda21beb7a0ad276b3ac2ab926e95919f84682f107700e7b302620e619bf2'
    then raise exception 'QA_SOURCE_FINGERPRINT_MISMATCH'; end if;
  if jsonb_array_length(i.preview_payload->'polygons') is distinct from 130 or i.total_polygons<>130
    or i.matched_polygons<>18 or i.unmatched_polygons<>112 then raise exception 'QA_PREVIEW_COUNTS_MISMATCH'; end if;
  if (select count(*) from public.field_geometries where company_id=c)<>18
    or (select count(*) from public.field_geometries where company_id=c and import_id=imp and source_import_id=imp
      and is_active and field_id is not null and contour_version=1 and source_polygon_id is not null)<>18 then raise exception 'QA_EXISTING_18_MISMATCH'; end if;
  if (select count(distinct p->>'polygon_id') from jsonb_array_elements(i.preview_payload->'polygons') p)<>130 then raise exception 'QA_SOURCE_IDENTITIES_MISMATCH'; end if;
  if exists(select 1 from public.field_geometries g where g.company_id=c and (select count(*)
    from jsonb_array_elements(i.preview_payload->'polygons') p where p->>'polygon_id'=g.source_polygon_id
      and p->'geometry'=g.geometry_geojson and coalesce(p->>'final_field_id',p->>'field_id')=g.field_id::text)<>1)
    then raise exception 'QA_KNOWN_LINK_OR_GEOMETRY_MISMATCH'; end if;
  if exists(select 1 from jsonb_array_elements(i.preview_payload->'polygons') p
    where coalesce(p->'geometry'->>'type','') not in ('Polygon','MultiPolygon') or p->>'area_ha' is null or (p->>'area_ha')::numeric<=0)
    then raise exception 'QA_SOURCE_GEOMETRY_INVALID'; end if;
  select array_agg(id order by id) into old_ids from public.field_geometries where company_id=c;
  insert into public.field_geometries(company_id,field_id,import_id,source_import_id,source_file_name,source_polygon_id,
    source_polygon_name,display_name,geometry_geojson,source_geometry_geojson,area_from_kml_ha,imported_by,is_active)
  select c,null,imp,imp,i.source_file_name,p->>'polygon_id',coalesce(p->>'polygon_name',p->>'polygon_id'),
    left(coalesce(nullif(p->>'polygon_name',''),p->>'polygon_id'),200),p->'geometry',p->'geometry',(p->>'area_ha')::numeric,actor,true
  from jsonb_array_elements(i.preview_payload->'polygons') p where not exists(
    select 1 from public.field_geometries g where g.company_id=c and g.import_id=imp and g.source_polygon_id=p->>'polygon_id');
  get diagnostics n=row_count;
  if n<>112 then raise exception 'QA_INSERT_COUNT_MISMATCH'; end if;
  select jsonb_agg(p || jsonb_build_object('final_status','saved','final_field_id',g.field_id,
    'final_reason',case when g.field_id is null then 'saved_unlinked' else null end) order by ord)
  into finalized from jsonb_array_elements(i.preview_payload->'polygons') with ordinality src(p,ord)
  join public.field_geometries g on g.company_id=c and g.import_id=imp and g.source_polygon_id=p->>'polygon_id';
  update public.field_map_imports set error_count=0,preview_payload=i.preview_payload || jsonb_build_object(
    'polygons',finalized,'unresolved_polygons','[]'::jsonb,'expanded_all_contours_at',now()) where id=imp and company_id=c;
  if (select count(*) from public.field_geometries where company_id=c and is_active)<>130
    or (select count(*) from public.field_geometries where company_id=c and field_id is null)<>112 then raise exception 'QA_POSTFLIGHT_COUNTS_MISMATCH'; end if;
  if (select md5(string_agg(to_jsonb(g)::text,'' order by g.id)) from public.field_geometries g where company_id=c and id=any(old_ids)) is distinct from '${input.geometryMd5}' then raise exception 'QA_EXISTING_IDS_CHANGED'; end if;
  if (select md5(string_agg(to_jsonb(f)::text,'' order by f.id)) from public.fields f where company_id=c) is distinct from '${input.fieldsMd5}' then raise exception 'QA_FIELDS_CHANGED'; end if;
  insert into public.audit_log(company_id,who,entity_type,entity_id,action,old_values,new_values,reason)
  values(c,actor,'field_map_import',imp::text,'expand_all_contours_guarded_v3',
    jsonb_build_object('active',18,'linked',18,'geometry_md5','${input.geometryMd5}','revision_md5','${input.revisionMd5}'),
    jsonb_build_object('active',130,'linked',18,'unlinked',112,'preserved_geometry_ids',old_ids),
    'Owner requested all valid STEM contours, unknown names remain unlinked; known IDs unchanged');
end; $expand$;
commit;`;
}

if (process.argv[1]?.replace(/\\/gu, "/").endsWith("/qa-stem-contours-expansion-proposal.ts")) {
  const [actorId, revisionMd5, geometryMd5, previewMd5, fieldsMd5, targetUpdatedAt] = process.argv.slice(2);
  console.log(buildStemContourExpansionSql({ actorId, revisionMd5, geometryMd5, previewMd5, fieldsMd5, targetUpdatedAt }));
}
