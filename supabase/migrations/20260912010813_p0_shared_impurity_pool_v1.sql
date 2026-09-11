begin;

-- P0 shared impurity pool V1.
--
-- One physical impurity-removal ticket may cover several exact harvest source
-- slices (crop_structure rows).  V1 deliberately does not invent a per-slice
-- impurity allocation.  Instead it freezes every exact source batch, moves the
-- complete unchanged balance of those batches into one warehouse-local pool,
-- and posts the measured impurity once against that pool:
--
--   source OUT (-S) + pool IN (+S) + impurity OUT (-I) = ticket effect (-I)
--
-- The pool clean balance is S-I.  Every member remains explicitly unresolved,
-- so downstream field yield must not treat the pool total as a per-field fact.
-- Source varieties/reproductions may differ: the pool is explicitly
-- shared_unresolved, with NULL scalar identity and an ordered provenance
-- snapshot; its pre-impurity masses are never presented as clean allocations.
-- Existing one-lot impurity functions and their signatures are not replaced.

do $preconditions$
begin
  if pg_catalog.to_regclass('public.tickets') is null
     or pg_catalog.to_regclass('public.ticket_lines') is null
     or pg_catalog.to_regclass('public.ticket_weighings') is null
     or pg_catalog.to_regclass('public.inventory_batches') is null
     or pg_catalog.to_regclass('public.stock_ledger_entries') is null
     or pg_catalog.to_regclass('public.harvest_lots') is null
     or pg_catalog.to_regclass('public.harvest_lot_batches') is null
     or pg_catalog.to_regclass('public.crop_structure') is null
     or pg_catalog.to_regclass('private.weighbridge_operator_sessions') is null
     or pg_catalog.to_regprocedure('public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)') is null
     or pg_catalog.to_regprocedure('private.tz315_lock_company_season_write_gate_v1(uuid,uuid)') is null
     or pg_catalog.to_regprocedure('private.assert_processing_gate_actor_v1(uuid,uuid)') is null
     or pg_catalog.to_regprocedure('private.resolve_processing_gate_session_actor_v1()') is null
     or pg_catalog.to_regprocedure('private.reconcile_harvest_lot_batch_balance_v1(uuid)') is null
     or pg_catalog.to_regprocedure('private.reconcile_warehouse_local_batch_balance_v1(uuid)') is null
     or pg_catalog.to_regprocedure('private.weighbridge_batch_available_for_ticket_v1(uuid,uuid)') is null
     or pg_catalog.to_regclass('public.v_weighbridge_open_ticket_reservations_v1') is null
     or pg_catalog.to_regclass('public.v_processing_active_allocations_v1') is null
     or pg_catalog.to_regclass('public.v_stock_balance_identity') is null
     or pg_catalog.to_regprocedure('public.canonical_stock_uom(text)') is null
  then
    raise exception 'SHARED_IMPURITY_PREREQUISITE_MISSING' using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_batches'
      and column_name = 'physical_state'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_batches'
      and column_name = 'crop_structure_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_ledger_entries'
      and column_name = 'inventory_batch_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_batches'
      and column_name = 'uom'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_batches'
      and column_name = 'composition_snapshot'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_batches'
      and column_name = 'composition_hash'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_batches'
      and column_name = 'is_mixed_harvest'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_batches'
      and column_name = 'display_name'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tickets'
      and column_name = 'source_physical_state'
  ) or (
    select pg_catalog.count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tickets'
      and column_name in (
        'correction_of_ticket_id',
        'linked_request_id',
        'linked_processing_id',
        'processing_output_role'
      )
  ) <> 4
  or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products'
      and column_name = 'base_uom'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'harvest_lots'
      and column_name = 'season_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'harvest_lots'
      and column_name = 'crop_id'
  ) then
    raise exception 'SHARED_IMPURITY_EXACT_BATCH_CONTRACT_MISSING' using errcode = '55000';
  end if;
end
$preconditions$;

