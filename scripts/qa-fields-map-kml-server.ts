import assert from "node:assert/strict";
import {
  FIELD_MAP_MAX_CONFLICT_CANDIDATE_PAIRS,
  FIELD_MAP_MAX_SELF_INTERSECTION_COMPLEXITY,
  countAreaGeometryPositions,
  estimateAreaGeometryConflictComplexity,
  estimateRawAreaGeometryComplexity,
  findAreaGeometryConflicts,
  validateAreaGeometry,
} from "../lib/fields-map/geometry-validation";
import { validateParsedPolygonsForImport } from "../lib/fields-map/import-validation";
import { parseKmlToGeoJson } from "../lib/fields-map/kml-server";
import type { GeoJsonAreaGeometry } from "../lib/types/fields-map";

const square = (minX: number, minY: number, maxX: number, maxY: number): GeoJsonAreaGeometry => ({
  type: "Polygon",
  coordinates: [[
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ]],
});

let assertions = 0;
const unicodeKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
<name>Поле Ғ 32</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
69,53 69.01,53 69.01,53.01 69,53.01 69,53
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
const parsed = parseKmlToGeoJson(unicodeKml);
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.features.length, 1);
assert.equal(parsed.features[0].name, "Поле Ғ 32");
assert.equal(countAreaGeometryPositions(parsed.features[0].geometry), 5);
assertions += 4;

const importValidation = validateParsedPolygonsForImport(parsed.features);
assert.equal(importValidation.ok, true);
assertions += 1;

const doctype = parseKmlToGeoJson(
  `<!DOCTYPE kml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><kml><Placemark><name>&xxe;</name></Placemark></kml>`
);
assert.equal(doctype.features.length, 0);
assert.match(doctype.errors.join(" "), /DOCTYPE/u);
assertions += 2;

const unclosed = validateAreaGeometry({
  type: "Polygon",
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
});
assert.equal(unclosed.ok, false);
assertions += 1;

const selfCrossing = validateAreaGeometry({
  type: "Polygon",
  coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]],
});
assert.equal(selfCrossing.ok, false);
assertions += 1;

const adjacent = findAreaGeometryConflicts([
  { id: "a", geometry: square(0, 0, 1, 1) },
  { id: "b", geometry: square(1, 0, 2, 1) },
]);
assert.deepEqual(adjacent, []);
assertions += 1;

const nested = findAreaGeometryConflicts([
  { id: "outer", geometry: square(0, 0, 10, 10) },
  { id: "inner", geometry: square(2, 2, 3, 3) },
]);
assert.deepEqual(nested, [{ firstId: "outer", secondId: "inner", kind: "interior_overlap" }]);
assertions += 1;

const identical = findAreaGeometryConflicts([
  { id: "first", geometry: square(0, 0, 1, 1) },
  { id: "second", geometry: square(0, 0, 1, 1) },
]);
assert.equal(identical.length, 1);
assertions += 1;

const polygonWithHole: GeoJsonAreaGeometry = {
  type: "Polygon",
  coordinates: [
    (square(0, 0, 10, 10) as any).coordinates[0],
    (square(2, 2, 8, 8) as any).coordinates[0],
  ],
};
const islandInsideHole = findAreaGeometryConflicts([
  { id: "hole-owner", geometry: polygonWithHole },
  { id: "island", geometry: square(3, 3, 4, 4) },
]);
assert.deepEqual(islandInsideHole, []);
assertions += 1;

const expensiveGeometry: GeoJsonAreaGeometry = {
  type: "MultiPolygon",
  coordinates: Array.from({ length: 30 }, (_, polygonIndex) => [[
    ...Array.from({ length: 999 }, (_, pointIndex) => {
      const angle = (pointIndex / 998) * Math.PI * 2;
      return [polygonIndex * 2 + Math.cos(angle), Math.sin(angle)] as [number, number];
    }),
    [polygonIndex * 2 + 1, 0] as [number, number],
  ]]),
};
const expensiveEstimate = estimateRawAreaGeometryComplexity(expensiveGeometry);
assert.ok(expensiveEstimate.selfIntersectionComplexity > FIELD_MAP_MAX_SELF_INTERSECTION_COMPLEXITY);
const expensiveImport = validateParsedPolygonsForImport([{
  id: "expensive",
  name: "Слишком сложный контур",
  geometry: expensiveGeometry,
  area_ha: null,
}]);
assert.deepEqual(expensiveImport, {
  ok: false,
  error: "Геометрия KML слишком сложна для безопасной проверки за один запрос.",
  tooLarge: true,
});
assertions += 2;

const conflictBudget = estimateAreaGeometryConflictComplexity(
  Array.from({ length: 101 }, (_, index) => ({ id: `same-${index}`, geometry: square(0, 0, 1, 1) }))
);
assert.ok(conflictBudget.candidatePairs > FIELD_MAP_MAX_CONFLICT_CANDIDATE_PAIRS);
assertions += 1;

console.log(`Fields map server KML/geometry PASS: ${assertions} assertions. No remote calls.`);
