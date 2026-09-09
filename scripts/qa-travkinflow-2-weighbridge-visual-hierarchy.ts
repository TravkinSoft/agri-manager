import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "app/(dashboard)/weighbridge/page.tsx"), "utf8");
const formStart = page.indexOf('id="weighbridge-workspace-panel"');
const formEnd = page.indexOf("<Sheet", formStart);

assert.ok(formStart >= 0 && formEnd > formStart, "main weighbridge workspace must remain discoverable");
const workspace = page.slice(formStart, formEnd);

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
};

check("all operation modes remain available", () => {
  for (const operation of [
    "harvest_incoming",
    "supplier_receipt",
    "issue_to_field",
    "transfer_between_warehouses",
    "shipment_outbound",
    "disposal_writeoff",
    "impurity_removal",
  ]) {
    assert.match(page, new RegExp(`type: "${operation}"`));
  }
});

check("workflow sections use semantic headings", () => {
  assert.match(page, /function WorkflowSectionHeading/);
  assert.match(page, /<h2 className="text-\[11px\]/);
});

check("route and harvest context are explicit sections", () => {
  assert.match(workspace, /data-weighbridge-section="route"/);
  assert.match(workspace, /data-weighbridge-section="harvest-context"/);
});

check("every secondary operation has a dedicated task section", () => {
  for (const section of ["impurity-batch", "supplier-materials", "field-issue-material", "movement-material"]) {
    assert.match(workspace, new RegExp(`data-weighbridge-section="${section}"`));
  }
});

check("transport and weight stay visible as separate steps", () => {
  assert.match(workspace, /data-weighbridge-section="transport"/);
  assert.match(workspace, /data-weighbridge-section="weight"/);
});

check("sections are separated by quiet dividers", () => {
  assert.match(page, /const formSectionClass = "space-y-4 border-t border-border pt-4/);
  assert.match(page, /const formRailClass = "border-l-2 border-border/);
  assert.match(page, /const formDataStripClass = "grid gap-2 border-y border-border/);
});

check("old framed supplier line cards are removed", () => {
  assert.doesNotMatch(workspace, /rounded-xl border border-slate-800\/80 bg-slate-950\/45 p-3/);
  assert.match(workspace, /Строка \{lineIndex \+ 2\}/);
});

check("open tickets render as flat keyboard-focusable rows", () => {
  assert.match(workspace, /w-full border-b border-border[\s\S]*focus-visible:ring-2[\s\S]*motion-reduce:transition-none/);
  assert.doesNotMatch(workspace, /w-full rounded-xl border border-slate-800 bg-slate-950\/55/);
});

check("history renders as flat rows", () => {
  assert.match(workspace, /border-b border-border px-1 py-3 transition-colors hover:bg-background motion-reduce:transition-none/);
  assert.doesNotMatch(workspace, /rounded-xl border border-slate-800 bg-slate-950\/45 px-3 py-2\.5/);
});

check("correction comparison uses an accent rail", () => {
  assert.match(workspace, /border-l-2 border-yellow-400\/50 bg-yellow-500\/5/);
  assert.doesNotMatch(workspace, /rounded-lg border border-yellow-500\/20/);
});

check("empty states avoid nested cards", () => {
  assert.match(workspace, /border-y border-dashed border-border/);
  assert.doesNotMatch(workspace, /rounded-lg bg-slate-950\/35 p-6/);
});

check("supplier disclosure exposes state and controlled region", () => {
  assert.match(workspace, /aria-expanded=\{showSupplierExtraFields\}/);
  assert.match(workspace, /aria-controls="supplier-extra-fields"/);
  assert.match(workspace, /id="supplier-extra-fields"/);
});

check("comment disclosure exposes state and an accessible textarea", () => {
  assert.match(workspace, /aria-expanded=\{commentOpen\}/);
  assert.match(workspace, /aria-controls="weighbridge-comment"/);
  assert.match(workspace, /id="weighbridge-comment" aria-label="Комментарий к талону"/);
});

check("dynamic supplier rows have accessible remove actions", () => {
  assert.match(workspace, /aria-label=\{`Удалить строку \$\{lineIndex \+ 2\}`\}/);
});

check("primary creation action remains sticky", () => {
  assert.match(workspace, /<PrimaryActionBar[\s\S]*?sticky[\s\S]*?onClick=\{\(\) => void create\(\)\}/);
});

check("role gates remain around create and cleanup actions", () => {
  assert.match(workspace, /\{canOperate && form\.operationType !== "harvest_incoming" \? \(/);
  assert.match(workspace, /\{canVoid && activeTicket \? \(/);
});

check("admin cleanup is a semantic top-level section", () => {
  assert.match(workspace, /<section className=\{`\$\{terminalPanelClass\} px-4 py-4`\} aria-labelledby="weighbridge-admin-cleanup-title"/);
  assert.doesNotMatch(workspace, /<Card>[\s\S]{0,120}Admin cleanup зависшего талона/);
});

check("mobile layout keeps base grids single-column", () => {
  assert.match(workspace, /grid gap-3 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(workspace, /grid gap-3 border-t border-border pt-4 md:grid-cols/);
  assert.match(page, /space-y-2 px-2 pb-4 sm:px-3/);
});

assert.equal(passed, 18);
console.log(`TRAVKINFLOW 2 WEIGHBRIDGE VISUAL HIERARCHY: ${passed}/${passed} PASS`);
