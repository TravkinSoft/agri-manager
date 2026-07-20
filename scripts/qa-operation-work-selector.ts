import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OPERATION_SUBTYPE_DEFINITIONS } from "../lib/operations/operation-engine";

const componentPath = join(process.cwd(), "components", "operations", "operation-form-dialog.tsx");
const source = readFileSync(componentPath, "utf8");

function readStringSet(name: string): Set<string> {
  const pattern = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`);
  const body = source.match(pattern)?.[1];
  assert.ok(body, `${name} must remain declared in the operation form`);
  return new Set(Array.from(body.matchAll(/"([^"]+)"/g), (match) => match[1]));
}

function visibleSubtypeSlugs(categorySlug: string): string[] {
  return OPERATION_SUBTYPE_DEFINITIONS
    .filter((item) => item.categorySlug === categorySlug)
    .filter((item) => !hiddenPilotSlugs.has(item.slug))
    .filter((item) => categorySlug !== "planting" || !hiddenPlantingSlugs.has(item.slug))
    .map((item) => item.slug);
}

const hiddenPilotSlugs = readStringSet("HIDDEN_PILOT_SUBTYPE_SLUGS");
const hiddenPlantingSlugs = readStringSet("HIDDEN_PLANTING_SUBTYPE_SLUGS");

const soilSlugs = visibleSubtypeSlugs("soil_operation");
const plantingSlugs = visibleSubtypeSlugs("planting");
const harvestingSlugs = visibleSubtypeSlugs("harvesting");

assert.equal(soilSlugs.length, 13, "the pilot must expose 13 soil works");
assert.deepEqual(
  plantingSlugs,
  ["seeding", "planting_generic", "overseeding"],
  "sowing, planting, and overseeding slugs must remain unchanged"
);
assert.equal(harvestingSlugs.length, 10, "the pilot must expose 10 harvesting works");
assert.ok(source.includes("RadioGroupPrimitive.Root"), "the selector must use RadioGroup semantics");
assert.ok(source.includes("RadioGroupPrimitive.Item"), "each category and work must expose radio semantics");
assert.ok(source.includes('event.key === "Enter"'), "Enter must select the focused option");
assert.ok(source.includes('event.key === "ArrowRight"'), "arrow keys must move and select within a group");
assert.ok(source.includes('event.key === " "'), "Space must select the focused option");
assert.ok(source.includes("nextItem.focus()"), "keyboard navigation must preserve visible focus");
assert.ok(source.includes("focus-visible:ring-2"), "keyboard focus must remain visible");
assert.ok(source.includes("grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4"), "category breakpoints must remain 2/3/4 columns");
assert.ok(source.includes("grid grid-cols-1 gap-2 sm:grid-cols-2"), "work buttons must remain 1/2 columns");
assert.ok(source.includes("<OperationWorkSelector"), "the operation form must render the button selector");
assert.ok(!source.includes("function GroupedWorkSelect"), "the grouped work dropdown must not return");

const selectorSource = source.slice(
  source.indexOf("function OperationWorkSelector"),
  source.indexOf("export function OperationFormDialog")
);
assert.ok(!selectorSource.includes('role="combobox"'), "the work selector must not expose a combobox");
assert.ok(!selectorSource.includes("overflow-y-auto"), "the work selector must not create nested scrolling");
assert.ok(!selectorSource.includes("Popover"), "the work selector must not create a popup menu");

console.log(
  JSON.stringify(
    {
      status: "PASS",
      soilWorks: soilSlugs.length,
      plantingWorks: plantingSlugs.length,
      harvestingWorks: harvestingSlugs.length,
      dropdownPresent: false,
      nestedScrollPresent: false,
      keyboardSemantics: "Radix RadioGroup + arrows/space + Enter",
    },
    null,
    2
  )
);
