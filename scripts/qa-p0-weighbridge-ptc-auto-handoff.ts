import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { resolveUniqueLoadedPtcTripByDriver } from "../lib/weighbridge/ptc-driver-trip";

type Row = Record<string, unknown>;
const migrationPaths = [
  "supabase/migrations/20260917161613_p0_weighbridge_ptc_auto_handoff_v1.sql",
  "supabase/migrations/20260918095931_p0_weighbridge_ptc_driver_fallback_v2.sql",
].map((path) => resolve(process.cwd(), path));
const ids = {
  company: "10000000-0000-0000-0000-000000000001",
  actor: "10000000-0000-0000-0000-000000000002",
  field: "10000000-0000-0000-0000-000000000003",
  plot: "10000000-0000-0000-0000-000000000004",
  driver: "10000000-0000-0000-0000-000000000005",
  driverB: "10000000-0000-0000-0000-000000000006",
  driverC: "10000000-0000-0000-0000-000000000007",
  driverFallback: "10000000-0000-0000-0000-000000000008",
  driverAmbiguous: "10000000-0000-0000-0000-000000000009",
  vehicleA: "20000000-0000-0000-0000-000000000001",
  vehicleB: "20000000-0000-0000-0000-000000000002",
  vehicleC: "20000000-0000-0000-0000-000000000003",
  vehicleD: "20000000-0000-0000-0000-000000000004",
  vehicleAlias: "20000000-0000-0000-0000-000000000005",
  vehicleE: "20000000-0000-0000-0000-000000000006",
  vehicleF: "20000000-0000-0000-0000-000000000007",
  vehicleG: "20000000-0000-0000-0000-000000000008",
  loadedA: "30000000-0000-0000-0000-000000000001",
  loadedB: "30000000-0000-0000-0000-000000000002",
  loadedC: "30000000-0000-0000-0000-000000000003",
  loadedE: "30000000-0000-0000-0000-000000000004",
  loadedF: "30000000-0000-0000-0000-000000000005",
  loadedG: "30000000-0000-0000-0000-000000000006",
  keyA: "40000000-0000-0000-0000-000000000001",
  keyB: "40000000-0000-0000-0000-000000000002",
  keyC: "40000000-0000-0000-0000-000000000003",
  keyE: "40000000-0000-0000-0000-000000000004",
  keyF: "40000000-0000-0000-0000-000000000005",
  keyG: "40000000-0000-0000-0000-000000000006",
  ticketA: "50000000-0000-0000-0000-000000000001",
  ticketB: "50000000-0000-0000-0000-000000000002",
  ticketC: "50000000-0000-0000-0000-000000000003",
  ticketD: "50000000-0000-0000-0000-000000000004",
  ticketE: "50000000-0000-0000-0000-000000000005",
  ticketF: "50000000-0000-0000-0000-000000000006",
};

