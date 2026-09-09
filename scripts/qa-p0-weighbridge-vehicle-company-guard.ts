import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  physicalWeighbridgeVehicleIds,
  requestedWeighbridgeVehicleSource,
  selectWeighbridgeVehicle,
} from "../lib/weighbridge/vehicle-guard";
import { resolveTransportIdentity } from "../lib/weighbridge/transport";

const ticketsRoute = readFileSync("app/api/weighbridge/tickets/route.ts", "utf8");

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_COMPANY_ID = "10000000-0000-4000-8000-000000000002";
const DIRECT_VEHICLE_ID = "20000000-0000-4000-8000-000000000001";
const MACHINE_ID = "30000000-0000-4000-8000-000000000001";
const PROJECTION_ID = "40000000-0000-4000-8000-000000000001";
const SECOND_PROJECTION_ID = "40000000-0000-4000-8000-000000000002";

const directVehicle = {
  id: DIRECT_VEHICLE_ID,
  company_id: COMPANY_ID,
  source_machine_id: null,
  type: "truck",
  is_active: true,
  archived: false,
};
const canonicalMachine = {
  id: MACHINE_ID,
  company_id: COMPANY_ID,
  type: "tractor",
  is_active: true,
  archived: false,
};
const legacyProjection = {
  id: PROJECTION_ID,
  company_id: COMPANY_ID,
  source_machine_id: MACHINE_ID,
  type: "tractor",
  is_active: true,
  archived: false,
};

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
};

const routeBlock = (start: string, end: string) => {
  const startIndex = ticketsRoute.indexOf(start);
  const endIndex = ticketsRoute.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `route block start is missing: ${start}`);
  assert.ok(endIndex > startIndex, `route block end is missing: ${end}`);
  return ticketsRoute.slice(startIndex, endIndex);
};

check("unknown or legacy audit source defaults to reference_vehicles", () => {
  assert.equal(requestedWeighbridgeVehicleSource(undefined), "reference_vehicles");
  assert.equal(requestedWeighbridgeVehicleSource("reference_vehicles"), "reference_vehicles");
  assert.equal(requestedWeighbridgeVehicleSource("legacy-client"), "reference_vehicles");
  assert.equal(requestedWeighbridgeVehicleSource("reference_machines"), "reference_machines");
});

check("direct same-company reference_vehicle remains selectable", () => {
  const selection = selectWeighbridgeVehicle({
    requestedId: DIRECT_VEHICLE_ID,
    requestedSource: "reference_vehicles",
    vehicleRow: directVehicle,
    machineRow: null,
  });
  assert.equal(selection?.source, "reference_vehicles");
  assert.equal(selection?.row.id, DIRECT_VEHICLE_ID);
  assert.deepEqual(physicalWeighbridgeVehicleIds(selection!), [DIRECT_VEHICLE_ID]);
});

check("canonical same-company reference_machine remains selectable", () => {
  const selection = selectWeighbridgeVehicle({
    requestedId: MACHINE_ID,
    requestedSource: "reference_machines",
    vehicleRow: null,
    machineRow: canonicalMachine,
  });
  assert.equal(selection?.source, "reference_machines");
  assert.equal(selection?.row.id, MACHINE_ID);
  assert.deepEqual(
    physicalWeighbridgeVehicleIds(selection!, [legacyProjection]),
    [MACHINE_ID, PROJECTION_ID],
  );
});

check("legacy same-company PTC projection is accepted and canonicalized to one physical alias set", () => {
  const selection = selectWeighbridgeVehicle({
    requestedId: PROJECTION_ID,
    requestedSource: "reference_vehicles",
    vehicleRow: legacyProjection,
    machineRow: null,
  });
  assert.equal(selection?.source, "reference_vehicles");
  assert.equal(selection?.row.id, PROJECTION_ID);
  assert.deepEqual(
    physicalWeighbridgeVehicleIds(selection!, [
      legacyProjection,
      { id: SECOND_PROJECTION_ID, source_machine_id: MACHINE_ID },
      { id: DIRECT_VEHICLE_ID, source_machine_id: null },
    ]),
    [PROJECTION_ID, MACHINE_ID, SECOND_PROJECTION_ID],
  );
});

check("stale source metadata safely falls back to the row that actually exists", () => {
  const machineFallback = selectWeighbridgeVehicle({
    requestedId: MACHINE_ID,
    requestedSource: "reference_vehicles",
    vehicleRow: null,
    machineRow: canonicalMachine,
  });
  const vehicleFallback = selectWeighbridgeVehicle({
    requestedId: DIRECT_VEHICLE_ID,
    requestedSource: "reference_machines",
    vehicleRow: directVehicle,
    machineRow: null,
  });
  assert.equal(machineFallback?.source, "reference_machines");
  assert.equal(vehicleFallback?.source, "reference_vehicles");
});

