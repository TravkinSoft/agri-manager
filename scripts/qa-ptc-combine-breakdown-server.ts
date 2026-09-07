import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const localRequire = createRequire(import.meta.url);
let checks = 0;
function equal(actual: unknown, expected: unknown, message?: string) {
  const normalize = (value: unknown) => value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
  assert.deepEqual(normalize(actual), normalize(expected), message);
  checks += 1;
}
function load(source: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} as any };
  vm.runInNewContext(output, {
    exports: loaded.exports,
    module: loaded,
    Error,
    require: (name: string) => dependencies[name] ?? localRequire(name),
  });
  return loaded.exports;
}

const companyId = "10000000-0000-4000-8000-000000000001";
const foreignCompanyId = "10000000-0000-4000-8000-000000000002";
const validOperator = "20000000-0000-4000-8000-000000000001";
const validPerson = "30000000-0000-4000-8000-000000000001";
const inactiveOperator = "20000000-0000-4000-8000-000000000002";
const inactivePerson = "30000000-0000-4000-8000-000000000002";
const wrongRoleOperator = "20000000-0000-4000-8000-000000000003";
const wrongRolePerson = "30000000-0000-4000-8000-000000000003";
const staleLinkOperator = "20000000-0000-4000-8000-000000000004";
const stalePerson = "30000000-0000-4000-8000-000000000004";
const replacementPerson = "30000000-0000-4000-8000-000000000005";
const duplicateLinkOperator = "20000000-0000-4000-8000-000000000005";
const duplicatePersonA = "30000000-0000-4000-8000-000000000006";
const duplicatePersonB = "30000000-0000-4000-8000-000000000007";
const recoveredOperator = "20000000-0000-4000-8000-000000000006";
const recoveredPerson = "30000000-0000-4000-8000-000000000008";
const foreignOperator = "20000000-0000-4000-8000-000000000008";

type Row = Record<string, any>;
const fixtures: Record<string, Row[]> = {
  ptc_flows: [{ company_id: companyId, enabled: true, field_id: null, updated_at: "2026-09-07T10:00:00Z" }],
  ptc_vehicle_states: [],
  ptc_events: [],
  ptc_last_vehicle_markers: [],
  ptc_combine_shifts: [],
  ptc_combine_operator_statuses: [
    { company_id: companyId, operator_user_id: validOperator, operator_person_id: validPerson, operator_name: "Действующий комбайнёр", is_broken: true, version: 1, changed_at: "2026-09-07T10:05:00Z" },
    { company_id: companyId, operator_user_id: inactiveOperator, operator_person_id: inactivePerson, operator_name: "Неактивный", is_broken: true, version: 1, changed_at: "2026-09-07T10:04:00Z" },
    { company_id: companyId, operator_user_id: wrongRoleOperator, operator_person_id: wrongRolePerson, operator_name: "Уже не комбайнёр", is_broken: true, version: 2, changed_at: "2026-09-07T10:03:00Z" },
    { company_id: companyId, operator_user_id: staleLinkOperator, operator_person_id: stalePerson, operator_name: "Старая связь", is_broken: true, version: 3, changed_at: "2026-09-07T10:02:00Z" },
    { company_id: companyId, operator_user_id: duplicateLinkOperator, operator_person_id: duplicatePersonA, operator_name: "Дублированная связь", is_broken: true, version: 4, changed_at: "2026-09-07T10:01:00Z" },
    { company_id: companyId, operator_user_id: recoveredOperator, operator_person_id: recoveredPerson, operator_name: "Работает", is_broken: false, version: 7, changed_at: "2026-09-07T10:00:00Z" },
    { company_id: foreignCompanyId, operator_user_id: foreignOperator, operator_person_id: recoveredPerson, operator_name: "Чужая компания", is_broken: true, version: 1, changed_at: "2026-09-07T10:06:00Z" },
  ],
  profiles: [
    { id: validOperator, company_id: companyId, role: "mechanic_operator", status: "active" },
    { id: inactiveOperator, company_id: companyId, role: "mechanic_operator", status: "inactive" },
    { id: wrongRoleOperator, company_id: companyId, role: "weighman", status: "active" },
    { id: staleLinkOperator, company_id: companyId, role: "mechanic_operator", status: "active" },
    { id: duplicateLinkOperator, company_id: companyId, role: "mechanic_operator", status: "active" },
    { id: recoveredOperator, company_id: companyId, role: "mechanic_operator", status: "active" },
  ],
  company_people: [
    { id: validPerson, company_id: companyId, user_id: validOperator, status: "active", deleted_at: null },
    { id: inactivePerson, company_id: companyId, user_id: inactiveOperator, status: "active", deleted_at: null },
    { id: wrongRolePerson, company_id: companyId, user_id: wrongRoleOperator, status: "active", deleted_at: null },
    { id: replacementPerson, company_id: companyId, user_id: staleLinkOperator, status: "active", deleted_at: null },
    { id: duplicatePersonA, company_id: companyId, user_id: duplicateLinkOperator, status: "active", deleted_at: null },
    { id: duplicatePersonB, company_id: companyId, user_id: duplicateLinkOperator, status: "active", deleted_at: null },
    { id: recoveredPerson, company_id: companyId, user_id: recoveredOperator, status: "active", deleted_at: null },
  ],
  reference_vehicles: [],
};

