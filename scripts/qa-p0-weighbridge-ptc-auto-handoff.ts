import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { resolveUniqueLoadedPtcTripByDriver } from "../lib/weighbridge/ptc-driver-trip";
import { currentTripEvents } from "../lib/traffic/analytics";

type Row = Record<string, unknown>;
const migrationPaths = [
  "supabase/migrations/20260917161613_p0_weighbridge_ptc_auto_handoff_v1.sql",
  "supabase/migrations/20260918095931_p0_weighbridge_ptc_driver_fallback_v2.sql",
  "supabase/migrations/20260919065424_p1_driver_vehicle_replacement.sql",
  "supabase/migrations/20260919074748_ptc_empty_queue_reentry_clock.sql",
].map((path) => resolve(process.cwd(), path));
const ids = {
  company: "10000000-0000-0000-0000-000000000001",
  actor: "10000000-0000-0000-0000-000000000002",
  field: "10000000-0000-0000-0000-000000000003",
  plot: "10000000-0000-0000-0000-000000000004",
  newField: "10000000-0000-0000-0000-000000000010",
  newPlot: "10000000-0000-0000-0000-000000000011",
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
    create role service_role;
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
    alter table public.tickets add column finalized_at timestamptz, add column tare_weight_kg numeric,
      add column audit_json jsonb;
    create table public.companies(id uuid primary key);
    create table public.profiles(id uuid primary key,company_id uuid,status text,role text,full_name text);
    create table public.company_people(id uuid primary key,company_id uuid,user_id uuid,status text,deleted_at timestamptz,role_type text,full_name text);
    create table public.reference_specialists(id uuid primary key,company_id uuid,person_id uuid,archived boolean,status text);
    create table public.reference_vehicles(id uuid primary key,company_id uuid,primary_responsible_personnel_id uuid,
      ptc_enabled boolean default true,is_active boolean default true,archived boolean default false);
    create table public.ptc_flows(company_id uuid primary key,enabled boolean,field_id uuid,updated_at timestamptz default now());
    create table public.fleet_vehicle_repairs(company_id uuid,vehicle_id uuid,in_repair boolean);
    create table public.ptc_last_vehicle_markers(company_id uuid primary key,vehicle_id uuid);
    create table public.ptc_last_vehicle_events(company_id uuid,vehicle_id uuid,actor_user_id uuid,actor_name text,command text,action text,idempotency_key uuid);
    create table public.ptc_combine_shifts(company_id uuid,operator_user_id uuid,closed_at timestamptz,opened_at timestamptz,
      field_id uuid,current_crop_structure_id uuid);
    insert into public.companies values('${ids.company}');
    insert into public.profiles values('${ids.actor}','${ids.company}','active','weighman','Весовщик');
    insert into public.company_people values('${ids.driver}','${ids.company}',null,'active',null,'driver','Водитель А');
    insert into public.company_people values('${ids.driverB}','${ids.company}',null,'active',null,'driver','Водитель Б');
    insert into public.company_people values('${ids.driverC}','${ids.company}',null,'active',null,'driver','Водитель В');
    insert into public.reference_specialists select id,company_id,id,false,'active' from public.company_people;
    insert into public.reference_vehicles(id,company_id,primary_responsible_personnel_id) values
      ('${ids.vehicleA}','${ids.company}','${ids.driver}'),
      ('${ids.vehicleB}','${ids.company}','${ids.driverB}'),
      ('${ids.vehicleC}','${ids.company}','${ids.driverC}'),
      ('${ids.vehicleD}','${ids.company}',null),
      ('${ids.vehicleAlias}','${ids.company}',null);
    insert into public.ptc_flows(company_id,enabled,field_id) values('${ids.company}',true,'${ids.field}');
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
      ids.ticketA, ids.company, ids.vehicleA, ids.actor, ids.newField, ids.newPlot, ids.driver,
    ]);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleA]), "unloading");
    const ticket = (await rows(db, "select ptc_event_id,ptc_cycle from public.tickets where id=$1", [ids.ticketA]))[0];
    assert.equal(ticket.ptc_event_id, ids.loadedA);
    assert.equal(Number(ticket.ptc_cycle), 3);
    assert.equal(await scalar(db, "select field_id from public.tickets where id=$1", [ids.ticketA]), ids.newField);
    assert.equal(await scalar(db, "select crop_structure_allocation_id from public.tickets where id=$1", [ids.ticketA]), ids.newPlot);
    assert.equal(await scalar(db, "select field_id from public.ptc_events where id=$1", [ids.loadedA]), ids.field);
    assert.equal(await scalar(db, "select field_id from public.ptc_events where vehicle_id=$1 and to_state='unloading'", [ids.vehicleA]), ids.newField);
    assert.equal(await scalar(db, "select count(*)::int from public.ptc_events where vehicle_id=$1 and to_state='unloading'", [ids.vehicleA]), 1);
  });

  await check("tare close atomically moves the same vehicle to empty exactly once", async () => {
    await db.query("update public.tickets set is_finalized=true,status='finalized',finalized_at=now(),tare_weight_kg=8000,closed_by=$2 where id=$1", [ids.ticketA, ids.actor]);
    await db.query("update public.tickets set is_finalized=true,status='finalized',finalized_at=now(),tare_weight_kg=8000,closed_by=$2 where id=$1", [ids.ticketA, ids.actor]);
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

  await check("a manually selected different vehicle is never silently overwritten", async () => {
    await assert.rejects(db.query(`insert into public.tickets(
      id,company_id,ticket_no,op_type,vehicle_id,created_by,field_id,crop_structure_allocation_id,driver_id
    ) values($1,$2,'WB-E','harvest_incoming',$3,$4,$5,$6,$7)`, [
      ids.ticketE, ids.company, ids.vehicleAlias, ids.actor, ids.field, ids.plot, ids.driverFallback,
    ]), /PTC_VEHICLE_REPLACEMENT_REQUIRED/);
    assert.equal(await scalar(db, "select state from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleE]), "loaded");
    assert.equal(await scalar(db, "select count(*)::int from public.tickets where id=$1", [ids.ticketE]), 0);
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

  const replacementKey = "60000000-0000-0000-0000-000000000001";
  await db.query("update public.tickets set is_voided=true,status='voided' where id=$1", [ids.ticketF]);
  const replace = (overrides: Record<string, unknown> = {}) => {
    const p = { actor: ids.actor, company: ids.company, driver: ids.driverB, source: ids.vehicleB, target: ids.vehicleAlias,
      sourceVersion: 6, targetVersion: 0, sourceAssignment: ids.driverB, targetAssignment: null, key: replacementKey, ...overrides };
    return db.query<{result: any}>("select public.ptc_replace_driver_vehicle_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result",
      [p.actor,p.company,p.driver,p.source,p.target,p.sourceVersion,p.targetVersion,p.sourceAssignment,p.targetAssignment,p.key]);
  };
  await check("loaded driver replacement preserves trip and keeps old history", async () => {
    const before = await rows(db,"select * from public.ptc_events where vehicle_id=$1 order by id",[ids.vehicleB]);
    const result = (await replace()).rows[0].result as any;
    assert.equal(result.vehicleId,ids.vehicleAlias);
    assert.equal(result.driverId,ids.driverB);
    assert.equal(result.state,"loaded");
    assert.deepEqual(await rows(db,"select * from public.ptc_events where vehicle_id=$1 order by id",[ids.vehicleB]),before);
    assert.equal(await scalar(db,"select assigned from public.ptc_vehicle_states where vehicle_id=$1",[ids.vehicleB]),false);
    assert.equal(await scalar(db,"select primary_responsible_personnel_id from public.reference_vehicles where id=$1",[ids.vehicleAlias]),ids.driverB);
    // Voided ticket is historical, not rewritten by the replacement.
    assert.equal(await scalar(db,"select vehicle_id from public.tickets where id=$1",[ids.ticketB]),ids.vehicleB);
    assert.equal(await scalar(db,"select count(*)::int from public.ptc_vehicle_replacements"),1);
  });
  await check("lost response retry returns the receipt without a second move", async () => {
    const result = (await replace()).rows[0].result as any;
    assert.equal(result.replayed,true);
    assert.equal(await scalar(db,"select count(*)::int from public.ptc_vehicle_replacements"),1);
  });
  await check("closed historical driver tonnage is unchanged", async () => {
    assert.equal(await scalar(db,"select vehicle_id from public.tickets where id=$1",[ids.ticketA]),ids.vehicleA);
    assert.equal(await scalar(db,"select driver_id from public.tickets where id=$1",[ids.ticketA]),ids.driver);
  });
  await check("occupied target is rejected without changing source or assignments", async () => {
    await assert.rejects(replace({source:ids.vehicleAlias,sourceVersion:1,target:ids.vehicleD,targetVersion:8,key:ids.keyA}),/PTC_REPLACE_TARGET_BUSY/);
    assert.equal(await scalar(db,"select state from public.ptc_vehicle_states where vehicle_id=$1",[ids.vehicleAlias]),"loaded");
  });
  await check("stale driver/version, cross-company and unauthorized role are rejected", async () => {
    await assert.rejects(replace({source:ids.vehicleAlias,sourceVersion:999,key:ids.keyB}),/PTC_REPLACE_INVALID|PTC_REPLACE_CONFLICT/);
    await assert.rejects(replace({company:ids.field,key:ids.keyB}),/PTC_REPLACE_FORBIDDEN/);
    await db.exec(`update public.profiles set role='director' where id='${ids.actor}'`);
    await assert.rejects(replace(),/PTC_REPLACE_FORBIDDEN/);
    await db.exec(`update public.profiles set role='weighman' where id='${ids.actor}'`);
  });
  await check("repair target is unavailable and key reuse cannot redirect a retry", async () => {
    await db.exec(`insert into public.fleet_vehicle_repairs values('${ids.company}','${ids.vehicleB}',true)`);
    await assert.rejects(replace({source:ids.vehicleAlias,sourceVersion:1,target:ids.vehicleB,targetVersion:7,key:ids.keyC}),/PTC_REPLACE_TARGET_BUSY/);
    await assert.rejects(replace({target:ids.vehicleD}),/PTC_KEY_CONFLICT/);
    await db.exec("delete from public.fleet_vehicle_repairs");
  });
  await check("replacement can follow an OPEN ticket without closing or changing its weight", async () => {
    await db.query(`insert into public.tickets(id,company_id,ticket_no,op_type,vehicle_id,created_by,field_id,crop_structure_allocation_id,driver_id)
      values($1,$2,'WB-REPLACED','harvest_incoming',$3,$4,$5,$6,$7)`,[ids.ticketE,ids.company,ids.vehicleAlias,ids.actor,ids.field,ids.plot,ids.driverB]);
    const result=(await replace({source:ids.vehicleAlias,sourceVersion:2,target:ids.vehicleB,targetVersion:7,key:ids.ticketD})).rows[0].result as any;
    assert.equal(result.state,'unloading');
    const t=(await rows(db,"select * from public.tickets where id=$1",[ids.ticketE]))[0];
    assert.equal(t.vehicle_id,ids.vehicleB); assert.equal(t.driver_id,ids.driverB);
    assert.equal(t.is_finalized,false); assert.equal(t.tare_weight_kg,null);
    assert.equal(t.ptc_event_id,result.ptcEventId); assert.equal(t.ptc_cycle,result.ptcCycle);
  });
  await check("opening a ticket and typing tare does NOT make it empty", async () => {
    await rows(db,"select * from public.tickets where id=$1",[ids.ticketE]);
    await db.query("update public.tickets set tare_weight_kg=8400 where id=$1",[ids.ticketE]);
    assert.equal(await scalar(db,"select state from public.ptc_vehicle_states where vehicle_id=$1",[ids.vehicleB]),'unloading');
    await assert.rejects(db.query("update public.tickets set is_finalized=true where id=$1",[ids.ticketE]),/PTC_CONFIRMED_CLOSE_REQUIRED/);
  });
  await check("legacy receiver cannot make it empty while ticket is open", async () => {
    await db.exec(`update public.profiles set role='vegetable_brigadier' where id='${ids.actor}'; update public.company_people set user_id='${ids.actor}' where id='${ids.driverB}'`);
    const version=await scalar<number>(db,"select version from public.ptc_vehicle_states where vehicle_id=$1",[ids.vehicleB]);
    await assert.rejects(db.query("select public.ptc_actor_transition_v1($1,$2,$3,'empty',$4)",[ids.actor,ids.vehicleB,version,ids.ticketF]),/PTC_OPEN_TICKET_WAITING_TARE/);
    assert.equal(await scalar(db,"select state from public.ptc_vehicle_states where vehicle_id=$1",[ids.vehicleB]),'unloading');
    await db.exec(`update public.profiles set role='weighman' where id='${ids.actor}'`);
  });
  await check("confirmed tare closes the replacement vehicle exactly once", async () => {
    await db.query("update public.tickets set is_finalized=true,status='finalized',finalized_at=now(),closed_by=$2 where id=$1",[ids.ticketE,ids.actor]);
    assert.equal(await scalar(db,"select state from public.ptc_vehicle_states where vehicle_id=$1",[ids.vehicleB]),'empty');
    assert.equal(await scalar(db,"select count(*)::int from public.ptc_events where vehicle_id=$1 and to_state='empty'",[ids.vehicleB]),1);
  });
  await check("two vehicle replacements do not double count a single driver's load",async()=>{
    const events=await rows(db,"select * from public.ptc_events where driver_id=$1",[ids.driverB]);
    const canonical=currentTripEvents(events as any[]);
    assert.equal(canonical.filter(e=>e.to_state==='loaded').length,2); // load + void returns to loaded; replacements add none
    assert.equal(canonical.filter(e=>e.to_state==='loaded' && e.idempotency_key===replacementKey).length,0);
  });
  await check("empty vehicle replacement enters at the queue tail and retry keeps its place", async () => {
    await db.query("update public.ptc_vehicle_states set since=now()-interval '12 days' where vehicle_id=$1", [ids.vehicleB]);
    const source = (await rows(db, "select version,since from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleB]))[0];
    const targetVersion = await scalar<number>(db, "select version from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleAlias]);
    const command = { source:ids.vehicleB, sourceVersion:source.version, target:ids.vehicleAlias, targetVersion,
      key:"60000000-0000-0000-0000-000000000003" };
    const eventCount = await scalar<number>(db, "select count(*)::int from public.ptc_events");
    await replace(command);
    const after = (await rows(db, "select state,since,version from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleAlias]))[0];
    assert.equal(after.state, 'empty');
    assert.ok(Date.parse(String(after.since)) > Date.parse(String(source.since)));
    assert.equal(await scalar(db, "select count(*)::int from public.ptc_events"), eventCount, 'no fake cargo trip');
    await replace(command);
    assert.deepEqual((await rows(db, "select state,since,version from public.ptc_vehicle_states where vehicle_id=$1", [ids.vehicleAlias]))[0], after);
  });
  await db.close();
  console.log(JSON.stringify({ suite: "P0 weighbridge PTC atomic handoff", passed, failed: 0 }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
