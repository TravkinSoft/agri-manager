begin;

alter table public.operations
  add column if not exists operation_category_slug text,
  add column if not exists operation_type_slug text,
  add column if not exists machine_id uuid,
  add column if not exists equipment_id uuid,
  add column if not exists transport_id uuid,
  add column if not exists operation_target text,
  add column if not exists rate_per_ha numeric(12,4),
  add column if not exists spray_volume_per_ha numeric(12,4),
  add column if not exists operation_config jsonb not null default '{}'::jsonb;

create table if not exists public.operation_materials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  operation_id uuid not null references public.operations(id) on delete cascade,
  operation_line_id uuid references public.operation_lines(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_id uuid references public.inventory_batches(id) on delete set null,
  material_type text not null check (
    material_type in (
      'seed',
      'fertilizer',
      'pesticide',
      'adjuvant',
      'ph_corrector',
      'defoamer',
      'biological',
      'fuel',
      'organic'
    )
  ),
  unit text not null check (unit in ('kg', 'l', 'pcs')),
  planned_rate numeric(12,4),
  actual_rate numeric(12,4),
  planned_quantity numeric(14,4),
  issued_quantity numeric(14,4) not null default 0,
  consumed_quantity numeric(14,4),
  returned_quantity numeric(14,4),
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_operation_materials_company_operation
  on public.operation_materials(company_id, operation_id);

create index if not exists idx_operation_materials_company_line
  on public.operation_materials(company_id, operation_line_id);

create index if not exists idx_operation_materials_company_product
  on public.operation_materials(company_id, product_id);

alter table public.operation_materials enable row level security;

drop policy if exists "Users can view company operation materials" on public.operation_materials;
create policy "Users can view company operation materials"
  on public.operation_materials for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company operation materials" on public.operation_materials;
create policy "Users can insert company operation materials"
  on public.operation_materials for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company operation materials" on public.operation_materials;
create policy "Users can update company operation materials"
  on public.operation_materials for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can delete company operation materials" on public.operation_materials;
create policy "Users can delete company operation materials"
  on public.operation_materials for delete
  to authenticated
  using (company_id = public.get_user_company_id());

create table if not exists public.global_admin_impersonation_contexts (
  admin_user_id uuid primary key references public.profiles(id) on delete cascade,
  impersonated_profile_id uuid references public.profiles(id) on delete set null,
  impersonated_company_id uuid references public.companies(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_global_admin_impersonation_context_company
  on public.global_admin_impersonation_contexts(impersonated_company_id);

create table if not exists public.global_admin_impersonation_audit_logs (
  id bigserial primary key,
  admin_user_id uuid not null references public.profiles(id) on delete cascade,
  impersonated_profile_id uuid references public.profiles(id) on delete set null,
  impersonated_company_id uuid references public.companies(id) on delete set null,
  event_type text not null check (event_type in ('start', 'stop', 'deny')),
  event_at timestamptz not null default now(),
  source_ip text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_global_admin_impersonation_audit_admin_time
  on public.global_admin_impersonation_audit_logs(admin_user_id, event_at desc);

create index if not exists idx_global_admin_impersonation_audit_company_time
  on public.global_admin_impersonation_audit_logs(impersonated_company_id, event_at desc);

alter table public.global_admin_impersonation_contexts enable row level security;
alter table public.global_admin_impersonation_audit_logs enable row level security;

drop policy if exists "Global admin can view own impersonation context" on public.global_admin_impersonation_contexts;
create policy "Global admin can view own impersonation context"
  on public.global_admin_impersonation_contexts
  for select
  to authenticated
  using (auth.uid() = admin_user_id);

drop policy if exists "Global admin can manage own impersonation context" on public.global_admin_impersonation_contexts;
create policy "Global admin can manage own impersonation context"
  on public.global_admin_impersonation_contexts
  for all
  to authenticated
  using (auth.uid() = admin_user_id)
  with check (auth.uid() = admin_user_id);

drop policy if exists "Global admin can view own impersonation audit" on public.global_admin_impersonation_audit_logs;
create policy "Global admin can view own impersonation audit"
  on public.global_admin_impersonation_audit_logs
  for select
  to authenticated
  using (auth.uid() = admin_user_id);

commit;

notify pgrst, 'reload schema';