const queriedTables: string[] = [];
function database() {
  return {
    from(table: string) {
      queriedTables.push(table);
      const filters: Array<(row: Row) => boolean> = [];
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        is: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        gte: () => query,
        lte: () => query,
        order: () => query,
        limit: () => query,
        range: () => query,
        maybeSingle: async () => ({
          data: (fixtures[table] ?? []).filter((row) => filters.every((filter) => filter(row)))[0] ?? null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: (fixtures[table] ?? []).filter((row) => filters.every((filter) => filter(row))),
            error: null,
          }).then(resolve, reject),
      };
      return query;
    },
  };
}

class SessionAuthError extends Error {
  status = 401;
}
const responseJson = (body: unknown, init: { status: number; headers: Record<string, string> }) => ({
  body,
  status: init.status,
  headers: init.headers,
});
const server = load(readFileSync("lib/traffic/server.ts", "utf8"), {
  "next/server": { NextResponse: { json: responseJson } },
  "@/lib/supabase/service": { getServiceClient: database },
  "@/lib/auth/server-session": {
    getServerActorFromSession: async () => null,
    resolveCompanyForActor: () => companyId,
    SessionAuthError,
  },
  "@/lib/auth/server-acl": { assertActorAccess: async () => undefined },
  "@/lib/vehicles/driver-name": {
    activeAssignedDriverName: () => null,
    vehicleAllowsMachineOperator: () => false,
  },
  "@/lib/fleet/repairs-server": { readVehicleRepairs: async () => new Map() },
  "@/lib/fleet/model": { getFleetVehicleBrand: () => "" },
  "@/lib/traffic/vehicle-eligibility": {
    isPtcEligibleReferenceVehicle: () => true,
    isStructurallyPtcReferenceVehicle: () => true,
    ptcVehicleDisplayPlate: () => null,
  },
  "./model": { visibleVehicles: (vehicles: unknown[]) => vehicles, operatorRole: () => null },
  "./analytics": { calculateTrafficAnalytics: () => null },
});

