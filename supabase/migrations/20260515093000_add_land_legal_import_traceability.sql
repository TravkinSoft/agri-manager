-- Land legal import traceability and document provenance.
-- Keeps operational company scope unchanged; adds legal-layer attribution fields.

begin;

alter table public.cadastral_parcels
  add column if not exists source text not null default 'manual',
  add column if not exists source_document text null;

create index if not exists idx_cadastral_parcels_company_source_document
  on public.cadastral_parcels(company_id, source_document)
  where archived = false;

alter table public.field_cadastre_links
  add column if not exists source_document text null,
  add column if not exists raw_field_key text null,
  add column if not exists raw_crop_name text null,
  add column if not exists source_row_hash text null;

do $$
begin
  if to_regclass('public.import_batches') is not null then
    begin
      alter table public.field_cadastre_links
        add column if not exists import_batch_id uuid null references public.import_batches(id) on delete set null;
    exception
      when undefined_table then null;
    end;
  end if;
end $$;

create index if not exists idx_field_cadastre_links_source_document
  on public.field_cadastre_links(company_id, season_id, source_document, status);

create index if not exists idx_field_cadastre_links_import_batch
  on public.field_cadastre_links(import_batch_id)
  where import_batch_id is not null;

create or replace view public.v_land_sowing_by_cadastre as
select
  l.company_id,
  l.season_id,
  s.year as season_year,
  l.field_id,
  f.name as field_name,
  l.cadastral_parcel_id,
  cp.cadastral_number,
  cp.region,
  cp.district,
  cp.rural_district,
  cp.locality,
  l.area_ha,
  l.crop_plan_allocation_id,
  l.crop_id,
  coalesce(c.name_ru, c.name) as crop_name,
  l.variety_id,
  v.name as variety_name,
  l.reproduction_id,
  r.name as reproduction_name,
  l.legal_entity_id,
  le.name as legal_entity_name,
  l.owner_legal_entity_id,
  ole.name as owner_legal_entity_name,
  l.usage_legal_entity_id,
  ule.name as usage_legal_entity_name,
  l.allocation_method,
  l.source,
  l.status,
  l.valid_from,
  l.valid_to,
  l.notes,
  l.source_document
from public.field_cadastre_links l
join public.fields f on f.id = l.field_id
join public.cadastral_parcels cp on cp.id = l.cadastral_parcel_id
left join public.seasons s on s.id = l.season_id
left join public.crops c on c.id = l.crop_id
left join public.varieties v on v.id = l.variety_id
left join public.seed_reproductions r on r.id = l.reproduction_id
left join public.legal_entities le on le.id = l.legal_entity_id
left join public.legal_entities ole on ole.id = l.owner_legal_entity_id
left join public.legal_entities ule on ule.id = l.usage_legal_entity_id
where l.status <> 'archived'
  and coalesce(f.archived, false) = false
  and coalesce(cp.archived, false) = false;

commit;
