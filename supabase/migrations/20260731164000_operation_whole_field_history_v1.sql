-- Record crop-independent whole-field operations in field history.
-- The atomic completion RPC resolves season through crop_structure_id, which is
-- intentionally null for target_scope = field. The operation contract already
-- stores the exact season_id in operation_config.

create or replace function public.record_whole_field_operation_history_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season_id uuid;
  v_season_year integer;
begin
  if new.crop_structure_id is not null
     or coalesce(new.operation_type_slug, new.operation_category_slug, '') not in ('plowing', 'snow_retention')
     or coalesce(new.operation_status, new.status, new.work_status, '') <> 'completed'
     or coalesce(old.operation_status, old.status, old.work_status, '') = 'completed' then
    return new;
  end if;

  select s.id, s.year
    into v_season_id, v_season_year
  from public.seasons s
  where s.company_id = new.company_id
    and s.id::text = nullif(new.operation_config ->> 'season_id', '')
    and coalesce(s.archived, false) = false
  limit 1;

  if v_season_id is null then
    return new;
  end if;

  insert into public.field_history_entries (
    company_id,
    field_id,
    season_id,
    season_year,
    history_value,
    original_raw_value,
    source,
    notes,
    operation_id,
    actual_completed_area_ha,
    material_facts,
    material_reconciliation_status
  )
  select
    new.company_id,
    new.field_id,
    v_season_id,
    v_season_year,
    'Operation completed: ' || coalesce(nullif(new.operation_type, ''), 'field work'),
    coalesce(nullif(new.operation_type, ''), 'operation completed'),
    'operation_close',
    new.specialist_comment,
    new.id,
    round(coalesce(new.completed_area_ha, new.planned_area_ha, 0), 4),
    '[]'::jsonb,
    'not_required'
  where not exists (
    select 1
    from public.field_history_entries h
    where h.company_id = new.company_id
      and h.operation_id = new.id
  );

  return new;
end;
$$;

drop trigger if exists operations_whole_field_history_v1 on public.operations;
create trigger operations_whole_field_history_v1
after update of operation_status, status, work_status on public.operations
for each row
execute function public.record_whole_field_operation_history_v1();

revoke all on function public.record_whole_field_operation_history_v1() from public, anon;

-- Idempotent repair for completed crop-independent whole-field operations whose
-- history was previously skipped by the crop_structure-based season lookup.
insert into public.field_history_entries (
  company_id,
  field_id,
  season_id,
  season_year,
  history_value,
  original_raw_value,
  source,
  notes,
  operation_id,
  actual_completed_area_ha,
  material_facts,
  material_reconciliation_status
)
select
  o.company_id,
  o.field_id,
  s.id,
  s.year,
  'Operation completed: ' || coalesce(nullif(o.operation_type, ''), 'field work'),
  coalesce(nullif(o.operation_type, ''), 'operation completed'),
  'operation_close',
  o.specialist_comment,
  o.id,
  round(coalesce(o.completed_area_ha, o.planned_area_ha, 0), 4),
  '[]'::jsonb,
  'not_required'
from public.operations o
join public.seasons s
  on s.company_id = o.company_id
 and s.id::text = nullif(o.operation_config ->> 'season_id', '')
 and coalesce(s.archived, false) = false
where o.crop_structure_id is null
  and coalesce(o.operation_type_slug, o.operation_category_slug, '') in ('plowing', 'snow_retention')
  and coalesce(o.operation_status, o.status, o.work_status, '') = 'completed'
  and not exists (
    select 1
    from public.field_history_entries h
    where h.company_id = o.company_id
      and h.operation_id = o.id
  );