async function main() {
  const manager = await server.readSnapshot(companyId, "manager", "");
  equal(manager.combineBreakdowns, [
    {
      operatorUserId: validOperator,
      operatorName: "Действующий комбайнёр",
      changedAt: "2026-09-07T10:05:00Z",
      version: 1,
    },
    {
      operatorUserId: inactiveOperator,
      operatorName: "Неактивный",
      changedAt: "2026-09-07T10:04:00Z",
      version: 1,
    },
    {
      operatorUserId: wrongRoleOperator,
      operatorName: "Уже не комбайнёр",
      changedAt: "2026-09-07T10:03:00Z",
      version: 2,
    },
    {
      operatorUserId: staleLinkOperator,
      operatorName: "Старая связь",
      changedAt: "2026-09-07T10:02:00Z",
      version: 3,
    },
    {
      operatorUserId: duplicateLinkOperator,
      operatorName: "Дублированная связь",
      changedAt: "2026-09-07T10:01:00Z",
      version: 4,
    },
  ], "a reported breakdown persists until explicit recovery, but never crosses tenants");
  equal(manager.ownCombineStatus, null);
  equal(queriedTables.includes("ptc_combine_operator_statuses"), true);
  equal(queriedTables.includes("profiles"), false, "breakdown polling adds no profile lookup");
  equal(queriedTables.includes("company_people"), false, "breakdown polling adds no people lookup");

  const recovered = await server.readSnapshot(
    companyId,
    "harvester",
    "Работает",
    false,
    recoveredOperator,
  );
  equal(recovered.ownCombineStatus, {
    operatorUserId: recoveredOperator,
    operatorName: "Работает",
    isBroken: false,
    changedAt: "2026-09-07T10:00:00Z",
    version: 7,
  });

  const newOperator = "20000000-0000-4000-8000-000000000007";
  const firstSnapshot = await server.readSnapshot(
    companyId,
    "harvester",
    "Новый комбайнёр",
    false,
    newOperator,
  );
  equal(firstSnapshot.ownCombineStatus, {
    operatorUserId: newOperator,
    operatorName: "Новый комбайнёр",
    isBroken: false,
    changedAt: null,
    version: 0,
  });

  equal(server.failed(new Error("PTC_COMBINE_STATUS_INVALID")).status, 400);
  equal(server.failed(new Error("PTC_COMBINE_STATUS_FORBIDDEN")).status, 403);
  equal(server.failed(new Error("PTC_COMBINE_STATUS_VERSION_CONFLICT")).status, 409);
  equal(server.failed(new Error("PTC_COMBINE_STATUS_NO_CHANGE")).status, 409);

  const routeSource = readFileSync(
    "app/api/traffic/operator/combine-breakdown/route.ts",
    "utf8",
  );
  let actorRole = "harvester";
  let sameOriginCalls = 0;
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const receipt = {
    ok: true,
    replayed: false,
    eventId: "40000000-0000-4000-8000-000000000001",
    operatorUserId: validOperator,
    operatorPersonId: validPerson,
    operatorName: "Действующий комбайнёр",
    isBroken: true,
    version: 1,
    changedAt: "2026-09-07T10:05:00Z",
    shiftId: null,
  };
  const route = load(routeSource, {
    "next/server": {},
    "@/lib/supabase/service": {
      getServiceClient: () => ({
        rpc: async (name: string, args: Record<string, unknown>) => {
          rpcCalls.push({ name, args });
          return { data: receipt, error: null };
        },
      }),
    },
    "@/lib/traffic/server": {
      failed: server.failed,
      noStore: server.noStore,
      operator: async () => ({ role: actorRole, actorId: validOperator }),
      sameOrigin: () => { sameOriginCalls += 1; },
      TrafficError: server.TrafficError,
    },
  });
  const key = "50000000-0000-4000-8000-000000000001";
  const valid = await route.POST({
    json: async () => ({ isBroken: true, version: 0, key }),
  });
  equal(valid.status, 200);
  equal(valid.body.operatorPersonId, undefined, "the public receipt omits internal person identity");
  equal(valid.body.isBroken, true);
  equal(valid.headers["Cache-Control"], "no-store, private");
  equal(sameOriginCalls, 1);
  equal(rpcCalls, [{
    name: "ptc_set_combine_breakdown_v1",
    args: {
      p_actor: validOperator,
      p_is_broken: true,
      p_expected_version: 0,
      p_key: key,
    },
  }]);

  const malformed = await route.POST({
    json: async () => ({ isBroken: true, version: 0, key, extra: true }),
  });
  equal(malformed.status, 400);
  equal(rpcCalls.length, 1, "invalid input never reaches the RPC");

  const outOfRange = await route.POST({
    json: async () => ({ isBroken: true, version: 2_147_483_647, key }),
  });
  equal(outOfRange.status, 400);
  equal(rpcCalls.length, 1, "an out-of-range PostgreSQL integer never reaches the RPC");

  const invalidJson = await route.POST({
    json: async () => { throw new SyntaxError("invalid JSON"); },
  });
  equal(invalidJson.status, 400);
  equal(rpcCalls.length, 1, "malformed JSON never reaches the RPC");

  actorRole = "weighman";
  const forbidden = await route.POST({
    json: async () => ({ isBroken: true, version: 0, key }),
  });
  equal(forbidden.status, 403);
  equal(rpcCalls.length, 1, "a non-harvester never reaches the RPC");

  console.log(
    `PTC combine breakdown server PASS: ${checks} checks; snapshot filtering, synthesized status, route validation and RPC envelope; no remote writes.`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
