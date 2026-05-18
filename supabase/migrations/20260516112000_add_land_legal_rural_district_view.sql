-- Land legal: canonical breakdown view with rural district and owner overlay.
-- Safe/additive migration.

begin;

create index if not exists idx_cadastral_parcels_company_rural_district
  on public.cadastral_parcels(company_id, rural_district)
  where archived = false;

create index if not exists idx_legal_entities_company_name
  on public.legal_entities(company_id, name)
  where archived = false;

do $$
begin
  if to_regclass('public.land_owner_allocations') is not null then
    execute $view$
      create or replace view public.v_field_legal_breakdown as
      with link_rows as (
        select
          l.id::text as row_id,
          'field_cadastre_link'::text as row_source,
          l.company_id,
          l.season_id,
          l.field_id,
          f.name as field_name,
          l.owner_legal_entity_id,
          coalesce(
            ole.name,
            case
              when lower(coalesce(l.source_document, '')) like '%посев 2025%' or lower(coalesce(l.source_document, '')) like '%stem%' then 'ТОО "Астык-STEM"'
              when lower(coalesce(l.source_document, '')) like '%посев 2026%' or lower(coalesce(l.source_document, '')) like '%карагаш%' or lower(coalesce(l.source_document, '')) like '%караагаш%' then 'ТОО "Астык-Караагаш"'
              else null
            end
          ) as owner_name,
          l.usage_legal_entity_id,
          ule.name as usage_name,
          l.area_ha,
          l.crop_id,
          coalesce(c.name_ru, c.name, l.raw_crop_name) as crop_name,
          l.cadastral_parcel_id,
          cp.cadastral_number,
          cp.rural_district,
          (cp.rural_district is null or btrim(cp.rural_district) = '') as rural_district_missing,
          l.source_document,
          (l.cadastral_parcel_id is null) as missing_cadastre,
          (l.crop_id is null) as missing_crop,
          l.status::text as allocation_status
        from public.field_cadastre_links l
        left join public.fields f on f.id = l.field_id
        left join public.cadastral_parcels cp on cp.id = l.cadastral_parcel_id
        left join public.crops c on c.id = l.crop_id
        left join public.legal_entities ole on ole.id = l.owner_legal_entity_id
        left join public.legal_entities ule on ule.id = l.usage_legal_entity_id
        where l.status <> 'archived'
          and coalesce(f.archived, false) = false
          and (cp.id is null or coalesce(cp.archived, false) = false)
      ),
      owner_overlay as (
        select
          o.id::text as row_id,
          'owner_allocation_overlay'::text as row_source,
          o.company_id,
          o.season_id,
          o.field_id,
          f.name as field_name,
          o.owner_legal_entity_id,
          coalesce(ole.name, nullif(btrim(o.raw_owner_name), '')) as owner_name,
          null::uuid as usage_legal_entity_id,
          null::text as usage_name,
          o.area_ha,
          o.crop_id,
          coalesce(c.name_ru, c.name, o.raw_crop_name) as crop_name,
          o.cadastral_parcel_id,
          cp.cadastral_number,
          cp.rural_district,
          (cp.rural_district is null or btrim(cp.rural_district) = '') as rural_district_missing,
          o.source_document,
          coalesce(o.missing_cadastre, o.cadastral_parcel_id is null) as missing_cadastre,
          coalesce(o.missing_crop, o.crop_id is null) as missing_crop,
          o.allocation_status::text as allocation_status
        from public.land_owner_allocations o
        left join public.fields f on f.id = o.field_id
        left join public.cadastral_parcels cp on cp.id = o.cadastral_parcel_id
        left join public.crops c on c.id = o.crop_id
        left join public.legal_entities ole on ole.id = o.owner_legal_entity_id
        where coalesce(o.archived, false) = false
          and coalesce(f.archived, false) = false
          and (cp.id is null or coalesce(cp.archived, false) = false)
      )
      select * from link_rows
      union all
      select o.*
      from owner_overlay o
      where not exists (
        select 1
        from link_rows l
        where l.company_id = o.company_id
          and coalesce(l.season_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(o.season_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and l.field_id = o.field_id
          and coalesce(l.cadastral_parcel_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(o.cadastral_parcel_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and coalesce(l.crop_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(o.crop_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and abs(coalesce(l.area_ha, 0) - coalesce(o.area_ha, 0)) <= 0.001
      );
    $view$;
  else
    execute $view$
      create or replace view public.v_field_legal_breakdown as
      select
        l.id::text as row_id,
        'field_cadastre_link'::text as row_source,
        l.company_id,
        l.season_id,
        l.field_id,
        f.name as field_name,
        l.owner_legal_entity_id,
        ole.name as owner_name,
        l.usage_legal_entity_id,
        ule.name as usage_name,
        l.area_ha,
        l.crop_id,
        coalesce(c.name_ru, c.name, l.raw_crop_name) as crop_name,
        l.cadastral_parcel_id,
        cp.cadastral_number,
        cp.rural_district,
        (cp.rural_district is null or btrim(cp.rural_district) = '') as rural_district_missing,
        l.source_document,
        (l.cadastral_parcel_id is null) as missing_cadastre,
        (l.crop_id is null) as missing_crop,
        l.status::text as allocation_status
      from public.field_cadastre_links l
      left join public.fields f on f.id = l.field_id
      left join public.cadastral_parcels cp on cp.id = l.cadastral_parcel_id
      left join public.crops c on c.id = l.crop_id
      left join public.legal_entities ole on ole.id = l.owner_legal_entity_id
      left join public.legal_entities ule on ule.id = l.usage_legal_entity_id
      where l.status <> 'archived'
        and coalesce(f.archived, false) = false
        and (cp.id is null or coalesce(cp.archived, false) = false);
    $view$;
  end if;
end $$;

commit;
