begin;

alter table public.operations
  alter column field_id drop not null;

alter table public.operation_materials
  drop constraint if exists operation_materials_material_type_check;

alter table public.operation_materials
  add constraint operation_materials_material_type_check
  check (
    material_type in (
      'seed',
      'fertilizer',
      'pesticide',
      'adjuvant',
      'ph_corrector',
      'defoamer',
      'biological',
      'fuel',
      'organic'
    )
  );

commit;

notify pgrst, 'reload schema';
