import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const requireLocal = createRequire(import.meta.url);
let checks = 0;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function check(actual: unknown, expected: unknown) { assert.deepEqual(plain(actual), plain(expected)); checks++; }
function load(path: string, dependencies: Record<string, unknown>) {
  const loaded = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: loaded, exports: loaded.exports, Error, SyntaxError, Date, process,
    require: (key: string) => dependencies[key] ?? requireLocal(key),
  });
  return loaded.exports;
}
const company = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const actorId = "20000000-0000-4000-8000-000000000001";
const vehicleId = "30000000-0000-4000-8000-000000000001";
const vehicle2 = "30000000-0000-4000-8000-000000000002";
const personId = "40000000-0000-4000-8000-000000000001";
const person2 = "40000000-0000-4000-8000-000000000002";
const specialistId = "50000000-0000-4000-8000-000000000001";
const specialist2 = "50000000-0000-4000-8000-000000000002";
const vehicle = { id: vehicleId, company_id: company, archived: false, name: "KAMAZ", brand: null, model: null,
  license_plate: "QA-207", plate_number: "old", primary_responsible_personnel_id: null, status: "in_trip" };
const driver = { id: personId, company_id: company, full_name: "Canonical Driver", role_type: "driver", status: "active", deleted_at: null };
const specialist = { id: specialistId, company_id: company, person_id: personId, full_name: "Old copied name", personnel_type: "driver", status: "active", archived: false };
type Row = Record<string, any>;
type Options = {
  role?: string; profileRole?: string; profileStatus?: string | null; profileCompany?: string; authUserId?: string;
  people?: Row[]; specialists?: Row[]; vehicles?: Row[]; noSession?: boolean; unlocked?: boolean;
  raceAssignment?: string | null; insertConflict?: boolean; orphanConflict?: boolean;
  failReadTable?: string; failWrite?: boolean; deactivateAfterInsert?: boolean;
};
function setup(options: Options = {}) {
  const tables: Record<string, Row[]> = {
    profiles: [{ id: actorId, role: options.profileRole ?? options.role ?? "agronomist", status: options.profileStatus === undefined ? "active" : options.profileStatus, company_id: options.profileCompany ?? company }],
    company_people: plain(options.people ?? [driver]),
    reference_specialists: plain(options.specialists ?? []),
    reference_vehicles: plain(options.vehicles ?? [vehicle, { ...vehicle, id: vehicle2, primary_responsible_personnel_id: specialistId }]),
  };
  const calls: any[] = [], auth: any[] = [], pins: any[] = [];
  let raceDone = false;
  const db = {
    from(table: string) {
      if (!(table in tables)) throw new Error(`Forbidden unexpected table ${table}`);
      let filters: any[] = [], fields = "*", payload: Row | undefined, op = "select", single = false;
      const run = async () => {
        calls.push({ table, filters: plain(filters), fields, payload: payload ? plain(payload) : null, op });
        if (op === "select" && options.failReadTable === table) return { data: null, error: new Error("secret database detail") };
        if (op !== "select" && options.failWrite) return { data: null, error: new Error("secret write detail") };
        const matches = (row: Row) => filters.every(([key, value]) => row[key] === value);
        let rows: Row[];
        if (op === "insert") {
          if (options.insertConflict) {
            if (!options.orphanConflict) tables[table].push({ ...payload!, id: specialistId });
            return { data: null, error: { code: "23505" } };
          }
          const inserted = { ...payload!, id: specialistId }; tables[table].push(inserted); rows = [inserted];
          if (options.deactivateAfterInsert) tables.company_people[0].status = "inactive";
        } else {
          if (op === "update" && !raceDone && "raceAssignment" in options) {
            tables.reference_vehicles[0].primary_responsible_personnel_id = options.raceAssignment;
            raceDone = true;
          }
          rows = tables[table].filter(matches);
          if (op === "update") rows.forEach(row => Object.assign(row, payload));
        }
        const selected = rows.map(row => fields === "*" ? { ...row } : Object.fromEntries(fields.split(",").map(key => key.trim()).map(key => [key, row[key]])));
        return { data: single ? selected[0] ?? null : selected, error: null };
      };
      const q: any = {
        select(value: string) { fields = value; return q; },
        eq(key: string, value: unknown) { filters.push([key, value]); return q; },
        is(key: string, value: unknown) { filters.push([key, value]); return q; },
        order() { return q; },
        insert(value: Row) { op = "insert"; payload = value; return q; },
        update(value: Row) { op = "update"; payload = value; return q; },
        maybeSingle() { single = true; return q; }, single() { single = true; return q; },
        then(resolve: any, reject: any) { return run().then(resolve, reject); },
      };
      return q;
    },
  };
  class SessionAuthError extends Error { constructor(message: string, public status = 401) { super(message); } }
  const roles = load("lib/auth/role-contract.ts", {});
  // Test real company-resolution logic, real ACL and real PIN guard, not permissive stubs.
  const sessionModule = load("lib/auth/server-session.ts", { "@/lib/supabase/service": { getServiceClient: () => db }, "@/lib/auth/role-contract": roles });
  const session = {
    SessionAuthError,
    getServerActorFromSession: async (_request: unknown, opts: unknown) => {
      auth.push(opts);
      if (options.noSession) throw new SessionAuthError("Login required");
      return { id: actorId, authUserId: options.authUserId ?? actorId, role: options.role ?? "agronomist", companyId: company, contextCompanyId: company };
    },
    resolveCompanyForActor: (actor: unknown, requested: string) => {
      try { return sessionModule.resolveCompanyForActor(actor, requested); }
      catch (error: any) { throw new SessionAuthError(error.message, error.status); }
    },
    getUserScopedClientFromRequest: async () => ({ rpc: async (name: string, input: unknown) => {
      pins.push({ name, input });
      return { data: options.unlocked === false ? { unlocked: false } : { unlocked: true, operator: { id: person2 }, shift: { id: other } }, error: null };
    } }),
  };
  const acl = load("lib/auth/server-acl.ts", { "@/lib/auth/server-session": session, "@/lib/auth/role-contract": roles });
  const wb = load("app/api/weighbridge/_auth.ts", {
    "@/lib/auth/server-session": session, "@/lib/auth/server-acl": acl, "@/lib/supabase/service": { getServiceClient: () => db },
  });
  const eligibility = load("lib/traffic/vehicle-eligibility.ts", {});
  const helper = load("lib/vehicles/driver-assignment-server.ts", {
    "@/lib/supabase/service": { getServiceClient: () => db }, "@/lib/auth/server-session": session,
    "@/lib/auth/server-acl": acl, "@/lib/auth/role-contract": roles, "@/app/api/weighbridge/_auth": wb,
    "@/lib/traffic/vehicle-eligibility": eligibility,
  });
  const route = load("app/api/vehicles/driver-assignment/route.ts", { "@/lib/vehicles/driver-assignment-server": helper });
  const command = { vehicleId, driverPersonId: personId, expectedAssignmentId: null };
  function request(method = "GET", body: unknown = command, query = `vehicleId=${vehicleId}`, origin = "https://qa.travkinflow.com", site = "same-origin") {
    return { method, nextUrl: new URL(`https://qa.travkinflow.com/api/vehicles/driver-assignment?${query}`),
      headers: new Headers({ origin, "sec-fetch-site": site }), cookies: { get: () => ({ value: "test-pin-cookie" }) },
      json: async () => { if (body === "malformed") throw new SyntaxError("bad JSON"); return body; } };
  }
  return { tables, calls, auth, pins, route, request, command };
}
async function response(status: number, value: Promise<Response>) {
  const res = await value;
  if (res.status !== status) console.error("Unexpected API response", await res.clone().json());
  check(res.status, status); check(res.headers.get("cache-control"), "no-store, private"); return res.json();
}
async function main() {
  let s = setup({ specialists: [specialist], vehicles: [{ ...vehicle, primary_responsible_personnel_id: specialistId }], people: [driver,
    { ...driver, id: person2, company_id: other }, { ...driver, id: other, status: "inactive" }] });
  let body = await response(200, s.route.GET(s.request()));
  check(body.vehicle, { id: vehicleId, name: "KAMAZ", plate: "QA-207", assignmentId: specialistId, driverPersonId: personId, driverName: "Canonical Driver" });
  check(body.drivers, [{ id: personId, name: "Canonical Driver" }]); check(body.canEdit, true);
  check(s.auth, [{ ignoreImpersonation: true, skipCache: true }]); check(s.calls.some(c => c.op !== "select"), false);
  for (const role of ["global_admin", "company_admin", "agronomist", "weighman"]) {
    s = setup({ role }); body = await response(200, s.route.POST(s.request("POST")));
    check(body.vehicle.driverPersonId, personId); check(body.vehicle.assignmentId, specialistId);
    check(s.calls.filter(c => c.op === "update").map(c => [c.table, c.payload]), [["reference_vehicles", { primary_responsible_personnel_id: specialistId }]]);
    check(s.tables.reference_vehicles[1].primary_responsible_personnel_id, specialistId);
    check(s.pins.length, role === "weighman" ? 1 : 0);
    if (role === "weighman") check(s.pins[0], { name: "weighbridge_operator_session_state_v1", input: { p_company_id: company, p_session_token: "test-pin-cookie" } });
    const write = s.calls.find(c => c.op === "update");
    check(write.filters, [["company_id", company], ["id", vehicleId], ["archived", false], ["primary_responsible_personnel_id", null]]);
    const inserted = s.calls.find(c => c.op === "insert");
    check(inserted.payload.person_id, personId); check(inserted.payload.user_id, actorId);
  }
  for (const role of ["director", "warehouse", "warehouse_operator", "specialist"]) {
    s = setup({ role }); body = await response(200, s.route.GET(s.request())); check(body.canEdit, false);
    await response(403, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op !== "select"), false);
  }
  for (const role of ["mechanic_operator", "vegetable_brigadier", "fuel_operator", "brigadier", "legal_operator"]) {
    s = setup({ role }); await response(403, s.route.GET(s.request())); await response(403, s.route.POST(s.request("POST")));
    check(s.calls.some(c => c.table !== "profiles"), false);
  }
  s = setup({ authUserId: other }); await response(200, s.route.POST(s.request("POST")));
  check(s.calls.find(c => c.op === "insert").payload.user_id, other); // compatibility FK points to auth.users, not profiles
  for (const profileStatus of ["inactive", "archived", null]) {
    s = setup({ profileStatus }); await response(403, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op !== "select"), false);
  }
  s = setup({ profileRole: "director" }); await response(403, s.route.POST(s.request("POST")));
  s = setup({ profileCompany: other }); await response(403, s.route.POST(s.request("POST")));
  s = setup({ noSession: true }); await response(401, s.route.GET(s.request())); check(s.calls.length, 0);
  s = setup({ role: "weighman", unlocked: false }); await response(423, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op !== "select"), false);
  for (const role of ["global_admin", "agronomist"]) {
    s = setup({ role }); await response(403, s.route.GET(s.request("GET", null, `companyId=${other}&vehicleId=${vehicleId}`)));
    await response(403, s.route.POST(s.request("POST", { ...s.command, companyId: other })));
  }
  for (const malformed of [{ vehicleId }, { vehicleId, driverPersonId: "bad", expectedAssignmentId: null }, { ...setup().command, extra: true }, "malformed"]) {
    s = setup(); await response(400, s.route.POST(s.request("POST", malformed))); check(s.auth.length, 0);
  }
  s = setup(); await response(400, s.route.GET(s.request("GET", null, "vehicleId=bad"))); check(s.auth.length, 0);
  await response(400, s.route.GET(s.request("GET", null, `vehicleId=${vehicleId}&unknown=true`)));
  for (const [origin, site] of [["https://evil.invalid", "same-origin"], ["https://qa.travkinflow.com", "cross-site"], ["", "same-origin"]]) {
    s = setup(); await response(403, s.route.POST(s.request("POST", s.command, "", origin, site))); check(s.auth.length, 0);
  }
  for (const patch of [{ company_id: other }, { archived: true }]) {
    s = setup({ vehicles: [{ ...vehicle, ...patch }] }); await response(404, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op !== "select"), false);
  }
  for (const patch of [{ company_id: other }, { status: "inactive" }, { deleted_at: "2026-09-04" }, { role_type: "machine_operator" }]) {
    s = setup({ people: [{ ...driver, ...patch }] }); await response(400, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op !== "select"), false);
  }
  s = setup({ specialists: [specialist] }); await response(200, s.route.POST(s.request("POST"))); check(s.calls.filter(c => c.op === "insert").length, 0);
  s = setup({ specialists: [{ ...specialist, status: "inactive" }] }); await response(409, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op !== "select"), false);
  for (const patch of [{ status: "inactive" }, { archived: true }, { company_id: other }, { person_id: null }]) {
    s = setup({ specialists: [{ ...specialist, ...patch }], vehicles: [{ ...vehicle, primary_responsible_personnel_id: specialistId }] });
    body = await response(200, s.route.GET(s.request()));
    check(body.vehicle.assignmentId, specialistId); check(body.vehicle.driverPersonId, null); check(body.vehicle.driverName, null);
  }
  s = setup({ specialists: [{ ...specialist, person_id: null }] }); await response(200, s.route.POST(s.request("POST")));
  check(s.calls.filter(c => c.op === "insert").length, 1); // no matching by duplicate name
  s = setup({ insertConflict: true }); await response(200, s.route.POST(s.request("POST"))); check(s.tables.reference_specialists.length, 1);
  s = setup({ insertConflict: true, orphanConflict: true }); await response(409, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op === "update"), false);
  s = setup({ deactivateAfterInsert: true }); await response(409, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op === "update"), false);
  s = setup({ vehicles: [{ ...vehicle, primary_responsible_personnel_id: specialist2 }] });
  await response(409, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op !== "select"), false);
  s = setup({ specialists: [specialist], vehicles: [{ ...vehicle, primary_responsible_personnel_id: specialistId }] });
  await response(200, s.route.POST(s.request("POST"))); check(s.calls.some(c => c.op !== "select"), false); // lost response retry
  const otherDriver = { ...driver, id: person2, full_name: "Other driver" };
  const otherSpecialist = { ...specialist, id: specialist2, person_id: person2 };
  s = setup({ specialists: [specialist, otherSpecialist], people: [driver, otherDriver], raceAssignment: specialist2 });
  await response(409, s.route.POST(s.request("POST"))); check(s.tables.reference_vehicles[0].primary_responsible_personnel_id, specialist2);
  s = setup({ specialists: [specialist], raceAssignment: specialistId }); await response(200, s.route.POST(s.request("POST")));
  s = setup({ specialists: [specialist], vehicles: [{ ...vehicle, primary_responsible_personnel_id: specialistId }] });
  body = await response(200, s.route.POST(s.request("POST", { ...s.command, driverPersonId: null, expectedAssignmentId: specialistId })));
  check(body.vehicle.assignmentId, null); check(body.vehicle.driverName, null);
  check(s.calls.find(c => c.op === "update").filters.at(-1), ["primary_responsible_personnel_id", specialistId]);
  s = setup(); await response(200, s.route.POST(s.request("POST", { ...s.command, driverPersonId: null, expectedAssignmentId: specialistId })));
  check(s.calls.some(c => c.op !== "select"), false);
  s = setup({ failReadTable: "company_people" }); body = await response(500, s.route.GET(s.request())); check(JSON.stringify(body).includes("secret"), false);
  s = setup({ failWrite: true }); await response(500, s.route.POST(s.request("POST")));
  check(s.tables.reference_vehicles[0].primary_responsible_personnel_id, null);
  console.log(`PASS ${checks} vehicle driver API checks (actual route, authorization, PIN and assignment helpers; no database writes)`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
