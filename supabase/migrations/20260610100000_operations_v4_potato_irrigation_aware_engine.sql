begin;

alter table public.crop_structure
  add column if not exists irrigation_type text not null default 'unknown',
  add column if not exists row_spacing_m numeric(10, 4),
  add column if not exists seed_spacing_cm numeric(10, 4);

update public.crop_structure
set irrigation_type = 'unknown'
where irrigation_type is null
   or irrigation_type not in ('drip', 'sprinkler', 'dryland', 'unknown');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'crop_structure_irrigation_type_check'
      and conrelid = 'public.crop_structure'::regclass
  ) then
    alter table public.crop_structure
      add constraint crop_structure_irrigation_type_check
      check (irrigation_type in ('drip', 'sprinkler', 'dryland', 'unknown'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'crop_structure_row_spacing_m_check'
      and conrelid = 'public.crop_structure'::regclass
  ) then
    alter table public.crop_structure
      add constraint crop_structure_row_spacing_m_check
      check (row_spacing_m is null or row_spacing_m > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'crop_structure_seed_spacing_cm_check'
      and conrelid = 'public.crop_structure'::regclass
  ) then
    alter table public.crop_structure
      add constraint crop_structure_seed_spacing_cm_check
      check (seed_spacing_cm is null or seed_spacing_cm > 0);
  end if;
end $$;

create index if not exists idx_crop_structure_company_irrigation
  on public.crop_structure(company_id, irrigation_type)
  where archived = false;

comment on column public.crop_structure.irrigation_type is
  'Operations V4 technology context: drip, sprinkler, dryland, unknown.';
comment on column public.crop_structure.row_spacing_m is
  'Planned row spacing for crop technology, e.g. potato 0.75 m. Operation may store a snapshot/fact.';
comment on column public.crop_structure.seed_spacing_cm is
  'Planned in-row seed/tuber spacing for crop technology. For potato this is auto, editable, required at planting.';

commit;

notify pgrst, 'reload schema';