const rows = async (db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as Row[];
const scalar = async <T>(db: PGlite, sql: string, params: unknown[] = []) =>
  Object.values((await rows(db, sql, params))[0] ?? {})[0] as T;

async function bootstrap(db: PGlite) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema private;
    create table public.ptc_vehicle_states (
      company_id uuid not null,
      vehicle_id uuid not null,
      assigned boolean not null default true,
      state text not null check (state in ('empty','loaded','unloading')),
      version integer not null default 0,
      cycle integer not null default 0,
      since timestamptz not null default now(),
      primary key(company_id, vehicle_id)
    );
    create table public.ptc_events (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      vehicle_id uuid not null,
      actor_user_id uuid,
      actor_name text not null,
      field_id uuid,
      crop_structure_id uuid,
      driver_id uuid,
      idempotency_key uuid not null,
      expected_version integer not null,
      from_state text not null,
      to_state text not null,
      cycle integer not null,
      created_at timestamptz not null default now(),
      unique(company_id, idempotency_key)
    );
    create table public.tickets (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null,
      ticket_no text,
      op_type text not null,
      vehicle_id uuid,
      correction_of_ticket_id uuid,
      weigh_method text,
      ptc_event_id uuid,
      ptc_cycle integer,
      created_by uuid,
      responsible_user_id uuid,
      field_id uuid,
      crop_structure_allocation_id uuid,
      driver_id uuid,
      is_voided boolean not null default false,
      is_finalized boolean not null default false,
      status text not null default 'active',
      voided_by uuid,
      closed_by uuid,
      created_at timestamptz not null default now()
    );
  `);
  for (const migrationPath of migrationPaths) {
    await db.exec(readFileSync(migrationPath, "utf8"));
  }
  await db.exec(`
    insert into public.ptc_vehicle_states(company_id,vehicle_id,state,version,cycle)
    values
      ('${ids.company}','${ids.vehicleA}','loaded',7,3),
      ('${ids.company}','${ids.vehicleB}','loaded',4,9),
      ('${ids.company}','${ids.vehicleC}','loaded',2,5),
      ('${ids.company}','${ids.vehicleD}','empty',8,2),
      ('${ids.company}','${ids.vehicleE}','loaded',5,4),
      ('${ids.company}','${ids.vehicleF}','loaded',6,7),
      ('${ids.company}','${ids.vehicleG}','loaded',9,8);
    insert into public.ptc_events(
      id,company_id,vehicle_id,actor_user_id,actor_name,field_id,crop_structure_id,driver_id,
      idempotency_key,expected_version,from_state,to_state,cycle
    ) values
      ('${ids.loadedA}','${ids.company}','${ids.vehicleA}','${ids.actor}','Комбайнёр','${ids.field}','${ids.plot}','${ids.driver}','${ids.keyA}',6,'empty','loaded',3),
      ('${ids.loadedB}','${ids.company}','${ids.vehicleB}','${ids.actor}','Комбайнёр','${ids.field}','${ids.plot}','${ids.driverB}','${ids.keyB}',3,'empty','loaded',9),
      ('${ids.loadedC}','${ids.company}','${ids.vehicleC}','${ids.actor}','Комбайнёр','${ids.field}','${ids.plot}','${ids.driverC}','${ids.keyC}',1,'empty','loaded',5),
      ('${ids.loadedE}','${ids.company}','${ids.vehicleE}','${ids.actor}','Комбайнёр','${ids.field}','${ids.plot}','${ids.driverFallback}','${ids.keyE}',4,'empty','loaded',4),
      ('${ids.loadedF}','${ids.company}','${ids.vehicleF}','${ids.actor}','Комбайнёр','${ids.field}','${ids.plot}','${ids.driverAmbiguous}','${ids.keyF}',5,'empty','loaded',7),
      ('${ids.loadedG}','${ids.company}','${ids.vehicleG}','${ids.actor}','Комбайнёр','${ids.field}','${ids.plot}','${ids.driverAmbiguous}','${ids.keyG}',8,'empty','loaded',8);
  `);
}

async function main() {
  const db = new PGlite();
  await bootstrap(db);
  let passed = 0;
  const check = async (name: string, action: () => Promise<void>) => {
    await action();
    passed += 1;
    console.log(`PASS ${passed} ${name}`);
  };

  await check("ticket create atomically moves a loaded PTC vehicle to unloading", async () => {
    await db.query(`insert into public.tickets(
      id,company_id,ticket_no,op_type,vehicle_id,created_by,field_id,crop_structure_allocation_id,driver_id
    ) values($1,$2,'WB-A','harvest_incoming',$3,$4,$5,$6,$7)`, [
      ids.ticketA, ids.company, ids.vehicleA, ids.actor, ids.field, ids.plot, ids.driver,
    ]);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleA]), "unloading");
    const ticket = (await rows(db, "select ptc_event_id,ptc_cycle from public.tickets where id=$1", [ids.ticketA]))[0];
    assert.equal(ticket.ptc_event_id, ids.loadedA);
    assert.equal(Number(ticket.ptc_cycle), 3);
    assert.equal(await scalar(db, "select count(*)::int from public.ptc_events where vehicle_id=$1 and to_state='unloading'", [ids.vehicleA]), 1);
  });

  await check("tare close atomically moves the same vehicle to empty exactly once", async () => {
    await db.query("update public.tickets set is_finalized=true,status='finalized',closed_by=$2 where id=$1", [ids.ticketA, ids.actor]);
    await db.query("update public.tickets set is_finalized=true,status='finalized',closed_by=$2 where id=$1", [ids.ticketA, ids.actor]);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleA]), "empty");
    assert.equal(await scalar(db, "select count(*)::int from public.ptc_events where vehicle_id=$1 and to_state='empty'", [ids.vehicleA]), 1);
  });

  await check("voiding an open ticket returns its vehicle to the loaded queue", async () => {
    await db.query(`insert into public.tickets(
      id,company_id,ticket_no,op_type,vehicle_id,created_by,field_id,crop_structure_allocation_id,driver_id
    ) values($1,$2,'WB-B','harvest_incoming',$3,$4,$5,$6,$7)`, [
      ids.ticketB, ids.company, ids.vehicleB, ids.actor, ids.field, ids.plot, ids.driverB,
    ]);
    await db.query("update public.tickets set is_voided=true,status='voided',voided_by=$2 where id=$1", [ids.ticketB, ids.actor]);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleB]), "loaded");
  });

  await check("paper/manual backfill never changes live PTC state", async () => {
    await db.query(`insert into public.tickets(
      id,company_id,ticket_no,op_type,vehicle_id,created_by,weigh_method
    ) values($1,$2,'WB-C','harvest_incoming',$3,$4,'manual_override_with_reason')`, [
      ids.ticketC, ids.company, ids.vehicleC, ids.actor,
    ]);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleC]), "loaded");
  });

  await check("an empty PTC vehicle is not falsely moved by a manual weighbridge arrival", async () => {
    await db.query(`insert into public.tickets(
      id,company_id,ticket_no,op_type,vehicle_id,created_by
    ) values($1,$2,'WB-D','harvest_incoming',$3,$4)`, [
      ids.ticketD, ids.company, ids.vehicleD, ids.actor,
    ]);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleD]), "empty");
  });

  await check("a duplicated vehicle id falls back to the driver's one unique loaded trip", async () => {
    await db.query(`insert into public.tickets(
      id,company_id,ticket_no,op_type,vehicle_id,created_by,field_id,crop_structure_allocation_id,driver_id
    ) values($1,$2,'WB-E','harvest_incoming',$3,$4,$5,$6,$7)`, [
      ids.ticketE, ids.company, ids.vehicleAlias, ids.actor, ids.field, ids.plot, ids.driverFallback,
    ]);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleE]), "unloading");
    const ticket = (await rows(db, "select vehicle_id,ptc_event_id,ptc_cycle from public.tickets where id=$1", [ids.ticketE]))[0];
    assert.equal(ticket.vehicle_id, ids.vehicleE);
    assert.equal(ticket.ptc_event_id, ids.loadedE);
    assert.equal(Number(ticket.ptc_cycle), 4);
  });

  await check("two loaded trips for one driver remain ambiguous and are never guessed", async () => {
    await db.query(`insert into public.tickets(
      id,company_id,ticket_no,op_type,vehicle_id,created_by,field_id,crop_structure_allocation_id,driver_id
    ) values($1,$2,'WB-F','harvest_incoming',$3,$4,$5,$6,$7)`, [
      ids.ticketF, ids.company, ids.vehicleAlias, ids.actor, ids.field, ids.plot, ids.driverAmbiguous,
    ]);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleF]), "loaded");
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleG]), "loaded");
    const ticket = (await rows(db, "select vehicle_id,ptc_event_id,ptc_cycle from public.tickets where id=$1", [ids.ticketF]))[0];
    assert.equal(ticket.vehicle_id, ids.vehicleAlias);
    assert.equal(ticket.ptc_event_id, null);
    assert.equal(ticket.ptc_cycle, null);
  });

  await check("server-side driver matcher follows the same unique-only rule", async () => {
    const matched = resolveUniqueLoadedPtcTripByDriver({
      driverId: ids.driverFallback,
      states: [{ vehicle_id: ids.vehicleE, assigned: true, state: "loaded", cycle: 4 }],
      events: [{ id: ids.loadedE, vehicle_id: ids.vehicleE, driver_id: ids.driverFallback, to_state: "loaded", cycle: 4 }],
    });
    assert.equal(matched.status, "matched");
    const ambiguous = resolveUniqueLoadedPtcTripByDriver({
      driverId: ids.driverAmbiguous,
      states: [
        { vehicle_id: ids.vehicleF, assigned: true, state: "loaded", cycle: 7 },
        { vehicle_id: ids.vehicleG, assigned: true, state: "loaded", cycle: 8 },
      ],
      events: [
        { id: ids.loadedF, vehicle_id: ids.vehicleF, driver_id: ids.driverAmbiguous, to_state: "loaded", cycle: 7 },
        { id: ids.loadedG, vehicle_id: ids.vehicleG, driver_id: ids.driverAmbiguous, to_state: "loaded", cycle: 8 },
      ],
    });
    assert.equal(ambiguous.status, "ambiguous");
  });

  await db.close();
  console.log(JSON.stringify({ suite: "P0 weighbridge PTC atomic handoff", passed, failed: 0 }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
