-- Backfill owner/usage legal context for 2026 legal allocations by source document.
-- Rule:
-- - "посев 2025 стем. — копия.docx" -> ТОО "Астык-STEM"
-- - "посев 2026 карагаш.docx"      -> ТОО "Астык-Караагаш"
-- - owner sheet rows are untouched.

begin;

-- 1) Ensure required legal entities exist for companies that have eligible 2026 links.
with companies_needing_backfill as (
  select distinct l.company_id
  from public.field_cadastre_links l
  join public.seasons s on s.id = l.season_id
  where s.year = 2026
    and coalesce(l.status, 'active') <> 'archived'
    and (l.owner_legal_entity_id is null or l.usage_legal_entity_id is null)
    and (
      lower(coalesce(l.source_document, '')) like '%посев 2025%'
      or lower(coalesce(l.source_document, '')) like '%стем%'
      or lower(coalesce(l.source_document, '')) like '%stem%'
      or lower(coalesce(l.source_document, '')) like '%посев 2026%'
      or lower(coalesce(l.source_document, '')) like '%карагаш%'
      or lower(coalesce(l.source_document, '')) like '%karagash%'
      or lower(coalesce(l.source_document, '')) like '%сс‚рµрј%'
      or lower(coalesce(l.source_document, '')) like '%рєр°сђр°рір°с%'
    )
)
insert into public.legal_entities (
  company_id,
  name,
  entity_type,
  is_active,
  archived,
  notes
)
select c.company_id, v.name, 'company', true, false, 'auto-created by owner fallback from source_document'
from companies_needing_backfill c
cross join (values ('ТОО "Астык-STEM"'), ('ТОО "Астык-Караагаш"')) as v(name)
where not exists (
  select 1
  from public.legal_entities le
  where le.company_id = c.company_id
    and le.archived = false
    and lower(trim(le.name)) = lower(trim(v.name))
);

-- 2) Backfill owner/usage IDs from source document for 2026 links only.
with stem_entity as (
  select le.company_id, le.id
  from public.legal_entities le
  where le.archived = false
    and lower(trim(le.name)) = lower(trim('ТОО "Астык-STEM"'))
),
karagash_entity as (
  select le.company_id, le.id
  from public.legal_entities le
  where le.archived = false
    and lower(trim(le.name)) = lower(trim('ТОО "Астык-Караагаш"'))
),
target_links as (
  select l.id, l.company_id, l.source_document, l.notes
  from public.field_cadastre_links l
  join public.seasons s on s.id = l.season_id
  where s.year = 2026
    and coalesce(l.status, 'active') <> 'archived'
    and (l.owner_legal_entity_id is null or l.usage_legal_entity_id is null)
    and lower(coalesce(l.source_document, '')) not like '%handwritten owner sheet%'
)
update public.field_cadastre_links l
set owner_legal_entity_id = coalesce(
      l.owner_legal_entity_id,
      case
        when lower(coalesce(t.source_document, '')) like '%посев 2025%'
          or lower(coalesce(t.source_document, '')) like '%стем%'
          or lower(coalesce(t.source_document, '')) like '%stem%'
          or lower(coalesce(t.source_document, '')) like '%сс‚рµрј%'
        then se.id
        when lower(coalesce(t.source_document, '')) like '%посев 2026%'
          or lower(coalesce(t.source_document, '')) like '%карагаш%'
          or lower(coalesce(t.source_document, '')) like '%karagash%'
          or lower(coalesce(t.source_document, '')) like '%рєр°сђр°рір°с%'
        then ke.id
        else null
      end
    ),
    usage_legal_entity_id = coalesce(
      l.usage_legal_entity_id,
      case
        when lower(coalesce(t.source_document, '')) like '%посев 2025%'
          or lower(coalesce(t.source_document, '')) like '%стем%'
          or lower(coalesce(t.source_document, '')) like '%stem%'
          or lower(coalesce(t.source_document, '')) like '%сс‚рµрј%'
        then se.id
        when lower(coalesce(t.source_document, '')) like '%посев 2026%'
          or lower(coalesce(t.source_document, '')) like '%карагаш%'
          or lower(coalesce(t.source_document, '')) like '%karagash%'
          or lower(coalesce(t.source_document, '')) like '%рєр°сђр°рір°с%'
        then ke.id
        else null
      end
    ),
    notes = case
      when coalesce(l.notes, '') ilike '%owner-fallback:source-document%'
        then l.notes
      else concat_ws(E'\n', nullif(l.notes, ''), '[owner-fallback:source-document]')
    end
from target_links t
left join stem_entity se on se.company_id = t.company_id
left join karagash_entity ke on ke.company_id = t.company_id
where l.id = t.id
  and (
    (l.owner_legal_entity_id is null and (se.id is not null or ke.id is not null))
    or (l.usage_legal_entity_id is null and (se.id is not null or ke.id is not null))
  );

commit;