check("cross-company or unknown ID is rejected by company-scoped lookups", () => {
  const foreignRow = { ...legacyProjection, company_id: OTHER_COMPANY_ID };
  const companyScopedVehicleRow = foreignRow.company_id === COMPANY_ID ? foreignRow : null;
  const selection = selectWeighbridgeVehicle({
    requestedId: PROJECTION_ID,
    requestedSource: "reference_vehicles",
    vehicleRow: companyScopedVehicleRow,
    machineRow: null,
  });
  assert.equal(selection, null);
});

check("helper ignores unrelated rows instead of accepting a mismatched identity", () => {
  assert.equal(selectWeighbridgeVehicle({
    requestedId: PROJECTION_ID,
    requestedSource: "reference_vehicles",
    vehicleRow: directVehicle,
    machineRow: canonicalMachine,
  }), null);
});

check("synthetic PTC plate cannot hide a real company plate", () => {
  const identity = resolveTransportIdentity({
    name: "МТЗ 878",
    plate: "PTC-TRACTOR-878",
    plate_number: "PTC-TRACTOR-878",
    license_plate: "T 878 ATD",
  });
  assert.equal(identity.plate, "T 878 ATD");
  assert.equal(identity.label, "МТЗ 878 · T 878 ATD");
  assert.ok(identity.searchTerms.includes("T 878 ATD"));
  assert.ok(!identity.searchTerms.includes("PTC-TRACTOR-878"));
});

check("route reads both vehicle sources inside the authenticated ticket company", () => {
  const guard = routeBlock("const vehicleGuardPromise", "const trailerGuardPromise");
  assert.match(guard, /from\("reference_vehicles"\)[\s\S]*?\.eq\("company_id", ticket\.company_id\)[\s\S]*?\.eq\("id", ticket\.vehicle_id\)/);
  assert.match(guard, /from\("reference_machines"\)[\s\S]*?\.eq\("company_id", ticket\.company_id\)[\s\S]*?\.eq\("id", ticket\.vehicle_id\)/);
  assert.doesNotMatch(guard, /\.is\("source_machine_id", null\)/);
});

check("route rejects inactive, archived, and direct trailer rows after actual-source selection", () => {
  const selection = routeBlock("let selectedVehicle:", "if (ticket.driver_id)");
  assert.match(selection, /selectWeighbridgeVehicle\(\{[\s\S]*?requestedId: ticket\.vehicle_id,[\s\S]*?requestedSource: requestedVehicleSource/);
  assert.match(selection, /actualVehicleSource === "reference_machines"[\s\S]*?!isTrailerTransport\(\{/);
  assert.match(selection, /if \(!selectableVehicle\)[\s\S]*?Vehicle not found in current company/);
  assert.match(selection, /if \(!selectableVehicle\.is_active \|\| selectableVehicle\.archived\)[\s\S]*?Vehicle is inactive or archived/);
});

check("active-ticket guard covers canonical machine and every legacy projection alias", () => {
  const selection = routeBlock("let selectedVehicle:", "if (ticket.driver_id)");
  assert.match(selection, /const canonicalMachineId = actualVehicleSource === "reference_machines"/);
  assert.match(selection, /from\("reference_vehicles"\)[\s\S]*?\.eq\("company_id", ticket\.company_id\)[\s\S]*?\.eq\("source_machine_id", canonicalMachineId\)/);
  assert.match(selection, /physicalWeighbridgeVehicleIds\([\s\S]*?projectionResult\.data/);
  assert.match(selection, /const aliasVehicleIds = physicalVehicleIds\.filter/);
  assert.match(selection, /\.in\("vehicle_id", aliasVehicleIds\)[\s\S]*?\.in\("status", \["draft", "active", "ready_to_close"\]\)/);
  assert.match(selection, /code: "vehicle_active_ticket"/);
});

check("idempotent replay resolves before vehicle lookup and remains company scoped", () => {
  const idempotencyLookup = ticketsRoute.indexOf('measure("idempotency_lookup"');
  const replayReturn = ticketsRoute.indexOf("idempotent_replay: true", idempotencyLookup);
  const vehicleLookup = ticketsRoute.indexOf("const vehicleGuardPromise");
  assert.ok(idempotencyLookup >= 0 && replayReturn > idempotencyLookup);
  assert.ok(vehicleLookup > replayReturn, "vehicle guard must not invalidate a valid replay");
  const block = ticketsRoute.slice(idempotencyLookup, replayReturn);
  assert.match(block, /from\("tickets"\)[\s\S]*?\.eq\("id", idempotencyKey\)[\s\S]*?\.eq\("company_id", companyId\)/);
  assert.match(block, /existingFingerprint !== requestFingerprint[\s\S]*?status: 409/);
});

console.log(`P0 weighbridge vehicle/company guard PASS: ${passed}/${passed}`);
