import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { nextState } from "../lib/traffic/model";
import { applyFleetRepair, isFleetRepairReceipt, type FleetSnapshot } from "../lib/fleet/model";
import { readVehicleRepairs } from "../lib/fleet/repairs-server";

let checks = 0;
const equal = (a: unknown, b: unknown) => { assert.deepEqual(a, b); checks++; };
async function main() {
  equal(nextState("harvester", "empty", true), null);
  equal(nextState("harvester", "empty", false), "loaded");
  equal(nextState("receiver", "loaded", true), "unloading");
  equal(nextState("receiver", "unloading", true), "empty");
  const receipt = { companyId: "a", vehicleId: "v", inRepair: true, version: 1, changedAt: "2026-09-05T00:00:00Z" };
  equal(isFleetRepairReceipt(receipt), true);
  for (const bad of [null, {}, { ...receipt, version: -1 }, { ...receipt, inRepair: "true" }, { ...receipt, changedAt: 3 }]) equal(isFleetRepairReceipt(bad), false);
  const snapshot = { companyId: "a", vehicles: [{ id: "v", name: "KAMAZ", plate: "QA", driver: "Driver", repairVersion: 0 }] } as FleetSnapshot;
  const repaired = applyFleetRepair(snapshot, receipt);
  equal(repaired.vehicles[0].inRepair, true);
  equal(snapshot.vehicles[0].inRepair, undefined);
  equal(applyFleetRepair(repaired, { ...receipt, companyId: "b" }), repaired);
  equal(applyFleetRepair(repaired, { ...receipt, version: 0, inRepair: false }).vehicles[0].inRepair, true);
  await assert.rejects(() => readVehicleRepairs({ from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ error: new Error("unavailable") }) }) }) }) } as any, "a", ["v"])); checks++;

  // Run actual SQL, including the existing PTC transitions, in PostgreSQL.
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid,role text,status text);
    create table fields(id uuid primary key,company_id uuid,archived boolean);
    create table reference_vehicles(id uuid primary key,company_id uuid,is_active boolean,archived boolean,status text default 'in_trip');
    create table company_people(id uuid primary key,company_id uuid,user_id uuid,full_name text,status text,deleted_at timestamptz);
    grant select on all tables in schema public to service_role;
    grant update on profiles,company_people,reference_vehicles to service_role;`);
  for (const file of ["20260904103550_ptc_independent_machine_turnover_v1.sql", "20260904112119_ptc_unified_account_auth_v1.sql", "20260905041243_fleet_vehicle_repair_v1.sql"]) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  const company = randomUUID(), foreign = randomUUID(), vehicle = randomUUID(), foreignVehicle = randomUUID(), archivedVehicle = randomUUID();
  await db.query("insert into companies values($1),($2)", [company, foreign]);
  await db.query("insert into reference_vehicles(id,company_id,is_active,archived) values($1,$2,true,false),($3,$4,true,false),($5,$2,true,true)", [vehicle, company, foreignVehicle, foreign, archivedVehicle]);
  await db.query("select ptc_configure_v1($1,true,null,$2)", [company, [vehicle]]);
  const actor = async (role: string, companyId = company, status = "active") => {
    const id = randomUUID();
    await db.query("insert into profiles values($1,$2,$3,$4)", [id, companyId, role, status]);
    await db.query("insert into company_people values($1,$2,$3,$4,'active',null)", [randomUUID(), companyId, id, role]);
    return id;
  };
  const manager = await actor("fleet_manager"), harvester = await actor("mechanic_operator"), receiver = await actor("vegetable_brigadier");
  const admin = await actor("company_admin"), globalAdmin = await actor("global_admin", foreign), agronomist = await actor("agronomist");
  const outsider = await actor("fleet_manager", foreign), inactive = await actor("fleet_manager", company, "inactive");
  const repair = async (value: boolean, version: number, who = manager, car = vehicle, tenant = company) =>
    (await db.query<{ value: any }>("select fleet_set_vehicle_repair_v1($1,$2,$3,$4,$5) as value", [who, tenant, car, value, version])).rows[0].value;
  const transition = async (who: string, version: number, state: string, key = randomUUID()) =>
    (await db.query<{ value: any }>("select ptc_actor_transition_v1($1,$2,$3,$4,$5) as value", [who, vehicle, version, state, key])).rows[0].value;
  const state = async () => (await db.query<{ state: string; version: number; cycle: number; since: unknown }>("select state,version,cycle,since from ptc_vehicle_states where vehicle_id=$1", [vehicle])).rows[0];
  const counts = async () => (await db.query("select (select count(*)::int from ptc_events) ptc,(select count(*)::int from fleet_vehicle_repair_events) repairs")).rows[0];
  const reject = async (call: () => Promise<unknown>, code: string) => { await assert.rejects(call, new RegExp(code)); checks++; };

  equal((await repair(false, 0)).version, 0);
  equal(await counts(), { ptc: 0, repairs: 0 });
  for (const who of [harvester, receiver, agronomist, outsider, inactive]) await reject(() => repair(true, 0, who), "FLEET_REPAIR_FORBIDDEN");
  await reject(() => repair(true, 0, manager, foreignVehicle), "FLEET_REPAIR_VEHICLE_UNAVAILABLE");
  await reject(() => repair(true, 0, manager, archivedVehicle), "FLEET_REPAIR_VEHICLE_UNAVAILABLE");
  await reject(() => repair(true, -1), "FLEET_REPAIR_INVALID");
  const before = await state();
  await db.exec("set role service_role");
  const first = await repair(true, 0);
  equal(first.inRepair, true); equal(first.version, 1);
  equal(await state(), before);
  equal((await repair(true, 0)).version, 1); // Lost-response retry is not a second event.
  equal(await counts(), { ptc: 0, repairs: 1 });
  await reject(() => transition(harvester, 0, "loaded"), "FLEET_VEHICLE_IN_REPAIR");
  equal(await state(), before);
  equal((await repair(false, 1, admin)).version, 2);
  const loadKey = randomUUID();
  const loaded = await transition(harvester, 0, "loaded", loadKey);
  equal(loaded.replayed, false);
  const cargo = await state();
  equal((await repair(true, 2, globalAdmin)).version, 3);
  equal(await state(), cargo);
  equal((await transition(harvester, 0, "loaded", loadKey)).replayed, true);
  await transition(receiver, 1, "unloading");
  await transition(receiver, 2, "empty");
  const returned = await state();
  equal({ state: returned.state, version: returned.version, cycle: returned.cycle }, { state: "empty", version: 3, cycle: 1 });
  await reject(() => transition(harvester, 3, "loaded"), "FLEET_VEHICLE_IN_REPAIR");
  await reject(() => repair(false, 1), "FLEET_REPAIR_CONFLICT");
  await reject(() => repair(true, 0), "FLEET_REPAIR_CONFLICT");
  equal((await repair(false, 3)).version, 4);
  equal(await state(), returned);
  equal((await db.query("select status from reference_vehicles where id=$1", [vehicle])).rows, [{ status: "in_trip" }]);
  equal(await counts(), { ptc: 3, repairs: 4 });
  equal((await db.query("select in_repair,version from fleet_vehicle_repair_events order by version")).rows,
    [{ in_repair: true, version: 1 }, { in_repair: false, version: 2 }, { in_repair: true, version: 3 }, { in_repair: false, version: 4 }]);
  await reject(() => db.exec("delete from fleet_vehicle_repair_events"), "permission denied");
  await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    equal((await db.query("select has_function_privilege($1,'fleet_set_vehicle_repair_v1(uuid,uuid,uuid,boolean,integer)','execute') allowed", [role])).rows, [{ allowed: false }]);
    for (const table of ["fleet_vehicle_repairs", "fleet_vehicle_repair_events"]) {
      equal((await db.query("select has_table_privilege($1,$2,'select,insert,update,delete') allowed", [role, table])).rows, [{ allowed: false }]);
    }
  }
  // Execute the actual HTTP handler against the actual PostgreSQL RPC.
  let apiRole = "fleet_manager";
  let rpcCalls = 0;
  let originAllowed = true;
  class AuthError extends Error { constructor(message: string, public status = 403) { super(message); } }
  const module = { exports: {} as any };
  const service = { rpc: async (name: string, input: any) => {
    rpcCalls++; equal(name, "fleet_set_vehicle_repair_v1");
    equal(input.p_actor, manager);
    return { data: await repair(input.p_in_repair, input.p_expected_version, input.p_actor, input.p_vehicle, input.p_company), error: null };
  } };
  const dependencies: Record<string, unknown> = {
    zod: { z },
    "@/lib/auth/server-session": { SessionAuthError: AuthError,
      getServerActorFromSession: async (_req: unknown, options: unknown) => {
        equal(JSON.parse(JSON.stringify(options)), { ignoreImpersonation: true, skipCache: true });
        return { id: manager, role: apiRole, companyId: company };
      },
      resolveCompanyForActor: (_actor: unknown, requested: string) => { if (requested !== company) throw new AuthError("Foreign company"); return company; } },
    "@/lib/auth/server-acl": { assertActorAccess: async (input: any) => { equal(input.actorUserId, manager); equal(input.companyId, company); } },
    "@/lib/supabase/service": { getServiceClient: () => service },
    "@/lib/traffic/server": {
      sameOrigin: () => { if (!originAllowed) throw new AuthError("Foreign origin"); },
      noStore: (data: unknown) => new Response(JSON.stringify(data), { headers: { "Cache-Control": "no-store, private" } }),
      failed: (error: any) => new Response("denied", { status: error.status || (error instanceof z.ZodError ? 400 : 409) }),
    },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync("app/api/fleet/repair/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const input = { companyId: company, vehicleId: vehicle, inRepair: false, expectedVersion: 4 };
  const post = (body: unknown = input): Promise<Response> => module.exports.POST({ json: async () => body });
  const result = await post();
  equal(result.status, 200); equal(result.headers.get("Cache-Control"), "no-store, private");
  equal((await result.json()).version, 4);
  const beforeDenied = rpcCalls;
  for (const denied of ["agronomist", "mechanic_operator", "vegetable_brigadier"]) { apiRole = denied; equal((await post()).status, 403); }
  apiRole = "fleet_manager";
  equal((await post({ ...input, companyId: foreign })).status, 403);
  for (const invalid of [{ ...input, expectedVersion: -1 }, { ...input, inRepair: "true" }, { ...input, actorId: manager }, { ...input, vehicleId: "bad" }]) equal((await post(invalid)).status, 400);
  originAllowed = false; equal((await post()).status, 403);
  originAllowed = true;
  equal((await module.exports.POST({ json: async () => { throw new SyntaxError("Malformed JSON"); } })).status, 400);
  equal(rpcCalls, beforeDenied);
  await db.close();
  console.log(`Fleet repair PASS: ${checks} checks; actual PostgreSQL functions, roles, transitions and retained history; no hosted writes.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
