begin;

insert into public.operation_lines (
  company_id,
  operation_id,
  field_id,
  crop_id,
  variety_id,
  reproduction_id,
  planned_area_ha,
  actual_area_ha,
  notes,
  created_by_user_id,
  updated_by_user_id
)
select
  o.company_id,
  o.id,
  o.field_id,
  cs.crop_id,
  cs.variety_id,
  cs.reproduction_id,
  greatest(coalesce(cs.area, f.area, 0), 0),
  null,
  'auto-backfilled default line from operation hardening',
  o.user_id,
  o.user_id
from public.operations o
left join public.crop_structure cs
  on cs.id = o.crop_structure_id
  and cs.company_id = o.company_id
left join public.fields f
  on f.id = o.field_id
  and f.company_id = o.company_id
where not exists (
    select 1
    from public.operation_lines ol
    where ol.company_id = o.company_id
      and ol.operation_id = o.id
  )
  and (
    lower(coalesce(o.operation_category_slug, '')) in ('seeding_planting', 'harvesting')
    or lower(coalesce(o.operation_type_slug, '') || ' ' || coalesce(o.operation_type, '')) similar to '%(seed|sow|plant|harvest)%'
  );

update public.operations o
set operation_config =
  coalesce(o.operation_config, '{}'::jsonb) ||
  jsonb_strip_nulls(
    jsonb_build_object(
      'planned_area_ha', coalesce(cs.area, f.area),
      'crop_id', cs.crop_id,
      'variety_id', cs.variety_id,
      'reproduction_id', cs.reproduction_id
    )
  )
from public.crop_structure cs
left join public.fields f
  on f.id = cs.field_id
  and f.company_id = cs.company_id
where o.crop_structure_id = cs.id
  and o.company_id = cs.company_id
  and not (coalesce(o.operation_config, '{}'::jsonb) ? 'planned_area_ha');

commit;

notify pgrst, 'reload schema';
