import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let checks = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks += 1; };
const rejects = async (call: () => Promise<unknown>, code: string) => {
  await assert.rejects(call, new RegExp(code));
  checks += 1;
};

async function main() {
  const shiftRoute = readFileSync("app/api/traffic/operator/shift/route.ts", "utf8");
  equal(shiftRoute.includes('const legacyClose = input.action === "close" && input.hectaresShift !== undefined'), true);
  equal(shiftRoute.includes('rpc("ptc_set_combine_shift_v1"'), true);
  const board = readFileSync("components/traffic/traffic-board.tsx", "utf8");
  equal(board.includes('data-testid="traffic-shift-required"'), true);
  equal(board.includes('data-testid="traffic-legacy-shift-plot"'), true);
  equal(board.includes('disabled={pendingVehicle || stale || !snapshot.enabled || !harvesterShiftReady}'), true);
  const dashboard = readFileSync("lib/dashboard/harvest-summary.ts", "utf8");
  equal(dashboard.includes("isHarvestVegetableLabel(ticketIdentity(ticket).crop)"), true);
  equal(dashboard.includes("? finalized\n        .filter"), true);

  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid references companies(id),role text,status text,full_name text);
    create table company_people(id uuid primary key,company_id uuid references companies(id),user_id uuid,full_name text,status text,deleted_at timestamptz);
    create table fields(id uuid primary key,company_id uuid references companies(id),name text);
    create table crop_structure(id uuid primary key,company_id uuid references companies(id),field_id uuid references fields(id),season_id uuid,crop_id uuid,variety_id uuid,reproduction_id uuid,area numeric,archived boolean default false,land_use_type text);
    create table reference_vehicles(id uuid primary key,company_id uuid references companies(id),primary_responsible_personnel_id uuid);
    create table reference_specialists(id uuid primary key,company_id uuid references companies(id),person_id uuid references company_people(id),personnel_type text,status text,archived boolean default false);
    create table fleet_vehicle_repairs(company_id uuid,vehicle_id uuid,in_repair boolean,primary key(company_id,vehicle_id));
    create table ptc_flows(company_id uuid primary key references companies(id),enabled boolean,field_id uuid references fields(id));
    create table ptc_vehicle_states(company_id uuid references companies(id),vehicle_id uuid references reference_vehicles(id),assigned boolean,state text,version integer,since timestamptz,cycle integer,primary key(company_id,vehicle_id));
    create table ptc_events(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),vehicle_id uuid references reference_vehicles(id),actor_user_id uuid,actor_name text,field_id uuid,idempotency_key uuid,expected_version integer,from_state text,to_state text,cycle integer,created_at timestamptz default now(),unique(company_id,idempotency_key));
    create table ptc_last_vehicle_markers(company_id uuid,vehicle_id uuid,primary key(company_id));
    create table ptc_last_vehicle_events(id uuid primary key default gen_random_uuid(),company_id uuid,vehicle_id uuid,actor_user_id uuid,actor_name text,command text,action text,idempotency_key uuid);
    create table ptc_combine_shifts(id uuid primary key default gen_random_uuid(),company_id uuid references ptc_flows(company_id),operator_user_id uuid references profiles(id),operator_person_id uuid references company_people(id),operator_name text,field_id uuid references fields(id),opened_at timestamptz default now(),closed_at timestamptz,hectares_shift numeric,hectares_field_total numeric,created_at timestamptz default now(),updated_at timestamptz default now());
    create table ptc_combine_shift_events(id uuid primary key default gen_random_uuid(),company_id uuid references ptc_flows(company_id),shift_id uuid references ptc_combine_shifts(id),actor_user_id uuid references profiles(id),command text check(command in ('open','close')),idempotency_key uuid,created_at timestamptz default now(),unique(company_id,idempotency_key));
    create table tickets(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),is_voided boolean default false);
    grant select,insert,update,delete on all tables in schema public to service_role;
  `);
  await db.exec(readFileSync("supabase/migrations/20260916042809_harvest_plot_driver_v1.sql", "utf8"));

  const company = randomUUID();
  const field = randomUUID();
  const structure = randomUUID();
  const structure2 = randomUUID();
  const harvester = randomUUID();
  const harvesterPerson = randomUUID();
  const driver = randomUUID();
  const specialist = randomUUID();
  const vehicle = randomUUID();
  await db.query("insert into companies values($1)", [company]);
  await db.query("insert into fields values($1,$2,'Поле 9')", [field, company]);
  await db.query("insert into crop_structure(id,company_id,field_id,area,archived,land_use_type) values($1,$2,$3,12,false,'crop'),($4,$2,$3,5,false,'crop')", [structure, company, field, structure2]);
  await db.query("insert into profiles values($1,$2,'mechanic_operator','active','Комбайнёр')", [harvester, company]);
  await db.query("insert into company_people values($1,$2,$3,'Комбайнёр','active',null),($4,$2,null,'Водитель','active',null)", [harvesterPerson, company, harvester, driver]);
  await db.query("insert into reference_specialists values($1,$2,$3,'driver','active',false)", [specialist, company, driver]);
  await db.query("insert into reference_vehicles values($1,$2,$3)", [vehicle, company, specialist]);
  await db.query("insert into ptc_flows values($1,true,$2)", [company, field]);
  await db.query("insert into ptc_vehicle_states values($1,$2,true,'empty',0,now(),0)", [company, vehicle]);

  await db.exec("set role service_role");
  const openKey = randomUUID();
  const opened = (await db.query<{ value: any }>(
    "select ptc_set_combine_shift_v2($1,'open',null,$2,null,null,false,$3) value",
    [harvester, structure, openKey],
  )).rows[0].value;
  equal(opened.status, "open");
  equal(opened.cropStructureId, structure);
  equal((await db.query<{ value: any }>(
    "select ptc_set_combine_shift_v2($1,'open',null,$2,null,null,false,$3) value",
    [harvester, structure, openKey],
  )).rows[0].value.replayed, true);

  const loaded = (await db.query<{ value: any }>(
    "select ptc_actor_transition_v1($1,$2,0,'loaded',$3) value",
    [harvester, vehicle, randomUUID()],
  )).rows[0].value;
  const trip = (await db.query<any>(
    "select crop_structure_id::text,field_id::text,driver_id::text,cycle from ptc_events where id=$1",
    [loaded.eventId],
  )).rows[0];
  equal(trip, { crop_structure_id: structure, field_id: field, driver_id: driver, cycle: 1 });

  const closed = (await db.query<{ value: any }>(
    "select ptc_set_combine_shift_v2($1,'close',$2,null,11,true,false,$3) value",
    [harvester, opened.shiftId, randomUUID()],
  )).rows[0].value;
  equal({ status: closed.status, shift: Number(closed.hectaresShift), total: Number(closed.hectaresFieldTotal) },
    { status: "closed", shift: 11, total: 11 });
  equal((await db.query<any>("select actual_completed_ha::float8,status from ptc_field_progress")).rows,
    [{ actual_completed_ha: 11, status: "completed" }]);
  await rejects(
    () => db.query("select ptc_set_combine_shift_v2($1,'open',null,$2,null,null,false,$3)", [harvester, structure, randomUUID()]),
    "PTC_FIELD_ALREADY_COMPLETED",
  );

  // An already-open legacy shift remains usable during the rollout. The
  // operator can attach the exact plot without closing the shift.
  await db.query("update ptc_vehicle_states set state='empty',version=0,cycle=0 where company_id=$1 and vehicle_id=$2", [company, vehicle]);
  const legacyShift = randomUUID();
  await db.query("insert into ptc_combine_shifts(id,company_id,operator_user_id,operator_person_id,operator_name,field_id) values($1,$2,$3,$4,'Комбайнёр',$5)", [legacyShift, company, harvester, harvesterPerson, field]);
  const legacyCompatibleLoad = (await db.query<{ value: any }>(
    "select ptc_actor_transition_v1($1,$2,0,'loaded',$3) value", [harvester, vehicle, randomUUID()],
  )).rows[0].value;
  equal((await db.query<any>("select crop_structure_id,field_id::text from ptc_events where id=$1", [legacyCompatibleLoad.eventId])).rows,
    [{ crop_structure_id: null, field_id: field }]);
  await db.query("update ptc_vehicle_states set state='empty',version=0,cycle=0 where company_id=$1 and vehicle_id=$2", [company, vehicle]);
  const attached = (await db.query<{ value: any }>(
    "select ptc_set_combine_shift_v2($1,'switch',$2,$3,0,false,false,$4) value",
    [harvester, legacyShift, structure2, randomUUID()],
  )).rows[0].value;
  equal(attached.cropStructureId, structure2);
  const legacyLoad = (await db.query<{ value: any }>(
    "select ptc_actor_transition_v1($1,$2,0,'loaded',$3) value", [harvester, vehicle, randomUUID()],
  )).rows[0].value;
  equal((await db.query<any>("select crop_structure_id,field_id::text from ptc_events where id=$1", [legacyLoad.eventId])).rows,
    [{ crop_structure_id: structure2, field_id: field }]);
  const legacyClosed = (await db.query<{ value: any }>(
    "select ptc_set_combine_shift_v2($1,'close',$2,null,5,false,false,$3) value",
    [harvester, legacyShift, randomUUID()],
  )).rows[0].value;
  equal({ status: legacyClosed.status, shift: Number(legacyClosed.hectaresShift) }, { status: "closed", shift: 5 });

  await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    equal((await db.query("select has_function_privilege($1,'ptc_set_combine_shift_v2(uuid,text,uuid,uuid,numeric,boolean,boolean,uuid)','execute') allowed", [role])).rows, [{ allowed: false }]);
    for (const table of ["ptc_field_progress", "ptc_combine_field_segments"]) {
      equal((await db.query("select has_table_privilege($1,$2,'select,insert,update,delete') allowed", [role, table])).rows, [{ allowed: false }]);
    }
  }
  await db.close();
  console.log(`Harvest plot/driver PASS: ${checks} checks; migration, compatibility, tenant isolation and immutable trip context; no hosted writes.`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
