/*
  Link specialists/drivers to transport vehicles for weighbridge autofill.
*/

do $$
begin
  if to_regclass('public.reference_vehicles') is null then
    raise notice '20260410195500: reference_vehicles is not available yet; machine link will be completed by 20260410235500';
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'machine_id'
  ) then
    alter table public.profiles
      add column machine_id uuid null references public.reference_vehicles(id) on delete set null;
  end if;

  create index if not exists idx_profiles_machine_id on public.profiles(machine_id);
end $$;
