import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(
  resolve(process.cwd(), "app/(dashboard)/crop-structure/page.tsx"),
  "utf8",
);

const masterItemStart = page.indexOf("const renderFieldMasterItem =");
const tableStart = page.indexOf("const renderTableView =", masterItemStart);
const workspaceStart = page.indexOf("const renderDesktopFieldWorkspace =");
const loadingStart = page.indexOf("if (loading)", workspaceStart);
const pageReturnStart = page.indexOf("return (", loadingStart);
const fieldDialogStart = page.indexOf("<Dialog open={Boolean(selectedFieldId)}", pageReturnStart);
const saveConfirmationStart = page.indexOf("<AlertDialog open={saveConfirmationOpen}", fieldDialogStart);

assert.ok(masterItemStart > 0 && tableStart > masterItemStart, "desktop field master item has a bounded source slice");
assert.ok(workspaceStart > tableStart && loadingStart > workspaceStart, "desktop field workspace has a bounded source slice");
assert.ok(fieldDialogStart > pageReturnStart && saveConfirmationStart > fieldDialogStart, "mobile field dialog remains mounted after the page workspace");

const masterItem = page.slice(masterItemStart, tableStart);
const workspace = page.slice(workspaceStart, loadingStart);
const pageComposition = page.slice(pageReturnStart, fieldDialogStart);
const fieldDialog = page.slice(fieldDialogStart, saveConfirmationStart);

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

check("01 desktop mode follows the Tailwind xl boundary", () => {
  assert.match(page, /window\.matchMedia\("\(min-width: 1280px\)"\)/);
  assert.match(page, /media\.addEventListener\("change", syncWorkspaceMode\)/);
  assert.match(page, /media\.removeEventListener\("change", syncWorkspaceMode\)/);
});

check("02 cards become a master-detail workspace only on desktop", () => {
  assert.match(pageComposition, /data-testid="crop-master-detail-workspace"/);
  assert.match(pageComposition, /hidden min-w-0 gap-4 xl:grid/);
  assert.match(pageComposition, /xl:grid-cols-\[minmax\(280px,340px\)_minmax\(0,1fr\)\]/);
});

check("03 compact cards remain the mobile and tablet surface", () => {
  assert.match(pageComposition, /data-testid="crop-field-card-grid"/);
  assert.match(pageComposition, /xl:hidden/);
  assert.match(pageComposition, /filteredFields\.map\(renderOverviewCard\)/);
});

check("04 table and map alternatives remain separate", () => {
  assert.match(pageComposition, /viewMode === "table" \? renderTableView\(\)/);
  assert.match(pageComposition, /viewMode === "map" && isGlobalAdmin \? renderMapView\(\)/);
  assert.match(page, /const changeViewMode = \(mode: ViewMode\)/);
});

