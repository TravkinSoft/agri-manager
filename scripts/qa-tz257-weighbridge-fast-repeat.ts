import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
  createUniversalWorkspace,
  parseUniversalWorkspaceState,
  serializeUniversalWorkspaceState,
  universalWorkspaceStorageKey,
} from "../lib/weighbridge/universal-workspaces";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const ticketPaper = read("components/weighbridge/weighbridge-ticket-paper.tsx");

const initialForm = {
  operationType: "harvest_incoming",
  fieldId: "",
  cropStructureAllocationId: "",
  warehouseToId: "",
  cropId: "",
  varietyId: "",
  reproductionId: "",
  vehicleId: "",
  driverId: "",
  grossKg: "",
  notes: "",
};

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const workspace = createUniversalWorkspace({
  ...initialForm,
  fieldId: "field-1",
  cropStructureAllocationId: "allocation-1",
  warehouseToId: "destination-1",
  cropId: "crop-1",
  varietyId: "variety-1",
  reproductionId: "reproduction-1",
  vehicleId: "vehicle-on-current-trip",
  driverId: "driver-on-current-trip",
  grossKg: "31420",
  notes: "current trip",
}, "harvest_incoming", "workspace-1");
const serializedWorkspace = serializeUniversalWorkspaceState({
  version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
  selectedId: workspace.id,
  workspaces: [workspace],
  migratedLegacyHarvest: true,
});
const restoredWorkspace = parseUniversalWorkspaceState(serializedWorkspace, initialForm);
const createResultIndex = page.indexOf("const result = await createTicket");
const resetStart = page.indexOf("setForm((prev) => {", createResultIndex);
const resetEnd = page.indexOf("setSupplierReceiptLines", resetStart);
const postGrossReset = page.slice(resetStart, resetEnd);
const harvestPostGrossReset = postGrossReset.match(/if \(prev\.operationType === "harvest_incoming"\) \{[\s\S]*?\n        \}/)?.[0] || "";
const closeShiftStart = page.indexOf("const closeShiftAction");
const closeShiftEnd = page.indexOf("const ", closeShiftStart + 25);
const closeShiftBlock = page.slice(closeShiftStart, closeShiftEnd);

check("new ticket form has no trailer selector", () => assert.doesNotMatch(page, /form\.trailerId|trailerSearch|Прицеп \(необязательно\)/));
check("new ticket payload has no trailer", () => assert.doesNotMatch(page, /trailer_id:\s*form\./));
check("legacy trailer remains readable", () => assert.match(ticketPaper, /trailer_name_snapshot[\s\S]*label="Прицеп"/));
check("backend keeps optional legacy trailer support", () => assert.match(ticketRoute, /if \(requestedTrailerId\)/));
check("workspace key requires company", () => assert.equal(universalWorkspaceStorageKey("", "season-1", "terminal-1"), ""));
check("workspace key requires season", () => assert.equal(universalWorkspaceStorageKey("company-1", "", "terminal-1"), ""));
check("workspace key requires workstation and contains the full scope", () => assert.equal(
  universalWorkspaceStorageKey("company-1", "season-1", "terminal-1"),
  "travkin.weighbridge.universalWorkspaces.v3.company-1.season-1.terminal-1"
));
check("field carries over", () => assert.equal(restoredWorkspace?.workspaces[0].form.fieldId, "field-1"));
check("field allocation carries over", () => assert.equal(restoredWorkspace?.workspaces[0].form.cropStructureAllocationId, "allocation-1"));
check("reception place carries over", () => assert.equal(restoredWorkspace?.workspaces[0].form.warehouseToId, "destination-1"));
check("in-progress trip survives refresh inside its workspace", () => assert.deepEqual(
  {
    vehicleId: restoredWorkspace?.workspaces[0].form.vehicleId,
    driverId: restoredWorkspace?.workspaces[0].form.driverId,
    grossKg: restoredWorkspace?.workspaces[0].form.grossKg,
    notes: restoredWorkspace?.workspaces[0].form.notes,
  },
  {
    vehicleId: "vehicle-on-current-trip",
    driverId: "driver-on-current-trip",
    grossKg: "31420",
    notes: "current trip",
  }
));
check("valid universal workspace state reloads", () => assert.equal(restoredWorkspace?.selectedId, "workspace-1"));
check("broken persisted workspace state is ignored", () => assert.equal(parseUniversalWorkspaceState("{", initialForm), null));
check("repeatable crop identity is preserved after GROSS", () => assert.match(harvestPostGrossReset, /cropId: prev\.cropId[\s\S]*varietyId: prev\.varietyId[\s\S]*reproductionId: prev\.reproductionId/));
check("harvest reset clears notes and weight through INITIAL_FORM", () => {
  assert.match(harvestPostGrossReset, /\.\.\.INITIAL_FORM/);
  assert.doesNotMatch(harvestPostGrossReset, /notes:\s*prev\.notes|grossKg:\s*prev\.grossKg/);
});
check("harvest reset clears vehicle", () => assert.doesNotMatch(harvestPostGrossReset, /vehicleId:\s*prev\.vehicleId/));
check("harvest reset clears driver", () => assert.doesNotMatch(harvestPostGrossReset, /driverId:\s*prev\.driverId/));
check("finalize clears tare input", () => assert.match(page, /await finalizeTicket[\s\S]*setClosingTare\(""\)/));
check("finalize clears moisture input", () => assert.match(page, /await finalizeTicket[\s\S]*setClosingMoisture\(""\)/));
check("closing shift keeps terminal workspaces for handover", () => assert.doesNotMatch(closeShiftBlock, /setForm|setWorkspaces|localStorage\.removeItem/));
check("workspace persistence is independent of shift lifecycle", () => {
  assert.match(page, /universalWorkspaceStorageKey\([\s\S]*profile\?\.company_id,[\s\S]*activeHarvestSeasonId,[\s\S]*workstationId/);
  assert.notEqual(universalWorkspaceStorageKey("company-1", "season-1", "terminal-1"), "");
});
check("idempotency remains separately persisted", () => assert.match(page, /idempotencyPersistKey/));

assert.equal(passed, 22);
console.log(`TZ257 ${passed}/${passed} PASS`);
