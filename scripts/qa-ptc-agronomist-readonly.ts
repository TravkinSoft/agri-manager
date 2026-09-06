import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let checks = 0;
function contains(source: string, value: string) {
  assert.ok(source.includes(value), `Missing contract: ${value}`);
  checks++;
}

const page = readFileSync("app/(dashboard)/traffic/page.tsx", "utf8");
const trafficRoute = readFileSync("app/api/traffic/route.ts", "utf8");
const lineRoute = readFileSync("app/api/traffic/line/route.ts", "utf8");
const repairRoute = readFileSync("app/api/fleet/repair/route.ts", "utf8");
const trafficServer = readFileSync("lib/traffic/server.ts", "utf8");
const entityServer = readFileSync("lib/fleet/entity-creation-server.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260906221526_ptc_fleet_manager_only_mutations.sql",
  "utf8",
);

contains(trafficRoute, 'const canManageFleet = actor.role === "fleet_manager";');
contains(trafficRoute, "canManageFleet ? readCompanyFleet(db, companyId) : Promise.resolve([])");
contains(trafficRoute, "canManageRepairs: canManageFleet");
contains(trafficRoute, "canCreateFleetEntities: canManageFleet");
contains(trafficRoute, "const { companyId } = await fleetManager(request);");

contains(page, "const canManageFleet = managed?.canManageFleet === true;");
contains(page, "onManageVehicle={canManageFleet ? setSelected : undefined}");
contains(page, "{canManageFleet && managed && live.data ? <TrafficFleetControls");
contains(page, "if (next !== \"history\" && !canManageFleet) return;");

contains(lineRoute, "const { actor, companyId } = await fleetManager(request);");
contains(repairRoute, "const { actor, companyId } = await fleetManager(request);");
contains(trafficServer, 'if (actor.role !== "fleet_manager")');
contains(trafficServer, 'allowedRoles: ["fleet_manager"]');
contains(entityServer, 'if (actor.role !== "fleet_manager")');
contains(entityServer, 'allowedRoles: ["fleet_manager"]');

const exactRoleChecks = migration.match(/coalesce\(actor_profile\.role, ''\) <> 'fleet_manager'/g) ?? [];
assert.equal(exactRoleChecks.length, 2);
checks++;
assert.equal(/actor_profile\.role[^\n]+(?:company_admin|global_admin|agronomist)/.test(migration), false);
checks++;

console.log(`PTC agronomist read-only PASS: ${checks} UI, payload, API and database contracts.`);
