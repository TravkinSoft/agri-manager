import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const page = read("app/(dashboard)/weighbridge/page.tsx");
const operatorRoute = read("app/api/weighbridge/operator-session/route.ts");
const workspace = read("lib/weighbridge/universal-workspaces.ts");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const migration = read("supabase/migrations/20260831224527_tz315_weighbridge_initial_workspace_v1.sql");
const roleCorrective = read("supabase/migrations/20260831225832_tz315_weighbridge_initial_workspace_role_corrective_v1.sql");
const getHandler = operatorRoute.slice(
  operatorRoute.indexOf("export async function GET"),
  operatorRoute.indexOf("export async function POST")
);
const businessLoadMarker = page.indexOf("// Business data starts only after the canonical operator session unlocks.");
const businessLoadEffectStart = page.lastIndexOf("useEffect(() => {", businessLoadMarker);
const businessLoadEffect = page.slice(businessLoadEffectStart, businessLoadMarker + 200);

check("initial load is one authenticated RPC", () => {
  assert.match(getHandler, /supabase\.rpc\("weighbridge_initial_workspace_v1"/);
  assert.doesNotMatch(getHandler, /getServerActorFromSession|resolveCompanyForActor|resolveWeighbridgeSession/);
});

check("RPC validates canonical actor and selected company", () => {
  assert.match(migration, /resolve_actor_context_from_session_v1\(\)/);
  assert.match(migration, /context_company_id is distinct from p_company_id/);
  assert.match(migration, /v_effective_company_id is distinct from p_company_id/);
});

check("locked operator state never receives workspace data", () => {
  assert.match(migration, /if not coalesce\(\(v_operator_state ->> 'unlocked'\)::boolean, false\)[\s\S]*?'initial_workspace', null/);
});

check("unlocked response contains only initial form resources", () => {
  for (const key of ["fields", "destinations", "vehicles", "people", "legacyDrivers", "profiles", "allocations"]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(migration, /harvest[_ ]?batches|stock_ledger_entries|batch_transformations/);
});

check("client hydrates the usable form from operator response", () => {
  assert.match(page, /applyInitialOperatorWorkspace\(\(nextState as any\)\.initial_workspace\)/);
  assert.match(page, /setCoreDataReady\(true\)[\s\S]*?setLoading\(false\)/);
  assert.match(page, /verifyOperatorSession\(controller\.signal, true\)/);
});

check("background business reconciliation remains behind canonical unlock", () => {
  assert.match(businessLoadEffect, /if \(canUseOperatorSession && !operatorState\.unlocked\) return;/);
  assert.match(businessLoadEffect, /usedInitialWorkspace[\s\S]*?loadTransportPickerDataCached/);
  assert.match(businessLoadEffect, /else \{[\s\S]*?tasks\.push\(load\(/);
});

check("default destination is isolated by company and workstation", () => {
  assert.match(workspace, /travkin\.weighbridge\.defaultDestination\.v1\.\$\{company\}\.\$\{workstation\}/);
  assert.match(page, /getWeighbridgeDefaultDestinationId[\s\S]*?profile\.company_id,[\s\S]*?workstationId/);
});

check("only an active YARD is eligible for automatic default", () => {
  assert.match(page, /warehouses\.filter\(\(warehouse\) => warehouse\.placeType === "YARD"\)/);
  assert.match(page, /yards\.length === 1 \? yards\[0\] : null/);
});

check("operator can override destination without changing terminal default", () => {
  assert.match(page, /onValueChange=\{\(warehouseToId\) => setForm/);
  const harvestPicker = page.slice(page.indexOf("<Label>Место приёмки *"), page.indexOf("isImpurityRemoval", page.indexOf("<Label>Место приёмки *")));
  assert.doesNotMatch(harvestPicker, /setWeighbridgeDefaultDestinationId/);
});

check("manual-first weight source is truthful and auditable", () => {
  assert.match(page, /Ручной ввод/);
  assert.doesNotMatch(page, /Live вес/);
  assert.match(ticketRoute, /device_source:\s*"manual"/);
});

check("migration is additive and grants only execution", () => {
  assert.match(migration, /create or replace function public\.weighbridge_initial_workspace_v1/);
  assert.match(migration, /p_include_workspace boolean default false/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from|update public\./i);
  assert.match(migration, /revoke all on function[\s\S]*?from public, anon/);
  assert.match(migration, /grant execute on function[\s\S]*?to authenticated/);
  assert.match(roleCorrective, /'global_admin', 'company_admin', 'director', 'weighman'/);
  assert.doesNotMatch(roleCorrective, /'weighbridge_operator'|'agronomist'|'warehouse_operator'|'specialist'/);
  assert.doesNotMatch(roleCorrective, /drop table|truncate|delete from|update public\./i);
  assert.match(roleCorrective, /revoke all on function[\s\S]*?from public, anon/);
});

assert.equal(passed, 11);
console.log(`TZ315 weighbridge initial/YARD/manual regression PASS: ${passed}/11`);
