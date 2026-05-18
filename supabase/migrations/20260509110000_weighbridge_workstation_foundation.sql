begin;

-- 1) Shift foundation
create table if not exists public.weighbridge_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  weighbridge_station_id uuid,
  operator_id uuid not null references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_note text,
  closing_note text,
  handover_note text,
  opened_by uuid not null references public.profiles(id),
  closed_by uuid references public.profiles(id),
  ticket_count integer not null default 0,
  closed_ticket_count integer not null default 0,
  voided_ticket_count integer not null default 0,
  manual_correction_count integer not null default 0,
  gross_total_kg numeric(18,3) not null default 0,
  net_total_kg numeric(18,3) not null default 0,
  unresolved_ticket_count integer not null default 0,
  unsynced_count integer not null default 0,
  summary_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_weighbridge_shifts_open_unique
  on public.weighbridge_shifts(company_id, operator_id)
  where status = 'open';
create index if not exists idx_weighbridge_shifts_company_status on public.weighbridge_shifts(company_id, status);
create index if not exists idx_weighbridge_shifts_company_opened_at on public.weighbridge_shifts(company_id, opened_at desc);

-- 2) Processing nodes foundation
create table if not exists public.processing_nodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  type text not null check (
    type in (
      'zav','bis','dryer','cleaning_line','sorting_line','calibration_line',
      'seed_treatment_line','warming_area','aeration_area','packaging_line','other'
    )
  ),
  linked_warehouse_id uuid references public.warehouses(id),
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, name)
);

create index if not exists idx_processing_nodes_company_active on public.processing_nodes(company_id, is_active, archived);

-- 3) Batch foundation
create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid references public.seasons(id),
  product_id uuid references public.products(id),
  crop_id uuid references public.crops(id),
  variety_id uuid references public.varieties(id),
  reproduction_id uuid references public.seed_reproductions(id),
  source_field_id uuid references public.fields(id),
  source_ticket_id uuid references public.tickets(id),
  harvest_year integer,
  batch_code text not null,
  status text not null default 'raw' check (
    status in (
      'raw','drying','cleaning','conditioned','calibrated','treated',
      'ready_for_seeding','commodity','forage','waste','rejected'
    )
  ),
  initial_weight_kg numeric(18,3),
  current_weight_kg numeric(18,3),
  moisture_percent numeric(8,3),
  purity_percent numeric(8,3),
  dockage_percent numeric(8,3),
  germination_percent numeric(8,3),
  energy_percent numeric(8,3),
  quality_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, batch_code)
);

create index if not exists idx_inventory_batches_company_status on public.inventory_batches(company_id, status);
create index if not exists idx_inventory_batches_company_product on public.inventory_batches(company_id, product_id);
create index if not exists idx_inventory_batches_company_crop on public.inventory_batches(company_id, crop_id);

create table if not exists public.batch_transformations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  processing_node_id uuid references public.processing_nodes(id),
  transformation_type text not null check (
    transformation_type in (
      'drying','cleaning','calibration','sorting','seed_treatment',
      'conditioning','aeration','potato_sorting','other'
    )
  ),
  status text not null default 'draft' check (status in ('draft', 'completed', 'voided')),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  completed_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.batch_transformation_inputs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transformation_id uuid not null references public.batch_transformations(id) on delete cascade,
  batch_id uuid references public.inventory_batches(id),
  warehouse_from_id uuid references public.warehouses(id),
  input_weight_kg numeric(18,3) not null,
  input_quality_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.batch_transformation_outputs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transformation_id uuid not null references public.batch_transformations(id) on delete cascade,
  output_batch_id uuid references public.inventory_batches(id),
  warehouse_to_id uuid references public.warehouses(id),
  line_type text not null check (
    line_type in (
      'cleaned_seed','commodity','forage_fraction','waste_fraction','soil','shrink_loss',
      'treated_seed','calibrated_fraction','potato_marketable','potato_seed',
      'potato_small','potato_rotten','potato_soil','other'
    )
  ),
  output_weight_kg numeric(18,3) not null,
  output_quality_json jsonb,
  created_at timestamptz not null default now()
);