create table public.weighbridge_shared_impurity_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ticket_id uuid not null unique references public.tickets(id) on delete cascade,
  source_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  crop_id uuid not null references public.crops(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  identity_kind text not null default 'shared_unresolved'
    check (identity_kind = 'shared_unresolved'),
  display_name text not null
    check (nullif(pg_catalog.btrim(display_name), '') is not null),
  composition_snapshot jsonb not null
    check (
      pg_catalog.jsonb_typeof(composition_snapshot) = 'array'
      and pg_catalog.jsonb_array_length(composition_snapshot) >= 2
    ),
  composition_hash text not null,
  is_mixed_harvest boolean not null default true
    check (is_mixed_harvest),
  pool_inventory_batch_id uuid unique references public.inventory_batches(id) on delete restrict,
  state text not null default 'open',
  member_resolution_status text not null default 'unresolved'
    check (member_resolution_status = 'unresolved'),
  impurity_type text not null
    check (impurity_type in ('soil_and_trash', 'nonconforming_crop', 'plant_residues', 'other')),
  source_total_kg numeric(18,6),
  impurity_weight_kg numeric(18,6),
  clean_total_kg numeric(18,6),
  source_scope_hash text,
  create_idempotency_key uuid not null,
  create_request_fingerprint text not null,
  finalize_idempotency_key uuid,
  finalize_request_fingerprint text,
  pool_in_ledger_entry_id uuid references public.stock_ledger_entries(id) on delete restrict,
  impurity_out_ledger_entry_id uuid references public.stock_ledger_entries(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_by_person_id uuid not null references public.company_people(id) on delete restrict,
  finalized_by uuid references public.profiles(id) on delete restrict,
  finalized_by_person_id uuid references public.company_people(id) on delete restrict,
  finalized_at timestamptz,
  voided_by uuid references public.profiles(id) on delete restrict,
  voided_at timestamptz,
  audit_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint weighbridge_shared_impurity_groups_id_company_uq
    unique (id, company_id),
  constraint weighbridge_shared_impurity_groups_create_idem_uq
    unique (company_id, create_idempotency_key),
  constraint weighbridge_shared_impurity_groups_hash_check
    check (
      pg_catalog.length(create_request_fingerprint) = 64
      and pg_catalog.length(composition_hash) = 64
      and (source_scope_hash is null or pg_catalog.length(source_scope_hash) = 64)
      and (finalize_request_fingerprint is null or pg_catalog.length(finalize_request_fingerprint) = 64)
    ),
  constraint weighbridge_shared_impurity_groups_weight_check
    check (
      (
        source_total_kg > 0
        and impurity_weight_kg is null
        and clean_total_kg is null
      )
      or (
        source_total_kg > 0
        and impurity_weight_kg > 0
        and clean_total_kg >= 0
        and pg_catalog.abs(source_total_kg - impurity_weight_kg - clean_total_kg) <= 0.000001
      )
    ),
  constraint weighbridge_shared_impurity_groups_state_check
    check (
      (state = 'open'
        and pool_inventory_batch_id is null
        and source_total_kg is not null
        and impurity_weight_kg is null
        and clean_total_kg is null
        and finalize_idempotency_key is null
        and finalize_request_fingerprint is null
        and finalized_at is null)
      or (state = 'finalized'
        and pool_inventory_batch_id is not null
        and source_total_kg is not null
        and impurity_weight_kg is not null
        and clean_total_kg is not null
        and finalize_idempotency_key is not null
        and finalize_request_fingerprint is not null
        and pool_in_ledger_entry_id is not null
        and impurity_out_ledger_entry_id is not null
        and finalized_by is not null
        and finalized_by_person_id is not null
        and finalized_at is not null)
      or state = 'voided'
    )
);

create table public.weighbridge_shared_impurity_members (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null,
  company_id uuid not null,
  crop_structure_id uuid not null references public.crop_structure(id) on delete restrict,
  field_id uuid not null references public.fields(id) on delete restrict,
  source_batch_count integer not null default 0 check (source_batch_count >= 0),
  source_total_snapshot_kg numeric(18,6) not null default 0
    check (source_total_snapshot_kg >= 0),
  identity_snapshot jsonb not null
    check (pg_catalog.jsonb_typeof(identity_snapshot) = 'object'),
  clean_balance_status text not null default 'unresolved'
    check (clean_balance_status = 'unresolved'),
  yield_status text not null default 'unresolved'
    check (yield_status = 'unresolved'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint weighbridge_shared_impurity_members_group_company_fk
    foreign key (group_id, company_id)
    references public.weighbridge_shared_impurity_groups(id, company_id)
    on delete cascade,
  constraint weighbridge_shared_impurity_members_scope_uq
    unique (group_id, crop_structure_id),
  constraint weighbridge_shared_impurity_members_composite_uq
    unique (id, group_id, company_id, crop_structure_id)
);

create table public.weighbridge_shared_impurity_source_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null,
  member_id uuid not null,
  company_id uuid not null,
  crop_structure_id uuid not null references public.crop_structure(id) on delete restrict,
  source_ticket_id uuid references public.tickets(id) on delete restrict,
  harvest_lot_id uuid not null references public.harvest_lots(id) on delete restrict,
  inventory_batch_id uuid not null references public.inventory_batches(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  source_balance_snapshot_kg numeric(18,6) not null
    check (source_balance_snapshot_kg > 0),
  state text not null default 'selected',
  reclass_out_ledger_entry_id uuid references public.stock_ledger_entries(id) on delete restrict,
  reclassified_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint weighbridge_shared_impurity_source_batches_group_company_fk
    foreign key (group_id, company_id)
    references public.weighbridge_shared_impurity_groups(id, company_id)
    on delete cascade,
  constraint weighbridge_shared_impurity_source_batches_member_scope_fk
    foreign key (member_id, group_id, company_id, crop_structure_id)
    references public.weighbridge_shared_impurity_members(
      id, group_id, company_id, crop_structure_id
    ) on delete cascade,
  constraint weighbridge_shared_impurity_source_batches_group_batch_uq
    unique (group_id, inventory_batch_id),
  constraint weighbridge_shared_impurity_source_batches_state_check
    check (
      (state = 'selected' and reclass_out_ledger_entry_id is null and reclassified_at is null)
      or (state = 'reclassified' and reclass_out_ledger_entry_id is not null and reclassified_at is not null)
      or (state = 'released' and (
        (reclass_out_ledger_entry_id is null and reclassified_at is null)
        or (reclass_out_ledger_entry_id is not null and reclassified_at is not null)
      ))
    )
);

create index weighbridge_shared_impurity_groups_company_state_idx
  on public.weighbridge_shared_impurity_groups(company_id, state, created_at desc);
create unique index weighbridge_shared_impurity_groups_finalize_idem_uq
  on public.weighbridge_shared_impurity_groups(company_id, finalize_idempotency_key)
  where finalize_idempotency_key is not null;
create index weighbridge_shared_impurity_members_crop_idx
  on public.weighbridge_shared_impurity_members(company_id, crop_structure_id, created_at desc);
create index weighbridge_shared_impurity_source_batches_group_idx
  on public.weighbridge_shared_impurity_source_batches(group_id, inventory_batch_id);
create index weighbridge_shared_impurity_source_batches_crop_idx
  on public.weighbridge_shared_impurity_source_batches(company_id, crop_structure_id, state);
create index weighbridge_shared_impurity_source_batches_lot_idx
  on public.weighbridge_shared_impurity_source_batches(company_id, harvest_lot_id, state);
create unique index weighbridge_shared_impurity_source_batches_active_batch_uq
  on public.weighbridge_shared_impurity_source_batches(inventory_batch_id)
  where state in ('selected', 'reclassified');

alter table public.weighbridge_shared_impurity_groups enable row level security;
alter table public.weighbridge_shared_impurity_members enable row level security;
alter table public.weighbridge_shared_impurity_source_batches enable row level security;

create policy weighbridge_shared_impurity_groups_select_v1
on public.weighbridge_shared_impurity_groups
for select to authenticated
using (company_id = (select public.get_user_company_id()));

create policy weighbridge_shared_impurity_members_select_v1
on public.weighbridge_shared_impurity_members
for select to authenticated
using (company_id = (select public.get_user_company_id()));

create policy weighbridge_shared_impurity_source_batches_select_v1
on public.weighbridge_shared_impurity_source_batches
for select to authenticated
using (company_id = (select public.get_user_company_id()));

revoke all privileges on table public.weighbridge_shared_impurity_groups
  from public, anon, authenticated, service_role;
revoke all privileges on table public.weighbridge_shared_impurity_members
  from public, anon, authenticated, service_role;
revoke all privileges on table public.weighbridge_shared_impurity_source_batches
  from public, anon, authenticated, service_role;
grant select on table public.weighbridge_shared_impurity_groups
  to authenticated, service_role;
grant select on table public.weighbridge_shared_impurity_members
  to authenticated, service_role;
grant select on table public.weighbridge_shared_impurity_source_batches
  to authenticated, service_role;

comment on table public.weighbridge_shared_impurity_groups is
  'One physical impurity ticket across exact crop-structure sources. Group clean total is exact; member clean balances remain unresolved.';
comment on table public.weighbridge_shared_impurity_members is
  'Selected crop_structure slices. V1 intentionally stores no invented member impurity or clean kilograms.';
comment on table public.weighbridge_shared_impurity_source_batches is
  'Frozen exact inventory batches and complete balances reclassified into a shared impurity pool.';
comment on column public.weighbridge_shared_impurity_groups.member_resolution_status is
  'Always unresolved in V1: group impurity is never proportionally allocated to crop_structure members.';
comment on column public.weighbridge_shared_impurity_members.source_total_snapshot_kg is
  'Exact pre-reclassification source mass only; it is not a clean yield.';
comment on column public.weighbridge_shared_impurity_members.identity_snapshot is
  'Frozen field/crop/variety/reproduction labels for stable ticket display; never a clean-mass allocation.';
comment on column public.weighbridge_shared_impurity_groups.composition_snapshot is
  'Frozen ordered source identities and pre-impurity masses. They are provenance only; no item is a clean-mass allocation.';

-- A shared open ticket promises the complete frozen balance of every selected
-- source batch.  Publish that promise through the same reservation contract
-- used by ordinary weighbridge finalizers.  Keeping the five-column signature
-- makes this a safe CREATE OR REPLACE for existing consumers.
create or replace view public.v_weighbridge_open_ticket_reservations_v1
with (security_invoker = true)
as
select
  t.company_id,
  t.id as ticket_id,
  t.warehouse_from_id as warehouse_id,
  case
    when coalesce(tl.batch_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then tl.batch_id::uuid
    else null
  end as batch_id,
  pg_catalog.sum(
    coalesce(tl.quantity_kg, tl.net_line_weight_kg, tl.mass_kg, tl.quantity, 0)
  )::numeric(18,6) as reserved_kg
from public.tickets t
join public.ticket_lines tl
  on tl.ticket_id = t.id
 and tl.company_id = t.company_id
where t.processing_allocation_ready
  and not coalesce(t.is_finalized, false)
  and not coalesce(t.is_voided, false)
  and t.status::text not in ('finalized', 'voided')
  and coalesce(tl.batch_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
group by t.company_id, t.id, t.warehouse_from_id,
  case
    when coalesce(tl.batch_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then tl.batch_id::uuid
    else null
  end

union all

select
  source.company_id,
  pool.ticket_id,
  source.warehouse_id,
  source.inventory_batch_id as batch_id,
  source.source_balance_snapshot_kg::numeric(18,6) as reserved_kg
from public.weighbridge_shared_impurity_source_batches source
join public.weighbridge_shared_impurity_groups pool
  on pool.id = source.group_id
 and pool.company_id = source.company_id
where pool.state = 'open'
  and source.state = 'selected';

revoke all on table public.v_weighbridge_open_ticket_reservations_v1
  from public, anon;
grant select on table public.v_weighbridge_open_ticket_reservations_v1
  to authenticated, service_role;

-- Restore the complete effective-balance contract (processing plus open ticket
-- reservations) without changing the established output column order.
create or replace view public.v_effective_stock_balance_identity_v1
with (security_invoker = true)
as
select
  stock.*,
  coalesce(allocations.allocated_kg, 0)::numeric(16,3) as processing_allocated_kg,
  greatest(
    stock.quantity
      - coalesce(allocations.allocated_kg, 0)
      - coalesce(reservations.reserved_kg, 0),
    0
  )::numeric(16,3) as effective_available_kg,
  coalesce(reservations.reserved_kg, 0)::numeric(16,3) as open_ticket_reserved_kg
from public.v_stock_balance_identity stock
left join (
  select company_id, warehouse_id, batch_id, pg_catalog.sum(allocated_kg) as allocated_kg
  from public.v_processing_active_allocations_v1
  group by company_id, warehouse_id, batch_id
) allocations
  on allocations.company_id = stock.company_id
 and allocations.warehouse_id = stock.warehouse_id
 and allocations.batch_id::text = stock.batch_id::text
left join (
  select company_id, warehouse_id, batch_id, pg_catalog.sum(reserved_kg) as reserved_kg
  from public.v_weighbridge_open_ticket_reservations_v1
  group by company_id, warehouse_id, batch_id
) reservations
  on reservations.company_id = stock.company_id
 and reservations.warehouse_id = stock.warehouse_id
 and reservations.batch_id::text = stock.batch_id::text;

revoke all on table public.v_effective_stock_balance_identity_v1
  from public, anon;
grant select on table public.v_effective_stock_balance_identity_v1
  to authenticated, service_role;

-- Corrections clone their source ticket.  A shared pool cannot be cloned
-- without inventing a per-member allocation, so fail before the correction
-- ticket is persisted.  Once a ticket belongs to a shared pool, it also must
-- never be attached to a warehouse request or processing flow: those links
-- change canonical availability semantics.  Clearing malformed legacy links
-- remains allowed so an operator can void or repair a stranded ticket.
create or replace function private.reject_shared_impurity_ticket_correction_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.correction_of_ticket_id is not null
     and exists (
       select 1
       from public.weighbridge_shared_impurity_groups pool
       where pool.ticket_id = new.correction_of_ticket_id
     )
     and (
       tg_op = 'INSERT'
       or (
         tg_op = 'UPDATE'
         and (
           new.correction_of_ticket_id is distinct from old.correction_of_ticket_id
           or (
             new.status::text = 'finalized'
             and old.status::text is distinct from 'finalized'
           )
           or (
             coalesce(new.is_finalized, false)
             and not coalesce(old.is_finalized, false)
           )
         )
       )
     )
  then
    raise exception 'SHARED_IMPURITY_CORRECTION_REQUIRES_VOID_NEW|%',
      new.correction_of_ticket_id
      using errcode = '23514';
  end if;

  if exists (
       select 1
       from public.weighbridge_shared_impurity_groups pool
       where pool.ticket_id = new.id
     )
     and (
       (
         tg_op = 'INSERT'
         and (
           new.correction_of_ticket_id is not null
           or new.linked_request_id is not null
           or new.linked_processing_id is not null
           or new.processing_output_role is not null
         )
       )
       or (
         tg_op = 'UPDATE'
         and (
           (new.correction_of_ticket_id is not null
             and new.correction_of_ticket_id is distinct from old.correction_of_ticket_id)
           or (new.linked_request_id is not null
             and new.linked_request_id is distinct from old.linked_request_id)
           or (new.linked_processing_id is not null
             and new.linked_processing_id is distinct from old.linked_processing_id)
           or (new.processing_output_role is not null
             and new.processing_output_role is distinct from old.processing_output_role)
         )
       )
     )
  then
    raise exception 'SHARED_IMPURITY_TICKET_LINKAGE_FORBIDDEN|%', new.id
      using errcode = '23514';
  end if;
  return new;
end
$function$;

revoke all on function private.reject_shared_impurity_ticket_correction_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists reject_shared_impurity_ticket_correction_v1 on public.tickets;
create trigger reject_shared_impurity_ticket_correction_v1
before insert or update of correction_of_ticket_id, linked_request_id,
  linked_processing_id, processing_output_role, status, is_finalized
  on public.tickets
for each row execute function private.reject_shared_impurity_ticket_correction_v1();

-- Validate the inverse edge as well.  INSERT protects the initial shared-group
-- attachment; UPDATE is intentionally limited to the finalized transition so
-- a malformed open ticket can still be cleared or voided without a dead-end.
create or replace function private.assert_shared_impurity_group_ticket_linkage_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT'
     or (
       tg_op = 'UPDATE'
       and new.state = 'finalized'
       and old.state is distinct from new.state
     )
  then
    if not exists (
      select 1
      from public.tickets ticket
      where ticket.id = new.ticket_id
        and ticket.company_id = new.company_id
    ) then
      raise exception 'SHARED_IMPURITY_TICKET_SCOPE_CHANGED'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.tickets ticket
      where ticket.id = new.ticket_id
        and (
          ticket.correction_of_ticket_id is not null
          or ticket.linked_request_id is not null
          or ticket.linked_processing_id is not null
          or ticket.processing_output_role is not null
        )
    ) then
      raise exception 'SHARED_IMPURITY_TICKET_LINKAGE_FORBIDDEN|%', new.ticket_id
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$function$;

revoke all on function private.assert_shared_impurity_group_ticket_linkage_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists assert_shared_impurity_group_ticket_linkage_v1
  on public.weighbridge_shared_impurity_groups;
create trigger assert_shared_impurity_group_ticket_linkage_v1
before insert or update of state on public.weighbridge_shared_impurity_groups
for each row execute function private.assert_shared_impurity_group_ticket_linkage_v1();

-- A shared ticket must only be finalized by the shared RPC.  The legacy
-- impurity finalizer writes the ticket before it knows about the shared group,
-- so an immediate trigger would reject the valid shared RPC's intermediate
-- state too.  The deferred invariant observes the final transaction state:
-- shared RPC passes after it finalizes both rows; legacy/direct finalization
-- rolls the whole transaction back and cannot leave ledger writes or a ghost
-- reservation behind.
create or replace function private.enforce_shared_impurity_lifecycle_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket_id uuid;
  v_ticket_finalized boolean;
  v_ticket_voided boolean;
  v_ticket_terminal boolean;
  v_pool_state text;
begin
  if tg_table_name = 'tickets' then
    v_ticket_id := new.id;
  else
    v_ticket_id := new.ticket_id;
  end if;

  select
    (
      not coalesce(ticket.is_voided, false)
      and coalesce(ticket.is_finalized, false)
      and ticket.status::text = 'finalized'
    ),
    (
      coalesce(ticket.is_voided, false)
      and ticket.status::text = 'voided'
    ),
    (
      coalesce(ticket.is_finalized, false)
      or coalesce(ticket.is_voided, false)
      or ticket.status::text in ('finalized', 'voided')
    ),
    pool.state
  into v_ticket_finalized, v_ticket_voided, v_ticket_terminal, v_pool_state
  from public.tickets ticket
  join public.weighbridge_shared_impurity_groups pool
    on pool.ticket_id = ticket.id
  where ticket.id = v_ticket_id;

  if not found then
    return new;
  end if;

  if (v_pool_state = 'finalized') is distinct from v_ticket_finalized
     or (v_pool_state = 'voided') is distinct from v_ticket_voided
     or (
       v_pool_state = 'open'
       and v_ticket_terminal
     )
  then
    raise exception 'SHARED_IMPURITY_LIFECYCLE_MISMATCH|%|%|%',
      v_ticket_id, v_pool_state,
      case
        when v_ticket_voided then 'voided'
        when v_ticket_finalized then 'finalized'
        else 'open'
      end
      using errcode = '23514';
  end if;

  return new;
end
$function$;

revoke all on function private.enforce_shared_impurity_lifecycle_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_shared_impurity_ticket_lifecycle_v1
  on public.tickets;
create constraint trigger enforce_shared_impurity_ticket_lifecycle_v1
after insert or update of status, is_finalized, is_voided on public.tickets
deferrable initially deferred
for each row execute function private.enforce_shared_impurity_lifecycle_v1();

drop trigger if exists enforce_shared_impurity_group_lifecycle_v1
  on public.weighbridge_shared_impurity_groups;
create constraint trigger enforce_shared_impurity_group_lifecycle_v1
after insert or update of state on public.weighbridge_shared_impurity_groups
deferrable initially deferred
for each row execute function private.enforce_shared_impurity_lifecycle_v1();

-- Keep the group lifecycle aligned with both the canonical open-ticket void and
-- finalized storno path.  Generic void owns the ledger reversals; this trigger
-- verifies their full fidelity before releasing the frozen source selection.
create or replace function private.sync_shared_impurity_pool_ticket_void_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_group public.weighbridge_shared_impurity_groups%rowtype;
  v_void_actor public.profiles%rowtype;
  v_base_count integer := 0;
  v_ticket_effect numeric(18,6) := 0;
begin
  if coalesce(new.is_voided, false)
     and new.status::text = 'voided'
     and (
       not coalesce(old.is_voided, false)
       or old.status::text is distinct from 'voided'
     )
  then
    select g.* into v_group
    from public.weighbridge_shared_impurity_groups g
    where g.ticket_id = new.id
      and g.company_id = new.company_id
    for update;
    if not found then
      return new;
    end if;

    if new.voided_by is null
       or new.voided_at is null
       or nullif(pg_catalog.btrim(coalesce(new.void_reason, '')), '') is null
       or auth.uid() is distinct from new.voided_by
    then
      raise exception 'SHARED_IMPURITY_VOID_CONTEXT_INVALID' using errcode = '42501';
    end if;
    select actor.* into v_void_actor
    from public.profiles actor
    where actor.id = new.voided_by
      and coalesce(actor.status, 'active') = 'active';
    if not found
       or (coalesce(v_void_actor.role, '') <> 'global_admin'
           and v_void_actor.company_id is distinct from new.company_id)
       or (
         v_group.state = 'finalized'
         and coalesce(v_void_actor.role, '') not in ('global_admin', 'admin', 'company_admin', 'director')
       )
       or (
         v_group.state = 'open'
         and coalesce(v_void_actor.role, '') not in (
           'global_admin', 'admin', 'company_admin', 'director',
           'warehouse', 'warehouse_operator', 'warehouse_manager',
           'weighman', 'weighbridge_operator'
         )
       )
    then
      raise exception 'SHARED_IMPURITY_VOID_ACTOR_FORBIDDEN' using errcode = '42501';
    end if;

    if v_group.state = 'open' then
      if exists (
        select 1 from public.stock_ledger_entries entry
        where entry.ticket_id = new.id
      ) then
        raise exception 'SHARED_IMPURITY_OPEN_VOID_LEDGER_PRESENT' using errcode = '23514';
      end if;
    elsif v_group.state = 'finalized' then
      -- The canonical generic void writes full-fidelity storno rows and
      -- reconciles every affected batch before it updates the ticket.  Refuse
      -- a direct status UPDATE that would otherwise release sources while the
      -- original accounting effects remain live.
      select pg_catalog.count(*)::integer into v_base_count
      from public.stock_ledger_entries base
      where base.ticket_id = new.id
        and not coalesce(base.is_storno, false);
      if v_base_count <> (
        select pg_catalog.count(*)::integer + 2
        from public.weighbridge_shared_impurity_source_batches source
        where source.group_id = v_group.id
      ) then
        raise exception 'SHARED_IMPURITY_VOID_BASE_LEDGER_INVALID' using errcode = '23514';
      end if;

      if exists (
        select 1
        from public.stock_ledger_entries base
        where base.ticket_id = new.id
          and not coalesce(base.is_storno, false)
          and (
            base.company_id is distinct from v_group.company_id
            or base.warehouse_id is distinct from v_group.source_warehouse_id
            or base.product_id is distinct from v_group.product_id
            or base.crop_id is distinct from v_group.crop_id
            or case base.reason_type
              when 'harvest_pool_reclass_out' then not exists (
                select 1
                from public.weighbridge_shared_impurity_source_batches source
                where source.group_id = v_group.id
                  and source.id = base.reason_ref_id
                  and source.reclass_out_ledger_entry_id = base.id
                  and source.inventory_batch_id = base.inventory_batch_id
                  and source.source_balance_snapshot_kg = base.quantity
                  and base.delta_qty_signed = -source.source_balance_snapshot_kg
                  and base.direction::text = 'out'
                  and exists (
                    select 1
                    from pg_catalog.jsonb_array_elements(v_group.composition_snapshot) component(value)
                    where component.value ->> 'inventory_batch_id' = source.inventory_batch_id::text
                      and component.value ->> 'harvest_lot_id' = source.harvest_lot_id::text
                      and component.value ->> 'crop_structure_id' = source.crop_structure_id::text
                      and component.value ->> 'variety_id'
                            is not distinct from base.variety_id::text
                      and component.value ->> 'reproduction_id'
                            is not distinct from base.reproduction_id::text
                  )
              )
              when 'harvest_pool_reclass_in' then not (
                base.id = v_group.pool_in_ledger_entry_id
                and base.reason_ref_id = v_group.id
                and base.inventory_batch_id = v_group.pool_inventory_batch_id
                and base.quantity = v_group.source_total_kg
                and base.delta_qty_signed = v_group.source_total_kg
                and base.direction::text = 'in'
                and base.variety_id is null
                and base.reproduction_id is null
              )
              when 'weighbridge_impurities_shared' then not (
                base.id = v_group.impurity_out_ledger_entry_id
                and base.reason_ref_id = new.id
                and base.inventory_batch_id = v_group.pool_inventory_batch_id
                and base.quantity = v_group.impurity_weight_kg
                and base.delta_qty_signed = -v_group.impurity_weight_kg
                and base.direction::text = 'out'
                and base.variety_id is null
                and base.reproduction_id is null
              )
              else true
            end
          )
      ) then
        raise exception 'SHARED_IMPURITY_VOID_BASE_LEDGER_INVALID' using errcode = '23514';
      end if;

      if exists (
        select 1
        from public.stock_ledger_entries base
        left join public.stock_ledger_entries reversal
          on reversal.storno_of_entry_id = base.id
        where base.ticket_id = new.id
          and not coalesce(base.is_storno, false)
          and (
            reversal.id is null
            or reversal.company_id is distinct from base.company_id
            or reversal.ticket_id is distinct from base.ticket_id
            or reversal.processing_id is distinct from base.processing_id
            or reversal.product_id is distinct from base.product_id
            or reversal.crop_id is distinct from base.crop_id
            or reversal.variety_id is distinct from base.variety_id
            or reversal.reproduction_id is distinct from base.reproduction_id
            or reversal.warehouse_id is distinct from base.warehouse_id
            or reversal.inventory_batch_id is distinct from base.inventory_batch_id
            or reversal.batch_id is distinct from base.batch_id
            or reversal.batch_id_text is distinct from base.batch_id_text
            or reversal.batch_class is distinct from base.batch_class
            or reversal.operation_line_id is distinct from base.operation_line_id
            or reversal.warehouse_issue_allocation_id is distinct from base.warehouse_issue_allocation_id
            or reversal.quantity is distinct from base.quantity
            or reversal.uom is distinct from base.uom
            or reversal.mass_kg is distinct from base.mass_kg
            or reversal.density_kg_per_l is distinct from base.density_kg_per_l
            or reversal.density_unit is distinct from base.density_unit
            or reversal.density_source is distinct from base.density_source
            or reversal.density_verification_status is distinct from base.density_verification_status
            or reversal.density_verified_at is distinct from base.density_verified_at
            or reversal.unit_source is distinct from base.unit_source
            or reversal.unit_contract_version is distinct from base.unit_contract_version
            or reversal.delta_qty_signed is distinct from -base.delta_qty_signed
            or reversal.direction::text is distinct from case
                 when base.direction::text = 'in' then 'out' else 'in'
               end
            or reversal.reason_type is distinct from ('storno_' || base.reason_type)
            or reversal.reason_ref_id is distinct from base.reason_ref_id
            or not coalesce(reversal.is_storno, false)
          )
      ) then
        raise exception 'SHARED_IMPURITY_VOID_STORNO_FIDELITY_FAILED' using errcode = '23514';
      end if;

      select pg_catalog.round(coalesce(pg_catalog.sum(entry.delta_qty_signed), 0), 6)
      into v_ticket_effect
      from public.stock_ledger_entries entry
      where entry.ticket_id = new.id;
      if pg_catalog.abs(v_ticket_effect) > 0.001 then
        raise exception 'SHARED_IMPURITY_VOID_LEDGER_EFFECT_INVALID|%', v_ticket_effect
          using errcode = '23514';
      end if;
      if exists (
        select 1
        from public.weighbridge_shared_impurity_source_batches source
        join public.inventory_batches batch on batch.id = source.inventory_batch_id
        where source.group_id = v_group.id
          and (
            source.state <> 'reclassified'
            or pg_catalog.abs(coalesce(batch.current_quantity, 0) - source.source_balance_snapshot_kg) > 0.001
            or pg_catalog.abs(coalesce(batch.current_weight_kg, 0) - source.source_balance_snapshot_kg) > 0.001
            or pg_catalog.abs(coalesce(batch.mass_kg, 0) - source.source_balance_snapshot_kg) > 0.001
          )
      ) or not exists (
        select 1
        from public.inventory_batches pool_batch
        where pool_batch.id = v_group.pool_inventory_batch_id
          and pool_batch.company_id = v_group.company_id
          and pool_batch.product_id = v_group.product_id
          and pool_batch.variety_id is null
          and pool_batch.reproduction_id is null
          and coalesce(pool_batch.composition_snapshot, '[]'::jsonb)
                is not distinct from v_group.composition_snapshot
          and pool_batch.composition_hash is not distinct from v_group.composition_hash
          and coalesce(pool_batch.is_mixed_harvest, false)
                is not distinct from v_group.is_mixed_harvest
          and pool_batch.display_name is not distinct from v_group.display_name
          and pool_batch.quality_json ->> 'identity_kind' = 'shared_unresolved'
          and pg_catalog.abs(coalesce(pool_batch.current_quantity, 0)) <= 0.001
          and pg_catalog.abs(coalesce(pool_batch.current_weight_kg, 0)) <= 0.001
          and pg_catalog.abs(coalesce(pool_batch.mass_kg, 0)) <= 0.001
      ) then
        raise exception 'SHARED_IMPURITY_VOID_BATCH_RECONCILE_INVALID' using errcode = '23514';
      end if;
    else
      raise exception 'SHARED_IMPURITY_VOID_STATE_INVALID' using errcode = '23514';
    end if;

    update public.weighbridge_shared_impurity_groups p
    set state = 'voided',
        voided_by = new.voided_by,
        voided_at = coalesce(new.voided_at, pg_catalog.now()),
        audit_json = coalesce(p.audit_json, '{}'::jsonb)
          || pg_catalog.jsonb_build_object(
               'void', pg_catalog.jsonb_build_object(
                  'ticket_id', new.id,
                  'void_reason', new.void_reason,
                  'voided_by', new.voided_by,
                  'voided_at', coalesce(new.voided_at, pg_catalog.now())
               )
             ),
        updated_at = pg_catalog.now()
    where p.ticket_id = new.id
      and p.company_id = new.company_id
      and p.state <> 'voided';

    update public.weighbridge_shared_impurity_source_batches s
    set state = 'released',
        updated_at = pg_catalog.now()
    where s.group_id in (
      select p.id
      from public.weighbridge_shared_impurity_groups p
      where p.ticket_id = new.id and p.company_id = new.company_id
    )
      and s.state <> 'released';
  end if;
  return new;
end
$function$;

create or replace function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  p_ticket_id uuid,
  p_session_token text,
  p_tare_weight_kg numeric,
  p_tare_variance_confirmed boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_principal_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_gate_actor record;
  v_session private.weighbridge_operator_sessions%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_ticket public.tickets%rowtype;
  v_pool public.weighbridge_shared_impurity_groups%rowtype;
  v_line public.ticket_lines%rowtype;
  v_source record;
  v_pool_batch public.inventory_batches%rowtype;
  v_tare numeric(14,3) := pg_catalog.round(p_tare_weight_kg, 3);
  v_impurity numeric(18,6);
  v_clean numeric(18,6);
  v_previous_tare numeric(14,3);
  v_tare_difference_percent numeric(8,2);
  v_current_balance numeric(18,6);
  v_available_balance numeric(18,6);
  v_reconciled_balance numeric(18,6);
  v_source_sum numeric(18,6) := 0;
  v_member_sum numeric(18,6) := 0;
  v_ticket_effect numeric(18,6) := 0;
  v_pool_balance numeric(18,6) := 0;
  v_source_count integer := 0;
  v_member_count integer := 0;
  v_zero_source_count integer := 0;
  v_line_count integer := 0;
  v_weighing_count integer := 0;
  v_ledger_count integer := 0;
  v_source_out_count integer := 0;
  v_pool_in_count integer := 0;
  v_impurity_out_count integer := 0;
  v_pool_batch_id uuid := extensions.gen_random_uuid();
  v_pool_batch_code text;
  v_source_ledger_id uuid;
  v_pool_in_ledger_id uuid;
  v_impurity_out_ledger_id uuid;
  v_line_id uuid;
  v_fingerprint text;
  v_create_fingerprint text;
  v_scope_hash text;
  v_source_scope jsonb;
  v_expires timestamptz := pg_catalog.now() + interval '24 hours';
begin
  if v_principal_id is null then
    raise exception 'SHARED_IMPURITY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_ticket_id is null or p_idempotency_key is null then
    raise exception 'SHARED_IMPURITY_FINALIZE_CONTEXT_REQUIRED' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_session_token, '')), '') is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if v_tare is null
     or v_tare::text in ('NaN', 'Infinity', '-Infinity')
     or v_tare < 0
  then
    raise exception 'SHARED_IMPURITY_TARE_INVALID' using errcode = '22023';
  end if;

  select gate_actor.* into v_gate_actor
  from private.resolve_processing_gate_session_actor_v1() gate_actor;
  if not found
     or v_gate_actor.actor_profile_id is null
     or v_gate_actor.selected_company_id is null
  then
    raise exception 'SHARED_IMPURITY_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;

  -- Authorization and business attribution follow the canonical effective
  -- actor (including a validated impersonation), while the PIN session remains
  -- bound to the actual authenticated principal below.
  select p.* into v_actor
  from public.profiles p
  where p.id = v_gate_actor.actor_profile_id
    and coalesce(p.status, 'active') = 'active';
  if not found
     or v_actor.role not in ('global_admin', 'company_admin', 'weighman')
  then
    raise exception 'SHARED_IMPURITY_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin'
     and v_actor.company_id is distinct from v_gate_actor.selected_company_id
  then
    raise exception 'SHARED_IMPURITY_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;

  -- Bind the document lookup to the actor's selected company before revealing
  -- whether a ticket or shared pool exists.
  select t.* into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
    and t.company_id = v_gate_actor.selected_company_id;
  if not found then
    raise exception 'SHARED_IMPURITY_TICKET_NOT_FOUND' using errcode = 'P0002';
  end if;
  select p.* into v_pool
  from public.weighbridge_shared_impurity_groups p
  where p.ticket_id = p_ticket_id
    and p.company_id = v_ticket.company_id;
  if not found then
    raise exception 'SHARED_IMPURITY_POOL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select s.* into v_session
  from private.weighbridge_operator_sessions s
  where s.company_id = v_ticket.company_id
    and s.auth_user_id = v_principal_id
    and s.token_hash = pg_catalog.encode(
      extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex'
    )
    and s.status = 'active'
  order by s.created_at desc
  limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  select ws.* into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = v_ticket.company_id
    and ws.status = 'open';
  if not found
     or v_session.expires_at <= pg_catalog.now()
     or v_shift.last_activity_at + interval '24 hours' <= pg_catalog.now()
     or v_shift.operator_person_id is distinct from v_session.person_id
  then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if not exists (
    select 1 from public.company_people cp
    where cp.id = v_session.person_id
      and cp.company_id = v_ticket.company_id
      and cp.role_type = 'weighbridge_operator'
      and cp.status = 'active'
      and cp.deleted_at is null
  ) then
    raise exception 'SHARED_IMPURITY_OPERATOR_FORBIDDEN' using errcode = '42501';
  end if;

  perform private.assert_processing_gate_actor_v1(v_ticket.company_id, v_actor.id);
  perform private.tz315_lock_company_season_write_gate_v1(
    v_ticket.company_id, v_pool.season_id
  );

  -- Re-lock and re-read every security and business resource after the common
  -- accounting gate.  This is the write-side scope snapshot.
  select s.* into v_session
  from private.weighbridge_operator_sessions s
  where s.id = v_session.id
    and s.company_id = v_ticket.company_id
    and s.auth_user_id = v_principal_id
    and s.token_hash = pg_catalog.encode(
      extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex'
    )
    and s.status = 'active'
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  select ws.* into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = v_ticket.company_id
    and ws.status = 'open'
  for update;
  if not found
     or v_session.expires_at <= pg_catalog.now()
     or v_shift.last_activity_at + interval '24 hours' <= pg_catalog.now()
     or v_shift.operator_person_id is distinct from v_session.person_id
  then
    if found then
      update public.weighbridge_shifts
      set status = 'closed',
          closed_at = last_activity_at + interval '24 hours',
          closed_by = null,
          closed_by_person_id = operator_person_id,
          close_reason = 'inactivity_24h'
      where id = v_shift.id and status = 'open';
    end if;
    update private.weighbridge_operator_sessions
    set status = 'expired', revoked_at = pg_catalog.now()
    where id = v_session.id;
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;

  select t.* into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;
  select p.* into v_pool
  from public.weighbridge_shared_impurity_groups p
  where p.ticket_id = p_ticket_id
    and p.company_id = v_ticket.company_id
  for update;
  if not found then
    raise exception 'SHARED_IMPURITY_POOL_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_ticket.company_id is distinct from v_pool.company_id
     or v_ticket.warehouse_from_id is distinct from v_pool.source_warehouse_id
     or v_ticket.season_id is distinct from v_pool.season_id
  then
    raise exception 'SHARED_IMPURITY_TICKET_SCOPE_CHANGED' using errcode = '23514';
  end if;
  if coalesce(v_ticket.is_voided, false)
     or v_ticket.status::text = 'voided'
     or v_pool.state = 'voided'
  then
    raise exception 'SHARED_IMPURITY_VOIDED' using errcode = '23514';
  end if;
  if v_ticket.direction::text <> 'outgoing'
     or v_ticket.op_type <> 'weighbridge_impurities'
     or v_ticket.ticket_type <> 'impurity_removal'
     or v_ticket.source_kind <> 'warehouse'
     or v_ticket.source_id is distinct from v_pool.source_warehouse_id::text
     or v_ticket.destination_kind <> 'impurity_removal'
     or v_ticket.destination_id is not null
     or v_ticket.warehouse_to_id is not null
     or v_ticket.weigh_method::text <> 'double_weighing'
     or v_ticket.weight_source is distinct from 'manual'
     or v_ticket.source_physical_state is distinct from 'SOURCE'
     or v_ticket.crop_structure_allocation_id is not null
     or v_ticket.replacement_ticket_id is not null
     or v_ticket.correction_of_ticket_id is not null
     or v_ticket.linked_request_id is not null
     or v_ticket.linked_processing_id is not null
     or v_ticket.processing_output_role is not null
     or v_ticket.created_by is distinct from v_pool.created_by
     or v_ticket.responsible_user_id is distinct from v_pool.created_by
  then
    raise exception 'SHARED_IMPURITY_TICKET_TYPE_INVALID' using errcode = '23514';
  end if;
  if v_ticket.shift_id is distinct from v_shift.id
     or v_ticket.created_by_person_id is distinct from v_session.person_id
  then
    raise exception 'SHARED_IMPURITY_OPERATOR_SCOPE_CHANGED' using errcode = '23514';
  end if;
  if v_ticket.gross_weight_kg is null
     or v_ticket.gross_weight_kg::text in ('NaN', 'Infinity', '-Infinity')
     or v_pool.source_total_kg is null
     or v_pool.source_total_kg::text in ('NaN', 'Infinity', '-Infinity')
     or v_ticket.gross_weight_kg <= 0
     or v_tare >= v_ticket.gross_weight_kg
  then
    raise exception 'SHARED_IMPURITY_WEIGHT_INVALID' using errcode = '22023';
  end if;
  if v_pool.state = 'open'
     and (
       v_ticket.status::text <> 'active'
       or coalesce(v_ticket.is_finalized, false)
       or v_ticket.tare_weight_kg is not null
       or v_ticket.net_weight_kg is not null
       or v_ticket.physical_net_kg is not null
       or v_ticket.accepted_weight_kg is not null
       or v_ticket.weighing_2_at is not null
       or v_ticket.batch_id is not null
       or v_ticket.lot_id is not null
     )
  then
    raise exception 'SHARED_IMPURITY_OPEN_TICKET_CHANGED' using errcode = '23514';
  end if;

  -- The legacy ticket tables still have broad tenant policies.  Treat their
  -- identity fields as untrusted on finalize and compare them with the frozen
  -- group fingerprint before any inventory write.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'harvest_lot_id', source_scope.harvest_lot_id,
        'crop_structure_id', source_scope.crop_structure_id
      ) order by source_scope.crop_structure_id, source_scope.harvest_lot_id
    ),
    '[]'::jsonb
  )
  into v_source_scope
  from (
    select distinct source.harvest_lot_id, source.crop_structure_id
    from public.weighbridge_shared_impurity_source_batches source
    where source.group_id = v_pool.id
  ) source_scope;
  v_create_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'company_id', v_ticket.company_id,
          'source_warehouse_id', v_pool.source_warehouse_id,
          'sources', v_source_scope,
          'vehicle_id', v_ticket.vehicle_id,
          'driver_id', v_ticket.driver_id,
          'gross_weight_kg', pg_catalog.round(v_ticket.gross_weight_kg, 3),
          'impurity_type', v_pool.impurity_type,
          'notes', nullif(pg_catalog.btrim(coalesce(v_ticket.notes, '')), ''),
          'contract_version', 'shared_impurity_pool_v1'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if v_create_fingerprint is distinct from v_pool.create_request_fingerprint then
    raise exception 'SHARED_IMPURITY_CREATE_SNAPSHOT_CHANGED' using errcode = '23514';
  end if;

  if v_pool.state = 'open' and not (
    exists (
      select 1 from public.reference_vehicles rv
      where rv.id = v_ticket.vehicle_id
        and rv.company_id = v_ticket.company_id
        and coalesce(rv.is_active, false)
        and not coalesce(rv.archived, false)
    )
    or exists (
      select 1 from public.reference_machines rm
      where rm.id = v_ticket.vehicle_id
        and rm.company_id = v_ticket.company_id
        and coalesce(rm.is_active, false)
        and not coalesce(rm.archived, false)
    )
  ) then
    raise exception 'SHARED_IMPURITY_VEHICLE_INVALID' using errcode = '23503';
  end if;
  if v_pool.state = 'open' and not exists (
    select 1 from public.company_people cp
    where cp.id = v_ticket.driver_id
      and cp.company_id = v_ticket.company_id
      and cp.role_type in ('driver', 'mechanic_operator')
      and cp.status = 'active'
      and cp.deleted_at is null
  ) then
    raise exception 'SHARED_IMPURITY_DRIVER_INVALID' using errcode = '23503';
  end if;
  if v_pool.state = 'open' and (not exists (
    select 1 from public.seasons season
    where season.id = v_pool.season_id
      and season.company_id = v_pool.company_id
      and not coalesce(season.archived, false)
  ) or not exists (
    select 1 from public.warehouses warehouse
    where warehouse.id = v_pool.source_warehouse_id
      and warehouse.company_id = v_pool.company_id
      and not coalesce(warehouse.archived, false)
      and not coalesce(warehouse.is_archived, false)
      and (
        warehouse.place_type in ('WAREHOUSE', 'YARD', 'DRYER', 'CLEANER')
        or pg_catalog.lower(coalesce(warehouse.warehouse_type, '')) in (
          'grain', 'grain_storage', 'harvest', 'crop', 'produce', 'elevator'
        )
      )
  ) or not exists (
    select 1 from public.products product
    where product.id = v_pool.product_id
      and public.canonical_stock_uom(
        coalesce(nullif(product.base_uom, ''), product.unit)
      ) = 'kg'
  )) then
    raise exception 'SHARED_IMPURITY_SOURCE_PLACE_OR_SEASON_INVALID'
      using errcode = '23514';
  end if;

  v_impurity := pg_catalog.round(v_ticket.gross_weight_kg - v_tare, 6);
  v_clean := pg_catalog.round(v_pool.source_total_kg - v_impurity, 6);
  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'ticket_id', p_ticket_id,
          'tare_weight_kg', v_tare,
          'tare_variance_confirmed', coalesce(p_tare_variance_confirmed, false),
          'contract_version', 'shared_impurity_pool_v1'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'travkinflow.shared-impurity.finalize.v1|'
        || v_ticket.company_id::text || '|' || p_idempotency_key::text,
      0::bigint
    )
  );

  if exists (
    select 1
    from public.weighbridge_shared_impurity_groups other_pool
    where other_pool.company_id = v_ticket.company_id
      and other_pool.finalize_idempotency_key = p_idempotency_key
      and other_pool.id <> v_pool.id
  ) then
    raise exception 'SHARED_IMPURITY_FINALIZE_IDEMPOTENCY_CONFLICT'
      using errcode = '23505';
  end if;

  if v_pool.state = 'finalized'
     or coalesce(v_ticket.is_finalized, false)
     or v_ticket.status::text = 'finalized'
  then
    if v_pool.state <> 'finalized'
       or not coalesce(v_ticket.is_finalized, false)
       or v_ticket.status::text <> 'finalized'
    then
      raise exception 'SHARED_IMPURITY_FINALIZE_STATE_INCONSISTENT' using errcode = '23514';
    end if;
    if v_pool.finalize_idempotency_key is distinct from p_idempotency_key
       or v_pool.finalize_request_fingerprint is distinct from v_fingerprint
    then
      raise exception 'SHARED_IMPURITY_ALREADY_FINALIZED' using errcode = '23505';
    end if;

    select pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
    into v_ticket_effect
    from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id;
    if pg_catalog.abs(v_ticket_effect + v_pool.impurity_weight_kg) > 0.001
       or exists (
         select 1
         from public.weighbridge_shared_impurity_source_batches s
         join public.inventory_batches ib on ib.id = s.inventory_batch_id
         where s.group_id = v_pool.id
           and s.state <> 'reclassified'
           and not exists (
             select 1 from public.stock_ledger_entries reversal
             where reversal.storno_of_entry_id = s.reclass_out_ledger_entry_id
           )
       )
    then
      raise exception 'SHARED_IMPURITY_REPLAY_POSTCONDITION_FAILED' using errcode = '23514';
    end if;
    select pg_catalog.count(*)::integer into v_source_count
    from public.weighbridge_shared_impurity_source_batches s
    where s.group_id = v_pool.id;
    select pg_catalog.count(*)::integer into v_member_count
    from public.weighbridge_shared_impurity_members m
    where m.group_id = v_pool.id;
    select pg_catalog.count(*)::integer into v_ledger_count
    from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id
      and not coalesce(sle.is_storno, false);
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'ticket_id', v_ticket.id,
      'pool_id', v_pool.id,
      'pool_inventory_batch_id', v_pool.pool_inventory_batch_id,
      'source_total_kg', v_pool.source_total_kg,
      'impurity_weight_kg', v_pool.impurity_weight_kg,
      'clean_total_kg', v_pool.clean_total_kg,
      'source_batch_count', v_source_count,
      'member_count', v_member_count,
      'member_resolution_status', v_pool.member_resolution_status,
      'ledger_count', v_ledger_count,
      'idempotent_replay', true
    );
  end if;

  if v_pool.state <> 'open' then
    raise exception 'SHARED_IMPURITY_POOL_NOT_OPEN' using errcode = '23514';
  end if;
  if v_impurity <= 0 then
    raise exception 'SHARED_IMPURITY_NET_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if v_clean < 0 then
    raise exception 'IMPURITY_WEIGHT_EXCEEDS_AVAILABLE|%', v_pool.source_total_kg
      using errcode = '23514';
  end if;
  v_clean := greatest(v_clean, 0);

  select t.tare_weight_kg into v_previous_tare
  from public.tickets t
  where t.company_id = v_ticket.company_id
    and t.vehicle_id = v_ticket.vehicle_id
    and t.id <> v_ticket.id
    and t.status::text = 'finalized'
    and coalesce(t.is_finalized, false)
    and not coalesce(t.is_voided, false)
    and t.tare_weight_kg > 0
  order by t.finalized_at desc nulls last, t.updated_at desc
  limit 1;
  if v_previous_tare is not null then
    v_tare_difference_percent := pg_catalog.round(
      ((v_tare - v_previous_tare) / v_previous_tare) * 100,
      2
    );
    if pg_catalog.abs(v_tare_difference_percent) >= 20
       and not coalesce(p_tare_variance_confirmed, false)
    then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'requires_confirmation', true,
        'code', 'tare_variance_confirmation_required',
        'previous_tare_kg', v_previous_tare,
        'current_tare_kg', v_tare,
        'difference_percent', v_tare_difference_percent
      );
    end if;
  end if;

  select pg_catalog.count(*)::integer,
         min(tl.id::text)::uuid
  into v_line_count, v_line_id
  from public.ticket_lines tl
  where tl.ticket_id = p_ticket_id
    and tl.company_id = v_ticket.company_id;
  if v_line_count <> 1 then
    raise exception 'SHARED_IMPURITY_REQUIRES_ONE_TICKET_LINE' using errcode = '23514';
  end if;
  select tl.* into v_line
  from public.ticket_lines tl
  where tl.id = v_line_id
  for update;
  if v_line.product_id is distinct from v_pool.product_id
     or v_line.crop_id is distinct from v_pool.crop_id
     or v_line.warehouse_from_id is distinct from v_pool.source_warehouse_id
     or v_line.warehouse_to_id is not null
     or v_line.line_type is distinct from 'impurity_removal'
     or v_line.uom <> 'kg'
     or v_line.batch_id is not null
     or v_line.lot_id is not null
     or v_line.variety_id is not null
     or v_line.reproduction_id is not null
     or v_line.batch_class is distinct from 'commodity'
     or v_line.quantity <> 0
     or coalesce(v_line.quantity_kg, 0) <> 0
     or coalesce(v_line.net_line_weight_kg, 0) <> 0
     or coalesce(v_line.mass_kg, 0) <> 0
     or v_line.unit_source is distinct from 'shared_impurity_pool_v1'
     or v_line.unit_contract_version is not null
     or coalesce(v_line.quality_json ->> 'shared_impurity_pool_id', '') <> v_pool.id::text
     or coalesce(v_line.quality_json ->> 'member_resolution_status', '') <> 'unresolved'
  then
    raise exception 'SHARED_IMPURITY_TICKET_LINE_CHANGED' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.ticket_weighings tw
    where tw.ticket_id = p_ticket_id
      and tw.company_id = v_ticket.company_id
      and tw.weighing_no = 1
      and pg_catalog.abs(tw.measured_weight_kg - v_ticket.gross_weight_kg) <= 0.001
      and tw.device_source = 'manual'
      and tw.operator_user_id = v_pool.created_by
      and tw.operator_person_id = v_session.person_id
      and tw.weighbridge_shift_id = v_shift.id
  ) then
    raise exception 'SHARED_IMPURITY_GROSS_EVENT_INVALID' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.ticket_weighings tw
    where tw.ticket_id = p_ticket_id and tw.weighing_no = 2
  ) then
    raise exception 'SHARED_IMPURITY_TARE_EVENT_ALREADY_EXISTS' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id
  ) then
    raise exception 'SHARED_IMPURITY_LEDGER_ALREADY_EXISTS' using errcode = '23505';
  end if;

  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'crop_structure_id', s.crop_structure_id,
              'harvest_lot_id', s.harvest_lot_id,
              'inventory_batch_id', s.inventory_batch_id,
              'source_balance_snapshot_kg', s.source_balance_snapshot_kg
            ) order by s.inventory_batch_id
          ),
          '[]'::jsonb
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) into v_scope_hash
  from public.weighbridge_shared_impurity_source_batches s
  where s.group_id = v_pool.id;
  if v_scope_hash is distinct from v_pool.source_scope_hash then
    raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_CHANGED' using errcode = '23514';
  end if;
  if v_pool.identity_kind <> 'shared_unresolved'
     or not v_pool.is_mixed_harvest
     or pg_catalog.jsonb_array_length(v_pool.composition_snapshot) <> (
       select pg_catalog.count(*)::integer
       from public.weighbridge_shared_impurity_source_batches source
       where source.group_id = v_pool.id
     )
     or v_pool.composition_hash is distinct from pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(v_pool.composition_snapshot::text, 'UTF8'),
         'sha256'
       ),
       'hex'
     )
  then
    raise exception 'SHARED_IMPURITY_COMPOSITION_SNAPSHOT_CHANGED' using errcode = '23514';
  end if;

  perform 1
  from public.weighbridge_shared_impurity_source_batches s
  join public.inventory_batches ib
    on ib.id = s.inventory_batch_id and ib.company_id = s.company_id
  where s.group_id = v_pool.id
  order by ib.id
  for update of ib, s;

  for v_source in
    select
      s.*,
      ib.season_id as batch_season_id,
      ib.crop_id as batch_crop_id,
       ib.crop_structure_id as batch_crop_structure_id,
       ib.product_id as batch_product_id,
       ib.variety_id as batch_variety_id,
       ib.reproduction_id as batch_reproduction_id,
       ib.composition_snapshot as batch_composition_snapshot,
       ib.composition_hash as batch_composition_hash,
       ib.is_mixed_harvest as batch_is_mixed_harvest,
       ib.warehouse_id as batch_warehouse_id,
       ib.batch_class as batch_class,
       ib.physical_state as batch_physical_state,
       ib.uom as batch_uom,
       ib.origin_type as batch_origin_type,
       ib.source_ticket_id as batch_source_ticket_id,
       ib.current_quantity as batch_current_quantity,
      ib.current_weight_kg as batch_current_weight_kg,
      ib.mass_kg as batch_mass_kg,
      pg_catalog.round(coalesce((
        select pg_catalog.sum(sle.delta_qty_signed)
        from public.stock_ledger_entries sle
        where sle.company_id = s.company_id
          and sle.warehouse_id = s.warehouse_id
          and coalesce(
            sle.inventory_batch_id::text,
            nullif(pg_catalog.btrim(sle.batch_id_text), ''),
            nullif(pg_catalog.btrim(sle.batch_id), '')
          ) = s.inventory_batch_id::text
      ), 0), 6) as exact_balance
    from public.weighbridge_shared_impurity_source_batches s
    join public.inventory_batches ib on ib.id = s.inventory_batch_id
    where s.group_id = v_pool.id
    order by s.inventory_batch_id
  loop
    v_source_count := v_source_count + 1;
    v_source_sum := v_source_sum + v_source.source_balance_snapshot_kg;
    v_current_balance := v_source.exact_balance;
    -- Exclude this shared ticket's own whole-batch reservation, but subtract
    -- every other open ticket and active processing allocation through the
    -- canonical availability contract while the source batch is locked.
    v_available_balance := private.weighbridge_batch_available_for_ticket_v1(
      v_ticket.id,
      v_source.inventory_batch_id
    );
    if v_source.state <> 'selected'
       or v_source.reclass_out_ledger_entry_id is not null
       or v_source.company_id is distinct from v_pool.company_id
       or v_source.warehouse_id is distinct from v_pool.source_warehouse_id
       or v_source.product_id is distinct from v_pool.product_id
       or v_source.batch_season_id is distinct from v_pool.season_id
       or v_source.batch_crop_id is distinct from v_pool.crop_id
       or v_source.batch_crop_structure_id is distinct from v_source.crop_structure_id
       or v_source.batch_product_id is distinct from v_pool.product_id
       or not exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_pool.composition_snapshot) component(value)
         where component.value @> pg_catalog.jsonb_build_object(
           'inventory_batch_id', v_source.inventory_batch_id,
           'harvest_lot_id', v_source.harvest_lot_id,
           'crop_structure_id', v_source.crop_structure_id,
           'source_ticket_id', v_source.source_ticket_id,
           'product_id', v_source.batch_product_id,
           'crop_id', v_source.batch_crop_id,
           'variety_id', v_source.batch_variety_id,
           'reproduction_id', v_source.batch_reproduction_id,
           'source_is_mixed_harvest', coalesce(v_source.batch_is_mixed_harvest, false),
           'source_composition_hash', v_source.batch_composition_hash,
           'source_composition_snapshot', coalesce(v_source.batch_composition_snapshot, '[]'::jsonb),
           'pre_impurity_source_mass_kg', v_source.source_balance_snapshot_kg,
           'clean_mass_status', 'unresolved'
         )
       )
       or v_source.batch_warehouse_id is distinct from v_pool.source_warehouse_id
       or v_source.batch_class is distinct from 'commodity'
       or coalesce(v_source.batch_physical_state, 'SOURCE') <> 'SOURCE'
       or public.canonical_stock_uom(v_source.batch_uom) is distinct from 'kg'
       or coalesce(v_source.batch_origin_type, '') not in ('harvest', 'transfer')
       or not exists (
         select 1
         from public.harvest_lot_batches hlb
         join public.harvest_lots hl
           on hl.id = hlb.harvest_lot_id
          and hl.company_id = hlb.company_id
           and hl.status = 'active'
           and hl.season_id is not distinct from v_pool.season_id
           and hl.crop_id is not distinct from v_pool.crop_id
         join public.crop_structure cs
           on cs.id = hlb.crop_structure_id
          and cs.company_id = hlb.company_id
          and cs.season_id is not distinct from v_pool.season_id
          and cs.crop_id is not distinct from v_pool.crop_id
          and not coalesce(cs.archived, false)
          and coalesce(cs.land_use_type, 'crop') = 'crop'
         join public.fields f
           on f.id = cs.field_id
          and f.company_id = cs.company_id
          and not coalesce(f.archived, false)
         join public.weighbridge_shared_impurity_members m
           on m.group_id = v_pool.id
          and m.company_id = hlb.company_id
          and m.crop_structure_id = cs.id
          and m.field_id = cs.field_id
         where hlb.harvest_lot_id = v_source.harvest_lot_id
           and hlb.company_id = v_source.company_id
           and hlb.inventory_batch_id = v_source.inventory_batch_id
           and hlb.crop_structure_id = v_source.crop_structure_id
           and coalesce(v_source.batch_source_ticket_id, hlb.source_ticket_id)
                 is not distinct from v_source.source_ticket_id
       )
       or (
         v_source.source_ticket_id is not null
         and not exists (
           select 1 from public.tickets source_ticket
           where source_ticket.id = v_source.source_ticket_id
             and source_ticket.company_id = v_pool.company_id
             and source_ticket.status::text = 'finalized'
             and coalesce(source_ticket.is_finalized, false)
             and not coalesce(source_ticket.is_voided, false)
             and source_ticket.replacement_ticket_id is null
         )
       )
       or (
         v_source.source_ticket_id is not null
         and exists (
           select 1 from public.stock_ledger_entries source_entry
           where source_entry.ticket_id = v_source.source_ticket_id
             and source_entry.inventory_batch_id is null
             and coalesce(
               nullif(pg_catalog.btrim(source_entry.batch_id_text), ''),
               nullif(pg_catalog.btrim(source_entry.batch_id), '')
             ) is distinct from v_source.inventory_batch_id::text
         )
       )
       or exists (
         select 1
         from public.stock_ledger_entries source_entry
         where source_entry.company_id = v_source.company_id
           and source_entry.warehouse_id = v_source.warehouse_id
           and coalesce(
             source_entry.inventory_batch_id::text,
             nullif(pg_catalog.btrim(source_entry.batch_id_text), ''),
             nullif(pg_catalog.btrim(source_entry.batch_id), '')
           ) = v_source.inventory_batch_id::text
           and public.canonical_stock_uom(source_entry.uom) is distinct from 'kg'
       )
     then
      raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_CHANGED|%', v_source.inventory_batch_id
        using errcode = '23514';
    end if;
    if pg_catalog.abs(v_current_balance - v_source.source_balance_snapshot_kg) > 0.001
       or pg_catalog.abs(v_available_balance - v_current_balance) > 0.001
       or (v_source.batch_current_quantity is not null
          and pg_catalog.abs(v_source.batch_current_quantity - v_current_balance) > 0.001)
       or (v_source.batch_current_weight_kg is not null
          and pg_catalog.abs(v_source.batch_current_weight_kg - v_current_balance) > 0.001)
       or (v_source.batch_mass_kg is not null
          and pg_catalog.abs(v_source.batch_mass_kg - v_current_balance) > 0.001)
    then
      raise exception 'SHARED_IMPURITY_SOURCE_COMMITTED_OR_CHANGED|%|%',
        v_source.inventory_batch_id, v_available_balance
        using errcode = '40001';
    end if;
  end loop;
  if v_source_count < 2
     or pg_catalog.abs(v_source_sum - v_pool.source_total_kg) > 0.001
  then
    raise exception 'SHARED_IMPURITY_SOURCE_TOTAL_INVALID' using errcode = '23514';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.round(coalesce(pg_catalog.sum(m.source_total_snapshot_kg), 0), 6)
  into v_member_count, v_member_sum
  from public.weighbridge_shared_impurity_members m
  where m.group_id = v_pool.id
    and m.company_id = v_pool.company_id;
  if v_member_count < 2
     or pg_catalog.abs(v_member_sum - v_pool.source_total_kg) > 0.001
     or exists (
       select 1
       from public.weighbridge_shared_impurity_members m
       where m.group_id = v_pool.id
         and (m.clean_balance_status <> 'unresolved' or m.yield_status <> 'unresolved')
     )
     -- The canonical availability helper excludes this ticket's own promise.
     -- Before consuming anything, nevertheless prove that the published
     -- promise still covers every frozen source completely and nothing else.
     or exists (
       select 1
       from public.weighbridge_shared_impurity_source_batches source
       left join (
         select reservation.company_id,
                reservation.ticket_id,
                reservation.warehouse_id,
                reservation.batch_id,
                pg_catalog.sum(reservation.reserved_kg) as reserved_kg
         from public.v_weighbridge_open_ticket_reservations_v1 reservation
         where reservation.ticket_id = v_ticket.id
         group by reservation.company_id, reservation.ticket_id,
                  reservation.warehouse_id, reservation.batch_id
       ) own_reservation
         on own_reservation.company_id = source.company_id
        and own_reservation.ticket_id = v_ticket.id
        and own_reservation.warehouse_id = source.warehouse_id
        and own_reservation.batch_id = source.inventory_batch_id
       where source.group_id = v_pool.id
         and pg_catalog.abs(
           coalesce(own_reservation.reserved_kg, 0)
             - source.source_balance_snapshot_kg
         ) > 0.001
     )
     or exists (
       select 1
       from public.v_weighbridge_open_ticket_reservations_v1 own_reservation
       where own_reservation.ticket_id = v_ticket.id
         and not exists (
           select 1
           from public.weighbridge_shared_impurity_source_batches source
           where source.group_id = v_pool.id
             and source.company_id = own_reservation.company_id
             and source.warehouse_id = own_reservation.warehouse_id
             and source.inventory_batch_id = own_reservation.batch_id
         )
     )
  then
    raise exception 'SHARED_IMPURITY_MEMBER_TOTAL_INVALID' using errcode = '23514';
  end if;

  v_pool_batch_code := 'SIP-' || pg_catalog.replace(v_pool.id::text, '-', '');
  insert into public.inventory_batches (
    id, company_id, season_id, product_id, crop_id,
    variety_id, reproduction_id, source_field_id, source_ticket_id,
    batch_code, status, initial_weight_kg, current_weight_kg, quality_json,
    batch_class, parent_batch_id, origin_type, origin_ref_id, treatment_status,
    initial_quantity, current_quantity, uom, mass_kg, unit_source,
    unit_contract_version, crop_structure_id, warehouse_id, received_at,
    source_type, composition_snapshot, composition_hash,
    is_mixed_harvest, physical_state, display_name
  ) values (
    v_pool_batch_id, v_pool.company_id, v_pool.season_id,
    v_pool.product_id, v_pool.crop_id,
    null, null, null, null,
    v_pool_batch_code, 'commodity', v_pool.source_total_kg,
    v_pool.source_total_kg,
    pg_catalog.jsonb_build_object(
      'shared_impurity_pool_id', v_pool.id,
      'identity_kind', 'shared_unresolved',
      'source_scope_hash', v_pool.source_scope_hash,
      'member_resolution_status', 'unresolved',
      'source_total_kg', v_pool.source_total_kg
    ),
    'commodity', null, 'shared_impurity_pool', v_pool.id, 'not_applicable',
    v_pool.source_total_kg, v_pool.source_total_kg, 'kg',
    v_pool.source_total_kg, 'shared_impurity_pool_v1',
    2, null, v_pool.source_warehouse_id, pg_catalog.now(),
    'shared_impurity_pool', v_pool.composition_snapshot,
    v_pool.composition_hash, true, 'SOURCE', v_pool.display_name
  ) returning * into v_pool_batch;

  for v_source in
    select s.*, ib.crop_id, ib.variety_id, ib.reproduction_id
    from public.weighbridge_shared_impurity_source_batches s
    join public.inventory_batches ib on ib.id = s.inventory_batch_id
    where s.group_id = v_pool.id
    order by s.inventory_batch_id
  loop
    insert into public.stock_ledger_entries (
      company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
      warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
      direction, quantity, uom, delta_qty_signed, mass_kg,
      unit_source, unit_contract_version, reason_type, reason_ref_id,
      occurred_at, created_by, is_storno, notes
    ) values (
      v_pool.company_id, v_ticket.id, v_pool.product_id,
      v_source.crop_id, v_source.variety_id, v_source.reproduction_id,
      v_pool.source_warehouse_id, v_source.inventory_batch_id,
      v_source.inventory_batch_id::text, v_source.inventory_batch_id::text,
      'commodity', 'out', v_source.source_balance_snapshot_kg, 'kg',
      -v_source.source_balance_snapshot_kg, v_source.source_balance_snapshot_kg,
      'shared_impurity_pool_v1', 2, 'harvest_pool_reclass_out', v_source.id,
      pg_catalog.now(), v_actor.id, false,
      'Full exact source balance moved to shared pool; no member impurity allocation.'
    ) returning id into v_source_ledger_id;

    update public.weighbridge_shared_impurity_source_batches
    set state = 'reclassified',
        reclass_out_ledger_entry_id = v_source_ledger_id,
        reclassified_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where id = v_source.id and state = 'selected';
    if not found then
      raise exception 'SHARED_IMPURITY_SOURCE_RECLASS_UPDATE_FAILED'
        using errcode = '23514';
    end if;

    v_reconciled_balance := private.reconcile_harvest_lot_batch_balance_v1(
      v_source.inventory_batch_id
    );
    if pg_catalog.abs(v_reconciled_balance) > 0.001 then
      raise exception 'SHARED_IMPURITY_SOURCE_NOT_ZERO|%|%',
        v_source.inventory_batch_id, v_reconciled_balance
        using errcode = '23514';
    end if;
  end loop;

  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
    direction, quantity, uom, delta_qty_signed, mass_kg,
    unit_source, unit_contract_version, reason_type, reason_ref_id,
    occurred_at, created_by, is_storno, notes
  ) values (
    v_pool.company_id, v_ticket.id, v_pool.product_id, v_pool.crop_id,
    null, null,
    v_pool.source_warehouse_id, v_pool_batch.id,
    v_pool_batch.id::text, v_pool_batch.id::text, 'commodity',
    'in', v_pool.source_total_kg, 'kg', v_pool.source_total_kg,
    v_pool.source_total_kg, 'shared_impurity_pool_v1', 2,
    'harvest_pool_reclass_in', v_pool.id, pg_catalog.now(), v_actor.id, false,
    'Aggregate pool receipt. Member clean balances remain unresolved.'
  ) returning id into v_pool_in_ledger_id;

  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
    direction, quantity, uom, delta_qty_signed, mass_kg,
    unit_source, unit_contract_version, reason_type, reason_ref_id,
    occurred_at, created_by, is_storno, notes
  ) values (
    v_pool.company_id, v_ticket.id, v_pool.product_id, v_pool.crop_id,
    null, null,
    v_pool.source_warehouse_id, v_pool_batch.id,
    v_pool_batch.id::text, v_pool_batch.id::text, 'commodity',
    'out', v_impurity, 'kg', -v_impurity, v_impurity,
    'shared_impurity_pool_v1', 2, 'weighbridge_impurities_shared',
    v_ticket.id, pg_catalog.now(), v_actor.id, false,
    'One measured group impurity debit; no proportional member allocation.'
  ) returning id into v_impurity_out_ledger_id;

  v_reconciled_balance := private.reconcile_warehouse_local_batch_balance_v1(
    v_pool_batch.id
  );
  if pg_catalog.abs(v_reconciled_balance - v_clean) > 0.001
     or v_pool_batch.variety_id is not null
     or v_pool_batch.reproduction_id is not null
     or coalesce(v_pool_batch.composition_snapshot, '[]'::jsonb)
          is distinct from v_pool.composition_snapshot
     or v_pool_batch.composition_hash is distinct from v_pool.composition_hash
     or coalesce(v_pool_batch.is_mixed_harvest, false)
          is distinct from v_pool.is_mixed_harvest
  then
    raise exception 'SHARED_IMPURITY_POOL_BALANCE_INVALID|%', v_reconciled_balance
      using errcode = '23514';
  end if;

  insert into public.ticket_weighings (
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id,
    weighbridge_shift_id, comment
  ) values (
    v_ticket.id, v_ticket.company_id, 2, v_tare, pg_catalog.now(),
    'manual', v_actor.id, v_session.person_id, v_shift.id,
    case when coalesce(p_tare_variance_confirmed, false)
      then 'Финальная тара общего вывоза; необычная тара подтверждена'
      else 'Финальная тара общего вывоза примеси'
    end
  );

  update public.ticket_lines
  set quantity = v_impurity,
      quantity_kg = v_impurity,
      net_line_weight_kg = v_impurity,
      mass_kg = v_impurity,
      batch_id = v_pool_batch.id,
      lot_id = v_pool_batch.batch_code,
      variety_id = null,
      reproduction_id = null,
      batch_class = 'commodity',
      unit_source = 'shared_impurity_pool_v1',
      unit_contract_version = 2,
      quality_json = coalesce(quality_json, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
             'shared_impurity_pool', pg_catalog.jsonb_build_object(
               'pool_id', v_pool.id,
               'source_total_kg', v_pool.source_total_kg,
               'impurity_weight_kg', v_impurity,
               'clean_total_kg', v_clean,
               'member_resolution_status', 'unresolved'
             )
           ),
      updated_at = pg_catalog.now()
  where id = v_line.id;

  update public.tickets
  set tare_weight_kg = v_tare,
      net_weight_kg = v_impurity,
      physical_net_kg = v_impurity,
      explicit_deductions_kg = 0,
      accepted_weight_kg = v_impurity,
      weighing_2_at = pg_catalog.now(),
      batch_id = v_pool_batch.id,
      lot_id = v_pool_batch.batch_code,
      status = 'finalized',
      is_finalized = true,
      closed_by = v_actor.id,
      finalized_by_person_id = v_session.person_id,
      finalized_at = pg_catalog.now(),
      audit_json = coalesce(audit_json, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
             'stock_source', 'shared_impurity_pool_exact_sources',
             'shared_impurity_pool_finalize', pg_catalog.jsonb_build_object(
               'contract_version', 'shared_impurity_pool_v1',
               'pool_id', v_pool.id,
               'pool_inventory_batch_id', v_pool_batch.id,
               'source_scope_hash', v_pool.source_scope_hash,
               'source_total_kg', v_pool.source_total_kg,
               'impurity_weight_kg', v_impurity,
               'clean_total_kg', v_clean,
               'member_resolution_status', 'unresolved',
               'allocation_rule', 'unknown_not_allocated',
               'idempotency_key', p_idempotency_key,
               'request_fingerprint', v_fingerprint,
               'auth_principal_profile_id', v_principal_id,
               'effective_actor_profile_id', v_actor.id,
               'operator_person_id', v_session.person_id,
               'shift_id', v_shift.id,
               'tare_variance_confirmed', coalesce(p_tare_variance_confirmed, false)
             )
           ),
      updated_at = pg_catalog.now()
  where id = v_ticket.id;

  update public.weighbridge_shared_impurity_groups
  set pool_inventory_batch_id = v_pool_batch.id,
      state = 'finalized',
      impurity_weight_kg = v_impurity,
      clean_total_kg = v_clean,
      finalize_idempotency_key = p_idempotency_key,
      finalize_request_fingerprint = v_fingerprint,
      pool_in_ledger_entry_id = v_pool_in_ledger_id,
      impurity_out_ledger_entry_id = v_impurity_out_ledger_id,
      finalized_by = v_actor.id,
      finalized_by_person_id = v_session.person_id,
      finalized_at = pg_catalog.now(),
      audit_json = audit_json || pg_catalog.jsonb_build_object(
        'finalize', pg_catalog.jsonb_build_object(
          'source_total_kg', source_total_kg,
          'impurity_weight_kg', v_impurity,
          'clean_total_kg', v_clean,
          'pool_inventory_batch_id', v_pool_batch.id,
          'pool_in_ledger_entry_id', v_pool_in_ledger_id,
          'impurity_out_ledger_entry_id', v_impurity_out_ledger_id,
          'member_resolution_status', 'unresolved'
        )
      ),
      updated_at = pg_catalog.now()
  where id = v_pool.id and state = 'open';
  if not found then
    raise exception 'SHARED_IMPURITY_FINALIZE_STATE_CHANGED_RETRY' using errcode = '40001';
  end if;

  select pg_catalog.count(*)::integer into v_weighing_count
  from public.ticket_weighings tw
  where tw.ticket_id = v_ticket.id and tw.company_id = v_ticket.company_id;
  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where sle.reason_type = 'harvest_pool_reclass_out'
    )::integer,
    pg_catalog.count(*) filter (
      where sle.reason_type = 'harvest_pool_reclass_in'
    )::integer,
    pg_catalog.count(*) filter (
      where sle.reason_type = 'weighbridge_impurities_shared'
    )::integer,
    pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
  into v_ledger_count, v_source_out_count, v_pool_in_count,
       v_impurity_out_count, v_ticket_effect
  from public.stock_ledger_entries sle
  where sle.ticket_id = v_ticket.id
    and not coalesce(sle.is_storno, false);
  select pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
  into v_pool_balance
  from public.stock_ledger_entries sle
  where sle.company_id = v_pool.company_id
    and sle.warehouse_id = v_pool.source_warehouse_id
    and sle.inventory_batch_id = v_pool_batch.id;
  select pg_catalog.count(*)::integer into v_zero_source_count
  from public.weighbridge_shared_impurity_source_batches s
  join public.inventory_batches ib on ib.id = s.inventory_batch_id
  where s.group_id = v_pool.id
    and s.state = 'reclassified'
    and pg_catalog.abs(coalesce(ib.current_quantity, 0)) <= 0.001
    and pg_catalog.abs(coalesce(ib.current_weight_kg, 0)) <= 0.001
    and pg_catalog.abs(coalesce(ib.mass_kg, 0)) <= 0.001;

  if v_weighing_count <> 2
     or v_ledger_count <> v_source_count + 2
     or v_source_out_count <> v_source_count
     or v_pool_in_count <> 1
     or v_impurity_out_count <> 1
     or v_zero_source_count <> v_source_count
     or pg_catalog.abs(v_ticket_effect + v_impurity) > 0.001
     or pg_catalog.abs(v_pool_balance - v_clean) > 0.001
     or exists (
       select 1
       from public.weighbridge_shared_impurity_members m
       where m.group_id = v_pool.id
         and (m.clean_balance_status <> 'unresolved' or m.yield_status <> 'unresolved')
     )
     -- Finalized ticket and reclassified sources must no longer reserve the
     -- original batches; otherwise later stock operations would see ghost
     -- commitments even though the source debit already happened.
     or exists (
       select 1
       from public.v_weighbridge_open_ticket_reservations_v1 reservation
       where reservation.ticket_id = v_ticket.id
     )
   then
    raise exception 'SHARED_IMPURITY_FINALIZE_POSTCONDITION_FAILED'
      using errcode = '23514';
  end if;

  update public.weighbridge_shifts
  set last_activity_at = pg_catalog.now()
  where id = v_shift.id and status = 'open';
  update private.weighbridge_operator_sessions
  set expires_at = v_expires, last_seen_at = pg_catalog.now()
  where id = v_session.id and status = 'active';

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, new_values, reason
  ) values (
    v_pool.company_id, v_actor.id, 'weighbridge_shared_impurity_pool',
    v_pool.id::text, 'finalize',
    pg_catalog.jsonb_build_object(
      'ticket_id', v_ticket.id,
      'pool_inventory_batch_id', v_pool_batch.id,
      'source_batch_count', v_source_count,
      'source_total_kg', v_pool.source_total_kg,
      'impurity_weight_kg', v_impurity,
      'clean_total_kg', v_clean,
      'ticket_ledger_effect_kg', v_ticket_effect,
      'member_resolution_status', 'unresolved',
      'auth_principal_profile_id', v_principal_id,
      'effective_actor_profile_id', v_actor.id,
      'operator_person_id', v_session.person_id,
      'shift_id', v_shift.id,
      'idempotency_key', p_idempotency_key
    ),
    'Exact sources reclassified; group impurity posted once; members remain unresolved.'
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket.id,
    'pool_id', v_pool.id,
    'pool_inventory_batch_id', v_pool_batch.id,
    'source_total_kg', v_pool.source_total_kg,
    'impurity_weight_kg', v_impurity,
    'clean_total_kg', v_clean,
    'source_batch_count', v_source_count,
    'member_count', v_member_count,
    'member_resolution_status', 'unresolved',
    'ledger_count', v_ledger_count,
    'idempotent_replay', false
  );
