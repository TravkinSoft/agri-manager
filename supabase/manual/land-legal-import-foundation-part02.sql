-- Part 02: import_batch_rows + link to field_cadastre_links
begin;

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

do $$
begin
  if to_regclass('public.field_cadastre_links') is not null
     and to_regclass('public.import_batches') is not null then
    begin
      alter table public.field_cadastre_links
        add column if not exists import_batch_id uuid null
          references public.import_batches(id) on delete set null;
    exception
      when others then null;
    end;
  end if;
end $$;

create index if not exists idx_field_cadastre_links_import_batch
  on public.field_cadastre_links(import_batch_id)
  where import_batch_id is not null;

commit;
