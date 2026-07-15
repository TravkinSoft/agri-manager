-- Foundation tables for safe company data reset and sowing structure import.
-- Scope: metadata/import audit only. Ledger/accounting logic is untouched.

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

drop trigger if exists trg_import_batches_updated_at on public.import_batches;
create trigger trg_import_batches_updated_at
before update on public.import_batches
for each row execute function public.update_updated_at_column();

create table if not exists public.import_batch_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  row_index integer not null,
  original_field_key text null,
  resolved_field_name text null,
  source_row_hash text not null,
  row_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  status text not null default 'parsed'
    check (status in ('parsed', 'skipped', 'warning', 'imported', 'error')),
  created_at timestamptz not null default now()
);

create unique index if not exists ux_import_batch_rows_unique_source_row
  on public.import_batch_rows(import_batch_id, source_row_hash);

create index if not exists idx_import_batch_rows_scope
  on public.import_batch_rows(company_id, import_batch_id, row_index);

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

drop trigger if exists trg_field_season_flags_updated_at on public.field_season_flags;
create trigger trg_field_season_flags_updated_at
before update on public.field_season_flags
for each row execute function public.update_updated_at_column();

create table if not exists public.field_history_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_id uuid not null references public.fields(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  season_year integer not null check (season_year between 2000 and 2100),
  crop_id uuid null references public.crops(id) on delete set null,
  history_value text not null check (length(trim(history_value)) > 0),
  token text null,
  original_raw_value text not null default '',
  parsed_from_multivalue boolean not null default false,
  parse_confidence numeric(5,2) null check (parse_confidence is null or (parse_confidence >= 0 and parse_confidence <= 100)),
  source text not null default 'import_2026_structure',
  import_batch_id uuid null references public.import_batches(id) on delete set null,
  import_row_index integer null,
  source_row_hash text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_field_history_entries_scope
  on public.field_history_entries(company_id, field_id, season_year);

create index if not exists idx_field_history_entries_crop
  on public.field_history_entries(company_id, crop_id, season_year);

drop trigger if exists trg_field_history_entries_updated_at on public.field_history_entries;
create trigger trg_field_history_entries_updated_at
before update on public.field_history_entries
for each row execute function public.update_updated_at_column();

alter table public.import_batches enable row level security;
alter table public.import_batch_rows enable row level security;
alter table public.field_season_flags enable row level security;
alter table public.field_history_entries enable row level security;

drop policy if exists "Users can view company import batches" on public.import_batches;
drop policy if exists "Users can insert company import batches" on public.import_batches;
drop policy if exists "Users can update company import batches" on public.import_batches;
drop policy if exists "Users can delete company import batches" on public.import_batches;

create policy "Users can view company import batches"
  on public.import_batches
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company import batches"
  on public.import_batches
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company import batches"
  on public.import_batches
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company import batches"
  on public.import_batches
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company import batch rows" on public.import_batch_rows;
drop policy if exists "Users can insert company import batch rows" on public.import_batch_rows;
drop policy if exists "Users can update company import batch rows" on public.import_batch_rows;
drop policy if exists "Users can delete company import batch rows" on public.import_batch_rows;

create policy "Users can view company import batch rows"
  on public.import_batch_rows
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company import batch rows"
  on public.import_batch_rows
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company import batch rows"
  on public.import_batch_rows
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company import batch rows"
  on public.import_batch_rows
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company field season flags" on public.field_season_flags;
drop policy if exists "Users can insert company field season flags" on public.field_season_flags;
drop policy if exists "Users can update company field season flags" on public.field_season_flags;
drop policy if exists "Users can delete company field season flags" on public.field_season_flags;

create policy "Users can view company field season flags"
  on public.field_season_flags
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company field season flags"
  on public.field_season_flags
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company field season flags"
  on public.field_season_flags
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company field season flags"
  on public.field_season_flags
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company field history entries" on public.field_history_entries;
drop policy if exists "Users can insert company field history entries" on public.field_history_entries;
drop policy if exists "Users can update company field history entries" on public.field_history_entries;
drop policy if exists "Users can delete company field history entries" on public.field_history_entries;

create policy "Users can view company field history entries"
  on public.field_history_entries
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company field history entries"
  on public.field_history_entries
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company field history entries"
  on public.field_history_entries
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company field history entries"
  on public.field_history_entries
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop trigger if exists trg_field_history_entries_updated_at
  on public.field_history_entries;

commit;
