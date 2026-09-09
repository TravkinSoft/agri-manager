import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAgronomistLastRoute } from "../lib/auth/last-route";

let checks = 0;
function contains(source: string, value: string) {
  assert.ok(source.includes(value), `Missing contract: ${value}`);
  checks++;
}

const page = readFileSync("app/(dashboard)/traffic/page.tsx", "utf8");
const board = readFileSync("components/traffic/traffic-board.tsx", "utf8");
const sidebar = readFileSync("components/layout/sidebar.tsx", "utf8");
const mobileNav = readFileSync("components/layout/mobile-bottom-nav.tsx", "utf8");
const trafficRoute = readFileSync("app/api/traffic/route.ts", "utf8");
const lineRoute = readFileSync("app/api/traffic/line/route.ts", "utf8");
const repairRoute = readFileSync("app/api/fleet/repair/route.ts", "utf8");
const fleetControls = readFileSync("components/traffic/traffic-fleet-controls.tsx", "utf8");
const operatorPage = readFileSync("app/traffic-operator/page.tsx", "utf8");
const trafficServer = readFileSync("lib/traffic/server.ts", "utf8");
const entityServer = readFileSync("lib/fleet/entity-creation-server.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260906221526_ptc_fleet_manager_only_mutations.sql",
  "utf8",
);

contains(trafficRoute, 'const canManageFleet = actor.role === "fleet_manager";');
contains(trafficRoute, 'actor.role === "agronomist"');
contains(trafficRoute, "readCompanyFleet(db, companyId)");
contains(trafficRoute, "canManageRepairs: canManageFleet");
contains(trafficRoute, "canCreateFleetEntities: canManageFleet");
contains(trafficRoute, "const { companyId } = await fleetManager(request);");

contains(page, "const canManageFleet = managed?.canManageFleet === true;");
contains(page, "onManageVehicle={canManageFleet ? setSelected : undefined}");
contains(page, "fleet={managed?.fleet}");
contains(page, "{canManageFleet && managed && live.data ? <TrafficFleetControls");
contains(board, 'loaded: "В пути на весовую"');
contains(board, '"h-[4.875rem] p-1.5 lg:h-24 lg:p-2.5"');
contains(board, 'data-testid="traffic-line-total"');
contains(board, '"offline"');
contains(board, "vehicle.assigned && !vehicle.inRepair");
contains(board, 'if (vehicle.inRepair) return "repair";');
contains(board, 'if (!vehicle.assigned) return "offline";');
contains(page, 'compactAgronomistMobile={managed?.managerRole === "agronomist"}');
assert.equal(page.includes('open("fleet")'), false);
checks++;
assert.equal(page.includes("drawerOpen"), false);
checks++;
assert.equal(operatorPage.includes('aria-label="Машины не на линии"'), false);
checks++;
assert.equal(operatorPage.includes("drawerOpen"), false);
checks++;
assert.equal(fleetControls.includes('type Panel = "offline"'), false);
checks++;
assert.equal(fleetControls.includes('data-testid={isOffline ? "offline-sheet"'), false);
checks++;
assert.equal(fleetControls.includes("offline-scroll-list"), false);
checks++;
contains(fleetControls, "assigned: selected.assigned");
contains(fleetControls, 'publishTrafficChanged(snapshot.companyId, "fleet")');
assert.equal(board.includes("traffic-empty-explainer"), false);
checks++;
assert.equal(sidebar.match(/const AGRONOMIST_NAV[\s\S]*?\];/)?.[0].includes('/tickets'), false);
checks++;
assert.equal(mobileNav.match(/case "agronomist":[\s\S]*?case "director"/)?.[0].includes('/tickets'), false);
checks++;
assert.equal(normalizeAgronomistLastRoute("/traffic"), "/traffic");
checks++;
assert.equal(normalizeAgronomistLastRoute("/crop-structure?season=2026"), "/crop-structure?season=2026");
checks++;
for (const denied of ["/tickets", "/tickets/one", "/auth/login", "//evil.test/traffic", "/\\evil.test/traffic", "https://evil.test/traffic"]) {
  assert.equal(normalizeAgronomistLastRoute(denied), null);
  checks++;
}

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
