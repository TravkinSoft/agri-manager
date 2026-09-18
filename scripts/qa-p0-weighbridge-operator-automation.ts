import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mergeWeighbridgeTransportCatalog,
  transportPickerOptionLabel,
} from "../lib/weighbridge/transport";
import { isPtcEligibleReferenceVehicle } from "../lib/traffic/vehicle-eligibility";
import { preferredDriverForVehicle } from "../lib/weighbridge/transport-pairing";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const resources = read("app/api/weighbridge/resources/route.ts");
const operatorSession = read("app/api/weighbridge/operator-session/route.ts");
const ptcQueueRoute = read("app/api/weighbridge/ptc-queue/route.ts");
const liveRefresh = read("hooks/use-live-refresh.ts");
const sidebar = read("components/layout/sidebar.tsx");
const mobileNav = read("components/layout/mobile-bottom-nav.tsx");
const legacyReceiverPage = read("app/(dashboard)/weighbridge/traffic/page.tsx");
let passed = 0;
function check(name: string, action: () => void) {
  action();
  passed += 1;
  console.log(`PASS ${passed} ${name}`);
}

check("canonical fleet card keeps its plate and hides only the linked technical machine", () => {
  const catalog = mergeWeighbridgeTransportCatalog(
    [
      { id: "vehicle-howo", sourceMachineId: "machine-howo", name: "HOWO", plate: "754", type: "truck" },
      { id: "vehicle-kamaz", sourceMachineId: null, name: "KAMAZ", plate: "058 YV 15", type: "truck" },
    ],
    [
      { id: "machine-howo", name: "HOWO", plate: "", type: "truck" },
      { id: "machine-unlinked", name: "МТЗ", plate: "T 075 ALB", type: "tractor" },
    ],
  );
  assert.deepEqual(catalog.map((row) => row.id), ["vehicle-howo", "vehicle-kamaz", "machine-unlinked"]);
  assert.equal((catalog[0] as { plate: string }).plate, "754");
});

check("short PTC fleet numbers stay visible in the weighbridge picker", () => {
  assert.equal(transportPickerOptionLabel({ name: "HOWO", plate: "754" }), "HOWO · 754");
  assert.equal(transportPickerOptionLabel({ name: "SHACMAN", plate: "683" }), "SHACMAN · 683");
  assert.equal(transportPickerOptionLabel({ name: "ЗИЛ", plate: "665" }), "ЗИЛ · 665");
});

check("vehicle choice suggests the latest completed-ticket driver but remains editable", () => {
  assert.equal(preferredDriverForVehicle({
    vehicle: { id: "vehicle-247", primaryPersonnelId: "stale-specialist" },
    drivers: [
      { id: "stale-driver", assignedVehicleIds: ["vehicle-247"] },
      { id: "latest-driver", assignedVehicleIds: [] },
    ],
    latestDriverByVehicle: { "vehicle-247": "latest-driver" },
    openAssignments: [],
  }), "latest-driver");
});

check("last manually selected combine operator survives ticket creation and plot changes", () => {
  assert.doesNotMatch(page, /combineOperatorPersonId:\s*persistentCombineOperator\s*\?/);
  assert.doesNotMatch(page, /cropStructureAllocationId:[\s\S]{0,500}combineOperatorPersonId:\s*""/);
  assert.match(page, /combineOperatorPersonId:\s*prev\.combineOperatorPersonId/);
});

check("both bootstrap paths expose only the complete PTC fleet", () => {
  assert.equal(isPtcEligibleReferenceVehicle({ ptc_enabled: true, type: "truck" }), true);
  assert.equal(isPtcEligibleReferenceVehicle({ ptc_enabled: false, type: "truck" }), false);
  assert.equal(isPtcEligibleReferenceVehicle({ ptc_enabled: true, type: "light_vehicle" }), false);
  assert.match(resources, /filter\(isPtcEligibleReferenceVehicle\)/);
  assert.match(operatorSession, /filter\(isPtcEligibleReferenceVehicle\)/);
  assert.doesNotMatch(resources, /from\("reference_machines"\)/);
  assert.doesNotMatch(operatorSession, /from\("reference_machines"\)/);
  assert.match(operatorSession, /\.eq\("ptc_enabled", true\)/);
  assert.match(resources, /ptcAssigned:/);
  assert.match(operatorSession, /ptcAssigned:/);
  assert.match(resources, /const ptcStateDb = getServiceClient\(\)[\s\S]*?ptcStateDb[\s\S]*?\.from\("ptc_vehicle_states"\)/);
  assert.match(operatorSession, /const ptcStatesPromise = initialWorkspace[\s\S]*?getServiceClient\(\)[\s\S]*?\.from\("ptc_vehicle_states"\)/);
});

check("the obsolete weighman receiver cabinet is removed from navigation and redirects", () => {
  const weighmanSidebar = sidebar.slice(sidebar.indexOf("const WEIGHMAN_NAV"), sidebar.indexOf("const SPECIALIST_NAV"));
  const weighmanMobile = mobileNav.slice(mobileNav.indexOf('case "weighman"'), mobileNav.indexOf('case "fuel_operator"'));
  assert.doesNotMatch(weighmanSidebar, /weighbridge\/traffic/);
  assert.doesNotMatch(weighmanMobile, /weighbridge\/traffic/);
  assert.match(legacyReceiverPage, /redirect\("\/weighbridge"\)/);
});

check("the harvest form follows the oldest loaded PTC trip without replacing an active draft", () => {
  assert.match(ptcQueueRoute, /\.eq\("state",\s*"loaded"\)/);
  assert.match(ptcQueueRoute, /Date\.parse\(left\.loadedAt\)\s*-\s*Date\.parse\(right\.loadedAt\)/);
  assert.match(page, /!workspaceReady \|\| !coreDataReady[\s\S]*?form\.operationType !== "harvest_incoming" \|\| form\.grossKg/);
  assert.match(page, /const transportIsEmpty = !form\.vehicleId && !form\.driverId/);
  assert.match(page, /if \(!transportIsEmpty && !completingSameQueuedVehicle\) return/);
  assert.match(page, /const next = ptcQueue\[0\] \|\| null/);
  assert.match(page, /setPtcQueue\(\(current\) => current\.filter\(\(item\) => item\.ptcEventId !== consumedPtcEventId\)\)/);
  assert.match(page, /ptcQueueGenerationRef\.current \+= 1/);
  assert.match(page, /generation === ptcQueueGenerationRef\.current/);
  assert.match(page, /if \(form\.operationType === "harvest_incoming"\) void refreshPtcQueue\(\)/);
  assert.match(liveRefresh, /"ptc_vehicle_states"/);
  assert.match(liveRefresh, /"ptc_events"/);
});

console.log(JSON.stringify({ suite: "P0 weighbridge operator automation", passed, failed: 0 }, null, 2));
