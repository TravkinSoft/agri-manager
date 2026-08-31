import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831124145_tz315_processing_create_atomic_v1.sql",
  import.meta.url,
);
const routeUrl = new URL("../app/api/processing/transformations/route.ts", import.meta.url);
const serviceUrl = new URL("../lib/services/processing.ts", import.meta.url);

const COMPANY = "31520000-0000-4000-8000-000000000001";
const FOREIGN_COMPANY = "31520000-0000-4000-8000-000000000002";
const SEASON = "31520000-0000-4000-8100-000000000001";
const FOREIGN_SEASON = "31520000-0000-4000-8100-000000000002";
const ACTOR = "31520000-0000-4000-8200-000000000001";
const AUTH_USER = "31520000-0000-4000-8200-000000000002";
const GLOBAL_ADMIN = "31520000-0000-4000-8200-000000000003";
const WAREHOUSE_IN = "31520000-0000-4000-8300-000000000001";
const WAREHOUSE_OUT = "31520000-0000-4000-8300-000000000002";
const DRYER_WAREHOUSE = "31520000-0000-4000-8300-000000000003";
const YARD_WAREHOUSE = "31520000-0000-4000-8300-000000000004";
const NODE = "31520000-0000-4000-8400-000000000001";
const DRYER_NODE = "31520000-0000-4000-8400-000000000002";
const YARD_NODE = "31520000-0000-4000-8400-000000000003";
const TICKET_BATCH = "31520000-0000-4000-8500-000000000001";
const LOT_BATCH_A = "31520000-0000-4000-8500-000000000002";
const LOT_BATCH_B = "31520000-0000-4000-8500-000000000003";
const FAILURE_BATCH = "31520000-0000-4000-8500-000000000004";
const FOREIGN_SEASON_BATCH = "31520000-0000-4000-8500-000000000005";
const SHARED_BATCH = "31520000-0000-4000-8500-000000000006";
const SHARED_BATCH_B = "31520000-0000-4000-8500-000000000007";
const PENDING_BATCH = "31520000-0000-4000-8500-000000000008";
const AMBIGUOUS_BATCH = "31520000-0000-4000-8500-000000000009";
const OUTPUT_CONFLICT_BATCH = "31520000-0000-4000-8500-000000000010";
const CROSSWIRE_BATCH = "31520000-0000-4000-8500-000000000011";
const DRYER_BATCH_A = "31520000-0000-4000-8500-000000000012";
const DRYER_BATCH_B = "31520000-0000-4000-8500-000000000013";
const YARD_BATCH_A = "31520000-0000-4000-8500-000000000014";
const YARD_BATCH_B = "31520000-0000-4000-8500-000000000015";
const CLEANER_CURRENT_BATCH_A = "31520000-0000-4000-8500-000000000016";
const CLEANER_CURRENT_BATCH_B = "31520000-0000-4000-8500-000000000017";
const VEGETABLE_CLEANER_BATCH = "31520000-0000-4000-8500-000000000018";
const VEGETABLE_DRYER_BATCH = "31520000-0000-4000-8500-000000000019";
const OUTPUT_TRACE_BATCH = "31520000-0000-4000-8500-000000000020";
const WIP_HANDOFF_BATCH = "31520000-0000-4000-8500-000000000021";
const LOT = "31520000-0000-4000-8600-000000000001";
const MISMATCH_LOT = "31520000-0000-4000-8600-000000000002";
const TICKET_LOT = "31520000-0000-4000-8600-000000000003";
const VEGETABLE_LOT = "31520000-0000-4000-8600-000000000004";
const FOREIGN_SEASON_LOT = "31520000-0000-4000-8600-000000000005";
const ORPHAN_LOT = "31520000-0000-4000-8600-000000000006";
const TICKET = "31520000-0000-4000-8700-000000000001";
const SHARED_TICKET = "31520000-0000-4000-8700-000000000005";
const PENDING_TICKET = "31520000-0000-4000-8700-000000000006";
const AMBIGUOUS_TICKET = "31520000-0000-4000-8700-000000000007";
const OUTPUT_CONFLICT_TICKET = "31520000-0000-4000-8700-000000000008";
const CROSSWIRE_TICKET = "31520000-0000-4000-8700-000000000009";
const DRYER_TICKET_A = "31520000-0000-4000-8700-000000000010";
const DRYER_TICKET_B = "31520000-0000-4000-8700-000000000011";
const YARD_TICKET_A = "31520000-0000-4000-8700-000000000012";
const YARD_TICKET_B = "31520000-0000-4000-8700-000000000013";
const CLEANER_CURRENT_TICKET_A = "31520000-0000-4000-8700-000000000014";
const CLEANER_CURRENT_TICKET_B = "31520000-0000-4000-8700-000000000015";
const VEGETABLE_CLEANER_TICKET = "31520000-0000-4000-8700-000000000016";
const VEGETABLE_DRYER_TICKET = "31520000-0000-4000-8700-000000000017";
const OUTPUT_TRACE_TICKET = "31520000-0000-4000-8700-000000000018";
const WIP_HANDOFF_TICKET = "31520000-0000-4000-8700-000000000019";
const AMBIGUOUS_TRANSFORMATION = "31520000-0000-4000-8800-000000000001";
const LEGACY_YARD_TRANSFORMATION = "31520000-0000-4000-8800-000000000002";
const OUTPUT_TRACE_ROW = "31520000-0000-4000-8800-000000000003";
const WIP_HANDOFF_OUTPUT_ROW = "31520000-0000-4000-8800-000000000004";
const TICKET_LINE = "31520000-0000-4000-8900-000000000001";
const SHARED_LINE_A = "31520000-0000-4000-8900-000000000002";
const SHARED_LINE_B = "31520000-0000-4000-8900-000000000003";
const PENDING_LINE = "31520000-0000-4000-8900-000000000004";
const AMBIGUOUS_LINE = "31520000-0000-4000-8900-000000000005";
const OUTPUT_CONFLICT_LINE = "31520000-0000-4000-8900-000000000006";
const CROSSWIRE_LINE_A = "31520000-0000-4000-8900-000000000007";
const CROSSWIRE_LINE_B = "31520000-0000-4000-8900-000000000008";
const DRYER_LINE_A = "31520000-0000-4000-8900-000000000009";
const DRYER_LINE_B = "31520000-0000-4000-8900-000000000010";
const YARD_LINE_A = "31520000-0000-4000-8900-000000000011";
const YARD_LINE_B = "31520000-0000-4000-8900-000000000012";
const CLEANER_CURRENT_LINE_A = "31520000-0000-4000-8900-000000000013";
const CLEANER_CURRENT_LINE_B = "31520000-0000-4000-8900-000000000014";
const VEGETABLE_CLEANER_LINE = "31520000-0000-4000-8900-000000000015";
const VEGETABLE_DRYER_LINE = "31520000-0000-4000-8900-000000000016";
const WIP_HANDOFF_LINE = "31520000-0000-4000-8900-000000000017";
const GRAIN_CATEGORY = "31520000-0000-4000-8a00-000000000001";
const VEGETABLE_CATEGORY = "31520000-0000-4000-8a00-000000000002";
const GRAIN_CROP = "31520000-0000-4000-8b00-000000000001";
const VEGETABLE_CROP = "31520000-0000-4000-8b00-000000000002";

async function rows(db: PGlite, sql: string) {
  return (await db.query<Record<string, any>>(sql)).rows;
}

async function scalar(db: PGlite, sql: string) {
  return (await rows(db, sql))[0]?.value;
}

async function asRole<T>(db: PGlite, role: string, action: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await db.exec("reset role");
  }
}

function decodeJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return (value || {}) as Record<string, unknown>;
}

