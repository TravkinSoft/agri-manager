import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(
  resolve(process.cwd(), "app/(dashboard)/crop-structure/page.tsx"),
  "utf8"
);

const dossierStart = page.indexOf("const renderFieldDossier =");
const editorStart = page.indexOf("const renderEditor =");
const legalStart = page.indexOf("const renderLegalContour =");
const legalEnd = page.indexOf("if (loading)", legalStart);
const dialogStart = page.indexOf("<Dialog open={Boolean(selectedFieldId)}");
const confirmationStart = page.indexOf("<AlertDialog open={saveConfirmationOpen}");

assert.ok(dossierStart > 0, "active field dossier is present");
assert.ok(editorStart > dossierStart, "structure editor follows the dossier");
assert.ok(legalStart > editorStart, "legal contour follows the editor");
assert.ok(legalEnd > legalStart, "legal contour has a bounded implementation slice");
assert.ok(dialogStart > legalStart, "field dialog shell is present");
assert.ok(confirmationStart > dialogStart, "save confirmation follows the field dialog");

const dossier = page.slice(dossierStart, editorStart);
const editor = page.slice(editorStart, legalStart);
const legal = page.slice(legalStart, legalEnd);
const dialog = page.slice(dialogStart, confirmationStart);

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

check("01 dialog fits a 360px viewport", () => {
  assert.match(dialog, /max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(dialog, /w-\[calc\(100vw-1rem\)\]/);
  assert.match(dialog, /overflow-hidden/);
});

check("02 dialog has one bounded content scroller", () => {
  assert.match(dialog, /id="field-dialog-panel"[\s\S]*?min-h-0 flex-1 overflow-y-auto overscroll-contain/);
});

check("03 field actions remain visible", () => {
  assert.match(dialog, /data-testid="field-dialog-action-bar"/);
  assert.match(dialog, /sticky bottom-0 z-20/);
});

check("04 sticky bar contains the complete editor workflow", () => {
  assert.match(dialog, /onClick=\{addRow\}[\s\S]*?Добавить участок/);
  assert.match(dialog, /onClick=\{requestCloseField\} disabled=\{saving\}>Закрыть/);
  assert.match(dialog, /onClick=\{requestSave\}[\s\S]*?Сохранить/);
});

check("05 save action communicates dirty state", () => {
  assert.match(dialog, /aria-live="polite"/);
  assert.match(dialog, /Есть несохранённые изменения/);
  assert.match(dialog, /disabled=\{saving \|\| !hasUnsavedStructureChanges\}/);
});

check("06 close continues through the guarded close handler", () => {
  assert.match(dialog, /hideCloseButton/);
  assert.match(dialog, /aria-label="Закрыть карточку поля"/);
  assert.match(dialog, /onClick=\{requestCloseField\}/);
  assert.match(page, /if \(hasUnsavedStructureChanges && !saving\)[\s\S]*?setDiscardConfirmationOpen\(true\)/);
});

check("07 field sections expose an accessible tab pattern", () => {
  assert.match(dialog, /role="tablist" aria-label="Разделы карточки поля"/);
  assert.match(dialog, /role="tab"[\s\S]*?aria-selected=\{fieldDialogTab === "dossier"\}/);
  assert.match(dialog, /role="tabpanel"[\s\S]*?aria-labelledby=\{`field-tab-\$\{fieldDialogTab\}`\}/);
});

check("08 roving keyboard focus supports arrows and boundaries", () => {
  assert.match(page, /const moveTabFocus/);
  assert.match(page, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(dialog, /tabIndex=\{fieldDialogTab === "dossier" \? 0 : -1\}/);
  assert.match(dialog, /onKeyDown=\{moveTabFocus\}/);
});

check("09 primary controls keep 44px targets", () => {
  assert.match(dialog, /className="h-11 min-w-11/);
  assert.match(dialog, /className="h-11 w-11/);
  assert.match(editor, /"h-11 w-full min-w-0/);
});

check("10 reduced motion is honored", () => {
  assert.match(dialog, /overlayClassName="motion-reduce:data-\[state=open\]:animate-none/);
  assert.match(dialog, /motion-reduce:data-\[state=closed\]:animate-none/);
  assert.match(dialog, /motion-reduce:transition-none/);
  assert.match(editor, /motion-reduce:transition-none/);
});

check("11 field heading is stated once in the dialog shell", () => {
  assert.match(dialog, /<DialogTitle[\s\S]*?fieldDisplayName\(selectedField\)/);
  assert.doesNotMatch(dossier, /text-2xl font-semibold text-white[^>]*>\{fieldDisplayName\(selectedField\)\}/);
});

check("12 seasonal truth is a semantic section", () => {
  assert.match(dossier, /<section aria-labelledby="field-season-summary-heading"/);
  assert.match(dossier, /<dl className="grid grid-cols-2/);
  assert.match(dossier, /Состояние поля в сезоне/);
});

check("13 overview no longer uses four framed KPI cards", () => {
  assert.doesNotMatch(dossier, /rounded-xl border border-slate-800 bg-slate-950\/45 p-3/);
  assert.match(dossier, /sm:divide-x sm:divide-border/);
  assert.doesNotMatch(legal, /bg-white|text-slate-900|text-slate-700/);
  assert.match(legal, /field-legal-contour-heading/);
});

check("14 live harvest projection remains mounted with exact scope", () => {
  assert.match(dossier, /<FieldHarvestLive[\s\S]*?companyId=\{activeCompanyId\}[\s\S]*?seasonId=\{seasonId\}[\s\S]*?fieldId=\{selectedField\.id\}/);
  assert.match(dossier, /allocationId=\{selectedItem\?\.allocation\.id \|\| null\}/);
});

check("15 plot selector adapts from narrow rail to desktop sidebar", () => {
  assert.match(dossier, /flex min-h-0 gap-2 overflow-x-auto/);
  assert.match(dossier, /lg:block[\s\S]*?lg:overflow-y-auto/);
  assert.match(dossier, /min-w-\[220px\][\s\S]*?lg:min-w-0/);
});

check("16 plot detail is a clear labelled section", () => {
  assert.match(dossier, /<section className="flex min-h-0 min-w-0 flex-col overflow-hidden" aria-labelledby="selected-allocation-heading">/);
  assert.match(dossier, /id="selected-allocation-heading"/);
  assert.match(dossier, /id=\{`allocation-tab-\$\{tab\.key\}`\}[\s\S]*?aria-controls="allocation-detail-panel"/);
  assert.match(dossier, /id="allocation-detail-panel"[\s\S]*?role="tabpanel"/);
});

check("17 detail tables remain usable on narrow screens", () => {
  assert.match(dossier, /overflow-x-auto border-y border-border[\s\S]*?min-w-\[640px\]/);
  assert.match(dossier, /overflow-x-auto border-y border-border[\s\S]*?min-w-\[680px\]/);
});

check("18 editor rows are divided sections instead of framed cards", () => {
  assert.match(editor, /aria-labelledby=\{`crop-structure-row-\$\{index\}`\}/);
  assert.match(editor, /border-t border-border py-3 first:border-t-0 first:pt-0 sm:py-4/);
  assert.doesNotMatch(editor, /overflow-hidden rounded-xl border border-slate-700\/80 bg-\[#101823\]/);
});

check("19 editor prioritizes identity and area with optional agronomy collapsed", () => {
  assert.match(editor, /Участки поля/);
  assert.match(editor, />Состав зерносмеси<\/h5>/);
  assert.match(editor, /<details[\s\S]*?<summary[\s\S]*?Дополнительные параметры/);
  assert.ok(editor.indexOf("Площадь, га *") < editor.indexOf("Культура *"));
  const optionalAgronomyStart = editor.indexOf('<details className="tf-estate-details');
  assert.ok(editor.indexOf("Сорт") < optionalAgronomyStart);
  assert.ok(editor.indexOf("Репродукция / поколение") < optionalAgronomyStart);
  assert.ok(editor.indexOf("Орошение") > optionalAgronomyStart);
  assert.match(editor, /col-span-5 min-w-0 sm:col-span-6 md:col-span-4/);
  assert.match(editor, /col-span-7 min-w-0 sm:col-span-6 md:col-span-3/);
  assert.match(editor, /col-span-12 min-w-0 sm:col-span-6 md:col-span-5/);
  assert.match(editor, /col-span-12 grid grid-cols-2 items-end gap-2 sm:gap-3/);
  assert.doesNotMatch(editor, /<details[\s\S]{0,300}?Посевной материал/);
});

check("20 area completion is visible and screen-reader friendly", () => {
  assert.match(editor, /role="progressbar"/);
  assert.match(editor, /aria-label="Заполненная площадь структуры"/);
  assert.match(editor, /aria-valuenow=\{Math\.round\(plannedPercent\)\}/);
});

check("21 deletion stays explicit and protected", () => {
  assert.match(editor, /const isDeleteLocked = operationsCount > 0 \|\| materialsCount > 0/);
  assert.match(editor, /onClick=\{\(\) => requestRemoveRow\(index\)\}/);
  assert.match(editor, /Показать причину запрета удаления участка/);
});

check("22 crop, fallow and crop-mix choices are preserved", () => {
  assert.match(editor, /<SelectItem value="crop">Культура<\/SelectItem>/);
  assert.match(editor, /<SelectItem value="crop_mix">Зерносмесь<\/SelectItem>/);
  assert.match(editor, /<SelectItem value="fallow">Пар<\/SelectItem>/);
});

check("23 seed identity and agronomy inputs are preserved", () => {
  for (const label of ["Культура *", "Сорт", "Репродукция / поколение", "Площадь, га *", "Орошение", "Междурядье, м", "Расстояние между семенами, см", "Комментарий"]) {
    assert.ok(editor.includes(label), `missing editor field: ${label}`);
  }
});

check("24 mix component lifecycle is preserved", () => {
  assert.match(editor, /patchMixComponent/);
  assert.match(editor, /removeMixComponent/);
  assert.match(editor, /addMixComponent/);
  assert.match(editor, /GRAIN_MIX_MIN_COMPONENTS/);
  assert.match(editor, /GRAIN_MIX_MAX_COMPONENTS/);
});

check("25 area helper remains keyboard-operable", () => {
  assert.match(editor, /aria-label="Заполнить остатком площади"/);
  assert.match(editor, /onClick=\{\(\) => fillRemainingArea\(index\)\}/);
});

check("26 empty editor tells the user where to continue", () => {
  assert.match(editor, /Добавьте первый участок в панели действий/);
});

check("27 role gates remain unchanged", () => {
  assert.match(page, /const canEditStructure = isGlobalAdmin \|\| profile\?\.role === "company_admin" \|\| profile\?\.role === "agronomist"/);
  assert.match(dialog, /\{canEditStructure \? \(/);
  assert.match(dialog, /\{isGlobalAdmin \? \(/);
  assert.match(dialog, /\{canEditSelectedSeason && fieldDialogTab === "editor" \? \(/);
});

check("28 save and discard confirmations are preserved", () => {
  assert.match(page, /Подтвердить изменения структуры\?/);
  assert.match(page, /Закрыть без сохранения\?/);
  assert.match(page, /onClick=\{\(\) => void confirmSave\(\)\}/);
});

check("29 PDF and operation planning remain available", () => {
  assert.match(dialog, /onClick=\{exportFieldPdf\}/);
  assert.match(dossier, /onClick=\{\(event\) => openOperationPlan\(selectedItemField, selectedItem\.allocation, event\)\}/);
});

check("30 C16 changes stay in the UI composition", () => {
  assert.doesNotMatch(dialog, /fetch\(|supabase\.|\.from\(/);
  assert.doesNotMatch(editor, /fetch\(|supabase\.|\.from\(/);
});

console.log(`TravkinFlow 2 crop structure dialog: ${passed}/30 PASS`);
