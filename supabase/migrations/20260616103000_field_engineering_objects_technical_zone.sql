begin;

alter table public.field_engineering_objects
  drop constraint if exists field_engineering_objects_object_type_check;

alter table public.field_engineering_objects
  add constraint field_engineering_objects_object_type_check
  check (
    object_type in (
      'pond',
      'pump_station',
      'main_pipe',
      'layflat_hose',
      'hydrant',
      'drip_tape',
      'irrigation_zone',
      'mixing_tank',
      'fertigation_point',
      'well',
      'connection_point',
      'technical_boundary',
      'technical_zone',
      'flag',
      'other'
    )
  );

commit;

notify pgrst, 'reload schema';
