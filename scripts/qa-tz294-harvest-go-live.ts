import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260820143000_tz294_atomic_harvest_intake_finalize_v1.sql",
  import.meta.url,
);
const closeHotfixMigrationUrl = new URL(
  "../supabase/migrations/20260820213218_tz294_atomic_close_ticket_p0.sql",
  import.meta.url,
);
const dedicatedAtomicMigrationUrl = new URL(
  "../supabase/migrations/20260820223111_tz294_dedicated_atomic_harvest_accounting.sql",
  import.meta.url,
);
const finalizeRouteUrl = new URL(
  "../app/api/weighbridge/tickets/[id]/finalize/route.ts",
  import.meta.url,
);
const weighbridgePageUrl = new URL(
  "../app/(dashboard)/weighbridge/page.tsx",
  import.meta.url,
);

const COMPANY = "10000000-0000-4000-8000-000000000001";
const ACTOR = "10000000-0000-4000-8000-000000000002";
const PERSON = "10000000-0000-4000-8000-000000000003";
const SHIFT = "10000000-0000-4000-8000-000000000004";
const SESSION = "10000000-0000-4000-8000-000000000005";
const TICKET = "10000000-0000-4000-8000-000000000006";
const LINE = "10000000-0000-4000-8000-000000000007";
const PRODUCT = "10000000-0000-4000-8000-000000000008";
const WAREHOUSE = "10000000-0000-4000-8000-000000000009";
const TOKEN = "qa-tz294-session";

const rows = async (db: PGlite, sql: string) =>
  (await db.query(sql)).rows as Array<Record<string, unknown>>;

