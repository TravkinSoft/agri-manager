import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeWeighbridgeTransportCatalog } from "../lib/weighbridge/transport";
import { preferredDriverForVehicle } from "../lib/weighbridge/transport-pairing";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const resources = read("app/api/weighbridge/resources/route.ts");
const operatorSession = read("app/api/weighbridge/operator-session/route.ts");
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

check("both bootstrap paths keep canonical vehicles and suppress linked machine duplicates", () => {
  assert.match(resources, /source_machine_id/);
  assert.doesNotMatch(resources, /\.is\("source_machine_id",\s*null\)/);
  assert.match(resources, /mergeWeighbridgeTransportCatalog\(vehicleRows, machineRows\)/);
  assert.match(operatorSession, /mergeWeighbridgeTransportCatalog\(vehicleRows, machineRows\)/);
  assert.match(operatorSession, /canonicalMachineLinks/);
});

check("the obsolete weighman receiver cabinet is removed from navigation and redirects", () => {
  const weighmanSidebar = sidebar.slice(sidebar.indexOf("const WEIGHMAN_NAV"), sidebar.indexOf("const SPECIALIST_NAV"));
  const weighmanMobile = mobileNav.slice(mobileNav.indexOf('case "weighman"'), mobileNav.indexOf('case "fuel_operator"'));
  assert.doesNotMatch(weighmanSidebar, /weighbridge\/traffic/);
  assert.doesNotMatch(weighmanMobile, /weighbridge\/traffic/);
  assert.match(legacyReceiverPage, /redirect\("\/weighbridge"\)/);
});

console.log(JSON.stringify({ suite: "P0 weighbridge operator automation", passed, failed: 0 }, null, 2));
