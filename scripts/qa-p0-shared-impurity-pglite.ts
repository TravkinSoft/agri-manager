import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

type Row = Record<string, unknown>;

const ID = {
  company: "49000000-0000-4000-8000-000000000001",
  actor: "49000000-0000-4000-8000-000000000002",
  operator: "49000000-0000-4000-8000-000000000003",
  driver: "49000000-0000-4000-8000-000000000004",
  shift: "49000000-0000-4000-8000-000000000005",
  session: "49000000-0000-4000-8000-000000000006",
  vehicle: "49000000-0000-4000-8000-000000000007",
  warehouse: "49000000-0000-4000-8000-000000000008",
  season: "49000000-0000-4000-8000-000000000009",
  crop: "49000000-0000-4000-8000-000000000010",
  product: "49000000-0000-4000-8000-000000000011",
  fieldA: "49000000-0000-4000-8000-000000000012",
  fieldB: "49000000-0000-4000-8000-000000000013",
  structureA: "49000000-0000-4000-8000-000000000014",
  structureB: "49000000-0000-4000-8000-000000000015",
  lotA: "49000000-0000-4000-8000-000000000016",
  lotB: "49000000-0000-4000-8000-000000000017",
  batchA: "49000000-0000-4000-8000-000000000018",
  batchB: "49000000-0000-4000-8000-000000000019",
  varietyA: "49000000-0000-4000-8000-000000000020",
  varietyB: "49000000-0000-4000-8000-000000000021",
  reproductionA: "49000000-0000-4000-8000-000000000022",
  reproductionB: "49000000-0000-4000-8000-000000000023",
  createKey: "49000000-0000-4000-8000-000000000024",
  finalizeKey: "49000000-0000-4000-8000-000000000025",
  legacyTicket: "49000000-0000-4000-8000-000000000026",
  regularReservationTicket: "49000000-0000-4000-8000-000000000027",
  correctionTicket: "49000000-0000-4000-8000-000000000028",
  conflictCreateKey: "49000000-0000-4000-8000-000000000029",
  processingCreateKey: "49000000-0000-4000-8000-000000000030",
  secondSharedCreateKey: "49000000-0000-4000-8000-000000000031",
  processingAllocation: "49000000-0000-4000-8000-000000000032",
  finalizeConflictKey: "49000000-0000-4000-8000-000000000033",
  vehicle2: "49000000-0000-4000-8000-000000000034",
  driver2: "49000000-0000-4000-8000-000000000035",
  exactCreateKey: "49000000-0000-4000-8000-000000000036",
  exactFinalizeKey: "49000000-0000-4000-8000-000000000037",
} as const;

const SESSION_TOKEN = "qa-p0-shared-impurity-session";

const rows = async (db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as Row[];

const scalar = async <T = unknown>(db: PGlite, sql: string, params: unknown[] = []) =>
  Object.values((await rows(db, sql, params))[0] ?? {})[0] as T;

const asAuthenticated = async <T>(db: PGlite, run: () => Promise<T>) => {
  await db.exec("set role authenticated");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
};

const expectDatabaseError = async (run: () => Promise<unknown>, pattern: RegExp) => {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, `expected database error matching ${pattern}`);
  assert.match(thrown.message, pattern);
};

async function findSharedImpurityMigration() {
  const migrationDirectory = join(process.cwd(), "supabase", "migrations");
  const candidates: Array<{ path: string; sql: string }> = [];
  for (const fileName of await readdir(migrationDirectory)) {
    if (!fileName.endsWith(".sql")) continue;
    const path = join(migrationDirectory, fileName);
    const sql = await readFile(path, "utf8");
    if (
      sql.includes("P0 shared impurity pool V1")
      && sql.includes("create_weighbridge_shared_impurity_pool_ticket_v1")
      && sql.includes("finalize_weighbridge_shared_impurity_pool_ticket_v1")
    ) {
      candidates.push({ path, sql });
    }
  }
  assert.equal(candidates.length, 1, "exactly one shared-impurity migration must exist");
  return candidates[0]!;
}

