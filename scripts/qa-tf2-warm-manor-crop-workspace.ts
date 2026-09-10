import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isSameCropStructureUiContext,
  type CropStructureUiContext,
} from "../app/(dashboard)/crop-structure/save-context";

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
const requestCloseStart = page.indexOf("const requestCloseField =");
const requestOpenStart = page.indexOf("const requestOpenField =", requestCloseStart);
const confirmDiscardStart = page.indexOf("const confirmDiscardFieldChanges =", requestOpenStart);
const patchDraftStart = page.indexOf("const patchDraft =", confirmDiscardStart);
const prepareSaveStart = page.indexOf("const prepareDraftForSave =", patchDraftStart);
const requestSaveStart = page.indexOf("const requestSave =", prepareSaveStart);
const confirmSaveStart = page.indexOf("const confirmSave =", requestSaveStart);
const exportExcelStart = page.indexOf("const exportExcel =", confirmSaveStart);
const requestCloseController = page.slice(requestCloseStart, requestOpenStart);
const requestOpenController = page.slice(requestOpenStart, confirmDiscardStart);
const draftMutationControllers = page.slice(patchDraftStart, prepareSaveStart);
const requestSaveController = page.slice(requestSaveStart, confirmSaveStart);
const confirmSaveController = page.slice(confirmSaveStart, exportExcelStart);

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

const checkAsync = async (name: string, run: () => Promise<void>) => {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
};