end
$function$;

revoke all on function private.sync_shared_impurity_pool_ticket_void_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists zz_sync_shared_impurity_pool_ticket_void_v1 on public.tickets;
create trigger zz_sync_shared_impurity_pool_ticket_void_v1
after update of status, is_voided, voided_at, voided_by on public.tickets
for each row execute function private.sync_shared_impurity_pool_ticket_void_v1();

create or replace function public.create_weighbridge_shared_impurity_pool_ticket_v1(
  p_company_id uuid,
  p_source_warehouse_id uuid,
  p_sources jsonb,
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_gross_weight_kg numeric,
  p_impurity_type text,
  p_notes text,
  p_session_token text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_principal_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_gate_actor record;
  v_session private.weighbridge_operator_sessions%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_existing public.weighbridge_shared_impurity_groups%rowtype;
  v_source record;
  v_member record;
  v_ids uuid[];
  v_source_scope jsonb;
  v_seasons uuid[];
  v_crops uuid[];
  v_requested_pair_count integer := 0;
  v_structure_count integer := 0;
  v_null_scope_count integer := 0;
  v_source_count integer := 0;
  v_frozen_source_count integer := 0;
  v_member_count integer := 0;
  v_line_count integer := 0;
  v_weighing_count integer := 0;
  v_ledger_count integer := 0;
  v_source_total numeric(18,6) := 0;
  v_source_snapshot_sum numeric(18,6) := 0;
  v_member_snapshot_sum numeric(18,6) := 0;
  v_balance numeric(18,6);
  v_reserved_balance numeric(18,6) := 0;
  v_processing_balance numeric(18,6) := 0;
  v_available_balance numeric(18,6) := 0;
  v_product_id uuid;
  v_composition_snapshot jsonb := '[]'::jsonb;
  v_composition_hash text;
  v_pool_display_name text := 'Общая партия после очистки — состав не распределён';
  v_season_id uuid;
  v_crop_id uuid;
  v_ticket_id uuid := extensions.gen_random_uuid();
  v_pool_id uuid := extensions.gen_random_uuid();
  v_ticket_no text;
  v_fingerprint text;
  v_scope_hash text;
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_gross numeric(14,3) := pg_catalog.round(p_gross_weight_kg, 3);
  v_expires timestamptz := pg_catalog.now() + interval '24 hours';
begin
  if v_principal_id is null then
    raise exception 'SHARED_IMPURITY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_source_warehouse_id is null
     or p_sources is null
     or p_vehicle_id is null
     or p_driver_id is null
     or p_idempotency_key is null
  then
    raise exception 'SHARED_IMPURITY_CREATE_CONTEXT_REQUIRED' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_session_token, '')), '') is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if v_gross is null
     or v_gross::text in ('NaN', 'Infinity', '-Infinity')
     or v_gross <= 0
  then
    raise exception 'SHARED_IMPURITY_GROSS_REQUIRED' using errcode = '22023';
  end if;
  if p_impurity_type is null or p_impurity_type not in (
    'soil_and_trash', 'nonconforming_crop', 'plant_residues', 'other'
  ) then
    raise exception 'SHARED_IMPURITY_TYPE_INVALID' using errcode = '22023';
  end if;
  if p_impurity_type = 'other' and v_notes is null then
    raise exception 'SHARED_IMPURITY_OTHER_NOTE_REQUIRED' using errcode = '22023';
  end if;

  -- Canonicalize the UI scope as exact (harvest_lot_id, crop_structure_id)
  -- pairs.  Keeping the lot in the identity is intentional: selecting one
  -- field slice must never consume a different lot that happens to carry the
  -- same crop_structure_id.
  if pg_catalog.jsonb_typeof(p_sources) is distinct from 'array' then
    raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_INVALID' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_sources) = 0
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_sources) item(value)
       where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
          or nullif(pg_catalog.btrim(item.value ->> 'harvest_lot_id'), '') is null
          or nullif(pg_catalog.btrim(item.value ->> 'crop_structure_id'), '') is null
     )
  then
    raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_INVALID' using errcode = '22023';
  end if;

  with parsed as (
    select source.harvest_lot_id, source.crop_structure_id
    from pg_catalog.jsonb_to_recordset(p_sources) as source(
      harvest_lot_id uuid,
      crop_structure_id uuid
    )
  ), canonical as (
    select parsed.harvest_lot_id, parsed.crop_structure_id
    from parsed
    group by parsed.harvest_lot_id, parsed.crop_structure_id
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'harvest_lot_id', canonical.harvest_lot_id,
          'crop_structure_id', canonical.crop_structure_id
        ) order by canonical.crop_structure_id, canonical.harvest_lot_id
      ),
      '[]'::jsonb
    ),
    coalesce(
      pg_catalog.array_agg(
        distinct canonical.crop_structure_id
        order by canonical.crop_structure_id
      ),
      array[]::uuid[]
    ),
    pg_catalog.count(*)::integer
  into v_source_scope, v_ids, v_requested_pair_count
  from canonical;

  if v_requested_pair_count <> pg_catalog.jsonb_array_length(p_sources) then
    raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_DUPLICATE'
      using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_ids) < 2 then
    raise exception 'SHARED_IMPURITY_REQUIRES_MULTIPLE_CROP_STRUCTURES' using errcode = '22023';
  end if;

  select gate_actor.* into v_gate_actor
  from private.resolve_processing_gate_session_actor_v1() gate_actor;
  if not found
     or v_gate_actor.actor_profile_id is null
     or v_gate_actor.selected_company_id is distinct from p_company_id
  then
    raise exception 'SHARED_IMPURITY_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;

  -- Use the effective session actor for role checks and attribution.  A global
  -- admin principal under impersonation does not inherit write permission from
  -- the principal role; the impersonated profile itself must be allowed.
  select p.* into v_actor
  from public.profiles p
  where p.id = v_gate_actor.actor_profile_id
    and coalesce(p.status, 'active') = 'active';
  if not found
     or v_actor.role not in ('global_admin', 'company_admin', 'weighman')
  then
    raise exception 'SHARED_IMPURITY_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin'
     and v_actor.company_id is distinct from p_company_id
  then
    raise exception 'SHARED_IMPURITY_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;

  -- Read-only token preflight.  The rows are locked and revalidated only after
  -- the universal company+season accounting gate is held.
  select s.* into v_session
  from private.weighbridge_operator_sessions s
  where s.company_id = p_company_id
    and s.auth_user_id = v_principal_id
    and s.token_hash = pg_catalog.encode(
      extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex'
    )
    and s.status = 'active'
  order by s.created_at desc
  limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  select ws.* into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = p_company_id
    and ws.status = 'open';
  if not found
     or v_session.expires_at <= pg_catalog.now()
     or v_shift.last_activity_at + interval '24 hours' <= pg_catalog.now()
     or v_shift.operator_person_id is distinct from v_session.person_id
  then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if not exists (
    select 1
    from public.company_people cp
    where cp.id = v_session.person_id
      and cp.company_id = p_company_id
      and cp.role_type = 'weighbridge_operator'
      and cp.status = 'active'
      and cp.deleted_at is null
  ) then
    raise exception 'SHARED_IMPURITY_OPERATOR_FORBIDDEN' using errcode = '42501';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where cs.season_id is null or cs.crop_id is null or cs.field_id is null
    )::integer,
    coalesce(pg_catalog.array_agg(distinct cs.season_id order by cs.season_id), array[]::uuid[]),
    coalesce(pg_catalog.array_agg(distinct cs.crop_id order by cs.crop_id), array[]::uuid[])
  into v_structure_count, v_null_scope_count, v_seasons, v_crops
  from public.crop_structure cs
  join public.fields f
    on f.id = cs.field_id
   and f.company_id = cs.company_id
  where cs.company_id = p_company_id
    and cs.id = any(v_ids)
    and not coalesce(cs.archived, false)
    and coalesce(cs.land_use_type, 'crop') = 'crop'
    and not coalesce(f.archived, false);
  if v_structure_count <> pg_catalog.cardinality(v_ids)
     or v_null_scope_count <> 0
     or pg_catalog.cardinality(v_seasons) <> 1
     or pg_catalog.cardinality(v_crops) <> 1
  then
    raise exception 'SHARED_IMPURITY_CROP_STRUCTURE_SCOPE_INVALID' using errcode = '23514';
  end if;
  v_season_id := v_seasons[1];
  v_crop_id := v_crops[1];

  if not exists (
    select 1 from public.seasons s
    where s.id = v_season_id
      and s.company_id = p_company_id
      and not coalesce(s.archived, false)
  ) then
    raise exception 'SHARED_IMPURITY_SEASON_INVALID' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_source_warehouse_id
      and w.company_id = p_company_id
      and not coalesce(w.archived, false)
      and not coalesce(w.is_archived, false)
      and (
        w.place_type in ('WAREHOUSE', 'YARD', 'DRYER', 'CLEANER')
        or pg_catalog.lower(coalesce(w.warehouse_type, '')) in (
          'grain', 'grain_storage', 'harvest', 'crop', 'produce', 'elevator'
        )
      )
  ) then
    raise exception 'SHARED_IMPURITY_SOURCE_PLACE_INVALID' using errcode = '23514';
  end if;

  -- This is the same gate hierarchy used by current ticket finalizers and
  -- processing writers.  It must precede every business-row lock or write.
  perform private.assert_processing_gate_actor_v1(p_company_id, v_actor.id);
  perform private.tz315_lock_company_season_write_gate_v1(
    p_company_id, v_season_id
  );

  select s.* into v_session
  from private.weighbridge_operator_sessions s
  where s.id = v_session.id
    and s.company_id = p_company_id
    and s.auth_user_id = v_principal_id
    and s.token_hash = pg_catalog.encode(
      extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex'
    )
    and s.status = 'active'
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  select ws.* into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = p_company_id
    and ws.status = 'open'
  for update;
  if not found
     or v_session.expires_at <= pg_catalog.now()
     or v_shift.last_activity_at + interval '24 hours' <= pg_catalog.now()
     or v_shift.operator_person_id is distinct from v_session.person_id
  then
    if found then
      update public.weighbridge_shifts
      set status = 'closed',
          closed_at = last_activity_at + interval '24 hours',
          closed_by = null,
          closed_by_person_id = operator_person_id,
          close_reason = 'inactivity_24h'
      where id = v_shift.id and status = 'open';
    end if;
    update private.weighbridge_operator_sessions
    set status = 'expired', revoked_at = pg_catalog.now()
    where id = v_session.id;
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'company_id', p_company_id,
          'source_warehouse_id', p_source_warehouse_id,
          'sources', v_source_scope,
          'vehicle_id', p_vehicle_id,
          'driver_id', p_driver_id,
          'gross_weight_kg', v_gross,
          'impurity_type', p_impurity_type,
          'notes', v_notes,
          'contract_version', 'shared_impurity_pool_v1'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'travkinflow.shared-impurity.create.v1|'
        || p_company_id::text || '|' || p_idempotency_key::text,
      0::bigint
    )
  );
  select p.* into v_existing
  from public.weighbridge_shared_impurity_groups p
  where p.company_id = p_company_id
    and p.create_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.create_request_fingerprint is distinct from v_fingerprint then
      raise exception 'SHARED_IMPURITY_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    select t.ticket_no into v_ticket_no
    from public.tickets t
    where t.id = v_existing.ticket_id
      and t.company_id = p_company_id;
    select pg_catalog.count(*)::integer into v_member_count
    from public.weighbridge_shared_impurity_members m
    where m.group_id = v_existing.id;
    select pg_catalog.count(*)::integer into v_source_count
    from public.weighbridge_shared_impurity_source_batches s
    where s.group_id = v_existing.id;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'ticket_id', v_existing.ticket_id,
      'pool_id', v_existing.id,
      'ticket_no', v_ticket_no,
      'state', v_existing.state,
      'source_total_kg', v_existing.source_total_kg,
      'source_batch_count', v_source_count,
      'member_count', v_member_count,
      'member_resolution_status', v_existing.member_resolution_status,
      'idempotent_replay', true
    );
  end if;

  if not (
    exists (
      select 1 from public.reference_vehicles rv
      where rv.id = p_vehicle_id
        and rv.company_id = p_company_id
        and coalesce(rv.is_active, false)
        and not coalesce(rv.archived, false)
    )
    or exists (
      select 1 from public.reference_machines rm
      where rm.id = p_vehicle_id
        and rm.company_id = p_company_id
        and coalesce(rm.is_active, false)
        and not coalesce(rm.archived, false)
    )
  ) then
    raise exception 'SHARED_IMPURITY_VEHICLE_INVALID' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.company_people cp
    where cp.id = p_driver_id
      and cp.company_id = p_company_id
      and cp.role_type in ('driver', 'mechanic_operator')
      and cp.status = 'active'
      and cp.deleted_at is null
  ) then
    raise exception 'SHARED_IMPURITY_DRIVER_INVALID' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.tickets t
    where t.company_id = p_company_id
      and t.status::text in ('draft', 'active', 'ready_to_close')
      and (t.vehicle_id = p_vehicle_id or t.driver_id = p_driver_id)
  ) then
    raise exception 'SHARED_IMPURITY_TRANSPORT_ALREADY_ACTIVE' using errcode = '23505';
  end if;

  -- Freeze crop-structure rows before deriving members, then lock every
  -- potential source batch in UUID order.  The second validation below makes
  -- a direct writer outside the canonical advisory gate fail closed as well.
  perform 1
  from public.crop_structure cs
  where cs.company_id = p_company_id and cs.id = any(v_ids)
  order by cs.id
  for share;

  perform 1
  from public.inventory_batches ib
  join public.harvest_lot_batches hlb
    on hlb.company_id = ib.company_id
   and hlb.inventory_batch_id = ib.id
   and hlb.crop_structure_id = ib.crop_structure_id
  join public.harvest_lots hl
    on hl.id = hlb.harvest_lot_id
   and hl.company_id = hlb.company_id
   and hl.status = 'active'
   and hl.season_id is not distinct from v_season_id
   and hl.crop_id is not distinct from v_crop_id
  where ib.company_id = p_company_id
    and ib.warehouse_id = p_source_warehouse_id
    and exists (
      select 1
      from pg_catalog.jsonb_to_recordset(v_source_scope) as scope(
        harvest_lot_id uuid,
        crop_structure_id uuid
      )
      where scope.harvest_lot_id = hlb.harvest_lot_id
        and scope.crop_structure_id = ib.crop_structure_id
    )
    and ib.batch_class = 'commodity'
    and coalesce(ib.physical_state, 'SOURCE') = 'SOURCE'
    and ib.origin_type in ('harvest', 'transfer')
  order by ib.id
  for update;

  for v_source in
    select
      ib.*,
      cs.field_id as member_field_id,
      hlb.harvest_lot_id as exact_harvest_lot_id,
      hlb.source_ticket_id as lot_batch_source_ticket_id,
      coalesce(ib.source_ticket_id, hlb.source_ticket_id) as exact_source_ticket_id,
      pg_catalog.round(coalesce((
        select pg_catalog.sum(sle.delta_qty_signed)
        from public.stock_ledger_entries sle
        where sle.company_id = ib.company_id
          and sle.warehouse_id = ib.warehouse_id
          and coalesce(
            sle.inventory_batch_id::text,
            nullif(pg_catalog.btrim(sle.batch_id_text), ''),
            nullif(pg_catalog.btrim(sle.batch_id), '')
          ) = ib.id::text
      ), 0), 6) as exact_balance
    from public.inventory_batches ib
    join public.crop_structure cs
      on cs.id = ib.crop_structure_id
     and cs.company_id = ib.company_id
    join public.harvest_lot_batches hlb
      on hlb.company_id = ib.company_id
     and hlb.inventory_batch_id = ib.id
     and hlb.crop_structure_id = ib.crop_structure_id
    join public.harvest_lots hl
      on hl.id = hlb.harvest_lot_id
     and hl.company_id = hlb.company_id
     and hl.status = 'active'
     and hl.season_id is not distinct from v_season_id
     and hl.crop_id is not distinct from v_crop_id
    where ib.company_id = p_company_id
      and ib.warehouse_id = p_source_warehouse_id
      and exists (
        select 1
        from pg_catalog.jsonb_to_recordset(v_source_scope) as scope(
          harvest_lot_id uuid,
          crop_structure_id uuid
        )
        where scope.harvest_lot_id = hlb.harvest_lot_id
          and scope.crop_structure_id = ib.crop_structure_id
      )
      and ib.batch_class = 'commodity'
      and coalesce(ib.physical_state, 'SOURCE') = 'SOURCE'
      and ib.origin_type in ('harvest', 'transfer')
    order by ib.id
  loop
    v_balance := v_source.exact_balance;
    if v_balance::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'SHARED_IMPURITY_SOURCE_BALANCE_INVALID|%', v_source.id
        using errcode = '23514';
    end if;
    if v_balance <= 0.001 then
      continue;
    end if;
    -- This operation promises and later consumes the complete exact balance.
    -- Therefore even a partial foreign reservation/allocation makes the batch
    -- ineligible.  These reads happen after the common gate and batch row lock.
    select pg_catalog.round(coalesce(pg_catalog.sum(reservation.reserved_kg), 0), 6)
    into v_reserved_balance
    from public.v_weighbridge_open_ticket_reservations_v1 reservation
    where reservation.company_id = p_company_id
      and reservation.warehouse_id = p_source_warehouse_id
      and reservation.batch_id = v_source.id;

    select pg_catalog.round(coalesce(pg_catalog.sum(allocation.allocated_kg), 0), 6)
    into v_processing_balance
    from public.v_processing_active_allocations_v1 allocation
    where allocation.company_id = p_company_id
      and allocation.warehouse_id = p_source_warehouse_id
      and allocation.batch_id = v_source.id;

    v_available_balance := pg_catalog.round(
      v_balance - v_reserved_balance - v_processing_balance,
      6
    );
    if v_available_balance < -0.001 then
      raise exception 'SHARED_IMPURITY_SOURCE_AVAILABILITY_NEGATIVE|%|%',
        v_source.id, v_available_balance
        using errcode = '23514';
    end if;
    if pg_catalog.abs(v_available_balance - v_balance) > 0.001 then
      raise exception 'SHARED_IMPURITY_SOURCE_ALREADY_COMMITTED|%|%',
        v_source.id, greatest(v_available_balance, 0)
        using errcode = '23514';
    end if;
    if v_source.season_id is distinct from v_season_id
       or v_source.crop_id is distinct from v_crop_id
       or v_source.product_id is null
       or public.canonical_stock_uom(v_source.uom) is distinct from 'kg'
       or (
         v_source.source_ticket_id is not null
         and v_source.lot_batch_source_ticket_id is not null
         and v_source.source_ticket_id is distinct from v_source.lot_batch_source_ticket_id
       )
    then
      raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_MISMATCH|%', v_source.id
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.stock_ledger_entries source_entry
      where source_entry.company_id = p_company_id
        and source_entry.warehouse_id = p_source_warehouse_id
        and coalesce(
          source_entry.inventory_batch_id::text,
          nullif(pg_catalog.btrim(source_entry.batch_id_text), ''),
          nullif(pg_catalog.btrim(source_entry.batch_id), '')
        ) = v_source.id::text
        and public.canonical_stock_uom(source_entry.uom) is distinct from 'kg'
    ) then
      raise exception 'SHARED_IMPURITY_SOURCE_UOM_INVALID|%', v_source.id
        using errcode = '23514';
    end if;
    v_composition_snapshot := v_composition_snapshot || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'inventory_batch_id', v_source.id,
        'harvest_lot_id', v_source.exact_harvest_lot_id,
        'crop_structure_id', v_source.crop_structure_id,
        'field_id', v_source.member_field_id,
        'source_ticket_id', v_source.exact_source_ticket_id,
        'product_id', v_source.product_id,
        'crop_id', v_source.crop_id,
        'variety_id', v_source.variety_id,
        'reproduction_id', v_source.reproduction_id,
        'source_is_mixed_harvest', coalesce(v_source.is_mixed_harvest, false),
        'source_composition_hash', v_source.composition_hash,
        'source_composition_snapshot', coalesce(v_source.composition_snapshot, '[]'::jsonb),
        'pre_impurity_source_mass_kg', v_balance,
        'clean_mass_status', 'unresolved'
      )
    );
    if v_product_id is null then
      v_product_id := v_source.product_id;
    elsif v_product_id is distinct from v_source.product_id then
      raise exception 'SHARED_IMPURITY_MULTIPLE_PRODUCTS_UNSUPPORTED'
        using errcode = '23514';
    end if;
    if (v_source.current_quantity is not null
          and pg_catalog.abs(v_source.current_quantity - v_balance) > 0.001)
       or (v_source.current_weight_kg is not null
          and pg_catalog.abs(v_source.current_weight_kg - v_balance) > 0.001)
       or (v_source.mass_kg is not null
          and pg_catalog.abs(v_source.mass_kg - v_balance) > 0.001)
    then
      raise exception 'SHARED_IMPURITY_SOURCE_BALANCE_STALE|%', v_source.id
        using errcode = '23514';
    end if;
    if v_source.exact_source_ticket_id is not null
       and not exists (
         select 1 from public.tickets t
         where t.id = v_source.exact_source_ticket_id
           and t.company_id = p_company_id
           and t.status::text = 'finalized'
           and coalesce(t.is_finalized, false)
           and not coalesce(t.is_voided, false)
           and t.replacement_ticket_id is null
       )
    then
      raise exception 'SHARED_IMPURITY_SOURCE_TICKET_INVALID|%', v_source.id
        using errcode = '23514';
    end if;
    if v_source.exact_source_ticket_id is not null
       and exists (
         select 1 from public.stock_ledger_entries sle
         where sle.ticket_id = v_source.exact_source_ticket_id
           and sle.inventory_batch_id is null
           and coalesce(
             nullif(pg_catalog.btrim(sle.batch_id_text), ''),
             nullif(pg_catalog.btrim(sle.batch_id), '')
           ) is distinct from v_source.id::text
       )
    then
      raise exception 'SHARED_IMPURITY_SOURCE_LEDGER_IDENTITY_AMBIGUOUS|%', v_source.id
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.weighbridge_shared_impurity_source_batches existing_source
      where existing_source.inventory_batch_id = v_source.id
        and existing_source.state in ('selected', 'reclassified')
    ) then
      raise exception 'SHARED_IMPURITY_SOURCE_ALREADY_SELECTED|%', v_source.id
        using errcode = '23505';
    end if;
    v_source_total := v_source_total + v_balance;
    v_source_count := v_source_count + 1;
  end loop;

  if v_source_count = 0 or v_product_id is null or v_source_total <= 0 then
    raise exception 'SHARED_IMPURITY_NO_EXACT_SOURCE_STOCK' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.products product
    where product.id = v_product_id
      and public.canonical_stock_uom(
        coalesce(nullif(product.base_uom, ''), product.unit)
      ) = 'kg'
  ) then
    raise exception 'SHARED_IMPURITY_PRODUCT_UOM_INVALID' using errcode = '23514';
  end if;
  if pg_catalog.jsonb_array_length(v_composition_snapshot) <> v_source_count then
    raise exception 'SHARED_IMPURITY_COMPOSITION_SNAPSHOT_INVALID' using errcode = '23514';
  end if;
  v_composition_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_composition_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_frozen_source_count := v_source_count;

  v_ticket_no := 'SI-' || pg_catalog.replace(v_ticket_id::text, '-', '');
  insert into public.tickets (
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, destination_kind, destination_id,
    warehouse_from_id, warehouse_to_id, vehicle_id, driver_id,
    responsible_user_id, created_by, gross_weight_kg, weigh_method,
    weighing_1_at, is_finalized, is_voided, notes, shift_id, season_id,
    weight_source, batch_id, crop_structure_allocation_id,
    created_by_person_id, source_physical_state, audit_json
  ) values (
    v_ticket_id, p_company_id, v_ticket_no, 'impurity_removal',
    'weighbridge_impurities', 'active', 'outgoing',
    'warehouse', p_source_warehouse_id::text, 'impurity_removal', null,
    p_source_warehouse_id, null, p_vehicle_id, p_driver_id,
    v_actor.id, v_actor.id, v_gross, 'double_weighing',
    pg_catalog.now(), false, false, v_notes, v_shift.id, v_season_id,
    'manual', null, null, v_session.person_id, 'SOURCE',
    pg_catalog.jsonb_build_object(
      'impurity_type', p_impurity_type,
      'stock_source', 'shared_impurity_pool_exact_sources',
      'shared_impurity_pool', pg_catalog.jsonb_build_object(
        'contract_version', 'shared_impurity_pool_v1',
        'pool_id', v_pool_id,
        'sources', v_source_scope,
        'source_crop_structure_ids', pg_catalog.to_jsonb(v_ids),
        'member_resolution_status', 'unresolved',
        'create_idempotency_key', p_idempotency_key,
        'create_request_fingerprint', v_fingerprint,
        'auth_principal_profile_id', v_principal_id,
        'effective_actor_profile_id', v_actor.id,
        'operator_person_id', v_session.person_id,
        'shift_id', v_shift.id
      )
    )
  );

  insert into public.weighbridge_shared_impurity_groups (
    id, company_id, ticket_id, source_warehouse_id, season_id, crop_id,
    product_id, identity_kind, display_name, composition_snapshot,
    composition_hash, is_mixed_harvest, state, impurity_type, source_total_kg,
    create_idempotency_key, create_request_fingerprint,
    created_by, created_by_person_id, audit_json
  ) values (
    v_pool_id, p_company_id, v_ticket_id, p_source_warehouse_id,
    v_season_id, v_crop_id, v_product_id, 'shared_unresolved',
    v_pool_display_name, v_composition_snapshot, v_composition_hash, true,
    'open', p_impurity_type,
    pg_catalog.round(v_source_total, 6), p_idempotency_key, v_fingerprint,
    v_actor.id, v_session.person_id,
    pg_catalog.jsonb_build_object(
      'contract_version', 'shared_impurity_pool_v1',
      'allocation_rule', 'unknown_not_allocated',
      'commodity_identity_rule', 'shared_unresolved_multi_source',
      'source_physical_state', 'SOURCE'
    )
  );

  insert into public.weighbridge_shared_impurity_members (
    group_id, company_id, crop_structure_id, field_id, identity_snapshot
  )
  select
    v_pool_id,
    p_company_id,
    cs.id,
    cs.field_id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'field_id', cs.field_id,
      'field_name', f.name,
      'crop_id', cs.crop_id,
      'crop_name', coalesce(nullif(pg_catalog.btrim(c.name_ru), ''), c.name),
      'variety_id', cs.variety_id,
      'variety_name', nullif(pg_catalog.btrim(variety.name), ''),
      'reproduction_id', cs.reproduction_id,
      'reproduction_name', coalesce(
        nullif(pg_catalog.btrim(reproduction.name_ru), ''),
        nullif(pg_catalog.btrim(reproduction.name), ''),
        nullif(pg_catalog.btrim(reproduction.code), '')
      ),
      'area_ha', cs.area
    ))
  from public.crop_structure cs
  join public.fields f
    on f.id = cs.field_id
   and f.company_id = cs.company_id
  join public.crops c on c.id = cs.crop_id
  left join public.varieties variety on variety.id = cs.variety_id
  left join public.seed_reproductions reproduction on reproduction.id = cs.reproduction_id
  where cs.company_id = p_company_id
    and cs.id = any(v_ids)
  order by cs.id;

  for v_source in
    select
      ib.id,
      ib.crop_structure_id,
      ib.product_id,
      coalesce(ib.source_ticket_id, hlb.source_ticket_id) as exact_source_ticket_id,
      hlb.harvest_lot_id,
      pg_catalog.round(coalesce((
        select pg_catalog.sum(sle.delta_qty_signed)
        from public.stock_ledger_entries sle
        where sle.company_id = ib.company_id
          and sle.warehouse_id = ib.warehouse_id
          and coalesce(
            sle.inventory_batch_id::text,
            nullif(pg_catalog.btrim(sle.batch_id_text), ''),
            nullif(pg_catalog.btrim(sle.batch_id), '')
          ) = ib.id::text
      ), 0), 6) as exact_balance
    from public.inventory_batches ib
    join public.harvest_lot_batches hlb
      on hlb.company_id = ib.company_id
     and hlb.inventory_batch_id = ib.id
     and hlb.crop_structure_id = ib.crop_structure_id
    join public.harvest_lots hl
      on hl.id = hlb.harvest_lot_id
     and hl.company_id = hlb.company_id
     and hl.status = 'active'
     and hl.season_id is not distinct from v_season_id
     and hl.crop_id is not distinct from v_crop_id
    where ib.company_id = p_company_id
      and ib.warehouse_id = p_source_warehouse_id
      and exists (
        select 1
        from pg_catalog.jsonb_to_recordset(v_source_scope) as scope(
          harvest_lot_id uuid,
          crop_structure_id uuid
        )
        where scope.harvest_lot_id = hlb.harvest_lot_id
          and scope.crop_structure_id = ib.crop_structure_id
      )
      and ib.batch_class = 'commodity'
      and coalesce(ib.physical_state, 'SOURCE') = 'SOURCE'
      and ib.origin_type in ('harvest', 'transfer')
    order by ib.id
  loop
    if v_source.exact_balance <= 0.001 then
      continue;
    end if;
    select m.* into v_member
    from public.weighbridge_shared_impurity_members m
    where m.group_id = v_pool_id
      and m.company_id = p_company_id
      and m.crop_structure_id = v_source.crop_structure_id;
    if not found then
      raise exception 'SHARED_IMPURITY_MEMBER_POSTCONDITION_FAILED'
        using errcode = '23514';
    end if;

    insert into public.weighbridge_shared_impurity_source_batches (
      group_id, member_id, company_id, crop_structure_id,
      source_ticket_id, harvest_lot_id, inventory_batch_id,
      warehouse_id, product_id, source_balance_snapshot_kg
    ) values (
      v_pool_id, v_member.id, p_company_id, v_source.crop_structure_id,
      v_source.exact_source_ticket_id, v_source.harvest_lot_id, v_source.id,
      p_source_warehouse_id, v_source.product_id, v_source.exact_balance
    );

    update public.weighbridge_shared_impurity_members
    set source_batch_count = source_batch_count + 1,
        source_total_snapshot_kg = source_total_snapshot_kg + v_source.exact_balance,
        updated_at = pg_catalog.now()
    where id = v_member.id;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(v_source_scope) as scope(
      harvest_lot_id uuid,
      crop_structure_id uuid
    )
    where not exists (
      select 1
      from public.weighbridge_shared_impurity_source_batches source
      where source.group_id = v_pool_id
        and source.harvest_lot_id = scope.harvest_lot_id
        and source.crop_structure_id = scope.crop_structure_id
    )
  ) then
    raise exception 'SHARED_IMPURITY_SOURCE_PAIR_HAS_NO_STOCK' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.weighbridge_shared_impurity_members m
    where m.group_id = v_pool_id
      and (m.source_batch_count = 0 or m.source_total_snapshot_kg <= 0)
  ) then
    raise exception 'SHARED_IMPURITY_MEMBER_HAS_NO_SOURCE_STOCK' using errcode = '23514';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.round(coalesce(pg_catalog.sum(s.source_balance_snapshot_kg), 0), 6)
  into v_source_count, v_source_snapshot_sum
  from public.weighbridge_shared_impurity_source_batches s
  where s.group_id = v_pool_id;
  select pg_catalog.round(
    coalesce(pg_catalog.sum(m.source_total_snapshot_kg), 0), 6
  )
  into v_member_snapshot_sum
  from public.weighbridge_shared_impurity_members m
  where m.group_id = v_pool_id;
  if v_source_count <> v_frozen_source_count
     or pg_catalog.abs(v_source_snapshot_sum - v_source_total) > 0.001
     or pg_catalog.abs(v_member_snapshot_sum - v_source_total) > 0.001
  then
    raise exception 'SHARED_IMPURITY_SOURCE_SNAPSHOT_CHANGED_RETRY'
      using errcode = '40001';
  end if;

  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'crop_structure_id', s.crop_structure_id,
              'harvest_lot_id', s.harvest_lot_id,
              'inventory_batch_id', s.inventory_batch_id,
              'source_balance_snapshot_kg', s.source_balance_snapshot_kg
            ) order by s.inventory_batch_id
          ),
          '[]'::jsonb
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) into v_scope_hash
  from public.weighbridge_shared_impurity_source_batches s
  where s.group_id = v_pool_id;

  update public.weighbridge_shared_impurity_groups
  set source_scope_hash = v_scope_hash,
      audit_json = audit_json || pg_catalog.jsonb_build_object(
        'source_scope_hash', v_scope_hash,
        'source_batch_count', v_source_count,
        'source_total_kg', pg_catalog.round(v_source_total, 6)
      ),
      updated_at = pg_catalog.now()
  where id = v_pool_id;

  insert into public.ticket_lines (
    ticket_id, company_id, product_id, crop_id, variety_id, reproduction_id,
    quantity, uom,
    warehouse_from_id, warehouse_to_id, batch_id, lot_id, batch_class,
    line_type, quality_json, mass_kg, unit_source, unit_contract_version,
    notes
  ) values (
    v_ticket_id, p_company_id, v_product_id, v_crop_id,
    null, null, 0, 'kg',
    p_source_warehouse_id, null, null, null, 'commodity',
    'impurity_removal',
    pg_catalog.jsonb_build_object(
      'shared_impurity_pool_id', v_pool_id,
      'member_resolution_status', 'unresolved',
      'identity_kind', 'shared_unresolved',
      'commodity_identity_rule', 'multi_source_provenance_only'
    ),
    null, 'shared_impurity_pool_v1', null,
    'Общий вес примеси; распределение по участкам не определено.'
  );

  insert into public.ticket_weighings (
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id,
    weighbridge_shift_id, comment
  ) values (
    v_ticket_id, p_company_id, 1, v_gross, pg_catalog.now(),
    'manual', v_actor.id, v_session.person_id, v_shift.id,
    'Первое взвешивание общего вывоза примеси'
  );

  select pg_catalog.count(*)::integer into v_member_count
  from public.weighbridge_shared_impurity_members m
  where m.group_id = v_pool_id;
  select pg_catalog.count(*)::integer into v_source_count
  from public.weighbridge_shared_impurity_source_batches s
  where s.group_id = v_pool_id;
  select pg_catalog.count(*)::integer into v_line_count
  from public.ticket_lines tl
  where tl.ticket_id = v_ticket_id and tl.company_id = p_company_id;
  select pg_catalog.count(*)::integer into v_weighing_count
  from public.ticket_weighings tw
  where tw.ticket_id = v_ticket_id and tw.company_id = p_company_id;
  select pg_catalog.count(*)::integer into v_ledger_count
  from public.stock_ledger_entries sle
  where sle.ticket_id = v_ticket_id;
  if v_member_count <> pg_catalog.cardinality(v_ids)
     or v_source_count < v_member_count
     or v_line_count <> 1
     or v_weighing_count <> 1
     or v_ledger_count <> 0
     or exists (
       select 1
       from public.weighbridge_shared_impurity_members m
       where m.group_id = v_pool_id
         and (
           m.clean_balance_status <> 'unresolved'
           or m.yield_status <> 'unresolved'
           or coalesce(m.identity_snapshot ->> 'field_id', '') <> m.field_id::text
           or coalesce(m.identity_snapshot ->> 'crop_id', '') = ''
         )
     )
     or exists (
       select 1
       from public.weighbridge_shared_impurity_source_batches source
       where source.group_id = v_pool_id
         and pg_catalog.abs(
           coalesce((
             select pg_catalog.sum(reservation.reserved_kg)
             from public.v_weighbridge_open_ticket_reservations_v1 reservation
             where reservation.ticket_id = v_ticket_id
               and reservation.company_id = p_company_id
               and reservation.warehouse_id = source.warehouse_id
               and reservation.batch_id = source.inventory_batch_id
           ), 0) - source.source_balance_snapshot_kg
         ) > 0.001
     )
  then
    raise exception 'SHARED_IMPURITY_CREATE_POSTCONDITION_FAILED'
      using errcode = '23514';
  end if;

  update public.weighbridge_shifts
  set last_activity_at = pg_catalog.now()
  where id = v_shift.id and status = 'open';
  update private.weighbridge_operator_sessions
  set expires_at = v_expires, last_seen_at = pg_catalog.now()
  where id = v_session.id and status = 'active';

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, new_values, reason
  ) values (
    p_company_id, v_actor.id, 'weighbridge_shared_impurity_pool',
    v_pool_id::text, 'create',
    pg_catalog.jsonb_build_object(
      'ticket_id', v_ticket_id,
      'sources', v_source_scope,
      'crop_structure_ids', pg_catalog.to_jsonb(v_ids),
      'source_batch_count', v_source_count,
      'source_total_kg', pg_catalog.round(v_source_total, 6),
      'auth_principal_profile_id', v_principal_id,
      'effective_actor_profile_id', v_actor.id,
      'source_scope_hash', v_scope_hash,
      'member_resolution_status', 'unresolved',
      'operator_person_id', v_session.person_id,
      'shift_id', v_shift.id,
      'idempotency_key', p_idempotency_key
    ),
    'Physical impurity ticket created without a per-member allocation.'
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket_id,
    'pool_id', v_pool_id,
    'ticket_no', v_ticket_no,
    'state', 'open',
    'source_total_kg', pg_catalog.round(v_source_total, 6),
    'source_batch_count', v_source_count,
    'member_count', v_member_count,
    'member_resolution_status', 'unresolved',
    'idempotent_replay', false
  );