function rpcSql(input: {
  company?: string;
  transformationType?: string;
  sourceTicketId?: string | null;
  input: Record<string, unknown>;
  outputs: Array<Record<string, unknown>>;
}) {
  const company = input.company || COMPANY;
  const sourceTicket = input.sourceTicketId ? `'${input.sourceTicketId}'::uuid` : "null::uuid";
  const inputJson = JSON.stringify(input.input).replaceAll("'", "''");
  const outputsJson = JSON.stringify(input.outputs).replaceAll("'", "''");
  return `
    select public.create_processing_transformation_atomic_v1(
      '${ACTOR}'::uuid,
      '${company}'::uuid,
      '${input.transformationType || "cleaning"}',
      '${NODE}'::uuid,
      ${sourceTicket},
      'TZ315 atomic create fixture',
      '${inputJson}'::jsonb,
      '${outputsJson}'::jsonb,
      '{}'::jsonb
    ) value
  `;
}

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt()
    returns jsonb
    language sql
    stable
    as $$
      select jsonb_build_object(
        'sub', current_setting('request.jwt.claim.sub', true),
        'email', current_setting('request.jwt.claim.email', true)
      )
    $$;

    create table public.companies(id uuid primary key);
    create table public.profiles(
      id uuid primary key,
      company_id uuid,
      role text not null,
      status text not null default 'active',
      email text
    );
    create table public.global_admin_company_contexts(
      user_id uuid primary key,
      company_id uuid not null
    );
    create table public.global_admin_impersonation_contexts(
      admin_user_id uuid primary key,
      impersonated_profile_id uuid,
      impersonated_company_id uuid,
      updated_at timestamptz not null default now()
    );
    create table public.seasons(
      id uuid primary key,
      company_id uuid,
      archived boolean default false
    );
    create table public.warehouses(
      id uuid primary key,
      company_id uuid,
      archived boolean default false,
      is_archived boolean not null default false,
      warehouse_type text,
      place_type text not null default 'WAREHOUSE'
    );
    create table public.processing_nodes(
      id uuid primary key,
      company_id uuid not null,
      linked_warehouse_id uuid,
      is_active boolean not null default true,
      archived boolean not null default false
    );
    create table public.inventory_batches(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid,
      physical_state text not null default 'SOURCE',
      source_ticket_id uuid,
      source_transformation_id uuid,
      warehouse_id uuid,
      received_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table public.crop_categories(
      id uuid primary key,
      slug text,
      name_ru text
    );
    create table public.crops(
      id uuid primary key,
      slug text,
      crop_category text,
      category text,
      subcategory text,
      crop_subcategory text,
      category_id uuid
    );
    create table public.harvest_lots(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid,
      crop_id uuid,
      status text not null default 'active'
    );
    create table public.harvest_lot_batches(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      harvest_lot_id uuid not null,
      inventory_batch_id uuid not null
    );
    create table public.tickets(
      id uuid primary key,
      company_id uuid not null,
      season_id uuid,
      status text not null default 'closed',
      is_finalized boolean not null default false,
      is_voided boolean not null default false,
      destination_kind text not null,
      batch_id uuid,
      warehouse_from_id uuid,
      warehouse_to_id uuid,
      processing_node_id uuid,
      net_weight_kg numeric,
      harvest_lot_id uuid,
      source_physical_state text,
      linked_processing_id uuid,
      source_kind text not null default 'warehouse',
      source_id text,
      processing_output_role text,
      finalized_at timestamptz,
      closed_by uuid,
      created_by uuid
    );
    create table public.ticket_lines(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null,
      company_id uuid not null default '${COMPANY}'::uuid,
      destination_batch_id uuid,
      batch_id text,
      warehouse_from_id uuid,
      warehouse_to_id uuid,
      net_line_weight_kg numeric,
      quantity_kg numeric,
      mass_kg numeric,
      quantity numeric,
      moisture_percent numeric,
      created_at timestamptz not null default now()
    );
    create table public.batch_transformations(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      season_id uuid,
      node_warehouse_id uuid,
      processing_node_id uuid,
      transformation_type text not null,
      processing_method text,
      status text not null default 'draft',
      processing_state text not null default 'in_processing',
      shadow_mode boolean not null default false,
      source_ticket_id uuid,
      harvest_lot_id uuid,
      source_physical_state text,
      started_at timestamptz,
      created_by uuid,
      note text,
      created_at timestamptz not null default now()
    );
    create unique index uq_batch_transformations_active_identity_v1
      on public.batch_transformations(
        company_id,
        coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(node_warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(processing_node_id, '00000000-0000-0000-0000-000000000000'::uuid),
        transformation_type,
        coalesce(harvest_lot_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(source_physical_state, 'SOURCE')
      )
      where processing_state in ('in_processing', 'processing_pending_outputs')
        and status <> 'voided';
    create table public.batch_transformation_inputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      batch_id uuid,
      warehouse_from_id uuid,
      input_weight_kg numeric(18,3) not null,
      input_quality_json jsonb,
      source_ticket_id uuid,
      source_ticket_line_id uuid,
      node_warehouse_id uuid,
      created_at timestamptz not null default now()
    );
    create unique index uq_batch_transformation_inputs_source_line_fixture
      on public.batch_transformation_inputs(source_ticket_line_id)
      where source_ticket_line_id is not null;
    create table public.batch_transformation_outputs(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      transformation_id uuid not null,
      warehouse_to_id uuid,
      line_type text not null,
      output_weight_kg numeric(18,3) not null,
      output_quality_json jsonb,
      batch_class text,
      output_type text not null default 'main_product',
      output_role text,
      physical_state text,
      source_ticket_id uuid,
      output_batch_id uuid,
      created_at timestamptz not null default now()
    );
    create type public.ledger_direction as enum ('in', 'out');
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      ticket_id uuid,
      processing_id uuid,
      inventory_batch_id uuid,
      warehouse_id uuid,
      direction public.ledger_direction,
      reason_type text,
      delta_qty_signed numeric,
      storno_of_entry_id uuid,
      is_storno boolean not null default false
    );
    create table public.fixture_stock(
      company_id uuid not null,
      warehouse_id uuid not null,
      batch_id uuid not null,
      quantity numeric(18,3) not null,
      primary key(company_id, warehouse_id, batch_id)
    );

    create view public.v_effective_stock_balance_identity_v1 as
    select stock.company_id,
           stock.warehouse_id,
           stock.batch_id::text as batch_id,
           'kg'::text as uom,
           stock.quantity,
           coalesce(allocated.allocated_kg, 0)::numeric(18,3) as processing_allocated_kg,
           greatest(stock.quantity - coalesce(allocated.allocated_kg, 0), 0)::numeric(18,3)
             as effective_available_kg,
           0::numeric(18,3) as open_ticket_reserved_kg
    from public.fixture_stock stock
    left join (
      select input_row.company_id,
             input_row.warehouse_from_id as warehouse_id,
             input_row.batch_id,
             sum(input_row.input_weight_kg) as allocated_kg
      from public.batch_transformation_inputs input_row
      join public.batch_transformations transformation
        on transformation.id = input_row.transformation_id
       and transformation.status <> 'voided'
      group by input_row.company_id, input_row.warehouse_from_id, input_row.batch_id
    ) allocated
      on allocated.company_id = stock.company_id
     and allocated.warehouse_id = stock.warehouse_id
     and allocated.batch_id = stock.batch_id;

    create or replace function public.get_user_company_id()
    returns uuid
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $$
    declare
      v_company_id uuid;
      v_role text;
      v_profile_id uuid;
      v_impersonated_company_id uuid;
    begin
      select profile.id, profile.company_id, profile.role
        into v_profile_id, v_company_id, v_role
      from public.profiles profile
      where profile.id = auth.uid()
         or lower(coalesce(profile.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      order by case when profile.id = auth.uid() then 0 else 1 end
      limit 1;
      if v_role = 'global_admin' then
        select impersonation.impersonated_company_id
          into v_impersonated_company_id
        from public.global_admin_impersonation_contexts impersonation
        where impersonation.admin_user_id in (v_profile_id, auth.uid())
          and impersonation.impersonated_profile_id is not null
        order by impersonation.updated_at desc
        limit 1;
        if v_impersonated_company_id is not null then
          return v_impersonated_company_id;
        end if;
        select context.company_id into v_company_id
        from public.global_admin_company_contexts context
        where context.user_id in (v_profile_id, auth.uid())
        order by case when context.user_id = v_profile_id then 0 else 1 end
        limit 1;
      end if;
      return v_company_id;
    end;
    $$;

    create or replace function public.tz297_assert_processing_actor_v1(
      p_company_id uuid,
      p_actor_user_id uuid,
      p_allowed_roles text[]
    ) returns text
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      v_auth uuid := auth.uid();
      v_actor public.profiles%rowtype;
    begin
      if v_auth is null or v_auth <> p_actor_user_id then
        raise exception 'PROCESSING_FORBIDDEN' using errcode = '42501';
      end if;
      select * into v_actor
      from public.profiles profile
      where profile.id = p_actor_user_id
        and profile.status = 'active';
      if not found
         or not (v_actor.role = any(p_allowed_roles))
         or (v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id)
      then
        raise exception 'PROCESSING_FORBIDDEN' using errcode = '42501';
      end if;
      return v_actor.role;
    end;
    $$;

    create or replace function private.tz315_lock_company_season_write_gate_v1(
      p_company_id uuid,
      p_canonical_season_id uuid
    ) returns void
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      -- TZ315_PROCESSING_COMPANY_SEASON_GATE_V1
      if p_company_id is null then
        raise exception 'TZ315_PROCESSING_GATE_COMPANY_REQUIRED' using errcode = '22004';
      end if;
      if p_canonical_season_id is null then
        raise exception 'TZ315_PROCESSING_GATE_SEASON_REQUIRED' using errcode = '22004';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'travkinflow.processing.company-season.v1|' || p_company_id::text || '|' || p_canonical_season_id::text,
        315::bigint
      ));
    end;
    $$;
    alter function private.tz315_lock_company_season_write_gate_v1(uuid, uuid) owner to postgres;
    revoke all on function private.tz315_lock_company_season_write_gate_v1(uuid, uuid)
      from public, anon, authenticated, service_role;

    create or replace function public.attach_processing_input_ticket_live_v1(
      p_ticket_id uuid
    ) returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      v_ticket public.tickets%rowtype;
      v_lot public.harvest_lots%rowtype;
      v_line record;
      v_batch public.inventory_batches%rowtype;
      v_transformation_type text;
      v_processing_method text;
      v_transformation_id uuid;
      v_existing_id uuid;
      v_active_ids uuid[] := array[]::uuid[];
      v_pending_ids uuid[] := array[]::uuid[];
      v_inserted integer := 0;
      v_row_count integer := 0;
    begin
      select * into v_ticket
      from public.tickets ticket
      where ticket.id = p_ticket_id
      for update;
      if not found
         or not v_ticket.is_finalized
         or v_ticket.is_voided
         or v_ticket.status <> 'finalized'
         or v_ticket.harvest_lot_id is null
      then
        return null;
      end if;

      select input_row.transformation_id into v_existing_id
      from public.batch_transformation_inputs input_row
      where input_row.company_id = v_ticket.company_id
        and input_row.source_ticket_id = v_ticket.id
      order by input_row.created_at, input_row.id
      limit 1;
      if v_existing_id is not null then
        update public.tickets set linked_processing_id = v_existing_id
        where id = v_ticket.id;
        return v_existing_id;
      end if;

      select * into v_lot
      from public.harvest_lots lot
      where lot.id = v_ticket.harvest_lot_id
        and lot.company_id = v_ticket.company_id
        and lot.status = 'active';
      if not found then
        raise exception 'PROCESSING_INPUT_LOT_NOT_FOUND' using errcode = '23514';
      end if;
      select
        case warehouse.place_type
          when 'CLEANER' then 'cleaning'
          when 'DRYER' then 'drying'
          when 'YARD' then 'drying'
          else null
        end,
        case warehouse.place_type
          when 'CLEANER' then 'CLEANING'
          when 'DRYER' then 'MECHANICAL_DRYING'
          when 'YARD' then 'NATURAL_DRYING'
          else null
        end
        into v_transformation_type, v_processing_method
      from public.warehouses warehouse
      where warehouse.id = v_ticket.warehouse_to_id
        and warehouse.company_id = v_ticket.company_id;
      if v_transformation_type is null then
        return null;
      end if;

      select
        coalesce(array_agg(transformation.id order by transformation.id)
          filter (where transformation.processing_state = 'in_processing'), array[]::uuid[]),
        coalesce(array_agg(transformation.id order by transformation.id)
          filter (where transformation.processing_state = 'processing_pending_outputs'), array[]::uuid[])
        into v_active_ids, v_pending_ids
      from public.batch_transformations transformation
      where transformation.company_id = v_ticket.company_id
        and transformation.season_id = v_lot.season_id
        and transformation.node_warehouse_id is not distinct from v_ticket.warehouse_to_id
        and transformation.processing_node_id is not distinct from v_ticket.processing_node_id
        and transformation.transformation_type = v_transformation_type
        and transformation.processing_method = v_processing_method
        and transformation.shadow_mode
        and transformation.harvest_lot_id is not distinct from v_ticket.harvest_lot_id
        and upper(coalesce(transformation.source_physical_state, 'SOURCE')) =
          upper(coalesce(v_ticket.source_physical_state, 'SOURCE'))
        and transformation.status <> 'voided'
        and transformation.processing_state in ('in_processing', 'processing_pending_outputs');
      if cardinality(v_active_ids) > 1
         or cardinality(v_pending_ids) > 1
         or (cardinality(v_active_ids) > 0 and cardinality(v_pending_ids) > 0)
      then
        raise exception 'PROCESSING_INPUT_AMBIGUOUS' using errcode = '23514';
      end if;
      if cardinality(v_pending_ids) = 1 then
        raise exception 'PROCESSING_INPUT_FINISHED' using errcode = '23514';
      end if;
      if cardinality(v_active_ids) = 1 then
        v_transformation_id := v_active_ids[1];
      else
        insert into public.batch_transformations(
          company_id, season_id, node_warehouse_id, processing_node_id,
          transformation_type, processing_method, status, processing_state,
          shadow_mode, harvest_lot_id,
          source_physical_state, source_ticket_id, started_at, created_by
        ) values (
          v_ticket.company_id, v_lot.season_id, v_ticket.warehouse_to_id,
          v_ticket.processing_node_id, v_transformation_type, v_processing_method,
          'draft', 'in_processing', true,
          v_ticket.harvest_lot_id, upper(coalesce(v_ticket.source_physical_state, 'SOURCE')),
          v_ticket.id, now(), coalesce(v_ticket.closed_by, v_ticket.created_by)
        ) returning id into v_transformation_id;
      end if;

      for v_line in
        select * from public.ticket_lines line
        where line.ticket_id = v_ticket.id
        order by line.created_at, line.id
      loop
        select * into v_batch
        from public.inventory_batches batch
        where batch.id = coalesce(v_line.destination_batch_id, nullif(v_line.batch_id, '')::uuid)
          and batch.company_id = v_ticket.company_id;
        if not found then
          raise exception 'PROCESSING_INPUT_BATCH_NOT_FOUND' using errcode = '23514';
        end if;
        insert into public.batch_transformation_inputs(
          company_id, transformation_id, batch_id, warehouse_from_id,
          input_weight_kg, input_quality_json, source_ticket_id,
          source_ticket_line_id, node_warehouse_id
        ) values (
          v_ticket.company_id, v_transformation_id, v_batch.id, v_ticket.warehouse_to_id,
          coalesce(v_line.net_line_weight_kg, v_line.quantity_kg, v_line.mass_kg, v_line.quantity),
          '{}'::jsonb, v_ticket.id, v_line.id, v_ticket.warehouse_to_id
        ) on conflict (source_ticket_line_id) where source_ticket_line_id is not null do nothing;
        get diagnostics v_row_count = row_count;
        v_inserted := v_inserted + v_row_count;
      end loop;
      if v_inserted = 0 then
        raise exception 'PROCESSING_INPUT_LINES_REQUIRED' using errcode = '23514';
      end if;
      update public.tickets set linked_processing_id = v_transformation_id
      where id = v_ticket.id;
      return v_transformation_id;
    end;
    $$;
    alter function public.attach_processing_input_ticket_live_v1(uuid) owner to postgres;
    revoke all on function public.attach_processing_input_ticket_live_v1(uuid)
      from public, anon, authenticated;
    grant execute on function public.attach_processing_input_ticket_live_v1(uuid)
      to service_role;

    create or replace function private.tz315_processing_wip_physical_state_valid_v1(
      p_ticket_id uuid
    )
    returns boolean
    language plpgsql
    stable
    security invoker
    set search_path = ''
    as $$
    declare
      v_ticket public.tickets%rowtype;
    begin
      select * into v_ticket
      from public.tickets ticket
      where ticket.id = p_ticket_id;
      if not found then
        return false;
      end if;
      if v_ticket.source_kind <> 'processing_wip' then
        return true;
      end if;
      -- TZ315_PROCESSING_WIP_ROLE_NULL_GUARD_V1
      if coalesce(v_ticket.processing_output_role, '') not in (
        'GRAIN', 'SCREENINGS', 'FEED', 'WASTE', 'TRIER_WASTE', 'OTHER'
      ) then
        return false;
      end if;
      return true;
    end
    $$;
    alter function private.tz315_processing_wip_physical_state_valid_v1(uuid)
      owner to postgres;
    revoke all on function private.tz315_processing_wip_physical_state_valid_v1(uuid)
      from public, anon, authenticated, service_role;

    create or replace function public.attach_route_processing_input_ticket_v1(p_ticket_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      v_place_type text;
      v_crop_slug text;
      v_category_slug text;
      v_category_name text;
      v_subcategory text;
    begin
      select
        upper(coalesce(w.place_type, 'WAREHOUSE')),
        lower(coalesce(c.slug, '')),
        lower(coalesce(cc.slug, '')),
        lower(coalesce(cc.name_ru, c.crop_category, c.category, '')),
        lower(coalesce(c.subcategory, c.crop_subcategory, ''))
      into
        v_place_type,
        v_crop_slug,
        v_category_slug,
        v_category_name,
        v_subcategory
      from public.tickets t
      join public.warehouses w
        on w.id = t.warehouse_to_id
       and w.company_id = t.company_id
      left join public.harvest_lots hl
        on hl.id = t.harvest_lot_id
       and hl.company_id = t.company_id
      left join public.crops c on c.id = hl.crop_id
      left join public.crop_categories cc on cc.id = c.category_id
      where t.id = p_ticket_id;

      if coalesce(v_place_type, 'WAREHOUSE') not in ('DRYER', 'CLEANER') then
        return null;
      end if;

      if v_category_slug = 'vegetable'
         or v_category_name like '%овощ%'
         or v_subcategory in ('tuber', 'root')
         or v_crop_slug in ('potato', 'carrot')
      then
        raise exception using
          errcode = '23514',
          message = 'VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED';
      end if;

      -- TZ315_PROCESSING_WIP_PHYSICAL_STATE_ROUTE_GUARD_V1
      if not private.tz315_processing_wip_physical_state_valid_v1(p_ticket_id) then
        raise exception 'PROCESSING_WIP_PHYSICAL_STATE_MISMATCH' using errcode = '23514';
      end if;

      return public.attach_processing_input_ticket_live_v1(p_ticket_id);
    end;
    $$;
    alter function public.attach_route_processing_input_ticket_v1(uuid) owner to postgres;
    revoke all on function public.attach_route_processing_input_ticket_v1(uuid)
      from public, anon, authenticated;
    grant execute on function public.attach_route_processing_input_ticket_v1(uuid)
      to service_role;

    create or replace function private.processing_output_ticket_trace_valid_v2(p_output_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select coalesce((
        select
          1=(select count(*) from public.stock_ledger_entries sle
            where not coalesce(sle.is_storno,false) and sle.ticket_id=o.source_ticket_id
              and sle.processing_id=o.transformation_id and sle.inventory_batch_id=o.output_batch_id
              and sle.warehouse_id=o.warehouse_to_id and sle.direction='in'::public.ledger_direction
              and sle.reason_type='processing_output_in'
              and abs(sle.delta_qty_signed-o.output_weight_kg)<=0.001)
          and abs(o.output_weight_kg-coalesce((select sum(-sle.delta_qty_signed)
            from public.stock_ledger_entries sle
            where not coalesce(sle.is_storno,false) and sle.ticket_id=o.source_ticket_id
              and sle.processing_id=o.transformation_id and sle.direction='out'::public.ledger_direction
              and sle.reason_type='processing_output_source_out'),0))<=0.001
          and not exists(
            select 1 from public.stock_ledger_entries sle
            where not coalesce(sle.is_storno,false) and sle.ticket_id=o.source_ticket_id
              and not (
                (sle.processing_id=o.transformation_id and sle.inventory_batch_id=o.output_batch_id
                  and sle.warehouse_id=o.warehouse_to_id and sle.direction='in'::public.ledger_direction
                  and sle.reason_type='processing_output_in')
                or
                (sle.processing_id=o.transformation_id and sle.direction='out'::public.ledger_direction
                  and sle.reason_type='processing_output_source_out'
                  and exists(select 1 from public.batch_transformation_inputs i
                    where i.transformation_id=o.transformation_id and i.batch_id=sle.inventory_batch_id
                      and i.warehouse_from_id=sle.warehouse_id))
              )
          )
        from public.batch_transformation_outputs o where o.id=p_output_id
      ),false)
    $$;
    alter function private.processing_output_ticket_trace_valid_v2(uuid) owner to postgres;
    revoke all on function private.processing_output_ticket_trace_valid_v2(uuid)
      from public, anon, authenticated, service_role;

    create or replace function public.close_processing_output_ticket_atomic_v1(
      p_ticket_id uuid,
      p_session_token text,
      p_tare_weight_kg numeric,
      p_moisture_percent numeric default null,
      p_tare_variance_confirmed boolean default false,
      p_idempotency_key text default null
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = pg_catalog, public, private, extensions
    as $$
    declare
      v_physical_state text := 'AFTER_CLEANING';
    begin
      -- output_role, is_projected_child, physical_state, output_type
      -- TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1
      if false then
        update public.tickets
        set source_physical_state = v_physical_state
        where id = p_ticket_id;
      end if;
      return jsonb_build_object('ok', true);
    end
    $$;
    alter function public.close_processing_output_ticket_atomic_v1(
      uuid, text, numeric, numeric, boolean, text
    ) owner to postgres;
    revoke all on function public.close_processing_output_ticket_atomic_v1(
      uuid, text, numeric, numeric, boolean, text
    ) from public, anon;
    grant execute on function public.close_processing_output_ticket_atomic_v1(
      uuid, text, numeric, numeric, boolean, text
    ) to authenticated, service_role;

    insert into public.companies(id) values ('${COMPANY}'), ('${FOREIGN_COMPANY}');
    insert into public.profiles(id, company_id, role, email) values
      ('${ACTOR}', '${COMPANY}', 'weighman', 'actor@tz315.test'),
      ('${GLOBAL_ADMIN}', null, 'global_admin', 'global@tz315.test');
    insert into public.seasons(id, company_id) values
      ('${SEASON}', '${COMPANY}'),
      ('${FOREIGN_SEASON}', '${COMPANY}');
    insert into public.crop_categories(id, slug, name_ru) values
      ('${GRAIN_CATEGORY}', 'grain', 'Зерновые'),
      ('${VEGETABLE_CATEGORY}', 'vegetable', 'Овощные');
    insert into public.crops(id, slug, crop_category, category, subcategory, crop_subcategory, category_id) values
      ('${GRAIN_CROP}', 'wheat', 'grain', 'grain', 'cereal', 'cereal', '${GRAIN_CATEGORY}'),
      ('${VEGETABLE_CROP}', 'potato', 'vegetable', 'vegetable', 'tuber', 'tuber', '${VEGETABLE_CATEGORY}');
    insert into public.warehouses(id, company_id, warehouse_type, place_type) values
      ('${WAREHOUSE_IN}', '${COMPANY}', 'universal', 'CLEANER'),
      ('${WAREHOUSE_OUT}', '${COMPANY}', 'grain', 'WAREHOUSE'),
      ('${DRYER_WAREHOUSE}', '${COMPANY}', 'universal', 'DRYER'),
      ('${YARD_WAREHOUSE}', '${COMPANY}', 'universal', 'YARD');
    insert into public.processing_nodes(id, company_id, linked_warehouse_id)
      values
        ('${NODE}', '${COMPANY}', '${WAREHOUSE_IN}'),
        ('${DRYER_NODE}', '${COMPANY}', '${DRYER_WAREHOUSE}'),
        ('${YARD_NODE}', '${COMPANY}', '${YARD_WAREHOUSE}');
    insert into public.inventory_batches(id, company_id, season_id, received_at) values
      ('${TICKET_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-01T00:00:00Z'),
      ('${LOT_BATCH_A}', '${COMPANY}', '${SEASON}', '2026-08-02T00:00:00Z'),
      ('${LOT_BATCH_B}', '${COMPANY}', '${SEASON}', '2026-08-03T00:00:00Z'),
      ('${FAILURE_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-04T00:00:00Z'),
      ('${FOREIGN_SEASON_BATCH}', '${COMPANY}', '${FOREIGN_SEASON}', '2026-08-05T00:00:00Z'),
      ('${SHARED_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-06T00:00:00Z'),
      ('${SHARED_BATCH_B}', '${COMPANY}', '${SEASON}', '2026-08-07T00:00:00Z'),
      ('${PENDING_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-08T00:00:00Z'),
      ('${AMBIGUOUS_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-09T00:00:00Z'),
      ('${OUTPUT_CONFLICT_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-10T00:00:00Z'),
      ('${CROSSWIRE_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-11T00:00:00Z'),
      ('${DRYER_BATCH_A}', '${COMPANY}', '${SEASON}', '2026-08-12T00:00:00Z'),
      ('${DRYER_BATCH_B}', '${COMPANY}', '${SEASON}', '2026-08-13T00:00:00Z'),
      ('${YARD_BATCH_A}', '${COMPANY}', '${SEASON}', '2026-08-14T00:00:00Z'),
      ('${YARD_BATCH_B}', '${COMPANY}', '${SEASON}', '2026-08-15T00:00:00Z'),
      ('${CLEANER_CURRENT_BATCH_A}', '${COMPANY}', '${SEASON}', '2026-08-16T00:00:00Z'),
      ('${CLEANER_CURRENT_BATCH_B}', '${COMPANY}', '${SEASON}', '2026-08-17T00:00:00Z'),
      ('${VEGETABLE_CLEANER_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-18T00:00:00Z'),
      ('${VEGETABLE_DRYER_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-19T00:00:00Z'),
      ('${OUTPUT_TRACE_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-20T00:00:00Z'),
      ('${WIP_HANDOFF_BATCH}', '${COMPANY}', '${SEASON}', '2026-08-21T00:00:00Z');
    insert into public.harvest_lots(id, company_id, season_id, crop_id) values
      ('${LOT}', '${COMPANY}', '${SEASON}', '${GRAIN_CROP}'),
      ('${MISMATCH_LOT}', '${COMPANY}', '${SEASON}', '${GRAIN_CROP}'),
      ('${TICKET_LOT}', '${COMPANY}', '${SEASON}', '${GRAIN_CROP}'),
      ('${VEGETABLE_LOT}', '${COMPANY}', '${SEASON}', '${VEGETABLE_CROP}'),
      ('${FOREIGN_SEASON_LOT}', '${COMPANY}', '${FOREIGN_SEASON}', '${GRAIN_CROP}');
    insert into public.harvest_lot_batches(company_id, harvest_lot_id, inventory_batch_id) values
      ('${COMPANY}', '${LOT}', '${LOT_BATCH_A}'),
      ('${COMPANY}', '${LOT}', '${LOT_BATCH_B}'),
      ('${COMPANY}', '${MISMATCH_LOT}', '${FOREIGN_SEASON_BATCH}'),
      ('${COMPANY}', '${TICKET_LOT}', '${TICKET_BATCH}'),
      ('${COMPANY}', '${TICKET_LOT}', '${SHARED_BATCH}'),
      ('${COMPANY}', '${TICKET_LOT}', '${SHARED_BATCH_B}'),
      ('${COMPANY}', '${TICKET_LOT}', '${PENDING_BATCH}'),
      ('${COMPANY}', '${TICKET_LOT}', '${AMBIGUOUS_BATCH}'),
      ('${COMPANY}', '${TICKET_LOT}', '${OUTPUT_CONFLICT_BATCH}'),
      ('${COMPANY}', '${TICKET_LOT}', '${CROSSWIRE_BATCH}'),
      ('${COMPANY}', '${TICKET_LOT}', '${DRYER_BATCH_A}'),
      ('${COMPANY}', '${TICKET_LOT}', '${DRYER_BATCH_B}'),
      ('${COMPANY}', '${TICKET_LOT}', '${YARD_BATCH_A}'),
      ('${COMPANY}', '${TICKET_LOT}', '${YARD_BATCH_B}'),
      ('${COMPANY}', '${TICKET_LOT}', '${CLEANER_CURRENT_BATCH_A}'),
      ('${COMPANY}', '${TICKET_LOT}', '${CLEANER_CURRENT_BATCH_B}'),
      ('${COMPANY}', '${VEGETABLE_LOT}', '${VEGETABLE_CLEANER_BATCH}'),
      ('${COMPANY}', '${VEGETABLE_LOT}', '${VEGETABLE_DRYER_BATCH}'),
      ('${COMPANY}', '${TICKET_LOT}', '${WIP_HANDOFF_BATCH}');
    insert into public.fixture_stock(company_id, warehouse_id, batch_id, quantity) values
      ('${COMPANY}', '${WAREHOUSE_IN}', '${TICKET_BATCH}', 10000),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${LOT_BATCH_A}', 300),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${LOT_BATCH_B}', 400),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${FAILURE_BATCH}', 1000),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${FOREIGN_SEASON_BATCH}', 1000),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${SHARED_BATCH}', 400),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${SHARED_BATCH_B}', 600),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${PENDING_BATCH}', 100),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${AMBIGUOUS_BATCH}', 100),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${OUTPUT_CONFLICT_BATCH}', 100),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${CROSSWIRE_BATCH}', 200),
      ('${COMPANY}', '${DRYER_WAREHOUSE}', '${DRYER_BATCH_A}', 100),
      ('${COMPANY}', '${DRYER_WAREHOUSE}', '${DRYER_BATCH_B}', 100),
      ('${COMPANY}', '${YARD_WAREHOUSE}', '${YARD_BATCH_A}', 100),
      ('${COMPANY}', '${YARD_WAREHOUSE}', '${YARD_BATCH_B}', 100),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${CLEANER_CURRENT_BATCH_A}', 100),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${CLEANER_CURRENT_BATCH_B}', 100),
      ('${COMPANY}', '${WAREHOUSE_IN}', '${VEGETABLE_CLEANER_BATCH}', 100),
      ('${COMPANY}', '${DRYER_WAREHOUSE}', '${VEGETABLE_DRYER_BATCH}', 100),
      ('${COMPANY}', '${WAREHOUSE_OUT}', '${OUTPUT_TRACE_BATCH}', 50),
      ('${COMPANY}', '${DRYER_WAREHOUSE}', '${WIP_HANDOFF_BATCH}', 100);
    insert into public.tickets(
      id, company_id, season_id, status, is_finalized, is_voided, destination_kind,
      batch_id, warehouse_to_id, processing_node_id, net_weight_kg, harvest_lot_id,
      source_physical_state, finalized_at, closed_by, created_by
    ) values
      ('${TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'processing_node',
       '${TICKET_BATCH}', '${WAREHOUSE_IN}', '${NODE}', 5000, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${SHARED_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'processing_node',
       '${SHARED_BATCH}', '${WAREHOUSE_IN}', '${NODE}', 1000, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${PENDING_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'processing_node',
       '${PENDING_BATCH}', '${WAREHOUSE_IN}', '${NODE}', 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${AMBIGUOUS_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'processing_node',
       '${AMBIGUOUS_BATCH}', '${WAREHOUSE_IN}', '${NODE}', 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${OUTPUT_CONFLICT_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'processing_node',
       '${OUTPUT_CONFLICT_BATCH}', '${WAREHOUSE_IN}', '${NODE}', 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${CROSSWIRE_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'processing_node',
       '${CROSSWIRE_BATCH}', '${WAREHOUSE_IN}', '${NODE}', 200, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${DRYER_TICKET_A}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       '${DRYER_BATCH_A}', '${DRYER_WAREHOUSE}', null, 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${DRYER_TICKET_B}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       '${DRYER_BATCH_B}', '${DRYER_WAREHOUSE}', null, 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${YARD_TICKET_A}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       '${YARD_BATCH_A}', '${YARD_WAREHOUSE}', null, 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${YARD_TICKET_B}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'processing_node',
       '${YARD_BATCH_B}', '${YARD_WAREHOUSE}', '${YARD_NODE}', 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${CLEANER_CURRENT_TICKET_A}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       '${CLEANER_CURRENT_BATCH_A}', '${WAREHOUSE_IN}', null, 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${CLEANER_CURRENT_TICKET_B}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       '${CLEANER_CURRENT_BATCH_B}', '${WAREHOUSE_IN}', null, 100, '${TICKET_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${VEGETABLE_CLEANER_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       '${VEGETABLE_CLEANER_BATCH}', '${WAREHOUSE_IN}', null, 100, '${VEGETABLE_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${VEGETABLE_DRYER_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       '${VEGETABLE_DRYER_BATCH}', '${DRYER_WAREHOUSE}', null, 100, '${VEGETABLE_LOT}',
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${OUTPUT_TRACE_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       '${OUTPUT_TRACE_BATCH}', '${WAREHOUSE_OUT}', null, 50, null,
       'SOURCE', now(), '${ACTOR}', '${ACTOR}'),
      ('${WIP_HANDOFF_TICKET}', '${COMPANY}', '${SEASON}', 'finalized', true, false, 'warehouse',
       null, '${DRYER_WAREHOUSE}', null, 100, '${TICKET_LOT}',
       'AFTER_CLEANING', now(), '${ACTOR}', '${ACTOR}');
    insert into public.ticket_lines(
      id, ticket_id, destination_batch_id, net_line_weight_kg, created_at
    ) values
      ('${TICKET_LINE}', '${TICKET}', '${TICKET_BATCH}', 5000, '2026-08-20T00:00:00Z'),
      ('${SHARED_LINE_A}', '${SHARED_TICKET}', '${SHARED_BATCH}', 400, '2026-08-21T00:00:00Z'),
      ('${SHARED_LINE_B}', '${SHARED_TICKET}', '${SHARED_BATCH_B}', 600, '2026-08-21T00:00:01Z'),
      ('${PENDING_LINE}', '${PENDING_TICKET}', '${PENDING_BATCH}', 100, '2026-08-22T00:00:00Z'),
      ('${AMBIGUOUS_LINE}', '${AMBIGUOUS_TICKET}', '${AMBIGUOUS_BATCH}', 100, '2026-08-23T00:00:00Z'),
      ('${OUTPUT_CONFLICT_LINE}', '${OUTPUT_CONFLICT_TICKET}', '${OUTPUT_CONFLICT_BATCH}', 100, '2026-08-24T00:00:00Z'),
      ('${CROSSWIRE_LINE_A}', '${CROSSWIRE_TICKET}', '${CROSSWIRE_BATCH}', 100, '2026-08-25T00:00:00Z'),
      ('${CROSSWIRE_LINE_B}', '${CROSSWIRE_TICKET}', '${TICKET_BATCH}', 100, '2026-08-25T00:00:01Z'),
      ('${DRYER_LINE_A}', '${DRYER_TICKET_A}', '${DRYER_BATCH_A}', 100, '2026-08-26T00:00:00Z'),
      ('${DRYER_LINE_B}', '${DRYER_TICKET_B}', '${DRYER_BATCH_B}', 100, '2026-08-26T00:00:01Z'),
      ('${YARD_LINE_A}', '${YARD_TICKET_A}', '${YARD_BATCH_A}', 100, '2026-08-27T00:00:00Z'),
      ('${YARD_LINE_B}', '${YARD_TICKET_B}', '${YARD_BATCH_B}', 100, '2026-08-27T00:00:01Z'),
      ('${CLEANER_CURRENT_LINE_A}', '${CLEANER_CURRENT_TICKET_A}', '${CLEANER_CURRENT_BATCH_A}', 100, '2026-08-28T00:00:00Z'),
      ('${CLEANER_CURRENT_LINE_B}', '${CLEANER_CURRENT_TICKET_B}', '${CLEANER_CURRENT_BATCH_B}', 100, '2026-08-28T00:00:01Z'),
      ('${VEGETABLE_CLEANER_LINE}', '${VEGETABLE_CLEANER_TICKET}', '${VEGETABLE_CLEANER_BATCH}', 100, '2026-08-29T00:00:00Z'),
      ('${VEGETABLE_DRYER_LINE}', '${VEGETABLE_DRYER_TICKET}', '${VEGETABLE_DRYER_BATCH}', 100, '2026-08-29T00:00:01Z'),
      ('${WIP_HANDOFF_LINE}', '${WIP_HANDOFF_TICKET}', '${WIP_HANDOFF_BATCH}', 100, '2026-08-30T00:00:00Z');

    insert into public.batch_transformations(
      id, company_id, season_id, node_warehouse_id, processing_node_id,
      transformation_type, status, processing_state, source_ticket_id,
      harvest_lot_id, source_physical_state, created_by
    ) values (
      '${LEGACY_YARD_TRANSFORMATION}', '${COMPANY}', '${SEASON}', '${YARD_WAREHOUSE}',
      '${YARD_NODE}', 'drying', 'draft', 'in_processing', '${YARD_TICKET_B}',
      '${TICKET_LOT}', 'SOURCE', '${ACTOR}'
    );
    insert into public.batch_transformation_inputs(
      company_id, transformation_id, batch_id, warehouse_from_id, input_weight_kg,
      input_quality_json, source_ticket_id, source_ticket_line_id, node_warehouse_id
    ) values (
      '${COMPANY}', '${LEGACY_YARD_TRANSFORMATION}', '${YARD_BATCH_B}', '${YARD_WAREHOUSE}',
      100, '{}'::jsonb, '${YARD_TICKET_B}', '${YARD_LINE_B}', '${YARD_WAREHOUSE}'
    );
    update public.tickets set linked_processing_id='${LEGACY_YARD_TRANSFORMATION}'
    where id='${YARD_TICKET_B}';

    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
}

async function main() {
  const [migration, route, service] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(routeUrl, "utf8"),
    readFile(serviceUrl, "utf8"),
  ]);

  assert.match(migration, /TZ315_PROCESSING_COMPANY_SEASON_GATE_V1/);
  assert.match(migration, /perform private\.tz315_lock_company_season_write_gate_v1\(/);
  assert.match(migration, /or coalesce\(v_gate_security_definer, false\)/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(migration, /\b(?:delete\s+from|truncate|drop\s+table|drop\s+column)\b/i);
  const gateCall = migration.indexOf("perform private.tz315_lock_company_season_write_gate_v1(");
  const firstRowLock = migration.indexOf("for key share;", gateCall);
  const routeAttach = migration.indexOf("v_transformation_id := public.attach_route_processing_input_ticket_v1(", gateCall);
  const membershipLock = migration.indexOf("from public.harvest_lot_batches link", gateCall);
  const membershipBatchLock = migration.indexOf("for update of batch;", membershipLock);
  const firstWrite = migration.indexOf("insert into public.batch_transformations", gateCall);
  assert.ok(gateCall > 0 && firstRowLock > gateCall && routeAttach > firstRowLock);
  assert.ok(firstWrite > firstRowLock && membershipLock > gateCall && membershipBatchLock > membershipLock);
  assert.match(migration, /perform 1\s+from public\.harvest_lot_batches link[\s\S]{0,300}order by link\.id\s+for update;[\s\S]*for update of batch;/);
  assert.match(migration, /v_source_ticket_id is null[\s\S]*jsonb_array_length\(v_outputs\) = 0/);
  assert.match(migration, /PROCESSING_SOURCE_TICKET_OUTPUT_GRAPH_CONFLICT/);
  assert.match(
    migration,
    /v_input_place_type := upper\(coalesce\(v_warehouse\.place_type, ''\)\)[\s\S]*case v_input_place_type[\s\S]*when 'CLEANER' then 'cleaning'[\s\S]*when 'DRYER' then 'drying'[\s\S]*when 'YARD' then 'drying'/,
  );
  assert.match(
    migration,
    /v_input_place_type in \('DRYER', 'CLEANER'\)[\s\S]*not coalesce\(v_existing_transformation\.shadow_mode, false\)[\s\S]*v_existing_transformation\.processing_method is distinct from v_processing_method/,
  );
  assert.match(migration, /attach_route_processing_input_ticket_v1/);
  assert.match(migration, /VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED/);
  assert.match(migration, /private\.processing_output_ticket_trace_valid_v2\(shared_output\.id\)/);
  assert.match(migration, /PROCESSING_CREATE_OUTPUT_TRACE_NON_CANONICAL/);
  assert.match(migration, /TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1/);
  assert.match(migration, /TZ315_PROCESSING_CREATE_WIP_PHYSICAL_STATE_DEPENDENCY_INVALID/);
  assert.match(migration, /TZ315_PROCESSING_WIP_ROLE_NULL_GUARD_V1/);
  assert.match(migration, /TZ315_PROCESSING_CREATE_WIP_ROLE_NULL_GUARD_MISSING/);
  assert.match(
    migration,
    /coalesce\(v_ticket\.processing_output_role, ''\) not in/,
  );
  assert.match(migration, /private\.tz315_processing_wip_handoff_valid_v1\(/);
  assert.match(
    migration,
    /from public\.harvest_lot_batches membership\s+where membership\.inventory_batch_id = v_input_batch_id/,
  );

  assert.match(route, /from\("warehouses"\)\.select\("id,place_type"\)/);
  assert.match(route, /placeType === "CLEANER"[\s\S]*placeType === "DRYER"/);
  assert.doesNotMatch(route.slice(route.indexOf("async function loadWaitingTickets")), /placeType === "YARD"/);
  assert.match(route, /\.in\("destination_kind", \["warehouse", "processing_node"\]\)/);

  const postRoute = route.slice(route.indexOf("export async function POST"));
  assert.match(postRoute, /resolveWeighbridgeSession\(request,[\s\S]*allowedRoles: WEIGHBRIDGE_WRITE_ROLES/);
  assert.match(postRoute, /supabase\.rpc\("create_processing_transformation_atomic_v1"/);
  assert.match(postRoute, /p_actor_user_id: actor\.id/);
  assert.match(postRoute, /p_company_id: companyId/);
  assert.match(postRoute, /body\.outputs != null && !Array\.isArray\(body\.outputs\)/);
  assert.match(postRoute, /outputs\.length === 0 && !sourceTicketId/);
  assert.doesNotMatch(postRoute, /requestedCompanyId:/);
  assert.doesNotMatch(postRoute, /getServiceClient|mutationClient|cleanup/);
  assert.doesNotMatch(
    postRoute,
    /\.from\("(?:batch_transformations|batch_transformation_inputs|batch_transformation_outputs|tickets)"\)[\s\S]*?\.(?:insert|update|delete)\(/,
  );
  assert.match(service, /CreateTransformationResult/);
  assert.match(service, /idempotent_replay\?: true/);

  const db = new PGlite();
  await bootstrap(db);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`
    select set_config('request.jwt.claim.sub', '${AUTH_USER}', false);
    select set_config('request.jwt.claim.email', 'actor@tz315.test', false);
  `);

  const contract = (await rows(db, `
    select pg_get_userbyid(proc.proowner) owner,
           proc.prosecdef security_definer,
           proc.proconfig,
           has_function_privilege('anon', proc.oid, 'EXECUTE') anon_execute,
           has_function_privilege('authenticated', proc.oid, 'EXECUTE') authenticated_execute,
           has_function_privilege('service_role', proc.oid, 'EXECUTE') service_execute
    from pg_proc proc
    where proc.oid = 'public.create_processing_transformation_atomic_v1(uuid,uuid,text,uuid,uuid,text,jsonb,jsonb,jsonb)'::regprocedure
  `))[0];
  assert.equal(contract.owner, "postgres");
  assert.equal(contract.security_definer, true);
  assert.deepEqual(contract.proconfig, ["search_path=\"\""]);
  assert.equal(contract.anon_execute, false);
  assert.equal(contract.authenticated_execute, true);
  assert.equal(contract.service_execute, false);

  const gateContract = (await rows(db, `
    select pg_get_userbyid(proc.proowner) owner,
           proc.prosecdef security_definer,
           proc.proconfig,
           has_function_privilege('public', proc.oid, 'EXECUTE') public_execute,
           has_function_privilege('anon', proc.oid, 'EXECUTE') anon_execute,
           has_function_privilege('authenticated', proc.oid, 'EXECUTE') authenticated_execute,
           has_function_privilege('service_role', proc.oid, 'EXECUTE') service_execute
    from pg_proc proc
    where proc.oid = 'private.tz315_lock_company_season_write_gate_v1(uuid,uuid)'::regprocedure
  `))[0];
  assert.equal(gateContract.owner, "postgres");
  assert.equal(gateContract.security_definer, false);
  assert.deepEqual(gateContract.proconfig, ["search_path=\"\""]);
  assert.equal(gateContract.public_execute, false);
  assert.equal(gateContract.anon_execute, false);
  assert.equal(gateContract.authenticated_execute, false);
  assert.equal(gateContract.service_execute, false);

  const handoffContract = (await rows(db, `
    select pg_get_userbyid(proc.proowner) owner,
           proc.prosecdef security_definer,
           proc.proconfig,
           has_function_privilege('public', proc.oid, 'EXECUTE') public_execute,
           has_function_privilege('anon', proc.oid, 'EXECUTE') anon_execute,
           has_function_privilege('authenticated', proc.oid, 'EXECUTE') authenticated_execute,
           has_function_privilege('service_role', proc.oid, 'EXECUTE') service_execute
    from pg_proc proc
    where proc.oid =
      'private.tz315_processing_wip_handoff_valid_v1(uuid,uuid,uuid)'::regprocedure
  `))[0];
  assert.equal(handoffContract.owner, "postgres");
  assert.equal(handoffContract.security_definer, false);
  assert.deepEqual(handoffContract.proconfig, ["search_path=\"\""]);
  assert.equal(handoffContract.public_execute, false);
  assert.equal(handoffContract.anon_execute, false);
  assert.equal(handoffContract.authenticated_execute, false);
  assert.equal(handoffContract.service_execute, false);

  await db.exec(`
    select set_config('request.jwt.claim.sub', '${GLOBAL_ADMIN}', false);
    select set_config('request.jwt.claim.email', 'global@tz315.test', false);
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: TICKET,
      input: {},
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 4500 },
        { line_type: "process_loss", batch_class: "commodity", warehouse_to_id: null, output_weight_kg: 500 },
      ],
    }))),
    /PROCESSING_ACTOR_SESSION_MISMATCH/i,
  );
  await db.exec(`
    insert into public.global_admin_impersonation_contexts(
      admin_user_id, impersonated_profile_id, impersonated_company_id
    ) values ('${GLOBAL_ADMIN}', '${ACTOR}', '${COMPANY}')
  `);

  const canonicalOutputs = [
    { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 4500 },
    { line_type: "process_loss", batch_class: "commodity", warehouse_to_id: null, output_weight_kg: 500 },
  ];

  const first = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    transformationType: "drying",
    sourceTicketId: TICKET,
    input: {},
    outputs: [],
  }))));
  const firstId = String(first.id);
  assert.ok(firstId);
  assert.equal(first.idempotent_replay, false);
  assert.equal(
    await scalar(db, `select linked_processing_id::text value from public.tickets where id='${TICKET}'`),
    firstId,
  );
  const firstContext = (await rows(db, `
    select season_id::text, node_warehouse_id::text, processing_node_id::text,
           transformation_type, processing_method, shadow_mode,
           harvest_lot_id::text, source_physical_state, source_ticket_id::text,
           created_by::text
    from public.batch_transformations
    where id='${firstId}'
  `))[0];
  assert.equal(firstContext.season_id, SEASON);
  assert.equal(firstContext.node_warehouse_id, WAREHOUSE_IN);
  assert.equal(firstContext.processing_node_id, NODE);
  assert.equal(firstContext.transformation_type, "cleaning");
  assert.equal(firstContext.processing_method, "CLEANING");
  assert.equal(firstContext.shadow_mode, true);
  assert.equal(firstContext.harvest_lot_id, TICKET_LOT);
  assert.equal(firstContext.source_physical_state, "SOURCE");
  assert.equal(firstContext.source_ticket_id, TICKET);
  assert.equal(firstContext.created_by, ACTOR);
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_inputs where transformation_id='${firstId}'`)),
    1,
  );
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_outputs where transformation_id='${firstId}'`)),
    0,
    "canonical source-ticket attach may remain input-only",
  );

  await db.exec(`
    select set_config('request.jwt.claim.sub', '${AUTH_USER}', false);
    select set_config('request.jwt.claim.email', 'actor@tz315.test', false);
  `);

  const replay = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    sourceTicketId: TICKET,
    input: {},
    outputs: [],
  }))));
  assert.equal(replay.id, firstId);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformations where source_ticket_id='${TICKET}'`)),
    1,
  );

  const sharedAttach = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    sourceTicketId: SHARED_TICKET,
    input: {},
    outputs: [...canonicalOutputs].reverse(),
  }))));
  assert.equal(sharedAttach.id, firstId);
  assert.equal(sharedAttach.idempotent_replay, false);
  assert.equal(
    await scalar(db, `select source_ticket_id::text value from public.batch_transformations where id='${firstId}'`),
    TICKET,
    "the shared cycle header must retain its first ticket",
  );
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_inputs where transformation_id='${firstId}'`)),
    3,
    "the second ticket contributes its two canonical ticket lines",
  );
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_outputs where transformation_id='${firstId}'`)),
    2,
    "shared input tickets must never duplicate outputs",
  );
  assert.equal(
    await scalar(db, `select output_type value from public.batch_transformation_outputs where transformation_id='${firstId}' and line_type='process_loss'`),
    "process_loss",
  );

  const sharedReplay = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    transformationType: "client-type-must-not-override-cleaner",
    sourceTicketId: SHARED_TICKET,
    input: {},
    outputs: canonicalOutputs,
  }))));
  assert.equal(sharedReplay.id, firstId);
  assert.equal(sharedReplay.idempotent_replay, true);
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_inputs where transformation_id='${firstId}'`)),
    3,
  );
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_outputs where transformation_id='${firstId}'`)),
    2,
  );

  await db.exec(`
    insert into public.stock_ledger_entries(company_id, ticket_id, processing_id)
    values ('${COMPANY}', '${TICKET}', '${LEGACY_YARD_TRANSFORMATION}');
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: SHARED_TICKET,
      input: {},
      outputs: [],
    }))),
    /PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`
    delete from public.stock_ledger_entries
    where ticket_id='${TICKET}' and processing_id='${LEGACY_YARD_TRANSFORMATION}';
  `);

  await db.exec(`
    update public.tickets set linked_processing_id='${firstId}'
    where id='${OUTPUT_TRACE_TICKET}';
    insert into public.batch_transformation_outputs(
      id, company_id, transformation_id, warehouse_to_id, line_type,
      output_weight_kg, output_quality_json, batch_class, output_type,
      source_ticket_id, output_batch_id
    ) values (
      '${OUTPUT_TRACE_ROW}', '${COMPANY}', '${firstId}', '${WAREHOUSE_OUT}', 'commodity',
      50, '{}'::jsonb, 'commodity', 'main_product', '${OUTPUT_TRACE_TICKET}', '${OUTPUT_TRACE_BATCH}'
    );
    insert into public.stock_ledger_entries(
      company_id, ticket_id, processing_id, inventory_batch_id, warehouse_id,
      direction, reason_type, delta_qty_signed
    ) values
      ('${COMPANY}', '${OUTPUT_TRACE_TICKET}', '${firstId}', '${OUTPUT_TRACE_BATCH}', '${WAREHOUSE_OUT}',
       'in', 'processing_output_in', 50),
      ('${COMPANY}', '${OUTPUT_TRACE_TICKET}', '${firstId}', '${TICKET_BATCH}', '${WAREHOUSE_IN}',
       'out', 'processing_output_source_out', -50);
  `);
  const tracedOutputReplay = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    sourceTicketId: TICKET,
    input: {},
    outputs: [],
  }))));
  assert.equal(tracedOutputReplay.id, firstId);

  await db.exec(`update public.batch_transformation_outputs set output_batch_id='${FAILURE_BATCH}' where id='${OUTPUT_TRACE_ROW}'`);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({ sourceTicketId: TICKET, input: {}, outputs: [] }))),
    /PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`update public.batch_transformation_outputs set output_batch_id='${OUTPUT_TRACE_BATCH}' where id='${OUTPUT_TRACE_ROW}'`);

  await db.exec(`update public.tickets set is_finalized=false where id='${OUTPUT_TRACE_TICKET}'`);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({ sourceTicketId: TICKET, input: {}, outputs: [] }))),
    /PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`update public.tickets set is_finalized=true where id='${OUTPUT_TRACE_TICKET}'`);

  await db.exec(`update public.tickets set linked_processing_id='${LEGACY_YARD_TRANSFORMATION}' where id='${OUTPUT_TRACE_TICKET}'`);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({ sourceTicketId: TICKET, input: {}, outputs: [] }))),
    /PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`update public.tickets set linked_processing_id='${firstId}' where id='${OUTPUT_TRACE_TICKET}'`);

  await db.exec(`update public.tickets set company_id='${FOREIGN_COMPANY}' where id='${OUTPUT_TRACE_TICKET}'`);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({ sourceTicketId: TICKET, input: {}, outputs: [] }))),
    /PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`update public.tickets set company_id='${COMPANY}' where id='${OUTPUT_TRACE_TICKET}'`);

  // Model the committed end-state of the canonical output-close trigger: the
  // output and its ledger remain upstream, while the finalized WIP ticket is
  // attached as the exact physical input of a new DRYER cycle.
  await db.exec(`
    update public.inventory_batches
    set source_ticket_id='${WIP_HANDOFF_TICKET}',
        source_transformation_id='${firstId}',
        warehouse_id='${DRYER_WAREHOUSE}',
        physical_state='AFTER_CLEANING'
    where id='${WIP_HANDOFF_BATCH}';
    update public.tickets
    set source_kind='processing_wip',
        source_id='${firstId}',
        processing_output_role='GRAIN',
        warehouse_from_id='${WAREHOUSE_IN}',
        linked_processing_id='${firstId}'
    where id='${WIP_HANDOFF_TICKET}';
    update public.ticket_lines
    set warehouse_from_id='${WAREHOUSE_IN}',
        warehouse_to_id='${DRYER_WAREHOUSE}'
    where id='${WIP_HANDOFF_LINE}';
    insert into public.batch_transformation_outputs(
      id, company_id, transformation_id, warehouse_to_id, line_type,
      output_weight_kg, output_quality_json, batch_class, output_type, output_role,
      physical_state, source_ticket_id, output_batch_id
    ) values (
      '${WIP_HANDOFF_OUTPUT_ROW}', '${COMPANY}', '${firstId}',
      '${DRYER_WAREHOUSE}', 'commodity', 100, '{}'::jsonb, 'commodity',
      'main_product', 'GRAIN', 'AFTER_CLEANING',
      '${WIP_HANDOFF_TICKET}', '${WIP_HANDOFF_BATCH}'
    );
    insert into public.stock_ledger_entries(
      company_id, ticket_id, processing_id, inventory_batch_id, warehouse_id,
      direction, reason_type, delta_qty_signed
    ) values
      ('${COMPANY}', '${WIP_HANDOFF_TICKET}', '${firstId}',
       '${WIP_HANDOFF_BATCH}', '${DRYER_WAREHOUSE}',
       'in', 'processing_output_in', 100),
      ('${COMPANY}', '${WIP_HANDOFF_TICKET}', '${firstId}',
       '${TICKET_BATCH}', '${WAREHOUSE_IN}',
       'out', 'processing_output_source_out', -100);
  `);
  const wipDownstreamId = String(await asRole(db, "service_role", () => scalar(db, `
    select public.attach_route_processing_input_ticket_v1(
      '${WIP_HANDOFF_TICKET}'::uuid
    )::text value
  `)));
  assert.ok(wipDownstreamId);
  assert.notEqual(wipDownstreamId, firstId);
  assert.equal(
    await scalar(db, `select linked_processing_id::text value from public.tickets where id='${WIP_HANDOFF_TICKET}'`),
    wipDownstreamId,
  );
  assert.equal(
    await scalar(db, `
      select private.tz315_processing_wip_handoff_valid_v1(
        '${WIP_HANDOFF_TICKET}', '${firstId}', '${wipDownstreamId}'
      ) value
    `),
    true,
  );

  const wipDownstreamOutputs = [
    { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 90 },
    { line_type: "process_loss", batch_class: "commodity", warehouse_to_id: null, output_weight_kg: 10 },
  ];
  const wipFirstReplay = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    transformationType: "client-type-must-not-override-dryer",
    sourceTicketId: WIP_HANDOFF_TICKET,
    input: {},
    outputs: wipDownstreamOutputs,
  }))));
  assert.equal(wipFirstReplay.id, wipDownstreamId);
  assert.equal(wipFirstReplay.idempotent_replay, true);
  assert.equal(
    Number(await scalar(db, `
      select count(*) value from public.batch_transformation_outputs
      where transformation_id='${wipDownstreamId}'
    `)),
    2,
  );

  const wipExactReplay = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    transformationType: "other",
    sourceTicketId: WIP_HANDOFF_TICKET,
    input: {},
    outputs: [...wipDownstreamOutputs].reverse(),
  }))));
  assert.equal(wipExactReplay.id, wipDownstreamId);
  assert.equal(wipExactReplay.idempotent_replay, true);
  assert.equal(
    Number(await scalar(db, `
      select count(*) value from public.batch_transformation_outputs
      where transformation_id='${wipDownstreamId}'
    `)),
    2,
    "WIP replay must not duplicate downstream outputs",
  );

  const upstreamAfterHandoffReplay = decodeJson(await asRole(
    db,
    "authenticated",
    () => scalar(db, rpcSql({ sourceTicketId: TICKET, input: {}, outputs: [] })),
  ));
  assert.equal(upstreamAfterHandoffReplay.id, firstId);

  const wipGraphBeforeCorruption = (await rows(db, `
    select
      (select count(*) from public.batch_transformations)::int transformations,
      (select count(*) from public.batch_transformation_inputs)::int inputs,
      (select count(*) from public.batch_transformation_outputs)::int outputs
  `))[0];
  await db.exec(`update public.tickets set source_id='${LEGACY_YARD_TRANSFORMATION}' where id='${WIP_HANDOFF_TICKET}'`);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: WIP_HANDOFF_TICKET,
      input: {},
      outputs: wipDownstreamOutputs,
    }))),
    /PROCESSING_SOURCE_TICKET_(?:SHARED|LINK)_GRAPH_INVALID/i,
  );
  await db.exec(`update public.tickets set source_id='${firstId}' where id='${WIP_HANDOFF_TICKET}'`);

  await db.exec(`
    update public.batch_transformation_outputs
    set output_batch_id='${FAILURE_BATCH}'
    where id='${WIP_HANDOFF_OUTPUT_ROW}'
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: WIP_HANDOFF_TICKET,
      input: {},
      outputs: wipDownstreamOutputs,
    }))),
    /PROCESSING_SOURCE_TICKET_(?:SHARED|LINK)_GRAPH_INVALID/i,
  );
  await db.exec(`
    update public.batch_transformation_outputs
    set output_batch_id='${WIP_HANDOFF_BATCH}'
    where id='${WIP_HANDOFF_OUTPUT_ROW}'
  `);

  await db.exec(`
    update public.stock_ledger_entries
    set company_id='${FOREIGN_COMPANY}'
    where ticket_id='${WIP_HANDOFF_TICKET}'
      and reason_type='processing_output_in'
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: WIP_HANDOFF_TICKET,
      input: {},
      outputs: wipDownstreamOutputs,
    }))),
    /PROCESSING_SOURCE_TICKET_(?:SHARED|LINK)_GRAPH_INVALID/i,
  );
  await db.exec(`
    update public.stock_ledger_entries
    set company_id='${COMPANY}'
    where ticket_id='${WIP_HANDOFF_TICKET}'
      and reason_type='processing_output_in'
  `);

  await db.exec(`
    update public.ticket_lines
    set company_id='${FOREIGN_COMPANY}'
    where id='${WIP_HANDOFF_LINE}'
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: WIP_HANDOFF_TICKET,
      input: {},
      outputs: wipDownstreamOutputs,
    }))),
    /PROCESSING_SOURCE_TICKET_(?:SHARED|LINK)_GRAPH_INVALID/i,
  );
  await db.exec(`
    update public.ticket_lines
    set company_id='${COMPANY}'
    where id='${WIP_HANDOFF_LINE}'
  `);

  await db.exec(`
    update public.tickets
    set source_physical_state='SOURCE'
    where id='${WIP_HANDOFF_TICKET}'
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: WIP_HANDOFF_TICKET,
      input: {},
      outputs: wipDownstreamOutputs,
    }))),
    /PROCESSING_SOURCE_TICKET_(?:ATTACHED_CONTEXT|SHARED|INPUT|LINK)_INVALID|PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`
    update public.tickets
    set source_physical_state='AFTER_CLEANING'
    where id='${WIP_HANDOFF_TICKET}'
  `);
  await db.exec(`
    update public.tickets
    set source_physical_state='SOURCE'
    where id='${WIP_HANDOFF_TICKET}';
    update public.batch_transformation_outputs
    set physical_state='SOURCE'
    where id='${WIP_HANDOFF_OUTPUT_ROW}';
    update public.inventory_batches
    set physical_state='SOURCE'
    where id='${WIP_HANDOFF_BATCH}';
    update public.batch_transformations
    set source_physical_state='SOURCE'
    where id='${wipDownstreamId}';
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: WIP_HANDOFF_TICKET,
      input: {},
      outputs: wipDownstreamOutputs,
    }))),
    /PROCESSING_SOURCE_TICKET_(?:ATTACHED_CONTEXT|SHARED|INPUT|LINK)_INVALID|PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`
    update public.tickets
    set source_physical_state='AFTER_CLEANING'
    where id='${WIP_HANDOFF_TICKET}';
    update public.batch_transformation_outputs
    set physical_state='AFTER_CLEANING'
    where id='${WIP_HANDOFF_OUTPUT_ROW}';
    update public.inventory_batches
    set physical_state='AFTER_CLEANING'
    where id='${WIP_HANDOFF_BATCH}';
    update public.batch_transformations
    set source_physical_state='AFTER_CLEANING'
    where id='${wipDownstreamId}';
  `);

  await db.exec(`
    update public.batch_transformation_outputs
    set output_role=null,
        physical_state='OTHER'
    where id='${WIP_HANDOFF_OUTPUT_ROW}';
    update public.inventory_batches
    set physical_state='OTHER'
    where id='${WIP_HANDOFF_BATCH}';
    update public.batch_transformations
    set source_physical_state='OTHER'
    where id='${wipDownstreamId}';
    update public.tickets
    set processing_output_role=null,
        source_physical_state='OTHER'
    where id='${WIP_HANDOFF_TICKET}';
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: WIP_HANDOFF_TICKET,
      input: {},
      outputs: wipDownstreamOutputs,
    }))),
    /PROCESSING_SOURCE_TICKET_(?:ATTACHED_CONTEXT|SHARED|INPUT|LINK)_INVALID|PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`
    update public.batch_transformation_outputs
    set output_role='GRAIN',
        physical_state='AFTER_CLEANING'
    where id='${WIP_HANDOFF_OUTPUT_ROW}';
    update public.inventory_batches
    set physical_state='AFTER_CLEANING'
    where id='${WIP_HANDOFF_BATCH}';
    update public.batch_transformations
    set source_physical_state='AFTER_CLEANING'
    where id='${wipDownstreamId}';
    update public.tickets
    set processing_output_role='GRAIN',
        source_physical_state='AFTER_CLEANING'
    where id='${WIP_HANDOFF_TICKET}';
  `);
  assert.deepEqual((await rows(db, `
    select
      (select count(*) from public.batch_transformations)::int transformations,
      (select count(*) from public.batch_transformation_inputs)::int inputs,
      (select count(*) from public.batch_transformation_outputs)::int outputs
  `))[0], wipGraphBeforeCorruption, "corrupt WIP provenance must not mutate the graph");

  for (const scenario of [
    {
      label: "DRYER",
      firstTicket: DRYER_TICKET_A,
      secondTicket: DRYER_TICKET_B,
      warehouse: DRYER_WAREHOUSE,
      expectedType: "drying",
      expectedMethod: "MECHANICAL_DRYING",
    },
    {
      label: "CLEANER",
      firstTicket: CLEANER_CURRENT_TICKET_A,
      secondTicket: CLEANER_CURRENT_TICKET_B,
      warehouse: WAREHOUSE_IN,
      expectedType: "cleaning",
      expectedMethod: "CLEANING",
    },
  ]) {
    const canonicalFirst = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
      transformationType: `invalid-client-${scenario.label.toLowerCase()}`,
      sourceTicketId: scenario.firstTicket,
      input: {},
      outputs: [],
    }))));
    const canonicalId = String(canonicalFirst.id);
    assert.ok(canonicalId);
    assert.equal(canonicalFirst.idempotent_replay, false);
    const canonicalContext = (await rows(db, `
      select transformation_type, processing_method, shadow_mode,
             node_warehouse_id::text, processing_node_id::text, source_ticket_id::text
      from public.batch_transformations where id='${canonicalId}'
    `))[0];
    assert.equal(canonicalContext.transformation_type, scenario.expectedType, `${scenario.label} must derive its physical type`);
    assert.equal(canonicalContext.processing_method, scenario.expectedMethod);
    assert.equal(canonicalContext.shadow_mode, true);
    assert.equal(canonicalContext.node_warehouse_id, scenario.warehouse);
    assert.equal(canonicalContext.processing_node_id, null, `${scenario.label} current route keeps canonical null node`);
    assert.equal(canonicalContext.source_ticket_id, scenario.firstTicket);

    const canonicalShared = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
      transformationType: "cleaning",
      sourceTicketId: scenario.secondTicket,
      input: {},
      outputs: [],
    }))));
    assert.equal(canonicalShared.id, canonicalId);
    assert.equal(canonicalShared.idempotent_replay, false);
    assert.equal(
      Number(await scalar(db, `select count(*) value from public.batch_transformation_inputs where transformation_id='${canonicalId}'`)),
      2,
    );
    assert.equal(
      await scalar(db, `select source_ticket_id::text value from public.batch_transformations where id='${canonicalId}'`),
      scenario.firstTicket,
    );

    const canonicalReplay = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
      transformationType: "other",
      sourceTicketId: scenario.secondTicket,
      input: {},
      outputs: [],
    }))));
    assert.equal(canonicalReplay.id, canonicalId);
    assert.equal(canonicalReplay.idempotent_replay, true);
    assert.equal(
      Number(await scalar(db, `select count(*) value from public.batch_transformation_inputs where transformation_id='${canonicalId}'`)),
      2,
    );

    await db.exec(`
      update public.batch_transformations
      set processing_method='NATURAL_DRYING'
      where id='${canonicalId}'
    `);
    await assert.rejects(
      () => asRole(db, "authenticated", () => db.exec(rpcSql({
        sourceTicketId: scenario.secondTicket,
        input: {},
        outputs: [],
      }))),
      /PROCESSING_SOURCE_TICKET_ATTACHED_CONTEXT_INVALID/i,
    );
    await db.exec(`
      update public.batch_transformations
      set processing_method='${scenario.expectedMethod}'
      where id='${canonicalId}'
    `);

    await db.exec(`
      update public.batch_transformations
      set shadow_mode=false
      where id='${canonicalId}'
    `);
    await assert.rejects(
      () => asRole(db, "authenticated", () => db.exec(rpcSql({
        sourceTicketId: scenario.secondTicket,
        input: {},
        outputs: [],
      }))),
      /PROCESSING_SOURCE_TICKET_ATTACHED_CONTEXT_INVALID/i,
    );
    await db.exec(`
      update public.batch_transformations
      set shadow_mode=true
      where id='${canonicalId}'
    `);
  }

  const yardGraphBefore = (await rows(db, `
    select
      (select count(*) from public.batch_transformations)::int transformations,
      (select count(*) from public.batch_transformation_inputs)::int inputs
  `))[0];
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: YARD_TICKET_A,
      input: {},
      outputs: [],
    }))),
    /PROCESSING_SOURCE_TICKET_ATTACH_REJECTED/i,
  );
  assert.equal(
    await scalar(db, `select linked_processing_id::text value from public.tickets where id='${YARD_TICKET_A}'`),
    null,
  );
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_inputs where source_ticket_id='${YARD_TICKET_A}'`)),
    0,
  );
  assert.deepEqual((await rows(db, `
    select
      (select count(*) from public.batch_transformations)::int transformations,
      (select count(*) from public.batch_transformation_inputs)::int inputs
  `))[0], yardGraphBefore, "new YARD route must not create a processing graph");

  const legacyYardReplay = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    transformationType: "client-type-ignored",
    sourceTicketId: YARD_TICKET_B,
    input: {},
    outputs: [],
  }))));
  assert.equal(legacyYardReplay.id, LEGACY_YARD_TRANSFORMATION);
  assert.equal(legacyYardReplay.idempotent_replay, true);
  assert.deepEqual((await rows(db, `
    select transformation_type, node_warehouse_id::text, processing_node_id::text
    from public.batch_transformations where id='${LEGACY_YARD_TRANSFORMATION}'
  `))[0], {
    transformation_type: "drying",
    node_warehouse_id: YARD_WAREHOUSE,
    processing_node_id: YARD_NODE,
  });

  const lifecycleOutput = [
    { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
  ];
  await db.exec(`update public.batch_transformations set status='draft', processing_state='processing_pending_outputs' where id='${LEGACY_YARD_TRANSFORMATION}'`);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: YARD_TICKET_B,
      input: {},
      outputs: lifecycleOutput,
    }))),
    /PROCESSING_SOURCE_TICKET_CYCLE_READ_ONLY/i,
  );
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_outputs where transformation_id='${LEGACY_YARD_TRANSFORMATION}'`)),
    0,
  );
  assert.equal(
    decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
      sourceTicketId: YARD_TICKET_B,
      input: {},
      outputs: [],
    })))).id,
    LEGACY_YARD_TRANSFORMATION,
  );

  await db.exec(`update public.batch_transformations set status='completed', processing_state='processing_closed' where id='${LEGACY_YARD_TRANSFORMATION}'`);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: YARD_TICKET_B,
      input: {},
      outputs: lifecycleOutput,
    }))),
    /PROCESSING_SOURCE_TICKET_CYCLE_READ_ONLY/i,
  );
  assert.equal(
    decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
      sourceTicketId: YARD_TICKET_B,
      input: {},
      outputs: [],
    })))).id,
    LEGACY_YARD_TRANSFORMATION,
  );

  await db.exec(`update public.batch_transformations set status='voided', processing_state='processing_closed' where id='${LEGACY_YARD_TRANSFORMATION}'`);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: YARD_TICKET_B,
      input: {},
      outputs: [],
    }))),
    /PROCESSING_SOURCE_TICKET_ATTACHED_CONTEXT_INVALID/i,
  );
  await db.exec(`update public.batch_transformations set status='draft', processing_state='in_processing' where id='${LEGACY_YARD_TRANSFORMATION}'`);

  for (const vegetableTicket of [VEGETABLE_CLEANER_TICKET, VEGETABLE_DRYER_TICKET]) {
    const beforeVegetable = (await rows(db, `
      select
        (select count(*) from public.batch_transformations)::int transformations,
        (select count(*) from public.batch_transformation_inputs)::int inputs
    `))[0];
    await assert.rejects(
      () => asRole(db, "authenticated", () => db.exec(rpcSql({
        sourceTicketId: vegetableTicket,
        input: {},
        outputs: [],
      }))),
      /VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED/i,
    );
    assert.equal(
      await scalar(db, `select linked_processing_id::text value from public.tickets where id='${vegetableTicket}'`),
      null,
    );
    assert.deepEqual((await rows(db, `
      select
        (select count(*) from public.batch_transformations)::int transformations,
        (select count(*) from public.batch_transformation_inputs)::int inputs
    `))[0], beforeVegetable, "vegetable route guard must roll back without a graph");
  }

  await db.exec(`
    update public.batch_transformation_outputs
    set output_weight_kg = 6500
    where transformation_id = '${firstId}' and line_type = 'commodity'
      and source_ticket_id is null;
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: TICKET,
      input: {},
      outputs: [],
    }))),
    /PROCESSING_OUTPUT_EXCEEDS_INPUT/i,
  );
  await db.exec(`
    update public.batch_transformation_outputs
    set output_weight_kg = 4500
    where transformation_id = '${firstId}' and line_type = 'commodity'
      and source_ticket_id is null;
  `);

  await db.exec(`
    insert into public.batch_transformation_outputs(
      company_id, transformation_id, warehouse_to_id, line_type,
      output_weight_kg, output_quality_json, batch_class, output_type
    ) values (
      '${FOREIGN_COMPANY}', '${firstId}', '${WAREHOUSE_OUT}', 'commodity',
      1, '{}'::jsonb, 'commodity', 'main_product'
    );
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: TICKET,
      input: {},
      outputs: [],
    }))),
    /PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID/i,
  );
  await db.exec(`
    delete from public.batch_transformation_outputs
    where company_id = '${FOREIGN_COMPANY}' and transformation_id = '${firstId}';
  `);

  const graphBeforeOutputConflict = (await rows(db, `
    select
      (select count(*) from public.batch_transformation_inputs where transformation_id='${firstId}')::int inputs,
      (select count(*) from public.batch_transformation_outputs where transformation_id='${firstId}')::int outputs
  `))[0];
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: OUTPUT_CONFLICT_TICKET,
      input: {},
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 4400 },
        { line_type: "process_loss", batch_class: "commodity", warehouse_to_id: null, output_weight_kg: 600 },
      ],
    }))),
    /PROCESSING_SOURCE_TICKET_OUTPUT_GRAPH_CONFLICT/i,
  );
  assert.equal(
    await scalar(db, `select linked_processing_id::text value from public.tickets where id='${OUTPUT_CONFLICT_TICKET}'`),
    null,
    "a conflicting output specification must roll back the ticket link",
  );
  assert.equal(
    Number(await scalar(db, `select count(*) value from public.batch_transformation_inputs where source_ticket_id='${OUTPUT_CONFLICT_TICKET}'`)),
    0,
    "a conflicting output specification must roll back the attached input",
  );
  assert.deepEqual((await rows(db, `
    select
      (select count(*) from public.batch_transformation_inputs where transformation_id='${firstId}')::int inputs,
      (select count(*) from public.batch_transformation_outputs where transformation_id='${firstId}')::int outputs
  `))[0], graphBeforeOutputConflict);

  await db.exec(`
    update public.batch_transformations
    set processing_state = 'processing_pending_outputs'
    where id = '${firstId}';
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: PENDING_TICKET,
      input: {},
      outputs: canonicalOutputs,
    }))),
    /PROCESSING_INPUT_FINISHED/i,
  );
  assert.equal(
    await scalar(db, `select linked_processing_id::text value from public.tickets where id='${PENDING_TICKET}'`),
    null,
  );
  await db.exec(`
    update public.batch_transformations set processing_state = 'in_processing'
    where id = '${firstId}';
  `);

  await db.exec(`
    drop index public.uq_batch_transformations_active_identity_v1;
    insert into public.batch_transformations(
      id, company_id, season_id, node_warehouse_id, processing_node_id,
      transformation_type, processing_method, shadow_mode,
      status, processing_state, source_ticket_id,
      harvest_lot_id, source_physical_state, created_by
    ) values (
      '${AMBIGUOUS_TRANSFORMATION}', '${COMPANY}', '${SEASON}', '${WAREHOUSE_IN}', '${NODE}',
      'cleaning', 'CLEANING', true, 'draft', 'in_processing', null,
      '${TICKET_LOT}', 'SOURCE', '${ACTOR}'
    );
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: AMBIGUOUS_TICKET,
      input: {},
      outputs: canonicalOutputs,
    }))),
    /PROCESSING_INPUT_AMBIGUOUS/i,
  );
  assert.equal(
    await scalar(db, `select linked_processing_id::text value from public.tickets where id='${AMBIGUOUS_TICKET}'`),
    null,
  );
  await db.exec(`
    update public.batch_transformations set status = 'voided'
    where id = '${AMBIGUOUS_TRANSFORMATION}';
    create unique index uq_batch_transformations_active_identity_v1
      on public.batch_transformations(
        company_id,
        coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(node_warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(processing_node_id, '00000000-0000-0000-0000-000000000000'::uuid),
        transformation_type,
        coalesce(harvest_lot_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(source_physical_state, 'SOURCE')
      )
      where processing_state in ('in_processing', 'processing_pending_outputs')
        and status <> 'voided';
  `);

  await db.exec(`
    insert into public.batch_transformation_inputs(
      company_id, transformation_id, batch_id, warehouse_from_id, input_weight_kg,
      source_ticket_id, source_ticket_line_id, node_warehouse_id
    ) values (
      '${COMPANY}', '${firstId}', '${CROSSWIRE_BATCH}', '${WAREHOUSE_IN}', 200,
      '${CROSSWIRE_TICKET}', '${CROSSWIRE_LINE_A}', '${WAREHOUSE_IN}'
    );
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      sourceTicketId: CROSSWIRE_TICKET,
      input: {},
      outputs: canonicalOutputs,
    }))),
    /PROCESSING_SOURCE_TICKET_(?:SHARED|INPUT)_GRAPH_INVALID/i,
  );
  assert.equal(
    await scalar(db, `select linked_processing_id::text value from public.tickets where id='${CROSSWIRE_TICKET}'`),
    null,
    "a partial/cross-wired ticket graph is fail-closed",
  );

  const lotResult = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    input: {
      harvest_lot_id: LOT,
      source_physical_state: "SOURCE",
      warehouse_from_id: WAREHOUSE_IN,
      input_weight_kg: 500,
    },
    outputs: [
      { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 500 },
    ],
  }))));
  assert.ok(lotResult.id);
  const lotInputs = await rows(db, `
    select batch_id::text, input_weight_kg::numeric
    from public.batch_transformation_inputs
    where transformation_id='${String(lotResult.id)}'
    order by batch_id
  `);
  assert.deepEqual(lotInputs.map((row) => [row.batch_id, Number(row.input_weight_kg)]), [
    [LOT_BATCH_A, 300],
    [LOT_BATCH_B, 200],
  ]);

  const beforeRejected = Number(await scalar(db, "select count(*) value from public.batch_transformations"));
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      input: {
        batch_id: TICKET_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 10,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 10 },
      ],
    }))),
    /PROCESSING_BATCH_CANONICAL_LOT_REQUIRED/i,
  );

  await db.exec(`
    insert into public.harvest_lot_batches(
      company_id, harvest_lot_id, inventory_batch_id
    ) values ('${COMPANY}', '${FOREIGN_SEASON_LOT}', '${FAILURE_BATCH}')
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      input: {
        batch_id: FAILURE_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 100,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
      ],
    }))),
    /PROCESSING_BATCH_CANONICAL_LOT_REQUIRED/i,
  );
  await db.exec(`
    delete from public.harvest_lot_batches
    where harvest_lot_id='${FOREIGN_SEASON_LOT}'
      and inventory_batch_id='${FAILURE_BATCH}'
  `);

  await db.exec(`
    insert into public.harvest_lot_batches(
      company_id, harvest_lot_id, inventory_batch_id
    ) values ('${FOREIGN_COMPANY}', '${TICKET_LOT}', '${FAILURE_BATCH}')
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      input: {
        batch_id: FAILURE_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 100,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
      ],
    }))),
    /PROCESSING_BATCH_CANONICAL_LOT_REQUIRED/i,
  );
  await db.exec(`
    delete from public.harvest_lot_batches
    where company_id='${FOREIGN_COMPANY}'
      and inventory_batch_id='${FAILURE_BATCH}'
  `);

  await db.exec(`
    insert into public.harvest_lot_batches(
      company_id, harvest_lot_id, inventory_batch_id
    ) values ('${COMPANY}', '${ORPHAN_LOT}', '${FAILURE_BATCH}')
  `);
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      input: {
        batch_id: FAILURE_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 100,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
      ],
    }))),
    /PROCESSING_BATCH_CANONICAL_LOT_REQUIRED/i,
  );
  await db.exec(`
    delete from public.harvest_lot_batches
    where harvest_lot_id='${ORPHAN_LOT}'
      and inventory_batch_id='${FAILURE_BATCH}'
  `);

  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      company: FOREIGN_COMPANY,
      input: {
        batch_id: FAILURE_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 100,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
      ],
    }))),
    /PROCESSING_ACTOR_COMPANY_MISMATCH|PROCESSING_SELECTED_COMPANY_MISMATCH/i,
  );
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      input: {
        harvest_lot_id: MISMATCH_LOT,
        source_physical_state: "SOURCE",
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 100,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
      ],
    }))),
    /PROCESSING_BATCH_SEASON_MISMATCH/i,
  );
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      input: {
        batch_id: FAILURE_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 2000,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 2000 },
      ],
    }))),
    /PROCESSING_INSUFFICIENT_EFFECTIVE_STOCK/i,
  );
  assert.equal(Number(await scalar(db, "select count(*) value from public.batch_transformations")), beforeRejected);

  const manualCycle = decodeJson(await asRole(db, "authenticated", () => scalar(db, rpcSql({
    input: {
      batch_id: FAILURE_BATCH,
      warehouse_from_id: WAREHOUSE_IN,
      input_weight_kg: 100,
    },
    outputs: [
      { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
    ],
  }))));
  assert.ok(manualCycle.id);

  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      input: {
        batch_id: FAILURE_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 100,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
      ],
    }))),
    /PROCESSING_ACTIVE_CYCLE_EXISTS/i,
  );

  await db.exec(`
    create function public.tz315_fail_output_fixture_v1()
    returns trigger language plpgsql as $$
    begin
      if new.line_type = 'other' then
        raise exception 'TZ315_INJECTED_OUTPUT_FAILURE';
      end if;
      return new;
    end;
    $$;
    create trigger tz315_fail_output_fixture_v1
      before insert on public.batch_transformation_outputs
      for each row execute function public.tz315_fail_output_fixture_v1();
  `);
  const graphBefore = (await rows(db, `
    select
      (select count(*) from public.batch_transformations)::int transformations,
      (select count(*) from public.batch_transformation_inputs)::int inputs,
      (select count(*) from public.batch_transformation_outputs)::int outputs
  `))[0];
  await assert.rejects(
    () => asRole(db, "authenticated", () => db.exec(rpcSql({
      transformationType: "other",
      input: {
        batch_id: FAILURE_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 100,
      },
      outputs: [
        { line_type: "other", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 100 },
      ],
    }))),
    /TZ315_INJECTED_OUTPUT_FAILURE/i,
  );
  const graphAfter = (await rows(db, `
    select
      (select count(*) from public.batch_transformations)::int transformations,
      (select count(*) from public.batch_transformation_inputs)::int inputs,
      (select count(*) from public.batch_transformation_outputs)::int outputs
  `))[0];
  assert.deepEqual(graphAfter, graphBefore, "an output failure must roll back the entire graph");

  await assert.rejects(
    () => asRole(db, "service_role", () => db.exec(rpcSql({
      input: {
        batch_id: FAILURE_BATCH,
        warehouse_from_id: WAREHOUSE_IN,
        input_weight_kg: 10,
      },
      outputs: [
        { line_type: "commodity", batch_class: "commodity", warehouse_to_id: WAREHOUSE_OUT, output_weight_kg: 10 },
      ],
    }))),
    /permission denied for function create_processing_transformation_atomic_v1/i,
  );

  console.log("TZ315 PROCESSING CREATE ATOMIC: PASS");
  console.log(JSON.stringify({
    route_direct_accounting_dml: 0,
    rpc: "public.create_processing_transformation_atomic_v1",
    universal_gate_first: true,
    source_ticket_idempotency: "PASS",
    aggregate_lot_fifo: "PASS",
    foreign_company: "BLOCKED",
    season_mismatch: "BLOCKED",
    nullable_wip_role: "BLOCKED",
    current_method_shadow_mutation: "BLOCKED",
    insufficient_stock: "BLOCKED",
    injected_output_failure_graph_rollback: "PASS",
    repeat_safe: true,
  }, null, 2));
  await db.close();
}

main().catch((error) => {
  console.error("TZ315 PROCESSING CREATE ATOMIC: FAIL");
  console.error(error);
  process.exitCode = 1;
});