async function findExactSourceMigration() {
  const migrationDirectory = join(process.cwd(), "supabase", "migrations");
  const candidates: Array<{ path: string; sql: string }> = [];
  for (const fileName of await readdir(migrationDirectory)) {
    if (!fileName.endsWith(".sql")) continue;
    const path = join(migrationDirectory, fileName);
    const sql = await readFile(path, "utf8");
    if (sql.includes("P0 exact impurity source scope V1")) candidates.push({ path, sql });
  }
  assert.equal(candidates.length, 1, "exactly one exact-source extension migration must exist");
  return candidates[0]!;
}

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema private;
    create schema extensions;

    create or replace function extensions.gen_random_uuid()
    returns uuid language sql volatile
    as $$ select gen_random_uuid() $$;
    create or replace function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable
    as $$ select decode(md5(value) || md5(value || ':sha256-tail'), 'hex') $$;
    create or replace function extensions.digest(value bytea, algorithm text)
    returns bytea language sql immutable
    as $$
      select decode(
        md5(encode(value, 'hex')) || md5(encode(value, 'hex') || ':sha256-tail'),
        'hex'
      )
    $$;

    create table public.companies(
      id uuid primary key,
      name text not null
    );
    create table public.profiles(
      id uuid primary key,
      company_id uuid references public.companies(id),
      role text not null,
      status text not null default 'active'
    );
    create table public.company_people(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      role_type text not null,
      status text not null default 'active',
      deleted_at timestamptz
    );
    create table public.seasons(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      archived boolean not null default false
    );
    create table public.crops(
      id uuid primary key,
      name text not null,
      name_ru text
    );
    create table public.varieties(
      id uuid primary key,
      name text not null
    );
    create table public.seed_reproductions(
      id uuid primary key,
      name_ru text,
      name text,
      code text
    );
    create table public.products(
      id uuid primary key,
      name text not null,
      base_uom text,
      unit text
    );
    create table public.warehouses(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      name text not null,
      archived boolean not null default false,
      is_archived boolean not null default false,
      place_type text,
      warehouse_type text
    );
    create table public.fields(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      name text not null,
      archived boolean not null default false
    );
    create table public.crop_structure(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      field_id uuid not null references public.fields(id),
      season_id uuid references public.seasons(id),
      crop_id uuid references public.crops(id),
      variety_id uuid references public.varieties(id),
      reproduction_id uuid references public.seed_reproductions(id),
      area numeric(18,6),
      archived boolean not null default false,
      land_use_type text not null default 'crop'
    );
    create table public.reference_vehicles(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      is_active boolean not null default true,
      archived boolean not null default false
    );
    create table public.reference_machines(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      is_active boolean not null default true,
      archived boolean not null default false
    );
    create table public.weighbridge_shifts(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      status text not null,
      operator_person_id uuid,
      opened_at timestamptz not null default now(),
      last_activity_at timestamptz not null default now(),
      closed_at timestamptz,
      closed_by uuid,
      closed_by_person_id uuid,
      close_reason text
    );
    create table private.weighbridge_operator_sessions(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      auth_user_id uuid not null,
      shift_id uuid not null references public.weighbridge_shifts(id),
      person_id uuid not null references public.company_people(id),
      token_hash text not null,
      status text not null,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      last_seen_at timestamptz,
      revoked_at timestamptz
    );
    create table public.tickets(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      ticket_no text not null,
      ticket_type text,
      op_type text not null,
      status text not null,
      direction text,
      source_kind text,
      source_id text,
      destination_kind text,
      destination_id text,
      warehouse_from_id uuid,
      warehouse_to_id uuid,
      vehicle_id uuid,
      driver_id uuid,
      responsible_user_id uuid,
      created_by uuid,
      gross_weight_kg numeric(18,6),
      tare_weight_kg numeric(18,6),
      net_weight_kg numeric(18,6),
      physical_net_kg numeric(18,6),
      explicit_deductions_kg numeric(18,6),
      accepted_weight_kg numeric(18,6),
      weigh_method text,
      weighing_1_at timestamptz,
      weighing_2_at timestamptz,
      is_finalized boolean not null default false,
      is_voided boolean not null default false,
      notes text,
      shift_id uuid,
      season_id uuid,
      weight_source text,
      batch_id uuid,
      lot_id text,
      crop_structure_allocation_id uuid,
      created_by_person_id uuid,
      source_physical_state text,
      replacement_ticket_id uuid,
      correction_of_ticket_id uuid,
      linked_request_id uuid,
      linked_processing_id uuid,
      processing_output_role text,
      processing_allocation_ready boolean not null default false,
      closed_by uuid,
      finalized_by_person_id uuid,
      finalized_at timestamptz,
      voided_by uuid,
      voided_at timestamptz,
      void_reason text,
      audit_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.ticket_lines(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null references public.tickets(id) on delete cascade,
      company_id uuid not null references public.companies(id),
      product_id uuid not null references public.products(id),
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      quantity numeric(18,6),
      quantity_kg numeric(18,6),
      uom text not null,
      warehouse_from_id uuid,
      warehouse_to_id uuid,
      batch_id text,
      lot_id text,
      batch_class text,
      line_type text,
      quality_json jsonb not null default '{}'::jsonb,
      mass_kg numeric(18,6),
      net_line_weight_kg numeric(18,6),
      unit_source text,
      unit_contract_version smallint,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.ticket_weighings(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null references public.tickets(id) on delete cascade,
      company_id uuid not null references public.companies(id),
      weighing_no integer not null,
      measured_weight_kg numeric(18,6) not null,
      measured_at timestamptz,
      device_source text,
      operator_user_id uuid,
      operator_person_id uuid,
      weighbridge_shift_id uuid,
      comment text,
      unique(ticket_id, weighing_no)
    );
    create table public.inventory_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id),
      season_id uuid,
      product_id uuid,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      source_field_id uuid,
      source_ticket_id uuid,
      batch_code text not null,
      status text not null default 'commodity',
      initial_weight_kg numeric(18,6),
      current_weight_kg numeric(18,6),
      quality_json jsonb not null default '{}'::jsonb,
      batch_class text not null default 'commodity',
      parent_batch_id uuid,
      origin_type text,
      origin_ref_id uuid,
      treatment_status text,
      initial_quantity numeric(18,6),
      current_quantity numeric(18,6),
      uom text,
      mass_kg numeric(18,6),
      unit_source text,
      unit_contract_version smallint,
      crop_structure_id uuid,
      warehouse_id uuid,
      received_at timestamptz,
      source_type text,
      composition_snapshot jsonb not null default '[]'::jsonb,
      composition_hash text,
      is_mixed_harvest boolean not null default false,
      physical_state text,
      display_name text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(company_id, batch_code)
    );
    create table public.harvest_lots(
      id uuid primary key,
      company_id uuid not null references public.companies(id),
      season_id uuid,
      crop_id uuid,
      status text not null default 'active'
    );
    create table public.harvest_lot_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id),
      harvest_lot_id uuid not null references public.harvest_lots(id),
      inventory_batch_id uuid not null references public.inventory_batches(id),
      source_ticket_id uuid,
      crop_structure_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(inventory_batch_id)
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id),
      ticket_id uuid,
      processing_id uuid,
      product_id uuid,
      crop_id uuid,
      variety_id uuid,
      reproduction_id uuid,
      warehouse_id uuid,
      inventory_batch_id uuid,
      batch_id text,
      batch_id_text text,
      batch_class text,
      operation_line_id uuid,
      warehouse_issue_allocation_id uuid,
      direction text not null,
      quantity numeric(18,6) not null,
      uom text not null,
      delta_qty_signed numeric(18,6) not null,
      mass_kg numeric(18,6),
      density_kg_per_l numeric(18,6),
      density_unit text,
      density_source text,
      density_verification_status text,
      density_verified_at timestamptz,
      unit_source text,
      unit_contract_version smallint,
      reason_type text not null,
      reason_ref_id uuid,
      occurred_at timestamptz not null default now(),
      created_by uuid,
      is_storno boolean not null default false,
      storno_of_entry_id uuid,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index uq_stock_ledger_storno_target
      on public.stock_ledger_entries(storno_of_entry_id)
      where storno_of_entry_id is not null;
    create table private.qa_processing_allocations(
      id uuid primary key,
      company_id uuid not null,
      warehouse_id uuid not null,
      batch_id uuid not null,
      allocated_kg numeric(18,6) not null
    );
    create view public.v_stock_balance_identity as
    select
      batch.company_id,
      batch.warehouse_id,
      batch.id as batch_id,
      pg_catalog.round(coalesce(pg_catalog.sum(entry.delta_qty_signed), 0), 6)::numeric(18,6) as quantity
    from public.inventory_batches batch
    left join public.stock_ledger_entries entry
      on entry.company_id = batch.company_id
     and entry.warehouse_id = batch.warehouse_id
     and coalesce(
       entry.inventory_batch_id::text,
       nullif(pg_catalog.btrim(entry.batch_id_text), ''),
       nullif(pg_catalog.btrim(entry.batch_id), '')
     ) = batch.id::text
    group by batch.company_id, batch.warehouse_id, batch.id;
    create view public.v_processing_active_allocations_v1 as
    select
      allocation.company_id,
      allocation.warehouse_id,
      allocation.batch_id,
      allocation.allocated_kg
    from private.qa_processing_allocations allocation;
    create view public.v_weighbridge_open_ticket_reservations_v1 as
    select
      ticket.company_id,
      ticket.id as ticket_id,
      ticket.warehouse_from_id as warehouse_id,
      line.batch_id::uuid as batch_id,
      pg_catalog.sum(
        coalesce(line.quantity_kg, line.net_line_weight_kg, line.mass_kg, line.quantity, 0)
      )::numeric(18,6) as reserved_kg
    from public.tickets ticket
    join public.ticket_lines line
      on line.ticket_id = ticket.id
     and line.company_id = ticket.company_id
    where ticket.processing_allocation_ready
      and not coalesce(ticket.is_finalized, false)
      and not coalesce(ticket.is_voided, false)
      and ticket.status::text not in ('finalized', 'voided')
      and coalesce(line.batch_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by ticket.company_id, ticket.id, ticket.warehouse_from_id, line.batch_id;
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(),
      company_id uuid,
      who uuid,
      entity_type text,
      entity_id text,
      action text,
      old_values jsonb,
      new_values jsonb,
      reason text,
      created_at timestamptz not null default now()
    );
    create table private.legacy_impurity_calls(
      ticket_id uuid primary key,
      call_count integer not null default 0
    );

    create or replace function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create or replace function public.get_user_company_id()
    returns uuid language sql stable security definer set search_path = ''
    as $$ select company_id from public.profiles where id = auth.uid() $$;
    create or replace function public.canonical_stock_uom(value text)
    returns text language sql immutable
    as $$ select case lower(btrim(coalesce(value, ''))) when 'кг' then 'kg' else lower(btrim(coalesce(value, ''))) end $$;

    create or replace function private.resolve_processing_gate_session_actor_v1()
    returns table(actor_profile_id uuid, selected_company_id uuid)
    language sql stable security definer set search_path = ''
    as $$
      select profile.id, profile.company_id
      from public.profiles profile
      where profile.id = auth.uid() and profile.status = 'active'
    $$;
    create or replace function private.assert_processing_gate_actor_v1(
      p_company_id uuid, p_actor_id uuid
    ) returns void language plpgsql security definer set search_path = ''
    as $$
    begin
      if not exists (
        select 1 from public.profiles profile
        where profile.id = p_actor_id and profile.company_id = p_company_id
          and profile.status = 'active'
      ) then
        raise exception 'processing gate actor invalid';
      end if;
    end $$;
    create or replace function private.tz315_lock_company_season_write_gate_v1(
      p_company_id uuid, p_season_id uuid
    ) returns void language sql security definer set search_path = ''
    as $$ select $$;

    create or replace function private.reconcile_harvest_lot_batch_balance_v1(p_batch_id uuid)
    returns numeric language plpgsql security definer set search_path = ''
    as $$
    declare
      v_batch public.inventory_batches%rowtype;
      v_balance numeric(18,6);
    begin
      select * into v_batch from public.inventory_batches where id = p_batch_id for update;
      if not found then raise exception 'harvest batch missing'; end if;
      select round(coalesce(sum(entry.delta_qty_signed), 0), 6) into v_balance
      from public.stock_ledger_entries entry
      where entry.company_id = v_batch.company_id
        and entry.warehouse_id = v_batch.warehouse_id
        and coalesce(
          entry.inventory_batch_id::text,
          nullif(btrim(entry.batch_id_text), ''),
          nullif(btrim(entry.batch_id), '')
        ) = v_batch.id::text;
      if v_balance < -0.001 then raise exception 'negative harvest balance'; end if;
      update public.inventory_batches
      set current_quantity = greatest(v_balance, 0),
          current_weight_kg = greatest(v_balance, 0),
          mass_kg = greatest(v_balance, 0),
          updated_at = now()
      where id = v_batch.id;
      return greatest(v_balance, 0);
    end $$;
    create or replace function private.reconcile_warehouse_local_batch_balance_v1(p_batch_id uuid)
    returns numeric language plpgsql security definer set search_path = ''
    as $$
    declare
      v_batch public.inventory_batches%rowtype;
      v_balance numeric(18,6);
    begin
      select * into v_batch from public.inventory_batches where id = p_batch_id for update;
      if not found then raise exception 'warehouse batch missing'; end if;
      select round(coalesce(sum(entry.delta_qty_signed), 0), 6) into v_balance
      from public.stock_ledger_entries entry
      where entry.company_id = v_batch.company_id
        and entry.warehouse_id = v_batch.warehouse_id
        and coalesce(
          entry.inventory_batch_id::text,
          nullif(btrim(entry.batch_id_text), ''),
          nullif(btrim(entry.batch_id), '')
        ) = v_batch.id::text;
      if v_balance < -0.001 then raise exception 'negative warehouse balance'; end if;
      update public.inventory_batches
      set current_quantity = greatest(v_balance, 0),
          current_weight_kg = greatest(v_balance, 0),
          mass_kg = greatest(v_balance, 0),
          updated_at = now()
      where id = v_batch.id;
      return greatest(v_balance, 0);
    end $$;

    create or replace function private.weighbridge_batch_available_for_ticket_v1(
      p_ticket_id uuid, p_batch_id uuid
    ) returns numeric language plpgsql security definer set search_path = ''
    as $$
    declare
      v_batch public.inventory_batches%rowtype;
      v_ledger numeric(18,6);
      v_reserved numeric(18,6);
      v_processing numeric(18,6);
    begin
      select * into v_batch from public.inventory_batches where id = p_batch_id;
      if not found then raise exception 'batch missing'; end if;
      select pg_catalog.round(coalesce(pg_catalog.sum(entry.delta_qty_signed), 0), 6)
      into v_ledger
      from public.stock_ledger_entries entry
      where entry.company_id = v_batch.company_id
        and entry.warehouse_id = v_batch.warehouse_id
        and coalesce(
          entry.inventory_batch_id::text,
          nullif(pg_catalog.btrim(entry.batch_id_text), ''),
          nullif(pg_catalog.btrim(entry.batch_id), '')
        ) = v_batch.id::text;
      select pg_catalog.round(coalesce(pg_catalog.sum(reservation.reserved_kg), 0), 6)
      into v_reserved
      from public.v_weighbridge_open_ticket_reservations_v1 reservation
      where reservation.company_id = v_batch.company_id
        and reservation.warehouse_id = v_batch.warehouse_id
        and reservation.batch_id = v_batch.id
        and reservation.ticket_id is distinct from p_ticket_id;
      select pg_catalog.round(coalesce(pg_catalog.sum(allocation.allocated_kg), 0), 6)
      into v_processing
      from public.v_processing_active_allocations_v1 allocation
      where allocation.company_id = v_batch.company_id
        and allocation.warehouse_id = v_batch.warehouse_id
        and allocation.batch_id = v_batch.id;
      return greatest(v_ledger - v_reserved - v_processing, 0);
    end $$;

    create or replace function public.finalize_weighbridge_impurity_ticket_for_session_v1(p_ticket_id uuid)
    returns uuid language plpgsql security definer set search_path = ''
    as $$
    begin
      insert into private.legacy_impurity_calls(ticket_id, call_count)
      values (p_ticket_id, 1)
      on conflict (ticket_id) do update
      set call_count = private.legacy_impurity_calls.call_count + 1;
      update public.tickets
      set status = 'finalized', is_finalized = true, finalized_at = now(), updated_at = now()
      where id = p_ticket_id;
      return p_ticket_id;
    end $$;
    grant execute on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)
      to authenticated, service_role;

    create or replace function public.void_ticket_with_storno_v2(
      p_ticket_id uuid, p_actor_user_id uuid, p_reason text
    ) returns uuid language plpgsql security definer set search_path = ''
    as $$
    declare
      v_base record;
      v_batch_id uuid;
    begin
      if auth.uid() is distinct from p_actor_user_id then
        raise exception 'void actor mismatch';
      end if;
      for v_base in
        select * from public.stock_ledger_entries
        where ticket_id = p_ticket_id and not coalesce(is_storno, false)
        order by id
      loop
        insert into public.stock_ledger_entries(
          company_id, ticket_id, processing_id, product_id, crop_id,
          variety_id, reproduction_id, warehouse_id, inventory_batch_id,
          batch_id, batch_id_text, batch_class, operation_line_id,
          warehouse_issue_allocation_id, direction, quantity, uom,
          delta_qty_signed, mass_kg, density_kg_per_l, density_unit,
          density_source, density_verification_status, density_verified_at,
          unit_source, unit_contract_version, reason_type, reason_ref_id,
          occurred_at, created_by, is_storno, storno_of_entry_id, notes
        ) values (
          v_base.company_id, v_base.ticket_id, v_base.processing_id,
          v_base.product_id, v_base.crop_id, v_base.variety_id,
          v_base.reproduction_id, v_base.warehouse_id,
          v_base.inventory_batch_id, v_base.batch_id, v_base.batch_id_text,
          v_base.batch_class, v_base.operation_line_id,
          v_base.warehouse_issue_allocation_id,
          case when v_base.direction = 'in' then 'out' else 'in' end,
          v_base.quantity, v_base.uom, -v_base.delta_qty_signed,
          v_base.mass_kg, v_base.density_kg_per_l, v_base.density_unit,
          v_base.density_source, v_base.density_verification_status,
          v_base.density_verified_at, v_base.unit_source,
          v_base.unit_contract_version, 'storno_' || v_base.reason_type,
          v_base.reason_ref_id, now(), p_actor_user_id, true, v_base.id,
          'QA full-fidelity storno'
        );
      end loop;

      for v_batch_id in
        select distinct inventory_batch_id
        from public.stock_ledger_entries
        where ticket_id = p_ticket_id and inventory_batch_id is not null
        order by inventory_batch_id
      loop
        if exists (
          select 1 from public.harvest_lot_batches
          where inventory_batch_id = v_batch_id
        ) then
          perform private.reconcile_harvest_lot_batch_balance_v1(v_batch_id);
        else
          perform private.reconcile_warehouse_local_batch_balance_v1(v_batch_id);
        end if;
      end loop;

      update public.tickets
      set status = 'voided', is_voided = true,
          voided_by = p_actor_user_id, voided_at = now(),
          void_reason = p_reason, updated_at = now()
      where id = p_ticket_id;
      return p_ticket_id;
    end $$;
    grant execute on function public.void_ticket_with_storno_v2(uuid, uuid, text)
      to authenticated, service_role;
  `);
}

async function seed(db: PGlite) {
  await db.exec(`
    insert into public.companies(id, name) values ('${ID.company}', 'P0 shared impurity QA');
    insert into public.profiles(id, company_id, role, status)
    values ('${ID.actor}', '${ID.company}', 'company_admin', 'active');
    insert into public.company_people(id, company_id, role_type, status) values
      ('${ID.operator}', '${ID.company}', 'weighbridge_operator', 'active'),
      ('${ID.driver}', '${ID.company}', 'driver', 'active'),
      ('${ID.driver2}', '${ID.company}', 'driver', 'active');
    insert into public.seasons(id, company_id) values ('${ID.season}', '${ID.company}');
    insert into public.crops(id, name, name_ru)
    values ('${ID.crop}', 'Картофель', 'Картофель');
    insert into public.varieties(id, name) values
      ('${ID.varietyA}', 'Гала'),
      ('${ID.varietyB}', 'Гала');
    insert into public.seed_reproductions(id, name_ru, name, code) values
      ('${ID.reproductionA}', 'ЭС', 'Elite seed', 'ES'),
      ('${ID.reproductionB}', '1 репр.', 'First reproduction', 'R1');
    insert into public.products(id, name, base_uom, unit)
    values ('${ID.product}', 'Картофель', 'kg', 'kg');
    insert into public.warehouses(
      id, company_id, name, place_type, warehouse_type
    ) values ('${ID.warehouse}', '${ID.company}', 'Картофеле-хранилище', 'WAREHOUSE', 'crop');
    insert into public.fields(id, company_id, name) values
      ('${ID.fieldA}', '${ID.company}', '49 — Гала ЭС'),
      ('${ID.fieldB}', '${ID.company}', '49 — Гала 1 репр.');
    insert into public.crop_structure(
      id, company_id, field_id, season_id, crop_id,
      variety_id, reproduction_id, area
    ) values
      (
        '${ID.structureA}', '${ID.company}', '${ID.fieldA}', '${ID.season}', '${ID.crop}',
        '${ID.varietyA}', '${ID.reproductionA}', 23
      ),
      (
        '${ID.structureB}', '${ID.company}', '${ID.fieldB}', '${ID.season}', '${ID.crop}',
        '${ID.varietyB}', '${ID.reproductionB}', 7
      );
    insert into public.reference_vehicles(id, company_id) values
      ('${ID.vehicle}', '${ID.company}'),
      ('${ID.vehicle2}', '${ID.company}');
    insert into public.weighbridge_shifts(
      id, company_id, status, operator_person_id, last_activity_at
    ) values ('${ID.shift}', '${ID.company}', 'open', '${ID.operator}', now());
    insert into private.weighbridge_operator_sessions(
      id, company_id, auth_user_id, shift_id, person_id,
      token_hash, status, expires_at, last_seen_at
    ) values (
      '${ID.session}', '${ID.company}', '${ID.actor}', '${ID.shift}', '${ID.operator}',
      encode(extensions.digest('${SESSION_TOKEN}', 'sha256'), 'hex'),
      'active', now() + interval '24 hours', now()
    );
    insert into public.harvest_lots(id, company_id, season_id, crop_id, status) values
      ('${ID.lotA}', '${ID.company}', '${ID.season}', '${ID.crop}', 'active'),
      ('${ID.lotB}', '${ID.company}', '${ID.season}', '${ID.crop}', 'active');
    insert into public.inventory_batches(
      id, company_id, season_id, product_id, crop_id, variety_id,
      reproduction_id, batch_code, status, initial_weight_kg,
      current_weight_kg, batch_class, origin_type, treatment_status,
      initial_quantity, current_quantity, uom, mass_kg, unit_source,
      unit_contract_version, crop_structure_id, warehouse_id, received_at,
      source_type, composition_snapshot, is_mixed_harvest, physical_state,
      display_name
    ) values
      (
        '${ID.batchA}', '${ID.company}', '${ID.season}', '${ID.product}', '${ID.crop}',
        '${ID.varietyA}', '${ID.reproductionA}', '49-GALA-ES', 'commodity', 120, 120,
        'commodity', 'harvest', 'not_applicable', 120, 120, 'kg', 120,
        'weighbridge', 2, '${ID.structureA}', '${ID.warehouse}', now(), 'harvest',
        '[]'::jsonb, false, 'SOURCE', '49 · Гала · ЭС'
      ),
      (
        '${ID.batchB}', '${ID.company}', '${ID.season}', '${ID.product}', '${ID.crop}',
        '${ID.varietyB}', '${ID.reproductionB}', '49-GALA-R1', 'commodity', 80, 80,
        'commodity', 'harvest', 'not_applicable', 80, 80, 'kg', 80,
        'weighbridge', 2, '${ID.structureB}', '${ID.warehouse}', now(), 'harvest',
        '[]'::jsonb, false, 'SOURCE', '49 · Гала · 1 репр.'
      );
    insert into public.harvest_lot_batches(
      company_id, harvest_lot_id, inventory_batch_id, crop_structure_id
    ) values
      ('${ID.company}', '${ID.lotA}', '${ID.batchA}', '${ID.structureA}'),
      ('${ID.company}', '${ID.lotB}', '${ID.batchB}', '${ID.structureB}');
    insert into public.stock_ledger_entries(
      company_id, product_id, crop_id, variety_id, reproduction_id,
      warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
      direction, quantity, uom, delta_qty_signed, mass_kg, unit_source,
      unit_contract_version, reason_type, notes
    ) values
      (
        '${ID.company}', '${ID.product}', '${ID.crop}', '${ID.varietyA}', '${ID.reproductionA}',
        '${ID.warehouse}', '${ID.batchA}', '${ID.batchA}', '${ID.batchA}', 'commodity',
        'in', 120, 'kg', 120, 120, 'weighbridge', 2, 'harvest_incoming', 'source A'
      ),
      (
        '${ID.company}', '${ID.product}', '${ID.crop}', '${ID.varietyB}', '${ID.reproductionB}',
        '${ID.warehouse}', '${ID.batchB}', '${ID.batchB}', '${ID.batchB}', 'commodity',
        'in', 80, 'kg', 80, 80, 'weighbridge', 2, 'harvest_incoming', 'source B'
      );
    insert into public.tickets(
      id, company_id, ticket_no, ticket_type, op_type, status, direction,
      is_finalized, is_voided
    ) values (
      '${ID.legacyTicket}', '${ID.company}', 'LEGACY-QA-1', 'impurity_removal',
      'weighbridge_impurities', 'active', 'outgoing', false, false
    );
    select set_config('app.uid', '${ID.actor}', false);
  `);
}

async function main() {
  let passed = 0;
  const check = async (name: string, run: () => Promise<void> | void) => {
    await run();
    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
  };

  const migration = await findSharedImpurityMigration();
  const exactSourceMigration = await findExactSourceMigration();
  await check("migration is discovered by contract marker, not timestamp", () => {
    assert.match(migration.sql, /source OUT \(-S\) \+ pool IN \(\+S\) \+ impurity OUT \(-I\)/);
    assert.match(migration.sql, /Existing one-lot impurity functions and their signatures are not replaced/);
    assert.doesNotMatch(
      migration.sql,
      /create\s+or\s+replace\s+function\s+public\.finalize_weighbridge_impurity_ticket_for_session_v1/i,
    );
  });

  const db = new PGlite();
  try {
    await bootstrap(db);
    await seed(db);
    const legacyDefinitionBefore = await scalar<string>(
      db,
      "select pg_get_functiondef('public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)'::regprocedure)",
    );

    await db.exec(migration.sql);
    await check("exact migration compiles on the canonical minimal schema", () => undefined);
    await db.exec(exactSourceMigration.sql);
    await check("exact single-source extension compiles after the shared-pool migration", () => undefined);

    await check("legacy single-lot RPC definition remains byte-for-byte unchanged and callable", async () => {
      const legacyDefinitionAfter = await scalar<string>(
        db,
        "select pg_get_functiondef('public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)'::regprocedure)",
      );
      assert.equal(legacyDefinitionAfter, legacyDefinitionBefore);
      const result = await asAuthenticated(db, () => scalar<string>(
        db,
        "select public.finalize_weighbridge_impurity_ticket_for_session_v1($1::uuid)",
        [ID.legacyTicket],
      ));
      assert.equal(result, ID.legacyTicket);
      assert.equal(await scalar<number>(
        db,
        "select call_count from private.legacy_impurity_calls where ticket_id=$1::uuid",
        [ID.legacyTicket],
      ), 1);
      assert.equal(await scalar<string>(
        db,
        "select status from public.tickets where id=$1::uuid",
        [ID.legacyTicket],
      ), "finalized");
    });

    const sources = JSON.stringify([
      { harvest_lot_id: ID.lotA, crop_structure_id: ID.structureA },
      { harvest_lot_id: ID.lotB, crop_structure_id: ID.structureB },
    ]);
    const createShared = (
      idempotencyKey: string,
      vehicleId: string = ID.vehicle,
      driverId: string = ID.driver,
    ) => asAuthenticated(db, () => scalar<Row>(db, `
      select public.create_weighbridge_shared_impurity_pool_ticket_v1(
        $1::uuid, $2::uuid, $3::jsonb, $4::uuid, $5::uuid,
        $6::numeric, $7::text, $8::text, $9::text, $10::uuid
      )
    `, [
      ID.company,
      ID.warehouse,
      sources,
      vehicleId,
      driverId,
      25,
      "soil_and_trash",
      "Общая земля: Гала ЭС + Гала 1 репр.",
      SESSION_TOKEN,
      idempotencyKey,
    ]));

    await check("ordinary open-ticket reservation blocks shared create atomically", async () => {
      await db.exec(`
        insert into public.tickets(
          id, company_id, ticket_no, ticket_type, op_type, status, direction,
          warehouse_from_id, processing_allocation_ready, is_finalized, is_voided
        ) values (
          '${ID.regularReservationTicket}', '${ID.company}', 'REGULAR-RESERVATION-QA',
          'transfer', 'warehouse_transfer', 'active', 'outgoing', '${ID.warehouse}',
          true, false, false
        );
        insert into public.ticket_lines(
          ticket_id, company_id, product_id, quantity, quantity_kg, uom,
          warehouse_from_id, batch_id, line_type
        ) values (
          '${ID.regularReservationTicket}', '${ID.company}', '${ID.product}', 5, 5, 'kg',
          '${ID.warehouse}', '${ID.batchA}', 'material'
        );
      `);
      await expectDatabaseError(
        () => createShared(ID.conflictCreateKey),
        /SHARED_IMPURITY_SOURCE_ALREADY_COMMITTED/,
      );
      assert.equal(await scalar<number>(db, `
        select count(*)::int from public.weighbridge_shared_impurity_groups
      `), 0);
      await db.exec(`delete from public.tickets where id='${ID.regularReservationTicket}'`);
    });

    await check("active processing allocation blocks shared create atomically", async () => {
      await db.exec(`
        insert into private.qa_processing_allocations(
          id, company_id, warehouse_id, batch_id, allocated_kg
        ) values (
          '${ID.processingAllocation}', '${ID.company}', '${ID.warehouse}', '${ID.batchB}', 7
        )
      `);
      await expectDatabaseError(
        () => createShared(ID.processingCreateKey),
        /SHARED_IMPURITY_SOURCE_ALREADY_COMMITTED/,
      );
      assert.equal(await scalar<number>(db, `
        select count(*)::int from public.weighbridge_shared_impurity_groups
      `), 0);
      await db.exec(`delete from private.qa_processing_allocations where id='${ID.processingAllocation}'`);
    });

    let created: Row = {};
    await check("create freezes exactly two crop-structure sources without ledger writes", async () => {
      created = await createShared(ID.createKey);
      assert.equal(created.ok, true);
      assert.equal(created.state, "open");
      assert.equal(Number(created.source_total_kg), 200);
      assert.equal(Number(created.source_batch_count), 2);
      assert.equal(Number(created.member_count), 2);
      assert.equal(created.member_resolution_status, "unresolved");
      assert.equal(await scalar<number>(
        db,
        "select count(*)::int from public.stock_ledger_entries where ticket_id=$1::uuid",
        [created.ticket_id],
      ), 0);
    });

    await check("open shared ticket reserves every exact source and removes it from ordinary availability", async () => {
      const reservations = await rows(db, `
        select batch_id::text, reserved_kg::text
        from public.v_weighbridge_open_ticket_reservations_v1
        where ticket_id=$1::uuid
        order by batch_id
      `, [created.ticket_id]);
      assert.deepEqual(
        reservations.map((row) => [row.batch_id, Number(row.reserved_kg)]),
        [[ID.batchA, 120], [ID.batchB, 80]],
      );
      const effective = await rows(db, `
        select batch_id::text, quantity::text, processing_allocated_kg::text,
               effective_available_kg::text, open_ticket_reserved_kg::text
        from public.v_effective_stock_balance_identity_v1
        where batch_id in ($1::uuid,$2::uuid)
        order by batch_id
      `, [ID.batchA, ID.batchB]);
      assert.deepEqual(
        effective.map((row) => [
          row.batch_id,
          Number(row.quantity),
          Number(row.processing_allocated_kg),
          Number(row.effective_available_kg),
          Number(row.open_ticket_reserved_kg),
        ]),
        [[ID.batchA, 120, 0, 0, 120], [ID.batchB, 80, 0, 0, 80]],
      );
      assert.equal(Number(await scalar(db, `
        select private.weighbridge_batch_available_for_ticket_v1($1::uuid,$2::uuid)
      `, [created.ticket_id, ID.batchA])), 120, "own shared reservation must be excluded on finalize");
      assert.equal(Number(await scalar(db, `
        select private.weighbridge_batch_available_for_ticket_v1($1::uuid,$2::uuid)
      `, [ID.legacyTicket, ID.batchA])), 0, "ordinary/foreign operation must see no available mass");
    });

    await check("a second shared ticket cannot collide with already reserved exact sources", async () => {
      await expectDatabaseError(
        () => createShared(ID.secondSharedCreateKey, ID.vehicle2, ID.driver2),
        /SHARED_IMPURITY_SOURCE_ALREADY_COMMITTED/,
      );
      assert.equal(await scalar<number>(db, `
        select count(*)::int from public.weighbridge_shared_impurity_groups
      `), 1);
    });

    await check("open group and every member are explicitly unresolved", async () => {
      const group = (await rows(db, `
        select state, member_resolution_status, source_total_kg::text,
               impurity_weight_kg, clean_total_kg
        from public.weighbridge_shared_impurity_groups
        where id=$1::uuid
      `, [created.pool_id]))[0]!;
      assert.deepEqual(group, {
        state: "open",
        member_resolution_status: "unresolved",
        source_total_kg: "200.000000",
        impurity_weight_kg: null,
        clean_total_kg: null,
      });
      const members = await rows(db, `
        select crop_structure_id::text, source_batch_count,
               source_total_snapshot_kg::text, clean_balance_status, yield_status
        from public.weighbridge_shared_impurity_members
        where group_id=$1::uuid
        order by crop_structure_id
      `, [created.pool_id]);
      assert.equal(members.length, 2);
      assert.deepEqual(members.map((member) => member.clean_balance_status), ["unresolved", "unresolved"]);
      assert.deepEqual(members.map((member) => member.yield_status), ["unresolved", "unresolved"]);
      assert.deepEqual(members.map((member) => Number(member.source_total_snapshot_kg)), [120, 80]);
      const identities = await rows(db, `
        select crop_structure_id::text, identity_snapshot
        from public.weighbridge_shared_impurity_members
        where group_id=$1::uuid
        order by crop_structure_id
      `, [created.pool_id]);
      assert.equal(identities.length, 2);
      assert.deepEqual(identities.map((row) => row.identity_snapshot), [
        {
          area_ha: 23,
          crop_id: ID.crop,
          crop_name: "Картофель",
          field_id: ID.fieldA,
          field_name: "49 — Гала ЭС",
          reproduction_id: ID.reproductionA,
          reproduction_name: "ЭС",
          variety_id: ID.varietyA,
          variety_name: "Гала",
        },
        {
          area_ha: 7,
          crop_id: ID.crop,
          crop_name: "Картофель",
          field_id: ID.fieldB,
          field_name: "49 — Гала 1 репр.",
          reproduction_id: ID.reproductionB,
          reproduction_name: "1 репр.",
          variety_id: ID.varietyB,
          variety_name: "Гала",
        },
      ]);
      for (const row of identities) {
        const identity = row.identity_snapshot as Row;
        assert.equal(Object.hasOwn(identity, "clean_mass_kg"), false);
        assert.equal(Object.hasOwn(identity, "clean_yield_t_ha"), false);
      }
    });

    await check("database rejects both correction insert and correction-link update for a shared ticket", async () => {
      await expectDatabaseError(() => db.exec(`
        insert into public.tickets(
          id, company_id, ticket_no, ticket_type, op_type, status, direction,
          correction_of_ticket_id, is_finalized, is_voided
        ) values (
          '${ID.correctionTicket}', '${ID.company}', 'SHARED-CORRECTION-QA',
          'correction', 'weighbridge_impurities', 'active', 'outgoing',
          '${String(created.ticket_id)}', false, false
        )
      `), /SHARED_IMPURITY_CORRECTION_REQUIRES_VOID_NEW/);
      await db.exec(`
        insert into public.tickets(
          id, company_id, ticket_no, ticket_type, op_type, status, direction,
          is_finalized, is_voided
        ) values (
          '${ID.correctionTicket}', '${ID.company}', 'SHARED-CORRECTION-QA',
          'correction', 'weighbridge_impurities', 'active', 'outgoing', false, false
        )
      `);
      await expectDatabaseError(() => db.exec(`
        update public.tickets
        set correction_of_ticket_id='${String(created.ticket_id)}'
        where id='${ID.correctionTicket}'
      `), /SHARED_IMPURITY_CORRECTION_REQUIRES_VOID_NEW/);
      await db.exec(`delete from public.tickets where id='${ID.correctionTicket}'`);
    });

    await check("database isolates an open shared ticket from request and processing linkage", async () => {
      await expectDatabaseError(() => db.exec(`
        update public.tickets
        set linked_request_id='49000000-0000-4000-8000-000000000090'
        where id='${String(created.ticket_id)}'
      `), /SHARED_IMPURITY_TICKET_LINKAGE_FORBIDDEN/);
      await expectDatabaseError(() => db.exec(`
        update public.tickets
        set linked_processing_id='49000000-0000-4000-8000-000000000091',
            processing_output_role='GRAIN'
        where id='${String(created.ticket_id)}'
      `), /SHARED_IMPURITY_TICKET_LINKAGE_FORBIDDEN/);
      const linked = (await rows(db, `
        select linked_request_id, linked_processing_id, processing_output_role
        from public.tickets
        where id=$1::uuid
      `, [created.ticket_id]))[0];
      assert.equal(linked.linked_request_id, null);
      assert.equal(linked.linked_processing_id, null);
      assert.equal(linked.processing_output_role, null);
    });

    await check("database rejects legacy or direct finalization of an open shared ticket", async () => {
      await expectDatabaseError(() => db.exec(`
        update public.tickets
        set status='finalized'
        where id='${String(created.ticket_id)}'
      `), /SHARED_IMPURITY_LIFECYCLE_MISMATCH/);
      await expectDatabaseError(() => db.exec(`
        update public.tickets
        set is_finalized=true
        where id='${String(created.ticket_id)}'
      `), /SHARED_IMPURITY_LIFECYCLE_MISMATCH/);
      await expectDatabaseError(() => db.exec(`
        update public.tickets
        set is_voided=true
        where id='${String(created.ticket_id)}'
      `), /SHARED_IMPURITY_LIFECYCLE_MISMATCH/);
      await expectDatabaseError(() => db.exec(`
        update public.tickets
        set status='finalized', is_finalized=true
        where id='${String(created.ticket_id)}'
      `), /SHARED_IMPURITY_LIFECYCLE_MISMATCH/);
      const lifecycle = (await rows(db, `
        select ticket.status, ticket.is_finalized, pool.state as pool_state
        from public.tickets ticket
        join public.weighbridge_shared_impurity_groups pool
          on pool.ticket_id=ticket.id
        where ticket.id=$1::uuid
      `, [created.ticket_id]))[0];
      assert.equal(lifecycle.status, "active");
      assert.equal(lifecycle.is_finalized, false);
      assert.equal(lifecycle.pool_state, "open");
    });

    await check("database blocks finalization but permits void of a pre-existing malformed correction", async () => {
      await db.exec(`alter table public.tickets disable trigger reject_shared_impurity_ticket_correction_v1`);
      await db.exec(`
        insert into public.tickets(
          id, company_id, ticket_no, ticket_type, op_type, status, direction,
          correction_of_ticket_id, is_finalized, is_voided
        ) values (
          '${ID.correctionTicket}', '${ID.company}', 'SHARED-CORRECTION-LEGACY-QA',
          'correction', 'weighbridge_impurities', 'active', 'outgoing',
          '${String(created.ticket_id)}', false, false
        )
      `);
      await db.exec(`alter table public.tickets enable trigger reject_shared_impurity_ticket_correction_v1`);
      await expectDatabaseError(() => db.exec(`
        update public.tickets
        set status='finalized', is_finalized=true
        where id='${ID.correctionTicket}'
      `), /SHARED_IMPURITY_CORRECTION_REQUIRES_VOID_NEW/);
      await db.exec(`
        update public.tickets
        set status='voided', is_voided=true
        where id='${ID.correctionTicket}'
      `);
      const malformedCorrection = (await rows(db, `
        select status, is_voided
        from public.tickets
        where id=$1::uuid
      `, [ID.correctionTicket]))[0];
      assert.equal(malformedCorrection.status, "voided");
      assert.equal(malformedCorrection.is_voided, true);
      await db.exec(`delete from public.tickets where id='${ID.correctionTicket}'`);
    });

    await check("foreign commitment added after create blocks shared finalize without partial ledger writes", async () => {
      await db.exec(`
        insert into public.tickets(
          id, company_id, ticket_no, ticket_type, op_type, status, direction,
          warehouse_from_id, processing_allocation_ready, is_finalized, is_voided
        ) values (
          '${ID.regularReservationTicket}', '${ID.company}', 'LATE-RESERVATION-QA',
          'transfer', 'warehouse_transfer', 'active', 'outgoing', '${ID.warehouse}',
          true, false, false
        );
        insert into public.ticket_lines(
          ticket_id, company_id, product_id, quantity, quantity_kg, uom,
          warehouse_from_id, batch_id, line_type
        ) values (
          '${ID.regularReservationTicket}', '${ID.company}', '${ID.product}', 5, 5, 'kg',
          '${ID.warehouse}', '${ID.batchA}', 'material'
        );
      `);
      await expectDatabaseError(() => asAuthenticated(db, () => scalar<Row>(db, `
        select public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
          $1::uuid, $2::text, $3::numeric, $4::boolean, $5::uuid
        )
      `, [created.ticket_id, SESSION_TOKEN, 10, false, ID.finalizeConflictKey])),
      /SHARED_IMPURITY_SOURCE_COMMITTED_OR_CHANGED/);
      assert.equal(await scalar<number>(db, `
        select count(*)::int from public.stock_ledger_entries where ticket_id=$1::uuid
      `, [created.ticket_id]), 0);
      assert.equal(await scalar<string>(db, `
        select state from public.weighbridge_shared_impurity_groups where id=$1::uuid
      `, [created.pool_id]), "open");
      await db.exec(`delete from public.tickets where id='${ID.regularReservationTicket}'`);
    });

    let finalized: Row = {};
    await check("finalize posts source OUT + pool IN + impurity OUT with exact mass invariant", async () => {
      finalized = await asAuthenticated(db, () => scalar<Row>(db, `
        select public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
          $1::uuid, $2::text, $3::numeric, $4::boolean, $5::uuid
        )
      `, [created.ticket_id, SESSION_TOKEN, 10, false, ID.finalizeKey]));
      assert.equal(finalized.ok, true);
      assert.equal(finalized.idempotent_replay, false);
      assert.equal(Number(finalized.source_total_kg), 200);
      assert.equal(Number(finalized.impurity_weight_kg), 15);
      assert.equal(Number(finalized.clean_total_kg), 185);
      assert.equal(Number(finalized.ledger_count), 4);

      const ledger = await rows(db, `
        select reason_type, count(*)::int entry_count,
               round(sum(delta_qty_signed),6)::text signed_kg
        from public.stock_ledger_entries
        where ticket_id=$1::uuid and not is_storno
        group by reason_type
        order by reason_type
      `, [created.ticket_id]);
      assert.deepEqual(ledger, [
        { reason_type: "harvest_pool_reclass_in", entry_count: 1, signed_kg: "200.000000" },
        { reason_type: "harvest_pool_reclass_out", entry_count: 2, signed_kg: "-200.000000" },
        { reason_type: "weighbridge_impurities_shared", entry_count: 1, signed_kg: "-15.000000" },
      ]);
      assert.equal(Number(await scalar<string>(db, `
        select round(sum(delta_qty_signed),6)::text
        from public.stock_ledger_entries where ticket_id=$1::uuid
      `, [created.ticket_id])), -15);
    });

    await check("source batches become zero and the pool holds the exact 185 kg clean total", async () => {
      const balances = await rows(db, `
        select id::text, current_quantity::text, current_weight_kg::text, mass_kg::text
        from public.inventory_batches
        where id in ($1::uuid,$2::uuid,$3::uuid)
      `, [ID.batchA, ID.batchB, finalized.pool_inventory_batch_id]);
      const balanceById = new Map(balances.map((row) => [String(row.id), row]));
      for (const sourceBatchId of [ID.batchA, ID.batchB]) {
        const source = balanceById.get(sourceBatchId);
        assert.ok(source, `source batch ${sourceBatchId} must remain addressable`);
        assert.equal(Number(source.current_quantity), 0);
        assert.equal(Number(source.current_weight_kg), 0);
        assert.equal(Number(source.mass_kg), 0);
      }
      const poolBatchId = String(finalized.pool_inventory_batch_id || "");
      assert.ok(poolBatchId, "shared pool batch id must be returned");
      const pool = balanceById.get(poolBatchId);
      assert.ok(pool, "shared pool batch must be addressable");
      assert.equal(Number(pool.current_quantity), 185);
      assert.equal(Number(pool.current_weight_kg), 185);
      assert.equal(Number(pool.mass_kg), 185);
    });

    await check("no per-source clean kilograms, impurity allocation, or yield are invented", async () => {
      const forbiddenColumns = await rows(db, `
        select column_name
        from information_schema.columns
        where table_schema='public'
          and table_name='weighbridge_shared_impurity_members'
          and column_name in (
            'clean_mass_kg','clean_weight_kg','clean_yield_t_ha',
            'yield_t_ha','impurity_weight_kg','impurity_allocation_kg'
          )
      `);
      assert.deepEqual(forbiddenColumns, []);
      const group = (await rows(db, `
        select member_resolution_status, composition_snapshot
        from public.weighbridge_shared_impurity_groups
        where id=$1::uuid
      `, [created.pool_id]))[0]!;
      assert.equal(group.member_resolution_status, "unresolved");
      const snapshot = group.composition_snapshot as Row[];
      assert.equal(snapshot.length, 2);
      for (const source of snapshot) {
        assert.equal(source.clean_mass_status, "unresolved");
        for (const forbidden of [
          "clean_mass_kg",
          "clean_weight_kg",
          "clean_yield_t_ha",
          "yield_t_ha",
          "impurity_weight_kg",
          "impurity_allocation_kg",
        ]) {
          assert.equal(Object.hasOwn(source, forbidden), false, `${forbidden} must not exist`);
        }
      }
    });

    await check("finalize replay is idempotent and creates no duplicate accounting rows", async () => {
      const replay = await asAuthenticated(db, () => scalar<Row>(db, `
        select public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
          $1::uuid, $2::text, $3::numeric, $4::boolean, $5::uuid
        )
      `, [created.ticket_id, SESSION_TOKEN, 10, false, ID.finalizeKey]));
      assert.equal(replay.idempotent_replay, true);
      assert.equal(await scalar<number>(db, `
        select count(*)::int from public.stock_ledger_entries
        where ticket_id=$1::uuid and not is_storno
      `, [created.ticket_id]), 4);
    });

    await check("canonical void/storno restores sources, zeros pool, and reconciles group state", async () => {
      const voided = await asAuthenticated(db, () => scalar<string>(db, `
        select public.void_ticket_with_storno_v2($1::uuid,$2::uuid,$3::text)
      `, [created.ticket_id, ID.actor, "QA void shared impurity"]));
      assert.equal(voided, created.ticket_id);

      const state = (await rows(db, `
        select ticket.status ticket_status, ticket.is_voided,
               pool.state pool_state, pool.member_resolution_status,
               (select count(*)::int
                from public.weighbridge_shared_impurity_source_batches source
                where source.group_id=pool.id and source.state='released') released_count
        from public.tickets ticket
        join public.weighbridge_shared_impurity_groups pool on pool.ticket_id=ticket.id
        where ticket.id=$1::uuid
      `, [created.ticket_id]))[0]!;
      assert.deepEqual(state, {
        ticket_status: "voided",
        is_voided: true,
        pool_state: "voided",
        member_resolution_status: "unresolved",
        released_count: 2,
      });
      assert.equal(Number(await scalar<string>(db, `
        select round(sum(delta_qty_signed),6)::text
        from public.stock_ledger_entries where ticket_id=$1::uuid
      `, [created.ticket_id])), 0);
      assert.equal(await scalar<number>(db, `
        select count(*)::int from public.stock_ledger_entries
        where ticket_id=$1::uuid and is_storno
      `, [created.ticket_id]), 4);
      const restored = await rows(db, `
        select id::text, current_quantity::text
        from public.inventory_batches
        where id in ($1::uuid,$2::uuid,$3::uuid)
      `, [ID.batchA, ID.batchB, finalized.pool_inventory_batch_id]);
      const restoredById = new Map(
        restored.map((row) => [String(row.id), Number(row.current_quantity)]),
      );
      assert.equal(restoredById.get(ID.batchA), 120);
      assert.equal(restoredById.get(ID.batchB), 80);
      assert.equal(restoredById.get(String(finalized.pool_inventory_batch_id)), 0);
    });

    await check("one exact crop-structure source finalizes without touching the other plot", async () => {
      const exactSources = JSON.stringify([
        { harvest_lot_id: ID.lotA, crop_structure_id: ID.structureA },
      ]);
      const exactCreated = await asAuthenticated(db, () => scalar<Row>(db, `
        select public.create_weighbridge_shared_impurity_pool_ticket_v1(
          $1::uuid, $2::uuid, $3::jsonb, $4::uuid, $5::uuid,
          $6::numeric, $7::text, $8::text, $9::text, $10::uuid
        )
      `, [
        ID.company,
        ID.warehouse,
        exactSources,
        ID.vehicle,
        ID.driver,
        25,
        "soil_and_trash",
        "Земля только по участку Гала ЭС",
        SESSION_TOKEN,
        ID.exactCreateKey,
      ]));
      assert.equal(exactCreated.ok, true);
      assert.equal(Number(exactCreated.source_total_kg), 120);
      assert.equal(Number(exactCreated.source_batch_count), 1);
      assert.equal(Number(exactCreated.member_count), 1);

      const exactFinalized = await asAuthenticated(db, () => scalar<Row>(db, `
        select public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
          $1::uuid, $2::text, $3::numeric, $4::boolean, $5::uuid
        )
      `, [exactCreated.ticket_id, SESSION_TOKEN, 10, false, ID.exactFinalizeKey]));
      assert.equal(exactFinalized.ok, true);
      assert.equal(Number(exactFinalized.source_total_kg), 120);
      assert.equal(Number(exactFinalized.impurity_weight_kg), 15);
      assert.equal(Number(exactFinalized.clean_total_kg), 105);
      assert.equal(Number(exactFinalized.ledger_count), 3);

      const balances = await rows(db, `
        select id::text, current_quantity::text
        from public.inventory_batches
        where id in ($1::uuid,$2::uuid,$3::uuid)
      `, [ID.batchA, ID.batchB, exactFinalized.pool_inventory_batch_id]);
      const balanceById = new Map(
        balances.map((row) => [String(row.id), Number(row.current_quantity)]),
      );
      assert.equal(balanceById.get(ID.batchA), 0);
      assert.equal(balanceById.get(ID.batchB), 80);
      assert.equal(balanceById.get(String(exactFinalized.pool_inventory_batch_id)), 105);
      assert.equal(await scalar<number>(db, `
        select count(*)::int
        from public.weighbridge_shared_impurity_members
        where group_id=$1::uuid
      `, [exactCreated.pool_id]), 1);
    });

    console.log(`P0 SHARED IMPURITY PGLITE ${passed}/${passed} PASS`);
    console.log(`Migration: ${migration.path}`);
    console.log(`Exact source extension: ${exactSourceMigration.path}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("P0 SHARED IMPURITY PGLITE FAIL");
  console.error(error);
  process.exitCode = 1;
});
