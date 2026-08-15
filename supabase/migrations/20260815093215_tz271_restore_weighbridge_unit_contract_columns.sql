begin;

-- TZ271 repairs schema drift where warehouse_canonical_units_v2 is recorded in
-- migration history but its additive columns are absent from Production.
alter table public.products
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz;

alter table public.inventory_transactions
  add column if not exists base_quantity numeric(18,6),
  add column if not exists base_uom text,
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists batch_class text,
  add column if not exists unit_source text,
  add column if not exists unit_contract_version smallint;

alter table public.stock_ledger_entries
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists unit_source text,
  add column if not exists unit_contract_version smallint;

alter table public.ticket_lines
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists unit_source text,
  add column if not exists unit_contract_version smallint;

alter table public.inventory_batches
  add column if not exists initial_quantity numeric(18,6),
  add column if not exists current_quantity numeric(18,6),
  add column if not exists uom text,
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists unit_source text,
  add column if not exists unit_contract_version smallint;

alter table public.field_material_consumptions
  add column if not exists quantity numeric(18,6),
  add column if not exists uom text,
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists unit_contract_version smallint;

commit;
