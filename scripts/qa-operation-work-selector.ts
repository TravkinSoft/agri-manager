import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OPERATION_SUBTYPE_DEFINITIONS, OPERATION_TYPE_DEFINITIONS } from "../lib/operations/operation-engine";
import {
  HIDDEN_NEW_PLAN_CATEGORY_SLUGS,
  OPERATION_WORK_UI_SECTIONS,
} from "../lib/operations/operation-work-ui";

const componentPath = join(process.cwd(), "components", "operations", "operation-form-dialog.tsx");
const source = readFileSync(componentPath, "utf8");

const sectionSlugs = OPERATION_WORK_UI_SECTIONS.map((section) => section.categorySlug);
const soilSlugs = OPERATION_WORK_UI_SECTIONS.find((section) => section.categorySlug === "soil_operation")?.works.map((work) => work.slug) || [];
const plantingSlugs = OPERATION_WORK_UI_SECTIONS.find((section) => section.categorySlug === "planting")?.works.map((work) => work.slug) || [];
const harvestingSlugs = OPERATION_WORK_UI_SECTIONS.find((section) => section.categorySlug === "harvesting")?.works.map((work) => work.slug) || [];
const directSections = OPERATION_WORK_UI_SECTIONS.filter((section) => section.selection === "direct");
const canonicalCategorySlugs = new Set(OPERATION_TYPE_DEFINITIONS.map((item) => item.categorySlug));
const canonicalSubtypeSlugs = new Set(OPERATION_SUBTYPE_DEFINITIONS.map((item) => item.slug));

assert.deepEqual(
  sectionSlugs,
  ["soil_operation", "planting", "fertilizer_application", "spraying", "irrigation", "harvesting"],
  "the create form must expose exactly six approved sections in owner order"
);
assert.equal(soilSlugs.length, 11, "the pilot must expose 11 approved soil works");
assert.ok(!soilSlugs.includes("plant_residue_shredding"), "residue shredding must stay hidden from new plans");
assert.ok(!soilSlugs.includes("leveling"), "leveling must stay hidden from new plans");
assert.deepEqual(
  plantingSlugs,
  ["seeding", "planting_generic", "overseeding"],
  "sowing, planting, and overseeding slugs must remain unchanged"
);
assert.equal(harvestingSlugs.length, 10, "the pilot must expose 10 harvesting works");
assert.deepEqual(
  directSections.map((section) => section.directOperationSlug),
  ["fertilizer_application", "spraying", "irrigation"],
  "fertilizer, spraying, and irrigation must select their canonical operation directly"
);
assert.ok(sectionSlugs.every((slug) => canonicalCategorySlugs.has(slug)), "visible category slugs must remain canonical");
assert.ok(
  OPERATION_WORK_UI_SECTIONS.flatMap((section) => section.works).every((work) => canonicalSubtypeSlugs.has(work.slug)),
  "visible work slugs must remain canonical"
);
assert.ok(HIDDEN_NEW_PLAN_CATEGORY_SLUGS.includes("scouting"), "scouting must be hidden from new plans");
assert.ok(HIDDEN_NEW_PLAN_CATEGORY_SLUGS.includes("service_operation"), "service operations must be hidden from new plans");
assert.ok(HIDDEN_NEW_PLAN_CATEGORY_SLUGS.includes("transport"), "logistics must be hidden from new plans");
assert.ok(HIDDEN_NEW_PLAN_CATEGORY_SLUGS.includes("post_harvest_operation"), "post-harvest processing must be hidden from new plans");
assert.ok(source.includes("RadioGroupPrimitive.Root"), "the selector must use RadioGroup semantics");
assert.ok(source.includes("RadioGroupPrimitive.Item"), "each category and work must expose radio semantics");
assert.ok(source.includes('event.key === "Enter"'), "Enter must select the focused option");
assert.ok(source.includes('event.key === "ArrowRight"'), "arrow keys must move and select within a group");
assert.ok(source.includes('event.key === " "'), "Space must select the focused option");
assert.ok(source.includes("nextItem.focus()"), "keyboard navigation must preserve visible focus");
assert.ok(source.includes("onKeyDownCapture"), "custom selection must run before Radix keyboard handling");
assert.ok(source.includes("focus-visible:ring-2"), "keyboard focus must remain visible");
assert.ok(source.includes("grid grid-cols-2 gap-2 md:grid-cols-3"), "category buttons must use 2 mobile and 3 desktop columns");
assert.ok(source.includes("grid grid-cols-1 gap-2 sm:grid-cols-2"), "work buttons must remain 1/2 columns");
assert.ok(source.includes('section?.selection === "direct"'), "category selection must support direct canonical operations");
assert.ok(source.includes("categoryValue && showsConcreteWorks"), "direct operations must hide the concrete work block");
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
      visibleSections: sectionSlugs.length,
      soilWorks: soilSlugs.length,
      plantingWorks: plantingSlugs.length,
      harvestingWorks: harvestingSlugs.length,
      directSelections: directSections.map((section) => section.directOperationSlug),
      dropdownPresent: false,
      nestedScrollPresent: false,
      keyboardSemantics: "Radix RadioGroup + arrows/space + Enter",
    },
    null,
    2
  )
);
