import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { automaticHarvestAllocation } from "../lib/weighbridge/harvest-contract";
import { harvestFieldsWithAllocations } from "../lib/weighbridge/field-picker";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const resourcesRoute = read("app/api/weighbridge/resources/route.ts");
const allocationsRoute = read("app/api/weighbridge/harvest-allocations/route.ts");
const harvestContext = read("lib/server/harvest-ticket-context.ts");

let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
}

const oneAllocation = {
  allocationId: "allocation-a",
  cropId: "crop-a",
  varietyId: "variety-a",
  reproductionId: "reproduction-a",
  isIncomplete: false,
};

check("physical fields are unique by UUID while equal names remain separate", () => {
  const fields = harvestFieldsWithAllocations([
    { id: "field-a", name: "9", area: 116, fieldCode: "FLD-009-A" },
    { id: "field-b", name: "9", area: 116, fieldCode: "FLD-009-B" },
    { id: "field-a", name: "9 duplicate transport row", area: 116, fieldCode: "FLD-009-A" },
  ], {
    "field-a": [oneAllocation, { ...oneAllocation, allocationId: "allocation-b" }],
    "field-b": [oneAllocation],
  });
  assert.deepEqual(fields.map((field) => field.id), ["field-a", "field-b"]);
});

check("fields without a harvestable structure row are not offered", () => {
  const fields = harvestFieldsWithAllocations([
    { id: "crop-field", name: "1", area: 100 },
    { id: "fallow-field", name: "2", area: 200 },
  ], { "crop-field": [oneAllocation] });
  assert.deepEqual(fields.map((field) => field.id), ["crop-field"]);
});

check("physical fields use natural numeric ordering", () => {
  const fields = harvestFieldsWithAllocations([
    { id: "field-21", name: "21", area: 399 },
    { id: "field-9", name: "9", area: 116 },
    { id: "field-1", name: "1", area: 321 },
  ], {
    "field-21": [oneAllocation],
    "field-9": [oneAllocation],
    "field-1": [oneAllocation],
  });
  assert.deepEqual(fields.map((field) => field.name), ["1", "9", "21"]);
});

check("one crop structure auto-selects but multiple rows require a choice", () => {
  assert.equal(
    automaticHarvestAllocation([oneAllocation], { allowIncompleteIdentity: true })?.allocationId,
    "allocation-a"
  );
  assert.equal(automaticHarvestAllocation([
    oneAllocation,
    { ...oneAllocation, allocationId: "allocation-b" },
  ], { allowIncompleteIdentity: true }), null);
});

check("field code is an optional physical-field search attribute", () => {
  assert.match(resourcesRoute, /\.select\("id,name,area,field_code"\)/);
  assert.match(resourcesRoute, /fieldCode: row\.field_code \? String\(row\.field_code\) : null/);
  assert.match(page, /keywords: \[field\.name, areaLabel, String\(field\.area\), field\.fieldCode \|\| ""\]/);
});

check("fallow is excluded by land-use identity rather than display name", () => {
  assert.match(allocationsRoute, /\.select\("id,field_id,land_use_type,area,crop_id,variety_id,reproduction_id,notes"\)/);
  assert.match(allocationsRoute, /\.eq\("land_use_type", "crop"\)/);
  assert.match(allocationsRoute, /row\.land_use_type !== "crop"/);
  assert.doesNotMatch(allocationsRoute, /cropName.*Пар|name.*Пар/);
});

check("harvest UI has separate physical-field and crop-structure pickers", () => {
  assert.match(page, /<Label>Поле \*<\/Label>[\s\S]*value=\{form\.fieldId\}[\s\S]*options=\{harvestFieldOptions\}/);
  assert.match(page, /<Label>Участок \/ культура \*<\/Label>[\s\S]*value=\{form\.cropStructureAllocationId\}[\s\S]*options=\{harvestAllocationOptions\}/);
  assert.match(page, /label: `\$\{field\.name\} — \$\{areaLabel\}`/);
  assert.match(page, /allocation\.cropName,[\s\S]*allocation\.varietyName,[\s\S]*allocation\.reproductionName,[\s\S]*allocation\.areaHa/);
});

check("crop-structure choices are scoped only by selected field UUID", () => {
  assert.match(page, /form\.fieldId \? harvestStructureByField\[form\.fieldId\] \|\| \[\] : \[\]/);
  assert.doesNotMatch(page, /const harvestTargetOptions/);
});

check("changing field or allocation clears the old combine operator", () => {
  const fieldHandler = page.slice(page.indexOf("const changeHarvestField"), page.indexOf("const changeHarvestTarget"));
  const allocationHandler = page.slice(page.indexOf("const changeHarvestTarget"), page.indexOf("const setActiveHarvestForm"));
  assert.match(fieldHandler, /combineOperatorPersonId: ""/);
  assert.match(allocationHandler, /combineOperatorPersonId: ""/);
  assert.match(fieldHandler, /automaticHarvestAllocation\(harvestStructureByField\[fieldId\]/);
});

check("ticket payload keeps exact field and crop-structure UUIDs", () => {
  assert.match(page, /source_id: form\.operationType === "harvest_incoming" \? form\.fieldId/);
  assert.match(page, /crop_structure_allocation_id:[\s\S]*form\.cropStructureAllocationId \|\| null/);
  assert.match(page, /field_id: form\.operationType === "supplier_receipt" \? null : form\.fieldId \|\| null/);
  assert.match(harvestContext, /\.eq\("id", allocationId\)[\s\S]*\.eq\("company_id", companyId\)[\s\S]*\.eq\("field_id", fieldId\)/);
  assert.match(harvestContext, /String\(allocation\?\.season_id \|\| ""\) !== String\(activeSeason\.id\)/);
});

console.log(`TZ313 FIELD PICKER ${checks}/${checks} PASS`);
