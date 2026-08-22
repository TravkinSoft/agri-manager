import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260820233817_tz294_warehouse_local_transfer_correction_v1.sql",
  import.meta.url,
);
const identityMigrationUrl = new URL(
  "../supabase/migrations/20260821002912_tz294_correction_lot_identity_v2.sql",
  import.meta.url,
);
const pageUrl = new URL("../app/(dashboard)/weighbridge/page.tsx", import.meta.url);
const paperUrl = new URL("../components/weighbridge/weighbridge-ticket-paper.tsx", import.meta.url);
const finalizeRouteUrl = new URL("../app/api/weighbridge/tickets/[id]/finalize/route.ts", import.meta.url);
const ticketsRouteUrl = new URL("../app/api/weighbridge/tickets/route.ts", import.meta.url);

const COMPANY = "8a0f2c00-0000-4000-8000-000000000001";
const ACTOR = "8a0f2c00-0000-4000-8000-000000000002";
const PERSON = "8a0f2c00-0000-4000-8000-000000000003";
const SHIFT = "8a0f2c00-0000-4000-8000-000000000004";
const PRODUCT = "8a0f2c00-0000-4000-8000-000000000005";
const CROP = "8a0f2c00-0000-4000-8000-000000000006";
const SOURCE_WAREHOUSE = "8a0f2c00-0000-4000-8000-000000000007";
const DESTINATION_WAREHOUSE = "8a0f2c00-0000-4000-8000-000000000008";
const SOURCE_BATCH = "41637b68-5a08-42b0-bc37-8fb35d0f5bc0";
const LOT = "8a0f2c00-0000-4000-8000-000000000010";
const ORIGINAL = "170e7d37-fb81-41b2-81e3-8f9a364ed253";
const CORRECTION = "c6b13eac-9ac5-4b05-aae7-5605bfc3d864";

type Row = Record<string, unknown>;
const rows = async (db: PGlite, sql: string) => (await db.query(sql)).rows as Row[];

