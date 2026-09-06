import assert from "node:assert/strict";
import {
  isPtcEligibleReferenceVehicle,
  isStructurallyPtcReferenceVehicle,
} from "../lib/traffic/vehicle-eligibility";

let checks = 0;
const eligible = (row: Parameters<typeof isPtcEligibleReferenceVehicle>[0]) => {
  const result = isPtcEligibleReferenceVehicle({ ptc_enabled: true, ...row });
  checks++;
  return result;
};

for (const kind of ["truck", "grain_truck", "dump_truck", "tractor", "tractor_unit"]) {
  assert.equal(eligible({ type: kind }), true, `${kind} reference_vehicle is eligible`);
}

assert.equal(eligible({ type: "other", transport_model: { category: "truck" } }), true);
assert.equal(eligible({ type: "truck", transport_model: [{ category: "TRACTOR" }] }), true);

for (const kind of [
  "light_vehicle",
  "trailer",
  "semi_trailer",
  "tractor_trailer",
  "special_vehicle",
  "crane",
  "fuel_tanker",
]) {
  assert.equal(
    eligible({ type: "truck", transport_model: { category: kind } }),
    false,
    `${kind} overrides an incorrect local truck type`,
  );
}

for (const row of [
  { type: "truck", import_source: "fleet_audit_2026" },
  { type: "truck", inventory_number: "PTC-QA-001" },
  { type: "truck", source_raw_name: "Smoke test vehicle" },
  { type: "tractor", source_clean_name: "E2E tractor" },
]) {
  assert.equal(eligible(row), false, "explicit structural audit marker is excluded");
}

assert.equal(eligible({ type: "truck", import_source: "fixed_asset_import_2026" }), true);
assert.equal(eligible({ type: "tractor", source_raw_name: "Трактор Беларус-82,1 Т 718 ABB" }), true);
assert.equal(eligible({ type: "truck", source_raw_name: "Contest logistics truck" }), true);
assert.equal(eligible({ type: "truck", source_raw_name: "Автокран КС-3577" }), false);
assert.equal(eligible({ type: "truck", source_clean_name: "Топливозаправщик АТЗ-5" }), false);
assert.equal(eligible({ type: "truck", source_raw_name: "Fuel tanker service vehicle" }), false);
assert.equal(eligible({ type: "combine" }), false);
assert.equal(eligible({ type: "loader" }), false);
assert.equal(eligible({}), false);
assert.equal(isPtcEligibleReferenceVehicle({ ptc_enabled: false, type: "truck" }), false);
assert.equal(isPtcEligibleReferenceVehicle({ type: "truck" }), false);
assert.equal(isStructurallyPtcReferenceVehicle({ ptc_enabled: false, type: "truck" }), true);
assert.equal(isStructurallyPtcReferenceVehicle({ ptc_enabled: false, type: "trailer" }), false);

// Display text is intentionally outside the structural eligibility contract.
assert.equal(eligible({ type: "truck", name: "AUDIT QA truck" } as any), true);

console.log(`PTC vehicle eligibility PASS: ${checks} structural cases.`);