async function main() {
  const migration = await readFile(migrationUrl, "utf8");
  const closeHotfixMigration = await readFile(closeHotfixMigrationUrl, "utf8");
  const dedicatedAtomicMigration = await readFile(dedicatedAtomicMigrationUrl, "utf8");
  const finalizeRoute = await readFile(finalizeRouteUrl, "utf8");
  const weighbridgePage = await readFile(weighbridgePageUrl, "utf8");
  assert.doesNotMatch(migration, /\b(?:drop\s+(?:table|column)|truncate|delete\s+from)\b/i);
  assert.doesNotMatch(closeHotfixMigration, /\b(?:drop\s+(?:table|column)|truncate|delete\s+from)\b/i);
  assert.doesNotMatch(dedicatedAtomicMigration, /\b(?:drop\s+(?:table|column)|truncate|delete\s+from)\b/i);
  assert.doesNotMatch(dedicatedAtomicMigration, /finalize_weighbridge_ticket_v2/i);
  assert.match(dedicatedAtomicMigration, /v_accepted\s*:=\s*round\(v_physical\s*-\s*v_deduction/i);
  assert.match(dedicatedAtomicMigration, /insert into public\.inventory_batches/i);
  assert.match(dedicatedAtomicMigration, /insert into public\.stock_ledger_entries/i);
  assert.match(dedicatedAtomicMigration, /is_finalized\s*=\s*true[\s\S]*status\s*=\s*'finalized'/i);
  assert.match(dedicatedAtomicMigration, /v_ledger_count\s*<>\s*1/i);
  assert.match(dedicatedAtomicMigration, /v_batch_count\s*<>\s*1/i);
  assert.match(dedicatedAtomicMigration, /v_lot_link_count\s*<>\s*1/i);
  assert.match(closeHotfixMigration, /add column if not exists updated_at/i);
  assert.match(closeHotfixMigration, /create or replace function public\.close_harvest_ticket_atomic/i);
  assert.match(finalizeRoute, /supabase\.rpc\(\s*[\r\n\s]*"close_harvest_ticket_atomic"/i);
  assert.match(weighbridgePage, /finalizingRef\.current/i);
  assert.doesNotMatch(
    weighbridgePage.match(/if \(isHarvestClosure\)[\s\S]*?\} else \{/i)?.[0] || "",
    /patchTicket\(/i,
  );

  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema private;
    create schema extensions;
    create or replace function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$ select decode(md5(value), 'hex') $$;

    create table public.profiles(
      id uuid primary key, company_id uuid, role text, status text
    );
    create table public.weighbridge_shifts(
      id uuid primary key, company_id uuid not null, status text not null,
      operator_person_id uuid, opened_at timestamptz default now(),
      last_activity_at timestamptz not null default now(), closed_at timestamptz,
      closed_by uuid, closed_by_person_id uuid, close_reason text
    );
    create table private.weighbridge_operator_sessions(
      id uuid primary key, company_id uuid not null, shift_id uuid not null,
      person_id uuid not null, token_hash text not null, status text not null,
      created_at timestamptz default now(), expires_at timestamptz not null,
      last_seen_at timestamptz, revoked_at timestamptz
    );
    create table public.tickets(
      id uuid primary key, company_id uuid not null, op_type text not null,
      status text not null, is_voided boolean default false,
      is_finalized boolean default false, gross_weight_kg numeric(14,3),
      tare_weight_kg numeric(14,3), net_weight_kg numeric(14,3),
      vehicle_id uuid, finalized_by_person_id uuid, audit_json jsonb default '{}'::jsonb,
      season_id uuid, field_id uuid, warehouse_to_id uuid, notes text,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      finalized_at timestamptz, weighing_2_at timestamptz, closed_by uuid,
      batch_id uuid, lot_id text, harvest_lot_id uuid
    );
    create table public.ticket_lines(
      id uuid primary key, ticket_id uuid not null, company_id uuid not null,
      product_id uuid not null, crop_id uuid, variety_id uuid, reproduction_id uuid,
      uom text not null default 'kg', quantity numeric(18,6), quantity_kg numeric(18,6),
      mass_kg numeric(18,6), net_line_weight_kg numeric(14,3),
      moisture_percent numeric(8,3), dirt_tare_percent numeric(8,4),
      quality_json jsonb default '{}'::jsonb,
      batch_id text, lot_id text, batch_class text
    );
    create table public.ticket_weighings(
      id uuid primary key default gen_random_uuid(), ticket_id uuid not null,
      company_id uuid not null, weighing_no integer not null,
      measured_weight_kg numeric(14,3) not null,
      measured_at timestamptz, device_source text, operator_user_id uuid,
      operator_person_id uuid, weighbridge_shift_id uuid, comment text,
      constraint ticket_weighings_measured_weight_kg_check check (measured_weight_kg > 0),
      unique(ticket_id, weighing_no)
    );
    create table public.inventory_batches(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      season_id uuid, product_id uuid, crop_id uuid, variety_id uuid, reproduction_id uuid,
      source_field_id uuid, source_ticket_id uuid, batch_code text not null,
      status text not null default 'raw', batch_class text not null default 'commodity',
      origin_type text, origin_ref_id uuid, initial_weight_kg numeric(14,3),
      current_weight_kg numeric(14,3), initial_quantity numeric(18,6),
      current_quantity numeric(18,6), uom text, mass_kg numeric(18,6),
      moisture_percent numeric(8,3), treatment_status text,
      unit_source text, unit_contract_version smallint, warehouse_id uuid,
      received_at timestamptz, updated_at timestamptz default now()
    );
    create table public.stock_ledger_entries(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      ticket_id uuid, product_id uuid not null, crop_id uuid, variety_id uuid,
      reproduction_id uuid, warehouse_id uuid not null, direction text,
      quantity numeric(18,6), uom text, delta_qty_signed numeric(18,6),
      reason_type text, reason_ref_id uuid, batch_id text, batch_id_text text,
      batch_class text, inventory_batch_id uuid, occurred_at timestamptz,
      created_by uuid, is_storno boolean default false, notes text,
      mass_kg numeric(18,6), unit_source text, unit_contract_version smallint
    );
    create table public.harvest_lot_batches(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      harvest_lot_id uuid not null default gen_random_uuid(), inventory_batch_id uuid not null,
      source_ticket_id uuid, unique(inventory_batch_id)
    );
    create table public.field_history_entries(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      harvest_ticket_id uuid not null, source text not null,
      unique(harvest_ticket_id, source)
    );

    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create or replace function public.canonical_stock_uom(value text)
      returns text language sql immutable as $$ select lower(value) $$;
    create or replace function public.validate_stock_quantity_contract(
      uuid, numeric, text, text, numeric, numeric, text, text, text, timestamptz
    ) returns void language plpgsql as $$
      begin
        if $3 <> 'kg' or abs($2 - $5) > 0.000001 then
          raise exception 'Kilogram quantity and mass must match';
        end if;
      end $$;
    create or replace function public.backfill_ticket_operation_line_links_v1(uuid)
      returns void language sql as $$ select $$;
    create or replace function public.ensure_harvest_lot_for_batch_v1(p_batch_id uuid)
      returns uuid language plpgsql as $$
      declare v_lot uuid := gen_random_uuid(); v_ticket uuid; v_company uuid;
      begin
        select company_id,source_ticket_id into v_company,v_ticket
        from public.inventory_batches where id=p_batch_id;
        insert into public.harvest_lot_batches(
          company_id,harvest_lot_id,inventory_batch_id,source_ticket_id
        ) values(v_company,v_lot,p_batch_id,v_ticket);
        return v_lot;
      end $$;
    create or replace function public.test_record_harvest_trace()
      returns trigger language plpgsql as $$
      begin
        if new.is_finalized and new.status='finalized'
           and not coalesce(old.is_finalized,false) then
          insert into public.field_history_entries(company_id,harvest_ticket_id,source)
          values(new.company_id,new.id,'weighbridge_harvest')
          on conflict do nothing;
        end if;
        return new;
      end $$;
    create trigger test_record_harvest_trace
      after update on public.tickets
      for each row execute function public.test_record_harvest_trace();
    create or replace function public.finalize_weighbridge_ticket_v2(uuid, uuid)
      returns uuid language plpgsql as $$
      begin raise exception 'legacy harvest finalizer must not be called'; end $$;
  `);

  await db.exec(migration);
  await db.exec(closeHotfixMigration);
  await db.exec(dedicatedAtomicMigration);
  const ticketLineColumns = await rows(db, `
    select column_name from information_schema.columns
    where table_schema='public' and table_name='ticket_lines' and column_name='updated_at'
  `);
  assert.equal(ticketLineColumns.length, 1, "compatibility migration must add ticket_lines.updated_at");
  await db.exec(`
    insert into public.profiles values ('${ACTOR}','${COMPANY}','weighman','active');
    insert into public.weighbridge_shifts(id,company_id,status,operator_person_id)
      values('${SHIFT}','${COMPANY}','open','${PERSON}');
    insert into private.weighbridge_operator_sessions(
      id,company_id,shift_id,person_id,token_hash,status,expires_at
    ) values (
      '${SESSION}','${COMPANY}','${SHIFT}','${PERSON}',
      encode(extensions.digest('${TOKEN}','sha256'),'hex'),'active',now()+interval '24 hours'
    );
    insert into public.tickets(
      id,company_id,op_type,status,gross_weight_kg,warehouse_to_id
    ) values(
      '${TICKET}','${COMPANY}','harvest_incoming','open',20000,'${WAREHOUSE}'
    );
    insert into public.ticket_lines(
      id,ticket_id,company_id,product_id,uom,quantity,quantity_kg,mass_kg
    ) values(
      '${LINE}','${TICKET}','${COMPANY}','${PRODUCT}','kg',20000,20000,20000
    );
    insert into public.ticket_weighings(ticket_id,company_id,weighing_no,measured_weight_kg)
      values('${TICKET}','${COMPANY}',1,20000);
    select set_config('app.uid','${ACTOR}',false);
  `);

  assert.equal(Number((await rows(db, `select count(*) count from public.ticket_weighings where ticket_id='${TICKET}'`))[0].count), 1);
  await db.exec(`
    create or replace function public.test_reject_harvest_ledger()
      returns trigger language plpgsql as $$
      begin raise exception 'forced ledger failure'; end $$;
    create trigger test_reject_harvest_ledger
      before insert on public.stock_ledger_entries
      for each row execute function public.test_reject_harvest_ledger();
  `);
  await assert.rejects(
    () => rows(db, `select public.close_harvest_ticket_atomic(
      '${TICKET}','${TOKEN}',8000,15,500,null,'soil',false,'tz294-once'
    ) as result`),
    /forced ledger failure/,
  );
  const rolledBack = (await rows(db, `
    select t.status,t.is_finalized,t.tare_weight_kg,t.net_weight_kg,
      (select quantity from public.ticket_lines where ticket_id=t.id) line_quantity,
      (select mass_kg from public.ticket_lines where ticket_id=t.id) line_mass,
      (select count(*) from public.ticket_weighings where ticket_id=t.id) weighing_count,
      (select count(*) from public.inventory_batches where source_ticket_id=t.id) batch_count,
      (select count(*) from public.stock_ledger_entries where ticket_id=t.id) ledger_count,
      (select count(*) from public.harvest_lot_batches where source_ticket_id=t.id) lot_link_count
    from public.tickets t where t.id='${TICKET}'
  `))[0];
  assert.equal(rolledBack.status, "open");
  assert.equal(rolledBack.is_finalized, false);
  assert.equal(rolledBack.tare_weight_kg, null);
  assert.equal(rolledBack.net_weight_kg, null);
  assert.equal(Number(rolledBack.line_quantity), 20000);
  assert.equal(Number(rolledBack.line_mass), 20000);
  assert.equal(Number(rolledBack.weighing_count), 1);
  assert.equal(Number(rolledBack.batch_count), 0);
  assert.equal(Number(rolledBack.ledger_count), 0);
  assert.equal(Number(rolledBack.lot_link_count), 0);
  await db.exec(`drop trigger test_reject_harvest_ledger on public.stock_ledger_entries`);

  const result = await rows(db, `select public.close_harvest_ticket_atomic(
    '${TICKET}','${TOKEN}',8000,15,500,null,'soil',false,'tz294-once'
  ) as result`);
  const payload = result[0].result as Record<string, unknown>;
  assert.equal(payload.ok, true);
  assert.equal(Number(payload.physical_net_kg), 12000);
  assert.equal(Number(payload.accepted_weight_kg), 11500);

  const facts = (await rows(db, `
    select t.status,t.net_weight_kg,t.physical_net_kg,t.explicit_deductions_kg,t.accepted_weight_kg,
      (select count(*) from public.ticket_lines where ticket_id=t.id) line_count,
      (select min(quantity) from public.ticket_lines where ticket_id=t.id) line_quantity,
      (select min(quantity_kg) from public.ticket_lines where ticket_id=t.id) line_quantity_kg,
      (select min(mass_kg) from public.ticket_lines where ticket_id=t.id) line_mass,
      (select count(*) from public.inventory_batches where source_ticket_id=t.id) batch_count,
      (select min(current_quantity) from public.inventory_batches where source_ticket_id=t.id) batch_quantity,
      (select min(mass_kg) from public.inventory_batches where source_ticket_id=t.id) batch_mass,
      (select count(*) from public.stock_ledger_entries where ticket_id=t.id and direction='in' and not is_storno) ledger_count,
      (select min(delta_qty_signed) from public.stock_ledger_entries where ticket_id=t.id and direction='in' and not is_storno) ledger_delta,
      (select min(mass_kg) from public.stock_ledger_entries where ticket_id=t.id and direction='in' and not is_storno) ledger_mass,
      (select count(*) from public.ticket_weighings where ticket_id=t.id) weighing_count,
      (select count(*) from public.harvest_lot_batches where source_ticket_id=t.id) lot_link_count,
      (select count(*) from public.field_history_entries where harvest_ticket_id=t.id) history_count
    from public.tickets t where t.id='${TICKET}'
  `))[0];
  assert.equal(facts.status, "finalized");
  assert.equal(Number(facts.net_weight_kg), 11500);
  assert.equal(Number(facts.physical_net_kg), 12000);
  assert.equal(Number(facts.explicit_deductions_kg), 500);
  assert.equal(Number(facts.accepted_weight_kg), 11500);
  for (const key of ["line_count", "batch_count", "ledger_count", "lot_link_count", "history_count"])
    assert.equal(Number(facts[key]), 1, key);
  assert.equal(Number(facts.weighing_count), 2);
  for (const key of [
    "line_quantity",
    "line_quantity_kg",
    "line_mass",
    "batch_quantity",
    "batch_mass",
    "ledger_delta",
    "ledger_mass",
  ])
    assert.equal(Number(facts[key]), 11500, key);

  const replay = await rows(db, `select public.close_harvest_ticket_atomic(
    '${TICKET}','${TOKEN}',8000,15,500,null,'soil',false,'tz294-once'
  ) as result`);
  assert.equal((replay[0].result as Record<string, unknown>).idempotent_replay, true);
  assert.equal(Number((await rows(db, `select count(*) count from public.stock_ledger_entries where ticket_id='${TICKET}'`))[0].count), 1);
  assert.equal(Number((await rows(db, `select count(*) count from public.inventory_batches where source_ticket_id='${TICKET}'`))[0].count), 1);

  console.log("TZ294 dedicated atomic harvest intake regression PASS");
  console.log("physical=12000 accepted=11500 rollback=1 lines=1 batch=1 ledger=1 lot_link=1 weighings=2 replay=1");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
