-- Company personnel role model v2.
-- Personnel remains separate from auth/profiles; user_id stays nullable.
-- reference_specialists remains a compatibility layer for drivers and mechanic operators.

begin;

update public.company_people
set role_type = case role_type
  when 'machine_operator' then 'mechanic_operator'
  when 'office' then 'agronomist'
  when 'cook' then 'other'
  when 'guard' then 'other'
  else role_type
end
where role_type in ('machine_operator', 'office', 'cook', 'guard');

alter table public.company_people
  drop constraint if exists company_people_role_type_check;

alter table public.company_people
  add constraint company_people_role_type_check
  check (
    role_type in (
      'agronomist',
      'mechanic_operator',
      'driver',
      'warehouse_manager',
      'weighbridge_operator',
      'worker',
      'manager',
      'admin',
      'other'
    )
  );

commit;
