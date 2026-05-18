-- Part 01: import_batches
begin;

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  import_type text not null default 'sowing_structure_2026',
  source_file_name text not null,
  source_sheet_name text not null default '2026',
  source_file_path text null,
  status text not null check (status in ('dry_run', 'executed', 'failed')),
  dry_run_report jsonb not null default '{}'::jsonb,
  execute_report jsonb not null default '{}'::jsonb,
  warnings_count integer not null default 0,
  errors_count integer not null default 0,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_import_batches_company_created
  on public.import_batches(company_id, created_at desc);

do $$
begin
  if to_regprocedure('public.update_updated_at_column()') is not null then
    execute 'drop trigger if exists trg_import_batches_updated_at on public.import_batches';
    execute '
      create trigger trg_import_batches_updated_at
      before update on public.import_batches
      for each row execute function public.update_updated_at_column()
    ';
  end if;
end $$;

commit;