-- 4) Extend tickets/ticket_lines safely
alter table public.tickets add column if not exists shift_id uuid references public.weighbridge_shifts(id);
alter table public.tickets add column if not exists processing_node_id uuid references public.processing_nodes(id);
alter table public.tickets add column if not exists source_type text;
alter table public.tickets add column if not exists destination_type text;
alter table public.tickets add column if not exists supplier_id uuid;
alter table public.tickets add column if not exists buyer_id uuid;
alter table public.tickets add column if not exists harvest_year integer;
alter table public.tickets add column if not exists weight_source text;
alter table public.tickets add column if not exists manual_correction_reason text;
alter table public.tickets add column if not exists stored_tare_used boolean not null default false;
alter table public.tickets add column if not exists quality_json jsonb;
alter table public.tickets add column if not exists batch_id uuid references public.inventory_batches(id);
alter table public.tickets add column if not exists lot_id text;
alter table public.tickets add column if not exists local_sync_status text;
alter table public.tickets add column if not exists requires_review boolean not null default false;
alter table public.tickets add column if not exists review_reason text;
alter table public.tickets add column if not exists audit_json jsonb;

alter table public.ticket_lines add column if not exists crop_id uuid references public.crops(id);
alter table public.ticket_lines add column if not exists batch_id uuid references public.inventory_batches(id);
alter table public.ticket_lines add column if not exists lot_id text;
alter table public.ticket_lines add column if not exists warehouse_from_id uuid references public.warehouses(id);
alter table public.ticket_lines add column if not exists warehouse_to_id uuid references public.warehouses(id);
alter table public.ticket_lines add column if not exists quantity_kg numeric(18,3);
alter table public.ticket_lines add column if not exists quality_json jsonb;
alter table public.ticket_lines add column if not exists line_type text;

-- 5) Useful indexes
create index if not exists idx_tickets_company_shift on public.tickets(company_id, shift_id);
create index if not exists idx_tickets_company_vehicle_status on public.tickets(company_id, vehicle_id, status);
create index if not exists idx_tickets_company_processing_node on public.tickets(company_id, processing_node_id);
create index if not exists idx_ticket_lines_company_ticket on public.ticket_lines(company_id, ticket_id);
create index if not exists idx_ticket_lines_company_batch on public.ticket_lines(company_id, batch_id);

-- 6) updated_at trigger helper use existing function if present
do $$
begin
  if exists(select 1 from pg_proc where proname='update_updated_at_column') then
    execute 'drop trigger if exists trg_weighbridge_shifts_updated_at on public.weighbridge_shifts';
    execute 'create trigger trg_weighbridge_shifts_updated_at before update on public.weighbridge_shifts for each row execute function update_updated_at_column()';
    execute 'drop trigger if exists trg_processing_nodes_updated_at on public.processing_nodes';
    execute 'create trigger trg_processing_nodes_updated_at before update on public.processing_nodes for each row execute function update_updated_at_column()';
    execute 'drop trigger if exists trg_inventory_batches_updated_at on public.inventory_batches';
    execute 'create trigger trg_inventory_batches_updated_at before update on public.inventory_batches for each row execute function update_updated_at_column()';
    execute 'drop trigger if exists trg_batch_transformations_updated_at on public.batch_transformations';
    execute 'create trigger trg_batch_transformations_updated_at before update on public.batch_transformations for each row execute function update_updated_at_column()';
  end if;
end $$;

-- 7) RLS (company-scoped, additive)
alter table public.weighbridge_shifts enable row level security;
alter table public.processing_nodes enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.batch_transformations enable row level security;
alter table public.batch_transformation_inputs enable row level security;
alter table public.batch_transformation_outputs enable row level security;

drop policy if exists weighbridge_shifts_rw on public.weighbridge_shifts;
create policy weighbridge_shifts_rw on public.weighbridge_shifts
for all to authenticated
using (company_id = get_user_company_id())
with check (company_id = get_user_company_id());

drop policy if exists processing_nodes_rw on public.processing_nodes;
create policy processing_nodes_rw on public.processing_nodes
for all to authenticated
using (company_id = get_user_company_id())
with check (company_id = get_user_company_id());

drop policy if exists inventory_batches_rw on public.inventory_batches;
create policy inventory_batches_rw on public.inventory_batches
for all to authenticated
using (company_id = get_user_company_id())
with check (company_id = get_user_company_id());

drop policy if exists batch_transformations_rw on public.batch_transformations;
create policy batch_transformations_rw on public.batch_transformations
for all to authenticated
using (company_id = get_user_company_id())
with check (company_id = get_user_company_id());

drop policy if exists batch_transformation_inputs_rw on public.batch_transformation_inputs;
create policy batch_transformation_inputs_rw on public.batch_transformation_inputs
for all to authenticated
using (company_id = get_user_company_id())
with check (company_id = get_user_company_id());

drop policy if exists batch_transformation_outputs_rw on public.batch_transformation_outputs;
create policy batch_transformation_outputs_rw on public.batch_transformation_outputs
for all to authenticated
using (company_id = get_user_company_id())
with check (company_id = get_user_company_id());

commit;
