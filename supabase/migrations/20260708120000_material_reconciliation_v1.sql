-- PHASE 5.6D - MATERIAL RECONCILIATION V1
-- Do not apply to production without explicit confirmation.
-- Adds reconciliation fields to existing canonical workflow tables.

begin;

alter table public.warehouse_issue_request_items
  add column if not exists prepared_quantity numeric(12, 4) not null default 0,
  add column if not exists prepared_unit text,
  add column if not exists issued_unit text,
  add column if not exists received_quantity numeric(12, 4) not null default 0,
  add column if not exists received_unit text,
  add column if not exists expected_consumed_quantity numeric(12, 4) not null default 0,
  add column if not exists shortage_quantity numeric(12, 4) not null default 0,
  add column if not exists package_size numeric(12, 4),
  add column if not exists package_count numeric(12, 4),
  add column if not exists package_unit text,
  add column if not exists reconciliation_status text not null default 'pending',
  add column if not exists substitution_status text not null default 'none',
  add column if not exists planned_product_id uuid references public.products(id) on delete set null,
  add column if not exists actual_product_id uuid references public.products(id) on delete set null,
  add column if not exists substitution_reason text,
  add column if not exists substitution_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists substitution_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists substitution_approved_at timestamptz;

alter table public.operation_materials
  add column if not exists loss_quantity numeric(14, 4) not null default 0;

update public.warehouse_issue_request_items
set
  planned_product_id = coalesce(planned_product_id, product_id),
  actual_product_id = coalesce(actual_product_id, product_id),
  prepared_unit = coalesce(prepared_unit, unit),
  issued_unit = coalesce(issued_unit, unit),
  received_unit = coalesce(received_unit, unit),
  package_unit = coalesce(package_unit, unit)
where planned_product_id is null
   or actual_product_id is null
   or prepared_unit is null
   or issued_unit is null
   or received_unit is null
   or package_unit is null;

alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_reconciliation_nonnegative_check;

alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_reconciliation_nonnegative_check
  check (
    prepared_quantity >= 0
    and coalesce(issued_quantity, 0) >= 0
    and received_quantity >= 0
    and expected_consumed_quantity >= 0
    and coalesce(consumed_quantity, 0) >= 0
    and coalesce(returned_quantity, 0) >= 0
    and coalesce(return_received_quantity, 0) >= 0
    and coalesce(loss_quantity, 0) >= 0
    and coalesce(expected_return_quantity, 0) >= 0
    and shortage_quantity >= 0
    and coalesce(package_count, 0) >= 0
  );

alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_package_size_check;

alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_package_size_check
  check (package_size is null or package_size > 0);

alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_package_count_size_check;

alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_package_count_size_check
  check (coalesce(package_count, 0) = 0 or package_size is not null);

alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_reconciliation_status_check;

alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_reconciliation_status_check
  check (
    reconciliation_status in (
      'not_required',
      'pending',
      'prepared',
      'issued',
      'received',
      'in_progress',
      'return_required',
      'return_declared',
      'return_received',
      'shortage',
      'loss_review',
      'reconciled',
      'blocked',
      'cancelled'
    )
  );

alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_substitution_status_check;

alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_substitution_status_check
  check (substitution_status in ('none', 'proposed', 'approved', 'rejected'));

create index if not exists idx_wiri_reconciliation_status
  on public.warehouse_issue_request_items(company_id, reconciliation_status);

create index if not exists idx_wiri_substitution_status
  on public.warehouse_issue_request_items(company_id, substitution_status);

create index if not exists idx_wiri_planned_actual_product
  on public.warehouse_issue_request_items(company_id, planned_product_id, actual_product_id);

alter table public.field_history_entries
  add column if not exists operation_id uuid references public.operations(id) on delete set null,
  add column if not exists actual_completed_area_ha numeric(14, 4),
  add column if not exists material_facts jsonb not null default '[]'::jsonb,
  add column if not exists material_reconciliation_status text;

create index if not exists idx_field_history_entries_operation
  on public.field_history_entries(company_id, operation_id);

comment on column public.warehouse_issue_request_items.prepared_quantity is
  'Quantity physically prepared by warehouse before specialist pickup.';
comment on column public.warehouse_issue_request_items.received_quantity is
  'Quantity confirmed by specialist as physically received.';
comment on column public.warehouse_issue_request_items.expected_consumed_quantity is
  'Expected consumption recalculated from actual completed area and planned demand.';
comment on column public.warehouse_issue_request_items.shortage_quantity is
  'Expected consumption above issued quantity; requires extra request, agronomist approval, or explanation.';
comment on column public.warehouse_issue_request_items.reconciliation_status is
  'Material reconciliation lifecycle for request item.';
comment on column public.warehouse_issue_request_items.substitution_status is
  'Planned vs actual material substitution approval status.';
comment on column public.field_history_entries.material_facts is
  'Operation material facts written only after operation close and reconciliation.';

commit;
