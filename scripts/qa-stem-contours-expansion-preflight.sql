-- READ ONLY. Run in QA gsglkmudcwkdetqtocae AFTER the v3 migration, before the proposal.
-- Record every returned fingerprint; never replace a mismatch with a newly guessed value.
select jsonb_build_object(
  'company_id',i.company_id,'import_id',i.id,'status',i.status,'active',i.is_active,
  'source_bytes',octet_length(i.source_kml_text),'source_sha256',encode(sha256(convert_to(i.source_kml_text,'UTF8')),'hex'),
  'source_md5',md5(i.source_kml_text),'preview_md5',md5(i.preview_payload::text),'target_updated_at',i.updated_at,
  'revision_md5',md5((public.get_field_map_snapshot_v1(i.company_id)->'revision')::text),
  'geometry_md5',(select md5(string_agg(to_jsonb(g)::text,'' order by g.id)) from public.field_geometries g where g.company_id=i.company_id),
  'fields_md5',(select md5(string_agg(to_jsonb(f)::text,'' order by f.id)) from public.fields f where f.company_id=i.company_id),
  'counts',(select jsonb_build_object('total',count(*),'active',count(*) filter(where is_active),
    'linked',count(field_id),'unlinked',count(*) filter(where field_id is null),'source_ids',count(source_polygon_id))
    from public.field_geometries where company_id=i.company_id),
  'preview_count',jsonb_array_length(i.preview_payload->'polygons')
) as preflight from public.field_map_imports i
where i.company_id='8a0f2c0e-6638-4a31-99a8-cab4237d287d'::uuid
  and i.id='097b2646-4adc-4842-b988-b3603889e271'::uuid;