async function main() {
  const migration = await readFile(migrationUrl, "utf8");
  const identityMigration = await readFile(identityMigrationUrl, "utf8");
  const page = await readFile(pageUrl, "utf8");
  const paper = await readFile(paperUrl, "utf8");
  const finalizeRoute = await readFile(finalizeRouteUrl, "utf8");
  const ticketsRoute = await readFile(ticketsRouteUrl, "utf8");

  assert.match(migration, /populate_ledger_inventory_batch_trace_v2/);
  assert.match(migration, /ensure_transfer_destination_batch_v1/);
  assert.match(migration, /repair_legacy_transfer_batch_trace_v1/);
  assert.match(migration, /finalize_warehouse_local_transfer_v1/);
  assert.match(migration, /storno_of_entry_id/);
  assert.match(migration, /Transfer correction changed total company stock/);
  assert.doesNotMatch(migration, /disable\s+trigger/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(tickets|stock_ledger_entries|inventory_batches)/i);
  assert.match(identityMigration, /sync_transfer_correction_lineage_v2/);
  assert.match(identityMigration, /correction_lineage_backfilled/);
  assert.match(identityMigration, /destination_batch_id/);
  assert.match(identityMigration, /line_quantity_kg/);
  assert.match(identityMigration, /Correction aggregate lot trace postcondition failed/);
  assert.doesNotMatch(identityMigration, /disable\s+trigger/i);
  assert.doesNotMatch(identityMigration, /delete\s+from\s+public\.(tickets|stock_ledger_entries|inventory_batches)/i);
  assert.match(page, /Исправляется/);
  assert.match(page, /Исходный талон/);
  assert.match(page, /Новое исправление/);
  assert.match(page, /ticket\?\.correction_of_ticket_id && ticket\?\.net_weight_kg != null/);
  assert.match(paper, /displayedLineQuantity/);
  assert.match(paper, /lines\.length === 1 && weightEditor\?\.physicalNetKg != null/);
  assert.match(finalizeRoute, /correction_lot_validation_failed/);
  assert.match(finalizeRoute, /Исходный талон не изменён/);
  assert.match(ticketsRoute, /correction_of_ticket_id/);

  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema private;
    create type public.ledger_direction as enum ('in','out');
    create type public.ticket_status as enum ('draft','active','ready_to_close','finalized','voided');
    create type public.ticket_direction as enum ('incoming','outgoing','transfer');

    create table public.profiles(
      id uuid primary key, company_id uuid, role text, status text
    );
    create table public.warehouse_issue_request_item_allocations(
      id uuid primary key, company_id uuid not null, batch_id uuid
    );
    create table public.tickets(
      id uuid primary key, company_id uuid not null, ticket_no text not null,
      direction public.ticket_direction not null, op_type text not null,
      status public.ticket_status not null, is_finalized boolean not null default false,
      is_voided boolean not null default false, warehouse_from_id uuid,
      warehouse_to_id uuid, gross_weight_kg numeric, tare_weight_kg numeric,
      net_weight_kg numeric, weigh_method text default 'double_weighing',
      harvest_lot_id uuid, processing_allocation_ready boolean not null default false,
      correction_of_ticket_id uuid, correction_reason text, replacement_ticket_id uuid,
      correction_completed_at timestamptz, finalized_by_person_id uuid,
      created_by uuid, source_physical_state text,
      closed_by uuid, finalized_at timestamptz, voided_by uuid, voided_at timestamptz,
      void_reason text, notes text, audit_json jsonb default '{}'::jsonb,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table public.ticket_lines(
      id uuid primary key default gen_random_uuid(), ticket_id uuid not null,
      company_id uuid not null, product_id uuid not null, crop_id uuid,
      variety_id uuid, reproduction_id uuid, batch_id text, batch_class text,
      destination_batch_id uuid, lot_id text, warehouse_from_id uuid, warehouse_to_id uuid,
      gross_line_weight_kg numeric, tare_line_weight_kg numeric,
      quantity numeric, quantity_kg numeric, mass_kg numeric,
      net_line_weight_kg numeric, uom text default 'kg', composition_snapshot jsonb,
      composition_hash text, unit_source text, unit_contract_version smallint,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create table public.inventory_batches(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      season_id uuid, product_id uuid, crop_id uuid, variety_id uuid,
      reproduction_id uuid, source_field_id uuid, source_ticket_id uuid,
      harvest_year integer, batch_code text not null, status text not null default 'commodity',
      initial_weight_kg numeric, current_weight_kg numeric, moisture_percent numeric,
      purity_percent numeric, dockage_percent numeric, germination_percent numeric,
      energy_percent numeric, quality_json jsonb, batch_class text not null default 'commodity',
      parent_batch_id uuid, origin_type text, origin_ref_id uuid, treatment_status text,
      initial_quantity numeric, current_quantity numeric, uom text, mass_kg numeric,
      density_kg_per_l numeric, density_unit text, density_source text,
      density_verification_status text, density_verified_at timestamptz,
      unit_source text, unit_contract_version smallint, crop_structure_id uuid,
      harvesting_operation_id uuid, warehouse_id uuid, received_at timestamptz,
      source_type text, composition_snapshot jsonb not null default '[]'::jsonb,
      composition_hash text, display_name text, is_mixed_harvest boolean not null default false,
      planting_operation_id uuid, physical_state text not null default 'SOURCE',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique(company_id,batch_code)
    );
    create table public.harvest_lot_batches(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      harvest_lot_id uuid not null, inventory_batch_id uuid not null unique,
      source_ticket_id uuid, crop_structure_id uuid, assigned_by uuid,
      assignment_reason text, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table public.harvest_lots(
      id uuid primary key, company_id uuid not null, lot_code text,
      season_id uuid, source_field_id uuid, crop_id uuid, variety_id uuid,
      reproduction_id uuid, composition_hash text, identity_kind text,
      identity_key text, review_state text, review_reasons text[],
      resolution_locked boolean default false, status text default 'active',
      merged_into_lot_id uuid, created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      ticket_id uuid, processing_id uuid, product_id uuid not null,
      warehouse_id uuid not null, direction public.ledger_direction not null,
      quantity numeric not null, uom text not null default 'kg',
      delta_qty_signed numeric not null, reason_type text not null, reason_ref_id uuid,
      batch_id text, occurred_at timestamptz default now(), created_by uuid,
      is_storno boolean default false, storno_of_entry_id uuid, notes text,
      variety_id uuid, reproduction_id uuid, batch_id_text text, batch_class text,
      operation_line_id uuid, mass_kg numeric, density_kg_per_l numeric,
      density_unit text, density_source text, density_verification_status text,
      density_verified_at timestamptz, unit_source text, unit_contract_version smallint,
      warehouse_issue_allocation_id uuid, crop_id uuid, inventory_batch_id uuid,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table public.audit_log(
      id uuid primary key default gen_random_uuid(), company_id uuid, who uuid,
      entity_type text, entity_id text, action text, old_values jsonb,
      new_values jsonb, reason text
    );

    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create or replace function public.canonical_stock_uom(value text)
      returns text language sql immutable as $$ select lower(value) $$;
    create or replace function public.backfill_ticket_operation_line_links_v1(uuid)
      returns void language sql as $$ select $$;
    create or replace function public.finalize_weighbridge_ticket_v2(uuid, uuid)
      returns uuid language plpgsql as $$ begin raise exception 'generic transfer finalizer called'; end $$;
    create or replace function public.prepare_grain_lot_ticket_allocations_v1(p_ticket_id uuid)
      returns void language plpgsql as $$
      declare v_ticket public.tickets%rowtype; v_line public.ticket_lines%rowtype;
        v_lot public.harvest_lots%rowtype;
      begin
        select * into v_ticket from public.tickets where id=p_ticket_id;
        select * into v_line from public.ticket_lines where ticket_id=p_ticket_id limit 1;
        select * into v_lot from public.harvest_lots where id=v_ticket.harvest_lot_id;
        if v_line.crop_id is distinct from v_lot.crop_id
           or v_line.variety_id is distinct from v_lot.variety_id
           or v_line.reproduction_id is distinct from v_lot.reproduction_id
           or coalesce(v_line.composition_hash,'') <> coalesce(v_lot.composition_hash,'') then
          raise exception 'Ticket identity does not match aggregate harvest lot';
        end if;
        update public.ticket_lines
        set batch_id='${SOURCE_BATCH}', quantity=v_ticket.net_weight_kg,
            quantity_kg=v_ticket.net_weight_kg, mass_kg=v_ticket.net_weight_kg,
            net_line_weight_kg=v_ticket.net_weight_kg
        where ticket_id=p_ticket_id;
        update public.tickets set processing_allocation_ready=true where id=p_ticket_id;
      end $$;
    create or replace function private.assert_weighbridge_ticket_correction_actor_v1(uuid,uuid,uuid)
      returns public.profiles language plpgsql security definer as $$
      declare v_actor public.profiles%rowtype;
      begin select * into v_actor from public.profiles where id=auth.uid(); return v_actor; end $$;
    create or replace function private.weighbridge_ticket_has_downstream_dependencies_v1(uuid)
      returns boolean language sql as $$ select false $$;

    insert into public.profiles values('${ACTOR}','${COMPANY}','global_admin','active');
    insert into public.harvest_lots(id,company_id,lot_code,crop_id,status)
    values('${LOT}','${COMPANY}','HL-CORRECTION','${CROP}','active');
    insert into public.tickets(
      id,company_id,ticket_no,direction,op_type,status,is_finalized,
      warehouse_from_id,warehouse_to_id,gross_weight_kg,tare_weight_kg,net_weight_kg
    ) values(
      '${ORIGINAL}','${COMPANY}','WB-8A0F2C-20260820231427-J16X','transfer',
      'transfer_between_warehouses','finalized',true,'${SOURCE_WAREHOUSE}',
      '${DESTINATION_WAREHOUSE}',15950,8900,7050
    ),(
      '${CORRECTION}','${COMPANY}','WB-8A0F2C-20260820231427-J16X-RC6B13E','transfer',
      'transfer_between_warehouses','ready_to_close',false,'${SOURCE_WAREHOUSE}',
      '${DESTINATION_WAREHOUSE}',24500,8900,15600
    );
    update public.tickets set correction_of_ticket_id='${ORIGINAL}', correction_reason='брутто'
    where id='${CORRECTION}';
    insert into public.ticket_lines(ticket_id,company_id,product_id,crop_id,batch_id,batch_class,quantity,quantity_kg,mass_kg,net_line_weight_kg,warehouse_from_id,warehouse_to_id)
    values('${ORIGINAL}','${COMPANY}','${PRODUCT}',null,'${SOURCE_BATCH}','commodity',7050,null,7050,7050,'${SOURCE_WAREHOUSE}','${DESTINATION_WAREHOUSE}'),
          ('${CORRECTION}','${COMPANY}','${PRODUCT}',null,null,'commodity',7050,null,7050,7050,'${SOURCE_WAREHOUSE}','${DESTINATION_WAREHOUSE}');
    insert into public.inventory_batches(
      id,company_id,product_id,crop_id,batch_code,batch_class,origin_type,
      initial_weight_kg,current_weight_kg,initial_quantity,current_quantity,
      uom,mass_kg,warehouse_id,unit_contract_version
    ) values('${SOURCE_BATCH}','${COMPANY}','${PRODUCT}','${CROP}',
      'HAR-20260820204212-1b0d70d6','commodity','harvest',16100,16100,16100,16100,
      'kg',16100,'${SOURCE_WAREHOUSE}',2);
    insert into public.harvest_lot_batches(company_id,harvest_lot_id,inventory_batch_id,source_ticket_id)
    values('${COMPANY}','${LOT}','${SOURCE_BATCH}','${ORIGINAL}');
    insert into public.stock_ledger_entries(
      company_id,ticket_id,product_id,crop_id,warehouse_id,direction,quantity,uom,
      delta_qty_signed,reason_type,reason_ref_id,batch_id,batch_id_text,batch_class,
      inventory_batch_id,mass_kg,unit_contract_version
    ) values
      ('${COMPANY}',null,'${PRODUCT}','${CROP}','${SOURCE_WAREHOUSE}','in',16100,'kg',16100,
       'harvest_incoming_in',null,'${SOURCE_BATCH}','${SOURCE_BATCH}','commodity','${SOURCE_BATCH}',16100,2),
      ('${COMPANY}','${ORIGINAL}','${PRODUCT}',null,'${SOURCE_WAREHOUSE}','out',7050,'kg',-7050,
       'warehouse_transfer_out','${ORIGINAL}','${SOURCE_BATCH}','${SOURCE_BATCH}','commodity','${SOURCE_BATCH}',7050,2),
      ('${COMPANY}','${ORIGINAL}','${PRODUCT}','${CROP}','${DESTINATION_WAREHOUSE}','in',7050,'kg',7050,
       'warehouse_transfer_in','${ORIGINAL}','${SOURCE_BATCH}','${SOURCE_BATCH}','commodity','${SOURCE_BATCH}',7050,2);
    select set_config('app.uid','${ACTOR}',false);
  `);

  await db.exec(migration);
  await db.exec("set check_function_bodies = false");
  await db.exec(identityMigration);
  await db.exec("set check_function_bodies = true");

  const repaired = (await rows(db, `
    select t.harvest_lot_id,
      (select inventory_batch_id from public.stock_ledger_entries
       where ticket_id=t.id and direction='in' and not is_storno) destination_batch_id
    from public.tickets t where t.id='${ORIGINAL}'
  `))[0];
  assert.equal(repaired.harvest_lot_id, LOT);
  assert.notEqual(repaired.destination_batch_id, SOURCE_BATCH);
  const destinationBatch = String(repaired.destination_batch_id);
  const repairedTrace = (await rows(db, `
    select ib.parent_batch_id,ib.warehouse_id,ib.current_quantity,hlb.harvest_lot_id
    from public.inventory_batches ib
    join public.harvest_lot_batches hlb on hlb.inventory_batch_id=ib.id
    where ib.id='${destinationBatch}'
  `))[0];
  assert.equal(repairedTrace.parent_batch_id, SOURCE_BATCH);
  assert.equal(repairedTrace.warehouse_id, DESTINATION_WAREHOUSE);
  assert.equal(Number(repairedTrace.current_quantity), 7050);
  assert.equal(repairedTrace.harvest_lot_id, LOT);

  const preview = (await rows(db, `
    select tl.quantity,tl.quantity_kg,tl.mass_kg,tl.net_line_weight_kg,
      tl.crop_id,tl.batch_id,tl.destination_batch_id,t.harvest_lot_id
    from public.ticket_lines tl join public.tickets t on t.id=tl.ticket_id
    where tl.ticket_id='${CORRECTION}'
  `))[0];
  assert.equal(Number(preview.quantity), 15600);
  assert.equal(Number(preview.quantity_kg), 15600);
  assert.equal(Number(preview.mass_kg), 15600);
  assert.equal(Number(preview.net_line_weight_kg), 15600);
  assert.equal(preview.crop_id, CROP);
  assert.equal(preview.batch_id, SOURCE_BATCH);
  assert.equal(preview.destination_batch_id, destinationBatch);
  assert.equal(preview.harvest_lot_id, LOT);

  await db.exec(`
    create or replace function public.reject_replacement_transfer_once()
      returns trigger language plpgsql as $$
      begin
        if new.ticket_id='${CORRECTION}' and new.reason_type='warehouse_transfer_in' then
          raise exception 'forced replacement failure';
        end if;
        return new;
      end $$;
    create trigger reject_replacement_transfer_once before insert on public.stock_ledger_entries
      for each row execute function public.reject_replacement_transfer_once();
  `);
  await assert.rejects(
    () => rows(db, `select public.finalize_weighbridge_ticket_correction_v1('${CORRECTION}','${PERSON}','${SHIFT}')`),
    /forced replacement failure/,
  );
  const rollback = (await rows(db, `
    select
      (select status from public.tickets where id='${ORIGINAL}') original_status,
      (select status from public.tickets where id='${CORRECTION}') correction_status,
      (select count(*) from public.stock_ledger_entries where is_storno) storno_count,
      (select count(*) from public.stock_ledger_entries where ticket_id='${CORRECTION}') replacement_count,
      (select quantity from public.ticket_lines where ticket_id='${CORRECTION}') correction_line_quantity
  `))[0];
  assert.equal(rollback.original_status, "finalized");
  assert.equal(rollback.correction_status, "ready_to_close");
  assert.equal(Number(rollback.storno_count), 0);
  assert.equal(Number(rollback.replacement_count), 0);
  assert.equal(Number(rollback.correction_line_quantity), 15600);

  await db.exec(`drop trigger reject_replacement_transfer_once on public.stock_ledger_entries`);
  await rows(db, `select public.finalize_weighbridge_ticket_correction_v1('${CORRECTION}','${PERSON}','${SHIFT}')`);
  await rows(db, `select public.finalize_weighbridge_ticket_correction_v1('${CORRECTION}','${PERSON}','${SHIFT}')`);

  const final = (await rows(db, `
    select
      (select status from public.tickets where id='${ORIGINAL}') original_status,
      (select replacement_ticket_id from public.tickets where id='${ORIGINAL}') replacement_ticket_id,
      (select status from public.tickets where id='${CORRECTION}') replacement_status,
      (select count(*) from public.stock_ledger_entries where is_storno) storno_count,
      (select count(*) from public.stock_ledger_entries where ticket_id='${CORRECTION}' and not is_storno) replacement_count,
      (select sum(delta_qty_signed) from public.stock_ledger_entries where ticket_id in ('${ORIGINAL}','${CORRECTION}')) company_delta,
      (select current_quantity from public.inventory_batches where id='${SOURCE_BATCH}') source_balance,
      (select current_quantity from public.inventory_batches where id='${destinationBatch}') destination_balance,
      (select quantity from public.ticket_lines where ticket_id='${CORRECTION}') correction_line_quantity,
      (select count(distinct hlb.harvest_lot_id) from public.stock_ledger_entries sle
       join public.harvest_lot_batches hlb on hlb.inventory_batch_id=sle.inventory_batch_id
       where sle.ticket_id in ('${ORIGINAL}','${CORRECTION}')) aggregate_lot_count,
      (select count(*) from public.stock_ledger_entries sle join public.inventory_batches ib on ib.id=sle.inventory_batch_id
       where sle.ticket_id in ('${ORIGINAL}','${CORRECTION}') and sle.warehouse_id<>ib.warehouse_id) trace_mismatches
  `))[0];
  assert.equal(final.original_status, "voided");
  assert.equal(final.replacement_ticket_id, CORRECTION);
  assert.equal(final.replacement_status, "finalized");
  assert.equal(Number(final.storno_count), 2);
  assert.equal(Number(final.replacement_count), 2);
  assert.equal(Number(final.company_delta), 0);
  assert.equal(Number(final.source_balance), 500);
  assert.equal(Number(final.destination_balance), 15600);
  assert.equal(Number(final.correction_line_quantity), 15600);
  assert.equal(Number(final.aggregate_lot_count), 1);
  assert.equal(Number(final.trace_mismatches), 0);

  console.log("TZ294 transfer correction regression: PASS");
  console.log(`source_batch=${SOURCE_BATCH}`);
  console.log(`destination_batch=${destinationBatch}`);
  console.log(`aggregate_lot=${LOT}`);
  console.log("old_effect=0 replacement_out=-15600 replacement_in=15600 company_delta=0");
  console.log("rollback=PASS retry=PASS double_click=PASS ui_grouping=PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
