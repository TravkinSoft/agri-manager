import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
  parseUniversalWorkspaceState,
  serializeUniversalWorkspaceState,
} from "../lib/weighbridge/universal-workspaces";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const combobox = read("components/weighbridge/searchable-combobox.tsx");
const driverPicker = read("components/weighbridge/transport-driver-picker.tsx");

let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
}

const initialForm = {
  operationType: "harvest_incoming",
  fieldId: "",
  cropStructureAllocationId: "",
  cropId: "",
  varietyId: "",
  reproductionId: "",
};

const persistedForm = {
  ...initialForm,
  fieldId: "field-potato",
  cropStructureAllocationId: "allocation-potato-1",
  cropId: "crop-potato",
  varietyId: "variety-potato",
  reproductionId: "reproduction-potato",
};

check("workspace round-trip preserves the full harvest identity", () => {
  const serialized = serializeUniversalWorkspaceState({
    version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
    selectedId: "workspace-1",
    workspaces: [{
      id: "workspace-1",
      form: persistedForm,
      supplierReceiptLines: [],
      showSupplierExtraFields: false,
    }],
    migratedLegacyHarvest: false,
  });
  const restored = parseUniversalWorkspaceState(serialized, initialForm);
  assert.deepEqual(restored?.workspaces[0]?.form, persistedForm);
});

check("allocation reconciliation waits for both restored workspace and canonical allocations", () => {
  const start = page.indexOf('if (form.operationType !== "harvest_incoming" && form.operationType !== "issue_to_field") return;');
  const end = page.indexOf("const exists = fieldHarvestOptions.some", start);
  const reconciliationPrelude = page.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(reconciliationPrelude, /if \(!workspaceReady \|\| !harvestAllocationsReady\) return;/);
  assert.ok(
    reconciliationPrelude.indexOf("!workspaceReady || !harvestAllocationsReady")
      < reconciliationPrelude.indexOf("!fieldHarvestOptions.length")
  );
});

check("only successful canonical allocation payloads unlock destructive reconciliation", () => {
  const applyStart = page.indexOf("const applyHarvestAllocations");
  const applyEnd = page.indexOf("const refreshHarvestAllocations", applyStart);
  assert.match(page.slice(applyStart, applyEnd), /setHarvestAllocationsReady\(true\)/);

  const operatorStart = page.indexOf("const applyInitialOperatorWorkspace");
  const operatorEnd = page.indexOf("const commitOperatorState", operatorStart);
  assert.match(page.slice(operatorStart, operatorEnd), /if \(!resources \|\| !allocations\) return false;[\s\S]*setHarvestAllocationsReady\(true\)/);
  assert.match(page, /setHarvestAllocationsReady\(false\);[\s\S]*setWorkspaceHydratedKey\(""\);[\s\S]*\}, \[profile\?\.company_id\]\);/);
});

check("driver search always returns its result viewport to the beginning", () => {
  assert.match(combobox, /const listRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(combobox, /onValueChange=\{\(\) => \{[\s\S]*listRef\.current\.scrollTop = 0/);
  assert.match(combobox, /<CommandList ref=\{listRef\}/);
});

check("driver search stays local and covers useful personnel attributes", () => {
  assert.doesNotMatch(driverPicker, /fetch\(|axios|supabase/);
  assert.match(driverPicker, /keywords: \[driver\.name, driver\.position \|\| "", driver\.department \|\| ""\]/);
  assert.match(driverPicker, /searchPlaceholder="Имя или фамилия водителя"/);
});

console.log(`P0 WEIGHBRIDGE FORM STATE ${checks}/${checks} PASS`);