check("05 desktop selects a first field without writing business data", () => {
  assert.match(page, /if \(!isDesktopWorkspace \|\| viewMode !== "cards" \|\| selectedFieldId \|\| filteredFields\.length === 0\) return/);
  assert.match(page, /const fieldId = filteredFields\[0\]\.id;[\s\S]*?setSelectedFieldId\(fieldId\);[\s\S]*?setFieldDialogTab\("dossier"\)/);
  const autoSelectionStart = page.indexOf("if (!isDesktopWorkspace || viewMode !== \"cards\"");
  const autoSelectionEnd = page.indexOf("}, [allocByField, filteredFields", autoSelectionStart);
  const autoSelection = page.slice(autoSelectionStart, autoSelectionEnd);
  assert.doesNotMatch(autoSelection, /fetch\(|supabase\.|createOperation|createField/);
});

check("06 master rows expose selection and a 44px target", () => {
  assert.match(masterItem, /data-testid="crop-field-master-item"/);
  assert.match(masterItem, /className="block min-h-11 w-full/);
  assert.match(masterItem, /aria-pressed=\{isSelected\}/);
  assert.match(masterItem, /onClick=\{\(\) => requestOpenField\(field\.id\)\}/);
});

check("07 master rows preserve field truth and operation entry", () => {
  assert.match(masterItem, /allocByField\.get\(field\.id\)/);
  assert.match(masterItem, /sumArea\(rows\)/);
  assert.match(masterItem, /stateText\(fieldState\(field\.id\)\)/);
  assert.match(masterItem, /openPrimaryOperationPlan\(field, event\)/);
});

check("08 dirty drafts block master-list operation shortcuts", () => {
  assert.match(masterItem, /disabled=\{!FIELD_FIRST_CREATE_ENABLED \|\| hasUnsavedStructureChanges\}/);
  assert.match(masterItem, /Сначала сохраните или отмените изменения структуры/);
});

check("09 field switching uses the guarded request path", () => {
  assert.match(page, /const requestOpenField = \(fieldId: string, tab: FieldWorkspaceTab = "dossier"\)/);
  assert.match(page, /selectedFieldId && hasUnsavedStructureChanges && !saving/);
  assert.match(page, /setPendingFieldSelection\(\{ fieldId, tab \}\);[\s\S]*?setDiscardConfirmationOpen\(true\)/);
});

check("10 confirmed discard can continue to the requested field", () => {
  assert.match(page, /const confirmDiscardFieldChanges = \(\) => \{[\s\S]*?const nextSelection = pendingFieldSelection;[\s\S]*?closeField\(\);[\s\S]*?openField\(nextSelection\.fieldId, nextSelection\.tab\)/);
  assert.match(page, /Перейти к другому полю без сохранения\?/);
  assert.match(page, /onClick=\{confirmDiscardFieldChanges\}/);
});

check("11 season switching cannot discard a desktop draft", () => {
  assert.match(pageComposition, /disabled=\{seasons\.length === 0 \|\| \(isDesktopWorkspace && hasUnsavedStructureChanges\)\}/);
});

check("12 selected field workspace reuses the proven dossier and editor", () => {
  assert.match(workspace, /data-testid="crop-field-workspace"/);
  assert.match(workspace, /fieldDialogTab === "dossier" \? renderFieldDossier\(\)/);
  assert.match(workspace, /fieldDialogTab === "editor" \? renderEditor\(\)/);
  assert.match(workspace, /fieldDialogTab === "legal" \? renderLegalContour\(\)/);
});

check("13 workspace has a bounded independent scroller", () => {
  assert.match(workspace, /h-\[calc\(100dvh-12rem\)\]/);
  assert.match(workspace, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(workspace, /travkin-scrollbar/);
});

check("14 field heading and PDF remain available inline", () => {
  assert.match(workspace, /tf-manor-heading/);
  assert.match(workspace, /fieldDisplayName\(selectedField\)/);
  assert.match(workspace, /onClick=\{exportFieldPdf\}/);
  assert.match(workspace, /Сезонный контур поля/);
});

check("15 inline field tabs implement keyboard-operable ARIA wiring", () => {
  assert.match(workspace, /role="tablist" aria-label="Разделы выбранного поля"/);
  assert.match(workspace, /id="field-workspace-tab-dossier"/);
  assert.match(workspace, /aria-controls="field-workspace-panel"/);
  assert.match(workspace, /role="tabpanel"/);
  assert.match(workspace, /aria-labelledby=\{`field-workspace-tab-\$\{fieldDialogTab\}`\}/);
  assert.match(workspace, /onKeyDown=\{moveTabFocus\}/);
});

check("16 inline primary controls keep 44px touch targets", () => {
  assert.match(workspace, /className="h-11 shrink-0 px-3"/);
  assert.match(workspace, /className=\{`h-11 shrink-0 rounded-none/);
  assert.match(workspace, /className="h-11" onClick=\{requestSave\}/);
});

check("17 inline editor keeps dirty feedback and explicit save", () => {
  assert.match(workspace, /data-testid="crop-field-workspace-action-bar"/);
  assert.match(workspace, /aria-live="polite"/);
  assert.match(workspace, /onClick=\{addRow\}/);
  assert.match(workspace, /onClick=\{requestSave\}/);
  assert.match(workspace, /disabled=\{saving \|\| !hasUnsavedStructureChanges\}/);
});

check("18 role gates remain attached to editor and legal contour", () => {
  assert.match(page, /const canEditStructure = isGlobalAdmin \|\| profile\?\.role === "company_admin" \|\| profile\?\.role === "agronomist"/);
  assert.match(workspace, /\{canEditStructure \? \(/);
  assert.match(workspace, /\{isGlobalAdmin \? \(/);
  assert.match(workspace, /disabled=\{!canEditSelectedSeason\}/);
});

check("19 mobile dialog remains unchanged and is not mounted over desktop cards", () => {
  assert.match(page, /\{!isDesktopWorkspace \|\| viewMode !== "cards" \? \([\s\S]*?<Dialog open=\{Boolean\(selectedFieldId\)\}/);
  assert.match(fieldDialog, /data-testid="field-dialog-content"/);
  assert.match(fieldDialog, /max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(fieldDialog, /w-\[calc\(100vw-1rem\)\]/);
  assert.match(fieldDialog, /onClick=\{requestCloseField\}/);
});

check("20 motion and palette use shared semantic contracts", () => {
  assert.match(masterItem, /motion-reduce:transition-none/);
  assert.match(workspace, /motion-reduce:transition-none/);
  assert.doesNotMatch(masterItem + workspace, /bg-\[#|text-\[#|border-\[#/);
});

check("21 workspace composition is presentation-only", () => {
  assert.doesNotMatch(masterItem + workspace, /fetch\(|supabase\.|\.from\(|\.insert\(|\.update\(|\.delete\(/);
});

check("22 crop lifecycle and C15 live projection remain in shared detail", () => {
  assert.match(page, /<FieldHarvestLive[\s\S]*?fieldId=\{selectedField\.id\}/);
  assert.match(page, /const requestSave =/);
  assert.match(page, /const confirmSave = async/);
  assert.match(page, /validateAndNormalizeCropStructureRows/);
});

console.log(`TF2 Warm Manor crop master-detail: ${passed}/22 PASS`);