end
$function$;

-- RPCs are the only client write surface.  Direct table mutation stays closed,
-- including to authenticated users, so caller-controlled company/scope values
-- always pass through the actor, selected-company, gate, shift and row-lock
-- checks above.
revoke all on function public.create_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, uuid, jsonb, uuid, uuid, numeric, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, uuid, jsonb, uuid, uuid, numeric, text, text, text, uuid
) to authenticated;

revoke all on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) to authenticated;

comment on function public.create_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, uuid, jsonb, uuid, uuid, numeric, text, text, text, uuid
) is
  'Creates one open shared-impurity ticket from exact JSON source pairs {harvest_lot_id,crop_structure_id}; no ledger write occurs until finalize.';
comment on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) is
  'Atomically reclassifies every selected exact source balance into one pool and deducts the measured group impurity once; member clean balances and yields remain unresolved.';

-- Migration-time catalog postconditions guard accidental privilege or contract
-- drift.  Runtime mass, scope, ledger and unresolved-member postconditions are
-- enforced inside the two RPC transactions.
do $postconditions$
begin
  if pg_catalog.to_regprocedure(
       'public.create_weighbridge_shared_impurity_pool_ticket_v1(uuid,uuid,jsonb,uuid,uuid,numeric,text,text,text,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.finalize_weighbridge_shared_impurity_pool_ticket_v1(uuid,text,numeric,boolean,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.reject_shared_impurity_ticket_correction_v1()'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.assert_shared_impurity_group_ticket_linkage_v1()'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.enforce_shared_impurity_lifecycle_v1()'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.tickets'::pg_catalog.regclass
         and trigger_row.tgname = 'reject_shared_impurity_ticket_correction_v1'
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.tickets'::pg_catalog.regclass
         and trigger_row.tgname = 'enforce_shared_impurity_ticket_lifecycle_v1'
         and trigger_row.tgdeferrable
         and trigger_row.tginitdeferred
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'public.weighbridge_shared_impurity_groups'::pg_catalog.regclass
         and trigger_row.tgname = 'enforce_shared_impurity_group_lifecycle_v1'
         and trigger_row.tgdeferrable
         and trigger_row.tginitdeferred
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'public.weighbridge_shared_impurity_groups'::pg_catalog.regclass
         and trigger_row.tgname = 'assert_shared_impurity_group_ticket_linkage_v1'
         and not trigger_row.tgisinternal
     )
  then
    raise exception 'SHARED_IMPURITY_RPC_POSTCONDITION_FAILED' using errcode = '55000';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated', 'public.weighbridge_shared_impurity_groups', 'INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated', 'public.weighbridge_shared_impurity_members', 'INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated', 'public.weighbridge_shared_impurity_source_batches', 'INSERT,UPDATE,DELETE'
     )
  then
    raise exception 'SHARED_IMPURITY_DIRECT_WRITE_PRIVILEGE_LEAK' using errcode = '42501';
  end if;
end
$postconditions$;

notify pgrst, 'reload schema';

commit;