const deferred = () => {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const runDelayedSaveCompletionProbe = async (
  snapshot: CropStructureUiContext,
  latestContext: () => CropStructureUiContext,
  transport: Promise<void>,
) => {
  const effects: string[] = [];
  try {
    await transport;
    if (!isSameCropStructureUiContext(latestContext(), snapshot)) return effects;
    effects.push("apply", "success-toast", "close");
  } catch {
    if (!isSameCropStructureUiContext(latestContext(), snapshot)) return effects;
    effects.push("error-toast");
  } finally {
    effects.push("unlock");
  }
  return effects;
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
  assert.match(page, /if \(!isDesktopWorkspace \|\| viewMode !== "cards" \|\| selectedFieldId \|\| saving \|\| filteredFields\.length === 0\) return/);
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
  assert.match(masterItem, /disabled=\{!FIELD_FIRST_CREATE_ENABLED \|\| hasUnsavedStructureChanges \|\| saving\}/);
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
  assert.match(pageComposition, /disabled=\{seasons\.length === 0 \|\| saving \|\| \(isDesktopWorkspace && hasUnsavedStructureChanges\)\}/);
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

check("23 in-flight lock wins before close and field-switch decisions", () => {
  const closeLock = requestCloseController.indexOf("if (saveInFlightRef.current)");
  const closeDiscard = requestCloseController.indexOf("if (hasUnsavedStructureChanges");
  const openLock = requestOpenController.indexOf("if (saveInFlightRef.current)");
  const openDiscard = requestOpenController.indexOf("if (selectedFieldId && hasUnsavedStructureChanges");
  const openCommit = requestOpenController.lastIndexOf("openField(fieldId, tab)");
  assert.ok(closeLock >= 0 && closeLock < closeDiscard, "close is locked before dirty-state routing");
  assert.ok(openLock >= 0 && openLock < openDiscard && openDiscard < openCommit, "switch is locked before discard/open routing");
});

check("24 save lock is synchronous and precedes every await", () => {
  const duplicateGuard = confirmSaveController.indexOf("if (saveInFlightRef.current) return");
  const lock = confirmSaveController.indexOf("saveInFlightRef.current = true");
  const firstAwait = confirmSaveController.indexOf("await ");
  assert.ok(duplicateGuard >= 0 && duplicateGuard < lock, "duplicate submit guard precedes lock acquisition");
  assert.ok(lock > duplicateGuard && lock < firstAwait, "lock is acquired before asynchronous work");
  assert.match(requestSaveController, /if \(saveInFlightRef\.current\) return/);
});

check("25 async save uses an immutable field/company/season snapshot", () => {
  assert.match(confirmSaveController, /const saveFieldId = selectedFieldId;/);
  assert.match(confirmSaveController, /const saveCompanyId = activeCompanyId;/);
  assert.match(confirmSaveController, /const saveSeasonId = seasonId;/);
  assert.match(confirmSaveController, /fetch\(`\/api\/crop-structure\/fields\/\$\{saveFieldId\}`/);
  assert.match(confirmSaveController, /companyId: saveCompanyId,[\s\S]*?seasonId: saveSeasonId/);
  assert.match(confirmSaveController, /next\.set\(saveFieldId, savedRows\)/);
});

check("26 save lock always releases in finally", () => {
  const finallyStart = confirmSaveController.indexOf("} finally {");
  const release = confirmSaveController.indexOf("saveInFlightRef.current = false", finallyStart);
  const renderRelease = confirmSaveController.indexOf("setSaving(false)", finallyStart);
  assert.ok(finallyStart >= 0 && release > finallyStart && renderRelease > release);
});

check("27 every editor mutation controller is locked during save", () => {
  const guards = draftMutationControllers.match(/saveInFlightRef\.current/g) || [];
  assert.ok(guards.length >= 9, `expected at least 9 mutation guards, found ${guards.length}`);
  assert.match(page, /<fieldset[\s\S]*?disabled=\{saving\}[\s\S]*?data-testid="crop-structure-editor"/);
  assert.match(page, /aria-busy=\{saving\}/);
});

check("28 navigation and action controls communicate the save lock", () => {
  assert.match(masterItem, /aria-pressed=\{isSelected\}[\s\S]*?disabled=\{saving\}/);
  assert.match(workspace, /onClick=\{addRow\}[\s\S]*?disabled=\{saving\}/);
  assert.match(fieldDialog, /onClick=\{requestCloseField\}[\s\S]*?disabled=\{saving\}/);
  assert.match(pageComposition, /onClick=\{\(\) => changeViewMode\("cards"\)\}[\s\S]*?disabled=\{saving\}/);
});

check("29 save completion follows the current responsive mode", () => {
  assert.match(confirmSaveController, /const remainsInline = window\.matchMedia\("\(min-width: 1280px\)"\)\.matches && viewMode === "cards"/);
  assert.match(confirmSaveController, /if \(remainsInline\) \{[\s\S]*?setPendingSaveRows\(\[\]\)[\s\S]*?\} else \{[\s\S]*?closeField\(\)/);
  assert.match(page, /\{!isDesktopWorkspace \|\| viewMode !== "cards" \? \(/);
});

check("30 view changes and automatic selection wait for save completion", () => {
  const changeViewStart = page.indexOf("const changeViewMode =");
  const fieldStateStart = page.indexOf("const fieldState =", changeViewStart);
  const changeViewController = page.slice(changeViewStart, fieldStateStart);
  assert.match(changeViewController, /if \(saveInFlightRef\.current\) return/);
  assert.match(page, /selectedFieldId \|\| saving \|\| filteredFields\.length === 0/);
});

check("31 save context identity rejects every global or local context change", () => {
  const snapshot: CropStructureUiContext = {
    companyId: "company-a",
    seasonId: "season-2026",
    fieldId: "field-1",
    profileId: "profile-1",
    role: "company_admin",
  };
  assert.equal(isSameCropStructureUiContext(snapshot, { ...snapshot }), true);
  assert.equal(isSameCropStructureUiContext(snapshot, { ...snapshot, companyId: "company-b" }), false);
  assert.equal(isSameCropStructureUiContext(snapshot, { ...snapshot, seasonId: "season-2027" }), false);
  assert.equal(isSameCropStructureUiContext(snapshot, { ...snapshot, fieldId: "field-2" }), false);
  assert.equal(isSameCropStructureUiContext(snapshot, { ...snapshot, profileId: "profile-2" }), false);
  assert.equal(isSameCropStructureUiContext(snapshot, { ...snapshot, role: "agronomist" }), false);
});

check("32 latest-context ref tracks company season field identity and role", () => {
  assert.match(page, /const useIsomorphicLayoutEffect = typeof window === "undefined" \? useEffect : useLayoutEffect/);
  assert.match(page, /const latestSaveContextRef = useRef<CropStructureUiContext>/);
  assert.match(page, /useIsomorphicLayoutEffect\(\(\) => \{[\s\S]*?latestSaveContextRef\.current = \{[\s\S]*?companyId: activeCompanyId,[\s\S]*?seasonId,[\s\S]*?fieldId: selectedFieldId,[\s\S]*?profileId: activeProfileId,[\s\S]*?role: profile\?\.role \|\| null/);
  assert.match(page, /return \(\) => \{[\s\S]*?latestSaveContextRef\.current = \{[\s\S]*?companyId: null,[\s\S]*?seasonId: "",[\s\S]*?fieldId: null,[\s\S]*?profileId: null,[\s\S]*?role: null/);
  assert.match(page, /\}, \[activeCompanyId, activeProfileId, profile\?\.role, seasonId, selectedFieldId\]\);/);
});

check("33 immutable save snapshot carries identity and authorization context", () => {
  assert.match(confirmSaveController, /const saveContext: CropStructureUiContext = \{[\s\S]*?companyId: saveCompanyId,[\s\S]*?seasonId: saveSeasonId,[\s\S]*?fieldId: saveFieldId,[\s\S]*?profileId: activeProfileId,[\s\S]*?role: profile\?\.role \|\| null/);
  assert.match(confirmSaveController, /isSameCropStructureUiContext\(latestSaveContextRef\.current, saveContext\)/);
});

check("34 context switch before PUT suppresses the stale write", () => {
  const sessionAwait = confirmSaveController.indexOf("await supabase.auth.getSession()");
  const preflightFence = confirmSaveController.indexOf("if (!saveContextIsCurrent()) return", sessionAwait);
  const request = confirmSaveController.indexOf("const response = await fetch", preflightFence);
  assert.ok(sessionAwait >= 0 && preflightFence > sessionAwait && request > preflightFence);
});

check("35 context switch after PUT suppresses every stale response effect", () => {
  const responsePayload = confirmSaveController.indexOf("await response.json()");
  const responseFence = confirmSaveController.indexOf("if (!saveContextIsCurrent()) return", responsePayload);
  const responseError = confirmSaveController.indexOf("if (!response.ok)", responseFence);
  const firstUiApply = confirmSaveController.indexOf("setAllocByField", responseFence);
  const successToast = confirmSaveController.indexOf('toast({ title: "Сохранено"', responseFence);
  const close = confirmSaveController.indexOf("closeField()", responseFence);
  assert.ok(responsePayload >= 0 && responseFence > responsePayload);
  assert.ok(responseError > responseFence && firstUiApply > responseFence && successToast > responseFence && close > responseFence);
});

check("36 stale transport failures stay silent but finally releases the lock", () => {
  const catchStart = confirmSaveController.indexOf("} catch (error) {");
  const catchFence = confirmSaveController.indexOf("if (!saveContextIsCurrent()) return", catchStart);
  const errorToast = confirmSaveController.indexOf('toast({ title: "Ошибка"', catchFence);
  const finallyStart = confirmSaveController.indexOf("} finally {", errorToast);
  const release = confirmSaveController.indexOf("saveInFlightRef.current = false", finallyStart);
  assert.ok(catchStart >= 0 && catchFence > catchStart && errorToast > catchFence);
  assert.ok(finallyStart > errorToast && release > finallyStart);
});

const runAsyncChecks = async () => {
  await checkAsync("37 delayed stale resolve and reject produce only unlock", async () => {
    const snapshot: CropStructureUiContext = {
      companyId: "company-a",
      seasonId: "season-2026",
      fieldId: "field-1",
      profileId: "profile-1",
      role: "company_admin",
    };

    let latestContext = snapshot;
    const resolvedTransport = deferred();
    const resolvedCompletion = runDelayedSaveCompletionProbe(snapshot, () => latestContext, resolvedTransport.promise);
    latestContext = { ...snapshot, companyId: "company-b" };
    resolvedTransport.resolve();
    assert.deepEqual(await resolvedCompletion, ["unlock"]);

    latestContext = snapshot;
    const rejectedTransport = deferred();
    const rejectedCompletion = runDelayedSaveCompletionProbe(snapshot, () => latestContext, rejectedTransport.promise);
    latestContext = { ...snapshot, role: "agronomist" };
    rejectedTransport.reject(new Error("late transport failure"));
    assert.deepEqual(await rejectedCompletion, ["unlock"]);
  });

  console.log(`TF2 Warm Manor crop master-detail: ${passed}/37 PASS`);
};

void runAsyncChecks().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
