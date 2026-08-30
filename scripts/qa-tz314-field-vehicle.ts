import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeHarvestFieldSearchText,
  rankHarvestPhysicalFieldSearch,
} from "../lib/weighbridge/field-picker";
import { transportPickerOptionLabel } from "../lib/weighbridge/transport";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const fieldPicker = read("components/weighbridge/active-harvest-tabs.tsx");
const searchableCombobox = read("components/weighbridge/searchable-combobox.tsx");
const transportPicker = read("components/weighbridge/transport-driver-picker.tsx");
const resourcesRoute = read("app/api/weighbridge/resources/route.ts");
const ticketsRoute = read("app/api/weighbridge/tickets/route.ts");

let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
}

check("field search normalizes NFKC, case, yo and repeated whitespace", () => {
  assert.equal(normalizeHarvestFieldSearchText("  ЁЛКА   ９  "), "елка 9");
});

check("field-name matches outrank area and technical-code matches", () => {
  assert.equal(rankHarvestPhysicalFieldSearch({ name: "9", area: 116, fieldCode: "FLD-A" }, "9"), 0);
  assert.equal(rankHarvestPhysicalFieldSearch({ name: "9-1", area: 10, fieldCode: "FLD-B" }, "9"), 10);
  assert.equal(rankHarvestPhysicalFieldSearch({ name: "90", area: 10, fieldCode: "FLD-C" }, "9"), 20);
  assert.equal(rankHarvestPhysicalFieldSearch({ name: "A9", area: 10, fieldCode: "FLD-D" }, "9"), 30);
  assert.equal(rankHarvestPhysicalFieldSearch({ name: "1", area: 99, fieldCode: "FLD-E" }, "9"), 41);
  assert.equal(rankHarvestPhysicalFieldSearch({ name: "2", area: 10, fieldCode: "FLD-9" }, "9"), 52);
});

check("exact-name search covers the owner acceptance matrix", () => {
  ["1", "9", "15", "15-1", "2-3", "52-2", "виноград"].forEach((name) => {
    assert.equal(rankHarvestPhysicalFieldSearch({ name, area: 1, fieldCode: null }, name), 0);
  });
});

check("physical-field picker applies ranked search with stable source-order ties", () => {
  assert.match(fieldPicker, /rankHarvestPhysicalFieldSearch/);
  assert.match(fieldPicker, /left\.rank - right\.rank \|\| left\.index - right\.index/);
  assert.match(page, /physicalFieldSearch:\s*\{[\s\S]*?name: field\.name[\s\S]*?area: field\.area[\s\S]*?fieldCode: field\.fieldCode/);
  assert.match(page, /listAriaLabel="Физические поля активного сезона"[\s\S]*?physicalFieldSearch/);
});

check("physical-field label shows one UUID-backed row with area", () => {
  assert.match(page, /value: field\.id,[\s\S]*?label: `\$\{field\.name\} · \$\{areaLabel\}`/);
});

check("weighbridge vehicle bootstrap reads only active vehicle-fleet rows", () => {
  assert.match(resourcesRoute, /from\("reference_vehicles"\)[\s\S]*?eq\("is_active", true\)[\s\S]*?eq\("archived", false\)/);
  assert.doesNotMatch(resourcesRoute, /from\("reference_machines"\)/);
  assert.doesNotMatch(ticketsRoute, /from\("reference_machines"\)/);
  assert.match(resourcesRoute, /const vehicles = vehicleRows\.filter\(\(row\) => isCargoVehicle\(row\)\)/);
  assert.match(resourcesRoute, /const trailers = vehicleRows\.filter\(\(row\) => isTrailerTransport\(row\)\)/);
});

check("cached picker rows cannot restore agricultural-machine sources", () => {
  assert.match(page, /cached\.vehicles[\s\S]*?vehicle\.source === "reference_vehicles"/);
  assert.doesNotMatch(page, /row\.source === "reference_machines"/);
  assert.match(page, /!form\.vehicleId \|\| vehicles\.some\(\(vehicle\) => vehicle\.id === form\.vehicleId\)/);
  assert.match(page, /Выберите машину из действующего автопарка/);
});

check("transport option identity and hover state use UUID", () => {
  assert.match(searchableCombobox, /key=\{option\.value\}[\s\S]*?value=\{option\.value\}/);
  assert.match(searchableCombobox, /keywords=\{\[option\.label, option\.description \|\| "", \.\.\.\(option\.keywords \|\| \[\]\)\]\}/);
  assert.match(searchableCombobox, /value === option\.value \? "opacity-100"/);
});

check("vehicle search keeps brand, model, plate and custom source terms", () => {
  assert.match(transportPicker, /keywords: \[vehicle\.name, vehicle\.model, vehicle\.plate, vehicle\.type, \.\.\.\(vehicle\.searchTerms \|\| \[\]\)\]/);
});

check("vehicle option prints a formatted real plate", () => {
  assert.equal(
    transportPickerOptionLabel({ name: "КАМАЗ 45143", plate: "826AB15" }),
    "КАМАЗ 45143 · 826 AB 15"
  );
});

check("vehicle option explains a missing plate without exposing OSV", () => {
  const label = transportPickerOptionLabel({
    name: "HOWO",
    brand: "HOWO",
    model: "ZZ3327S3847E",
    plate_number: "OSV-ROW-128",
  });
  assert.equal(label, "HOWO ZZ3327S3847E · Госномер не указан");
  assert.doesNotMatch(label, /OSV-ROW/);
  assert.match(page, /snapshotVehicle = resolveTransportIdentity/);
});

assert.equal(checks, 11);
console.log(`TZ314 field and vehicle regression PASS: ${checks}/${checks}`);
