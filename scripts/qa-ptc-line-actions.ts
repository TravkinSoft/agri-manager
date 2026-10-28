import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { visibleVehicles, type TrafficState } from "../lib/traffic/model";

async function main() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid,role text,status text);
    create table fields(id uuid primary key,company_id uuid,archived boolean);
    create table reference_vehicles(id uuid primary key,company_id uuid,is_active boolean,archived boolean);
    create table company_people(id uuid primary key,company_id uuid,user_id uuid,full_name text,status text,deleted_at timestamptz);
    grant select on all tables in schema public to service_role;
    grant update on profiles,reference_vehicles,company_people to service_role;`);
  for (const file of ["20260904103550_ptc_independent_machine_turnover_v1.sql", "20260904112119_ptc_unified_account_auth_v1.sql",
    "20260905041243_fleet_vehicle_repair_v1.sql", "20260905103242_ptc_vehicle_line_actions_v1.sql",
    "20260906221526_ptc_fleet_manager_only_mutations.sql",
    "20260919074748_ptc_empty_queue_reentry_clock.sql"]) {
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  }
  const company = randomUUID(), foreign = randomUUID(), manager = randomUUID(), operator = randomUUID(), agronomist = randomUUID(), admin = randomUUID(), vehicle = randomUUID(), second = randomUUID(), outsider = randomUUID();
  await db.query("insert into companies values($1),($2)", [company, foreign]);
  await db.query("insert into profiles values($1,$2,'fleet_manager','active'),($3,$2,'mechanic_operator','active'),($4,$2,'agronomist','active'),($5,$2,'company_admin','active')", [manager, company, operator, agronomist, admin]);
  await db.query("insert into reference_vehicles values($1,$2,true,false),($3,$2,true,false),($4,$5,true,false)", [vehicle, company, second, outsider, foreign]);
  const revision = async () => (await db.query<{ value: string | null }>("select (select updated_at::text from ptc_flows where company_id=$1) value", [company])).rows[0].value;
  const line = async (ids: string[], assigned: boolean, expected: string | null, actor = manager) =>
    (await db.query<{ value: any }>("select ptc_set_vehicle_line_v1($1,$2,$3,$4,$5) value", [actor, company, ids, assigned, expected])).rows[0].value;
  const states = async () => (await db.query<{ vehicle_id: string; state: TrafficState; version: number; cycle: number; since: string; assigned: boolean }>("select vehicle_id,state,version,cycle,since::text,assigned from ptc_vehicle_states order by vehicle_id")).rows;
  const rejected = (fn: () => Promise<unknown>, message: string) => assert.rejects(fn, new RegExp(message));
  await db.exec("set role service_role");
  await rejected(() => line([vehicle], true, null, operator), "PTC_LINE_FORBIDDEN");
  await rejected(() => line([vehicle], true, null, agronomist), "PTC_LINE_FORBIDDEN");
  await rejected(() => line([vehicle], true, null, admin), "PTC_LINE_FORBIDDEN");
  await rejected(() => line([outsider], true, null), "PTC_COMPANY_MISMATCH");
  assert.equal(await revision(), null); // Entire rejected initialization rolled back.
  await line([vehicle], true, null);
  const first = await revision();
  const original = await states();
  await line([second], true, first);
  await rejected(() => line([vehicle], false, first), "PTC_LINE_CONFLICT");
  assert.equal((await states()).length, 2);
  await line([vehicle], false, await revision());
  const removed = (await states()).find(row => row.vehicle_id === vehicle)!;
  assert.deepEqual({ ...removed, assigned: true }, original[0]);
  await db.query("select fleet_set_vehicle_repair_v1($1,$2,$3,true,0)", [manager, company, vehicle]);
  const beforeRejected = await states();
  await rejected(async () => line([vehicle, second], true, await revision()), "FLEET_VEHICLE_IN_REPAIR");
  assert.deepEqual(await states(), beforeRejected);
  await db.query("select fleet_set_vehicle_repair_v1($1,$2,$3,false,1)", [manager, company, vehicle]);
  await line([vehicle], true, await revision());
  const returned = (await states()).find(row => row.vehicle_id === vehicle)!;
  assert.equal(returned.state, 'empty');
  assert.equal(returned.cycle, original[0].cycle);
  assert.equal(returned.version, original[0].version + 1);
  assert.ok(Date.parse(returned.since) > Date.parse(original[0].since));
  const queue = (rows: Awaited<ReturnType<typeof states>>) => visibleVehicles(rows.map(row => ({ ...row, name: row.vehicle_id, plate: null, driver: null })), 'harvester').map(row => row.vehicle_id);
  assert.deepEqual(queue(await states()), [second, vehicle], 'return from off-line goes to the empty queue tail');
  const beforeReplay = await states();
  await line([vehicle], true, await revision());
  assert.deepEqual(await states(), beforeReplay, 'already on line: do not reset clocks or CAS versions');
  await line([vehicle], false, await revision());
  await db.exec('reset role');
  await db.query("update ptc_vehicle_states set since=now()-interval '12 days' where vehicle_id=$1", [vehicle]);
  await db.exec('set role service_role');
  await line([vehicle], true, await revision());
  const fresh = (await states()).find(row => row.vehicle_id === vehicle)!;
  assert.ok(Date.parse(fresh.since) > Date.now() - 60_000, 'old vehicle timer is not inherited');
  assert.deepEqual(queue(await states()), [second, vehicle]);
  await db.exec("reset role");
  await db.query("update ptc_vehicle_states set state='loaded',version=4,cycle=2 where vehicle_id=$1", [vehicle]);
  await db.exec("set role service_role");
  const cargo = await states();
  await rejected(async () => line([second, vehicle], false, await revision()), "PTC_ACTIVE_VEHICLE");
  assert.deepEqual(await states(), cargo);
  await db.exec('reset role');
  await db.query("update ptc_vehicle_states set state='unloading',since=now()-interval '1 hour' where vehicle_id=$1", [vehicle]);
  const unloading = (await states()).find(row => row.vehicle_id === vehicle)!;
  await db.query("update ptc_vehicle_states set state='empty',version=version+1 where vehicle_id=$1", [vehicle]);
  const closed = (await states()).find(row => row.vehicle_id === vehicle)!;
  assert.ok(Date.parse(closed.since) > Date.parse(unloading.since));
  assert.equal(closed.version, unloading.version+1, 'normal close increments only once');
  assert.deepEqual(queue(await states()), [second, vehicle], 'return from unloading also goes to tail');
  await db.exec('set role service_role');
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'ptc_set_vehicle_line_v1(uuid,uuid,uuid[],boolean,timestamptz)','execute') allowed", [role])).rows[0].allowed, false);
  }
  assert.equal((await db.query<{ total: number }>("select count(*)::int total from ptc_events")).rows[0].total, 0);
  await db.close();
  console.log("PASS: line ACL/CAS, off-line and unloading returns go to empty queue tail, fresh timer, no-op replay preserves queue, cargo/history preservation, grants");
}
main().catch(error => { console.error(error); process.exit(1); });
