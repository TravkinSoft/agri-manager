-- TZ299 P0: align the warehouses schema with the deployed weighbridge runtime.
-- Existing rows keep their business identity and become ordinary WAREHOUSE places.

alter table public.warehouses
  add column if not exists place_type text not null default 'WAREHOUSE';

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.warehouses'::regclass
      and conname = 'warehouses_place_type_check'
  ) then
    alter table public.warehouses
      add constraint warehouses_place_type_check
      check (place_type in ('WAREHOUSE', 'YARD', 'DRYER', 'CLEANER')) not valid;
  end if;
end
$migration$;

alter table public.warehouses
  validate constraint warehouses_place_type_check;

comment on column public.warehouses.place_type is
  'Physical storage place type used by weighbridge and processing destinations.';
