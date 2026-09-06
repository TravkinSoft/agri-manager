import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { canAccessPath, getDefaultPathForRole } from "../lib/auth/role-access";
import { parseCanonicalRole } from "../lib/auth/role-contract";
import { operatorRole } from "../lib/traffic/model";
import { isTrafficOperatorRole } from "../lib/auth/ptc-invitations";
import { filterFleet } from "../lib/fleet/model";
import { activeAssignedDriverName } from "../lib/vehicles/driver-name";
import { readVehicleRepairs } from "../lib/fleet/repairs-server";
import { readCompanyFleet } from "../lib/fleet/server";

const company = "00000000-0000-4000-8000-000000000001";
const foreign = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";
const userId = "00000000-0000-4000-8000-000000000004";
let checks = 0;
const equal = (a: unknown, b: unknown) => { assert.deepEqual(a, b); checks++; };
class SessionAuthError extends Error { constructor(message: string, public status = 403) { super(message); } }

async function main() {
  equal(parseCanonicalRole("fleet_manager"), "fleet_manager");
  equal(getDefaultPathForRole("fleet_manager"), "/traffic");
  for (const path of ["/fleet", "/traffic", "/auth/set-password"]) equal(canAccessPath("fleet_manager", path), true);
  for (const path of ["/users", "/weighbridge", "/references", "/settings", "/warehouses", "/dashboard", "/fleet/other"]) {
    equal(canAccessPath("fleet_manager", path), false);
  }
  equal(operatorRole("fleet_manager"), null);
  equal(isTrafficOperatorRole("fleet_manager"), true);
  const fleet = [
    { id: "one", name: "КАМАЗ", plate: "984 AE 15", driver: "Иванов Иван" },
    { id: "two", name: "ЗИЛ", plate: "T-309 BK", driver: null },
  ];
  equal(filterFleet(fleet, "984ae15", false).map(v => v.id), ["one"]);
  equal(filterFleet(fleet, "ИВАН", false).map(v => v.id), ["one"]);
  equal(filterFleet(fleet, "", true).map(v => v.id), ["two"]);
  equal(filterFleet(fleet, "несуществующая", false), []);

  // Execute the real GET handler with fault-injected identity/DB boundaries.
  let role = "fleet_manager";
  const rows = Array.from({ length: 251 }, (_, i) => ({
    id: String(i), company_id: company, is_active: true, archived: false,
    name: "КАМАЗ", license_plate: String(i), primary_responsible_personnel_id: "driver",
    type: "truck", fleet_type: "truck", ptc_enabled: true,
  }));
  const person = { full_name: "Иван", company_id: company, status: "active", role_type: "driver", deleted_at: null };
  const specialists = [{ id: "driver", company_id: company, archived: false, status: "active", personnel_type: "driver", person }];
  let queries = 0;
  const db = { from(table: string) {
    queries++;
    let subset: any[] = table === "reference_vehicles" ? [...rows,
      { ...rows[0], id: "foreign", company_id: foreign }, { ...rows[0], id: "archived", archived: true }] : table === "fleet_vehicle_repairs"
      ? [{ vehicle_id: "0", company_id: company, in_repair: true, version: 3 }, { vehicle_id: "1", company_id: foreign, in_repair: true, version: 9 }] : specialists;
    let start = 0, end = Infinity;
    const q: any = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { subset = subset.filter(row => row[key] === value); return q; },
      in: (key: string, values: unknown[]) => { subset = subset.filter(row => values.includes(row[key])); return q; },
      range: (a: number, b: number) => { start = a; end = b; return q; },
      then: (resolve: any, reject: any) => Promise.resolve({ data: subset.slice(start, end + 1), error: null }).then(resolve, reject),
    };
    return q;
  } };
  const source = ts.transpileModule(fs.readFileSync("app/api/fleet/route.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(source, { module, exports: module.exports, require: (name: string) => {
    if (name === "zod") return { z };
    if (name === "@/lib/auth/server-session") return {
      SessionAuthError,
      getServerActorFromSession: async (_req: unknown, options: unknown) => {
        equal(JSON.parse(JSON.stringify(options)), { ignoreImpersonation: true, skipCache: true });
        return { id: actorId, role, companyId: company };
      },
      resolveCompanyForActor: (_actor: unknown, requested: string | null) => {
        if (requested && requested !== company) throw new SessionAuthError("Foreign company");
        return company;
      },
    };
    if (name === "@/lib/auth/server-acl") return { assertActorAccess: async (options: any) => {
      equal(options.companyId, company); equal(options.allowedRoles.includes(role), true);
    } };
    if (name === "@/lib/supabase/service") return { getServiceClient: () => db };
    if (name === "@/lib/fleet/server") return { readCompanyFleet };
    if (name === "@/lib/vehicles/driver-name") return { activeAssignedDriverName };
    if (name === "@/lib/fleet/repairs-server") return { readVehicleRepairs };
    if (name === "@/lib/traffic/server") return {
      noStore: (body: unknown) => new Response(JSON.stringify(body), { headers: { "Cache-Control": "no-store, private" } }),
      failed: (error: any) => new Response("denied", { status: error.status || 500 }),
    };
    throw new Error(name);
  } });
  const get = (c = company) => module.exports.GET({ nextUrl: new URL(`https://test/api/fleet?companyId=${c}`) }) as Promise<Response>;
  const response = await get();
  equal(response.status, 200);
  equal(response.headers.get("Cache-Control"), "no-store, private");
  const payload = await response.json();
  equal(payload.companyId, company);
  equal(payload.vehicles.length, 251);
  equal(payload.vehicles[0].driver, "Иван");
  equal(queries, 8);
  equal(payload.vehicles[0].inRepair, true);
  equal(payload.vehicles[0].repairVersion, 3);
  equal(payload.vehicles[1].inRepair, false);
  equal(payload.vehicles[1].repairVersion, 0);
  person.company_id = foreign;
  equal((await (await get()).json()).vehicles[0].driver, null);
  person.company_id = company;
  equal((await get(foreign)).status, 403);
  for (const denied of ["mechanic_operator", "vegetable_brigadier", "agronomist", "specialist"]) {
    role = denied;
    const before = queries;
    equal((await get()).status, 403);
    equal(queries, before);
  }

  // PostgreSQL executes the migration and binding, not a string-presence assertion.
  const sql = new PGlite();
  await sql.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key, company_id uuid, role text, status text, full_name text, email text, is_owner boolean,
      constraint valid_role check(role in ('company_admin','mechanic_operator','vegetable_brigadier')));
    create table company_people(id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid, full_name text,
      role_type text, position text, status text, deleted_at timestamptz, created_by_user_id uuid, updated_by_user_id uuid);
    insert into profiles values('${actorId}','${company}','company_admin','active','Admin','admin@test.invalid',false);
  `);
  await sql.exec(fs.readFileSync("supabase/migrations/20260905030901_fleet_manager_cabinet_v1.sql", "utf8"));
  const bind = (r: string, u: string, c = company) => sql.query(
    "select ptc_bind_invited_profile_v1($1,$2,$3,$4,$5,$6,null,true,true)",
    [actorId, u, c, r, `QA ${r}`, `${r}@test.invalid`]);
  await bind("fleet_manager", userId);
  const linked = await sql.query("select p.role,p.status,c.position,c.role_type from profiles p join company_people c on c.user_id=p.id where p.id=$1", [userId]);
  equal(linked.rows, [{ role: "fleet_manager", status: "pending", position: "Заведующий автопарком", role_type: "manager" }]);
  await assert.rejects(() => bind("company_admin", "00000000-0000-4000-8000-000000000005")); checks++;
  await assert.rejects(() => bind("fleet_manager", "00000000-0000-4000-8000-000000000006", foreign)); checks++;
  await bind("mechanic_operator", "00000000-0000-4000-8000-000000000007");
  await bind("vegetable_brigadier", "00000000-0000-4000-8000-000000000008");
  equal((await sql.query("select count(*)::int as n from company_people")).rows, [{ n: 3 }]);
  equal((await sql.query("select has_function_privilege('authenticated','ptc_bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean)','execute') as allowed")).rows, [{ allowed: false }]);
  await sql.close();
  console.log(`Fleet cabinet PASS: ${checks} behavioral checks; no hosted writes or email.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
