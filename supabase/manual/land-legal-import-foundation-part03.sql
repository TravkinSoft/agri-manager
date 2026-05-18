-- Part 03: field_season_flags
begin;

create table if not exists public.field_season_flags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_id uuid not null references public.fields(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  flag_key text not null check (length(trim(flag_key)) > 0),
  flag_value_text text null,
  flag_value_numeric numeric(14,3) null,
  source text not null default 'import_2026_structure',
  raw_value text null,
  source_row_hash text null,
  import_batch_id uuid null references public.import_batches(id) on delete set null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_field_season_flags_scope
  on public.field_season_flags(company_id, season_id, field_id, flag_key);

do $$
begin
  if to_regprocedure('public.update_updated_at_column()') is not null then
    execute 'drop trigger if exists trg_field_season_flags_updated_at on public.field_season_flags';
    execute '
      create trigger trg_field_season_flags_updated_at
      before update on public.field_season_flags
      for each row execute function public.update_updated_at_column()
    ';
  end if;
end $$;

commit;
