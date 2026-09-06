import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { activeAssignedDriverName, vehicleAllowsMachineOperator } from "../lib/vehicles/driver-name";
import * as model from "../lib/traffic/model";
import * as eligibility from "../lib/traffic/vehicle-eligibility";

let checks = 0;
const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
const companyId = "10000000-0000-4000-8000-000000000001";
const person = { full_name: "Текущий водитель", role_type: "driver", company_id: companyId, status: "active", deleted_at: null };
const specialist = { id: "reference-driver", full_name: "Старое имя", personnel_type: "driver", status: "active", archived: false, person };
const mechanic = { ...person, full_name: "Калымов Канат Айтенович", role_type: "mechanic_operator" };
const machineOperator = { ...specialist, id: "reference-mechanic", personnel_type: "machine_operator", person: mechanic };
check(activeAssignedDriverName(specialist, companyId), person.full_name);
check(activeAssignedDriverName([{ ...specialist, person: [person] }], companyId), person.full_name);
check(activeAssignedDriverName(machineOperator, companyId), null);
check(activeAssignedDriverName(machineOperator, companyId, true), mechanic.full_name);
check(vehicleAllowsMachineOperator({ type: "truck", fleet_type: "truck" }), false);
check(vehicleAllowsMachineOperator({ type: "tractor", fleet_type: "tractor" }), true);
check(activeAssignedDriverName({ ...specialist, person: mechanic }, companyId), null);
check(activeAssignedDriverName({ ...machineOperator, person }, companyId), null);
for (const change of [{ archived: true }, { status: "inactive" }, { personnel_type: "specialist" }, { person: null }])
  check(activeAssignedDriverName({ ...specialist, ...change }, companyId), null);
for (const change of [{ status: "inactive" }, { role_type: "worker" }, { company_id: "foreign" }, { deleted_at: "2026-09-04" }, { full_name: "" }])
  check(activeAssignedDriverName({ ...specialist, person: { ...person, ...change } }, companyId), null);
check(activeAssignedDriverName(null, companyId), null);
const queries: Array<{ table: string; columns: string }> = [];
const fixture: Record<string, unknown> = {
  ptc_flows: { enabled: true, field_id: null },
  ptc_vehicle_states: [
    { vehicle_id: "vehicle", state: "loaded", version: 9, cycle: 3, assigned: true, since: "2026-09-04T10:00:00Z" },
    { vehicle_id: "light", state: "empty", version: 1, cycle: 0, assigned: true, since: "2026-09-04T10:00:00Z" },
    { vehicle_id: "trailer", state: "empty", version: 1, cycle: 0, assigned: true, since: "2026-09-04T10:00:00Z" },
    { vehicle_id: "audit", state: "empty", version: 1, cycle: 0, assigned: true, since: "2026-09-04T10:00:00Z" },
  ],
  ptc_events: [
    { id: "visible-event", vehicle_id: "vehicle", from_state: "empty", to_state: "loaded", created_at: "2026-09-04T10:00:00Z", actor_name: "Комбайнёр", field_id: null },
    { id: "retained-event", vehicle_id: "retained", from_state: "empty", to_state: "loaded", created_at: "2026-09-04T09:30:00Z", actor_name: "Комбайнёр", field_id: null },
    { id: "hidden-event", vehicle_id: "audit", from_state: "empty", to_state: "loaded", created_at: "2026-09-04T10:00:00Z", actor_name: "QA", field_id: null },
  ],
  reference_vehicles: [
    { id: "vehicle", name: "КАМАЗ", license_plate: "QA-207", type: "truck", fleet_type: "truck", ptc_enabled: true, primary_responsible_personnel_id: specialist.id },
    { id: "retained", name: "ЗИЛ", license_plate: "T-804 BN", type: "truck", fleet_type: "truck", ptc_enabled: false, primary_responsible_personnel_id: null },
    { id: "light", name: "Hilux", type: "truck", fleet_type: "truck", ptc_enabled: true, transport_model: { category: "light_vehicle" }, primary_responsible_personnel_id: null },
    { id: "trailer", name: "Прицеп", type: "trailer", fleet_type: "trailer", ptc_enabled: true, primary_responsible_personnel_id: null },
    { id: "audit", name: "Машина", type: "truck", fleet_type: "truck", ptc_enabled: true, import_source: "ptc_audit_2026", primary_responsible_personnel_id: null },
  ],
  reference_specialists: [specialist],
};
const db = { from(table: string) {
  const q: any = { select(columns: string) { queries.push({ table, columns }); return q; },
    eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { return q; },
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: fixture[table], error: null }).then(resolve); } };
  return q;
} };
const localRequire = createRequire(import.meta.url);
const moduleScope = { exports: {} as any };
const code = ts.transpileModule(readFileSync("lib/traffic/server.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dependencies: Record<string, unknown> = {
  "@/lib/supabase/service": { getServiceClient: () => db },
  "@/lib/auth/server-session": {}, "@/lib/auth/server-acl": {},
  "@/lib/traffic/vehicle-eligibility": eligibility,
  "@/lib/vehicles/driver-name": { activeAssignedDriverName, vehicleAllowsMachineOperator }, "./model": model,
};
vm.runInNewContext(code, { module: moduleScope, exports: moduleScope.exports, Date,
  require: (name: string) => dependencies[name] ?? localRequire(name) });
async function main() {
  const snapshot = await moduleScope.exports.readSnapshot(companyId, "manager", "Агроном");
  check(snapshot.companyId, companyId);
  check(snapshot.vehicles[0].driver, person.full_name);
  check(snapshot.vehicles[0].state, "loaded");
  check(snapshot.vehicles[0].version, 9);
  check(snapshot.vehicles[0].cycle, 3);
  check(snapshot.vehicles.length, 1);
  check(snapshot.events.map((event: { id: string }) => event.id), ["visible-event", "retained-event"]);
  check(queries.some(q => q.table === "reference_specialists" && q.columns.includes("person:person_id")), true);
  fixture.reference_specialists = [{ ...specialist, person: { ...person, status: "inactive" } }];
  check((await moduleScope.exports.readSnapshot(companyId, "receiver", "Бригадир")).vehicles[0].driver, null);
  const references = readFileSync("app/(dashboard)/references/page.tsx", "utf8");
  check(references.includes('"Водитель",'), true);
  check(references.includes("vehicleAllowsMachineOperator(row)"), true);
  check(references.includes('result.vehicle.driverRoleType === "mechanic_operator"'), true);
  check(references.includes("result.companyId !== companyId"), true);
  check(references.includes("assignmentUpdates.current.get(row.id)"), true);
  check(readFileSync("lib/services/references.ts", "utf8").includes("person:person_id(full_name,company_id,role_type,status,deleted_at)"), true);
  console.log(`Vehicle driver surfaces PASS: ${checks} (canonical hydration, actual PTC snapshot, reference wiring; no database writes)`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
