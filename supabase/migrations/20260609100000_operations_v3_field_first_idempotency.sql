begin;

alter table public.operations
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text;

create unique index if not exists idx_operations_company_idempotency_key
  on public.operations(company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_operations_company_crop_structure
  on public.operations(company_id, crop_structure_id)
  where crop_structure_id is not null;

create table if not exists public.crop_structure_change_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_id uuid not null references public.fields(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_crop_structure_id uuid references public.crop_structure(id) on delete set null,
  new_crop_structure_id uuid references public.crop_structure(id) on delete set null,
  operation_id uuid references public.operations(id) on delete set null,
  change_type text not null check (change_type in ('area_split', 'crop_replace')),
  old_crop_id uuid references public.crops(id) on delete set null,
  new_crop_id uuid references public.crops(id) on delete set null,
  old_area_ha numeric(12, 2),
  new_area_ha numeric(12, 2),
  payload jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crop_structure_change_events_company_field
  on public.crop_structure_change_events(company_id, field_id, season_id, created_at desc);

alter table public.crop_structure_change_events enable row level security;

drop policy if exists "Users can view company crop structure changes" on public.crop_structure_change_events;
create policy "Users can view company crop structure changes"
  on public.crop_structure_change_events for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.company_id = crop_structure_change_events.company_id
    )
  );

drop policy if exists "Users can insert company crop structure changes" on public.crop_structure_change_events;
create policy "Users can insert company crop structure changes"
  on public.crop_structure_change_events for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.company_id = crop_structure_change_events.company_id
        and p.role in ('global_admin', 'company_admin', 'agronomist')
    )
  );

commit;

notify pgrst, 'reload schema';
