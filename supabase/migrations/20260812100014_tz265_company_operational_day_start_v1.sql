alter table public.companies
  add column if not exists operational_day_start_hour smallint not null default 7;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_operational_day_start_hour_check'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_operational_day_start_hour_check
      check (operational_day_start_hour between 0 and 23);
  end if;
end
$$;

comment on column public.companies.operational_day_start_hour is
  'Local hour when the company operational day starts; TZ265 dashboard default is 07:00.';
