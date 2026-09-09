import assert from "node:assert/strict";
import { buildFieldAliasIndex, resolveFieldByPolygonName } from "../lib/fields-map/matching";

const field91 = "00000000-0000-4000-8000-000000000091";
const field9Dash1 = "00000000-0000-4000-8000-000000000901";
const field32 = "00000000-0000-4000-8000-000000000032";
const fieldStation = "00000000-0000-4000-8000-000000000777";

const index = buildFieldAliasIndex([
  { id: field91, name: "91", display_name: "91", area: 91 },
  { id: field9Dash1, name: "9-1", display_name: "9-1", area: 50 },
  { id: field32, name: "32", display_name: "32", area: 100 },
  { id: fieldStation, name: "Полевой стан", display_name: "Полевой стан", area: 12 },
]);

let assertions = 0;
const spacedUnicode = resolveFieldByPolygonName("9 поле 1", index, { area_ha: 50.5 });
assert.equal(spacedUnicode.status, "matched");
assert.equal(spacedUnicode.field_id, field9Dash1);
assert.notEqual(spacedUnicode.field_id, field91);
assert.ok(spacedUnicode.reason_codes.includes("area_within_3pct"));
assertions += 4;

const unicodeWordBoundary = resolveFieldByPolygonName("Полевой стан", index, { area_ha: 12 });
assert.equal(unicodeWordBoundary.status, "matched");
assert.equal(unicodeWordBoundary.field_id, fieldStation);
assertions += 2;

const safeArea = resolveFieldByPolygonName("Поле 32", index, { area_ha: 102.9 });
assert.equal(safeArea.status, "matched");
assert.equal(safeArea.field_id, field32);
assertions += 2;

const areaMismatch = resolveFieldByPolygonName("Поле 32", index, { area_ha: 103.1 });
assert.equal(areaMismatch.status, "ambiguous");
assert.equal(areaMismatch.field_id, null);
assert.ok(areaMismatch.reason_codes.includes("area_mismatch"));
assertions += 3;

const missingArea = resolveFieldByPolygonName("Поле 32", index);
assert.equal(missingArea.status, "ambiguous");
assert.ok(missingArea.reason_codes.includes("source_area_missing"));
assertions += 2;

const geometryConflict = resolveFieldByPolygonName("Поле 32", index, {
  area_ha: 100,
  conflict_polygon_ids: ["poly-99"],
});
assert.equal(geometryConflict.status, "ambiguous");
assert.equal(geometryConflict.field_id, null);
assert.ok(geometryConflict.reason_codes.includes("geometry_conflict"));
assertions += 3;

const duplicateClearIndex = buildFieldAliasIndex([
  {
    id: "00000000-0000-4000-8000-000000000141",
    name: "14-1",
    display_name: "14",
    original_field_key: "14",
    area: 100,
  },
  {
    id: "00000000-0000-4000-8000-000000000142",
    name: "14-2",
    display_name: "14",
    original_field_key: "14",
    area: 130,
  },
]);
const duplicateClear = resolveFieldByPolygonName("14 поле", duplicateClearIndex, { area_ha: 101 });
assert.equal(duplicateClear.status, "matched");
assert.equal(duplicateClear.field_id, "00000000-0000-4000-8000-000000000141");
assert.ok(duplicateClear.reason_codes.includes("area_margin_clear"));
assertions += 3;

const duplicateCloseIndex = buildFieldAliasIndex([
  {
    id: "00000000-0000-4000-8000-000000000151",
    name: "15-1",
    display_name: "15",
    original_field_key: "15",
    area: 100,
  },
  {
    id: "00000000-0000-4000-8000-000000000152",
    name: "15-2",
    display_name: "15",
    original_field_key: "15",
    area: 104,
  },
]);
const duplicateClose = resolveFieldByPolygonName("15", duplicateCloseIndex, { area_ha: 101 });
assert.equal(duplicateClose.status, "ambiguous");
assert.equal(duplicateClose.field_id, null);
assert.ok(duplicateClose.reason_codes.includes("area_margin_too_small"));
assertions += 3;

const fuzzyIndex = buildFieldAliasIndex([
  {
    id: "00000000-0000-4000-8000-000000009999",
    name: "Платина картофель",
    display_name: "Платина картофель",
    area: 70,
  },
]);
const fuzzy = resolveFieldByPolygonName("Платина картоф", fuzzyIndex, { area_ha: 70 });
assert.equal(fuzzy.status, "ambiguous");
assert.equal(fuzzy.field_id, null);
assert.equal(fuzzy.suggested_field_id, "00000000-0000-4000-8000-000000009999");
assert.ok(fuzzy.reason_codes.includes("fuzzy_suggestion_only"));
assertions += 4;

const numericPrefix = resolveFieldByPolygonName("9", index, { area_ha: 50 });
assert.notEqual(numericPrefix.status, "matched");
assert.equal(numericPrefix.field_id, null);
assertions += 2;

console.log(`Fields map conservative matcher PASS: ${assertions} assertions. No remote calls.`);
