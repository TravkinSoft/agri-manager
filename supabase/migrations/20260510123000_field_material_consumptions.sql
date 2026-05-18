begin;

alter table public.tickets
  add column if not exists field_operation_type text;

create table if not exists public.field_material_consumptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid null references public.seasons(id) on delete set null,
  field_id uuid not null references public.fields(id) on delete restrict,
  crop_structure_row_id uuid null references public.crop_structure(id) on delete set null,
  operation_id uuid null references public.operations(id) on delete set null,
  ticket_id uuid null references public.tickets(id) on delete set null,
  ticket_line_id uuid null references public.ticket_lines(id) on delete set null,
  warehouse_id uuid null references public.warehouses(id) on delete set null,
  operation_type text not null,
  material_category text null,
  product_id uuid not null references public.products(id) on delete restrict,
  variety_id uuid null references public.varieties(id) on delete set null,
  reproduction_id uuid null references public.seed_reproductions(id) on delete set null,
  batch_id_text text null,
  batch_class text null default 'commodity',
  quantity_kg numeric(18,3) not null check (quantity_kg > 0),
  area_ha numeric(18,3) null,
  norm_per_ha numeric(18,6) null,
  unit_cost numeric(18,4) null,
  total_cost numeric(18,2) null,
  responsible_personnel_id uuid null references public.reference_specialists(id) on delete set null,
  vehicle_id uuid null references public.reference_vehicles(id) on delete set null,
  notes text null,
  consumed_at timestamptz not null default now(),
  created_by_user_id uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'field_material_consumptions_batch_class_check'
      and conrelid = 'public.field_material_consumptions'::regclass
  ) then
    alter table public.field_material_consumptions
      add constraint field_material_consumptions_batch_class_check
      check (
        batch_class is null
        or batch_class in ('commodity', 'seed', 'feed', 'waste', 'processing', 'rejected')
      );
  end if;
end $$;

create index if not exists idx_field_material_consumptions_company_field
  on public.field_material_consumptions(company_id, field_id, consumed_at desc);

create index if not exists idx_field_material_consumptions_ticket
  on public.field_material_consumptions(ticket_id, ticket_line_id);

create index if not exists idx_field_material_consumptions_identity
  on public.field_material_consumptions(company_id, product_id, variety_id, reproduction_id, batch_class);

create unique index if not exists ux_field_material_consumptions_ticket_line
  on public.field_material_consumptions(ticket_line_id)
  where ticket_line_id is not null;

alter table public.field_material_consumptions enable row level security;

drop policy if exists "Users can view company field material consumptions" on public.field_material_consumptions;
create policy "Users can view company field material consumptions"
  on public.field_material_consumptions
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.company_id = field_material_consumptions.company_id
    )
  );

drop policy if exists "Users can insert company field material consumptions" on public.field_material_consumptions;
create policy "Users can insert company field material consumptions"
  on public.field_material_consumptions
  for insert
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.company_id = field_material_consumptions.company_id
        and p.role in ('admin', 'company_admin', 'warehouse', 'weighman', 'agronomist')
    )
  );

notify pgrst, 'reload schema';

commit;
