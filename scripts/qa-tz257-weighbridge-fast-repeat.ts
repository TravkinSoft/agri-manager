import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parseWeighbridgeFastRepeatContext,
  pickWeighbridgeFastRepeatContext,
  weighbridgeFastRepeatStorageKey,
} from "../lib/weighbridge/fast-repeat";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const context = pickWeighbridgeFastRepeatContext({
  fieldId: "field-1",
  cropStructureAllocationId: "allocation-1",
  warehouseToId: "destination-1",
});

check("new ticket form has no trailer selector", () => assert.doesNotMatch(page, /form\.trailerId|trailerSearch|Прицеп \(необязательно\)/));
check("new ticket payload has no trailer", () => assert.doesNotMatch(page, /trailer_id:\s*form\./));
check("legacy trailer remains readable", () => assert.match(page, /activeTrailer[\s\S]*Прицеп:/));
check("backend keeps optional legacy trailer support", () => assert.match(ticketRoute, /if \(requestedTrailerId\)/));
check("carry-over key requires company", () => assert.equal(weighbridgeFastRepeatStorageKey("", "shift-1"), ""));
check("carry-over key requires active shift", () => assert.equal(weighbridgeFastRepeatStorageKey("company-1", ""), ""));
check("carry-over key contains company and shift", () => assert.equal(
  weighbridgeFastRepeatStorageKey("company-1", "shift-1"),
  "travkin.weighbridge.fastRepeat.v1.company-1.shift-1"
));
check("field carries over", () => assert.equal(context.fieldId, "field-1"));
check("field allocation carries over", () => assert.equal(context.cropStructureAllocationId, "allocation-1"));
check("reception place carries over", () => assert.equal(context.warehouseToId, "destination-1"));
check("trip data is excluded from persisted context", () => assert.deepEqual(Object.keys(context).sort(), [
  "cropStructureAllocationId",
  "fieldId",
  "warehouseToId",
]));
check("valid persisted context reloads", () => assert.deepEqual(parseWeighbridgeFastRepeatContext(JSON.stringify(context)), context));
check("broken persisted context is ignored", () => assert.equal(parseWeighbridgeFastRepeatContext("{"), null));
check("derived crop identity is not persisted", () => assert.doesNotMatch(read("lib/weighbridge/fast-repeat.ts"), /cropId|varietyId|reproductionId/));
check("harvest reset clears notes", () => assert.match(page, /if \(prev\.operationType === "harvest_incoming"\)[\s\S]*\.\.\.INITIAL_FORM/));
check("harvest reset clears vehicle", () => assert.match(page, /if \(prev\.operationType === "harvest_incoming"\)[\s\S]*\.\.\.INITIAL_FORM/));
check("harvest reset clears driver", () => assert.doesNotMatch(page, /driverId:\s*prev\.driverId|vehicleId:\s*prev\.vehicleId/));
check("finalize clears tare input", () => assert.match(page, /await finalizeTicket[\s\S]*setClosingTare\(""\)/));
check("finalize clears moisture input", () => assert.match(page, /await finalizeTicket[\s\S]*setClosingMoisture\(""\)/));
check("closing shift removes carry-over", () => assert.match(page, /await closeShift[\s\S]*localStorage\.removeItem\(fastRepeatPersistKey\)/));
check("new shift starts from initial form", () => assert.match(page, /setForm\(INITIAL_FORM\)/));
check("idempotency remains separately persisted", () => assert.match(page, /idempotencyPersistKey/));

assert.equal(passed, 22);
console.log(`TZ257 ${passed}/${passed} PASS`);
