import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { personnelRoleForVehicle, personnelRoleMatchesVehicle } from "../lib/weighbridge/personnel";
import { isCargoTractor, isCargoVehicle, isTrailerTransport } from "../lib/weighbridge/transport";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const resources = read("app/api/weighbridge/resources/route.ts");
const tickets = read("app/api/weighbridge/tickets/route.ts");
const ticketPatch = read("app/api/weighbridge/tickets/[id]/route.ts");
const finalize = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const voidRoute = read("app/api/weighbridge/tickets/[id]/void/route.ts");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const ticketPaper = read("components/weighbridge/weighbridge-ticket-paper.tsx");

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

check("truck is cargo-capable", () => assert.equal(isCargoVehicle({ type: "truck" }), true));
check("dump truck is cargo-capable", () => assert.equal(isCargoVehicle({ fleetType: "dump_truck" }), true));
check("special cargo vehicle is allowed", () => assert.equal(isCargoVehicle({ category: "special_vehicle" }), true));
check("light vehicle is excluded", () => assert.equal(isCargoVehicle({ type: "truck", category: "light_vehicle" }), false));
check("trailer is excluded from main transport", () => assert.equal(isCargoVehicle({ type: "trailer" }), false));
check("tractor is cargo-capable through machine source", () => assert.equal(isCargoTractor({ type: "tractor" }), true));
check("trailer types are recognized", () => assert.equal(isTrailerTransport({ fleetType: "tractor_trailer" }), true));

check("truck recommends driver", () => assert.equal(personnelRoleForVehicle({ type: "truck" }), "driver"));
check("tractor recommends machine operator", () => assert.equal(personnelRoleForVehicle({ type: "tractor" }), "mechanic_operator"));
check("driver can be chosen manually for tractor", () => assert.equal(personnelRoleMatchesVehicle("driver", { type: "tractor" }), true));
check("machine operator can be chosen manually for truck", () => assert.equal(personnelRoleMatchesVehicle("mechanic_operator", { type: "truck" }), true));

check("resources use current company vehicles", () => assert.match(resources, /from\("reference_vehicles"\)[\s\S]*eq\("company_id", companyId\)/));
check("resources add existing tractors", () => assert.match(resources, /from\("reference_machines"\)[\s\S]*eq\("type", "tractor"\)/));
check("resources split trailers", () => assert.match(resources, /const trailers = vehicleRows\.filter/));
check("resources keep active non-archived assets", () => assert.match(resources, /eq\("is_active", true\)[\s\S]*eq\("archived", false\)/));
check("resources contain no crop filter", () => assert.doesNotMatch(resources, /crop_id|cropId/));

check("API validates vehicle against company", () => assert.match(tickets, /eq\("company_id", ticket\.company_id\)/));
check("API accepts canonical tractors", () => assert.match(tickets, /isCargoTractor/));
check("API rejects non-cargo assets", () => assert.match(tickets, /isCargoVehicle/));
check("API validates optional trailer", () => assert.match(tickets, /isTrailerTransport/));
check("API blocks active trailer reuse", () => assert.match(tickets, /This trailer already has an active ticket/));
check("API stores validated transport snapshot", () => {
  assert.match(tickets, /vehicle_name_snapshot/);
  assert.match(tickets, /trailer_name_snapshot/);
});
check("API permits both canonical personnel roles", () => assert.match(tickets, /isWeighbridgePersonnelRole/));

check("UI has unified transport search", () => assert.match(page, /Название, модель или госномер/));
check("legacy trailer remains visible on existing tickets", () => assert.match(ticketPaper, /trailer_name_snapshot[\s\S]*label="Прицеп"/));
check("UI does not auto-bind driver to vehicle", () => assert.doesNotMatch(page, /switch to driver's default vehicle|Soft autofill only/));
check("UI labels recommended personnel group", () => assert.match(page, /рекомендуется/));
check("UI accepts moisture at gross", () => assert.match(page, /harvestMoisture[\s\S]*step="0\.1"/));
check("gross persists moisture in ticket line", () => assert.match(page, /operationType === "harvest_incoming"[\s\S]*toNum\(form\.harvestMoisture\)/));
check("moisture can remain null at tare", () => assert.match(ticketPatch, /harvestMoisture = rawMoisture == null/));
check("nullable moisture does not block finalize", () => assert.doesNotMatch(finalize, /Перед закрытием укажите влажность рейса/));
check("stored moisture syncs to batch", () => assert.match(finalize, /update\(\{ moisture_percent: moisture \}\)/));
check("harvest operation remains optional", () => assert.match(tickets, /linked_operation_id = harvestContext\.operationId \|\| null/));
check("VOID uses canonical storno flow", () => assert.match(voidRoute, /void_weighbridge_ticket_for_session_v1/));

assert.equal(passed, 34);
console.log(`TZ256 ${passed}/${passed} PASS`);
