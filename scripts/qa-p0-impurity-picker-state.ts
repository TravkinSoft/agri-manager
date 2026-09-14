import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getImpuritySourcePickerDraftIssue,
  reconcileImpuritySourcePickerDraft,
} from "../components/weighbridge/impurity-source-picker";

const root = process.cwd();
const pickerPath = path.join(root, "components/weighbridge/impurity-source-picker.tsx");
const picker = fs.readFileSync(pickerPath, "utf8");

const exactA = { key: "lot-a:field-49-elite", supportsSharedSelection: true };
const exactB = { key: "lot-a:field-49-first", supportsSharedSelection: true };
const legacy = { key: "legacy:lot-a", supportsSharedSelection: false };
const stale = "released:first-ticket";
const options = [exactA, exactB];

const openedDraft = reconcileImpuritySourcePickerDraft(
  [stale, exactA.key, exactA.key, exactB.key],
  options,
  false
);
assert.deepEqual(
  openedDraft,
  [exactA.key, exactB.key],
  "opening the picker must remove stale keys and duplicates"
);

const transientDraft = reconcileImpuritySourcePickerDraft(openedDraft, [], true);
assert.deepEqual(
  transientDraft,
  openedDraft,
  "an open picker must preserve selected keys while options are transiently empty"
);

const restoredDraft = reconcileImpuritySourcePickerDraft(transientDraft, options, true);
assert.deepEqual(
  restoredDraft,
  openedDraft,
  "restoring options must restore the same checked selections"
);

assert.equal(
  getImpuritySourcePickerDraftIssue([exactA.key, exactB.key], options),
  null,
  "multiple exact sources must remain a valid shared selection"
);
assert.equal(
  getImpuritySourcePickerDraftIssue([legacy.key], [legacy, ...options]),
  null,
  "one legacy whole-lot source must remain valid"
);
assert.equal(
  getImpuritySourcePickerDraftIssue([legacy.key, exactA.key], [legacy, ...options]),
  "incompatible",
  "a whole-lot source must never be combined with an exact source"
);
assert.equal(
  getImpuritySourcePickerDraftIssue([exactA.key, stale], options),
  "unavailable",
  "a missing selected key must block commit instead of being silently dropped"
);

assert.match(
  picker,
  /onPointerDownOutside=\{\(event\) => event\.preventDefault\(\)\}/,
  "outside pointer interactions must not dismiss the picker"
);
assert.match(
  picker,
  /onInteractOutside=\{\(event\) => event\.preventDefault\(\)\}/,
  "outside interactions must not dismiss the picker"
);
assert.match(
  picker,
  /onEscapeKeyDown=\{\(event\) => event\.preventDefault\(\)\}/,
  "Escape must not dismiss the picker"
);
assert.match(
  picker,
  /const cancelPicker = \(\) => \{\s*setDraftValue\(value\);\s*setQuery\(""\);\s*setOpen\(false\);\s*\};/,
  "the explicit cancel action must close without committing"
);
assert.match(
  picker,
  /const commitPicker = \(\) => \{[\s\S]*?getImpuritySourcePickerDraftIssue\(availableDraftValue, options\)[\s\S]*?onChange\(reconcileImpuritySourcePickerDraft\(availableDraftValue, options, false\)\);[\s\S]*?setOpen\(false\);/,
  "Done must validate and commit the preserved draft before closing"
);
assert.doesNotMatch(
  picker,
  /onOpenChange=\{\(nextOpen\) => \{\s*setOpen\(nextOpen\)/,
  "implicit Radix close requests must not change controlled open state"
);
assert.match(picker, /onClick=\{cancelPicker\}/, "X must use the explicit cancel action");
assert.match(picker, /onClick=\{commitPicker\}/, "Done must use the explicit commit action");
assert.match(
  picker,
  /const toggle = \(option: ImpuritySourcePickerOption\) => \{\s*if \(draftHasUnavailableKeys\) return;/,
  "all option toggles must be frozen while a selected source is unavailable"
);
assert.match(
  picker,
  /const interactionBlocked = draftHasUnavailableKeys \|\| selectionBlocked;[\s\S]*?disabled=\{interactionBlocked\}/,
  "unavailable draft state must disable the rendered checkboxes"
);
assert.match(
  picker,
  /if \(getImpuritySourcePickerDraftIssue\(availableDraftValue, options\)\) return;/,
  "commit must revalidate the current option snapshot"
);
assert.match(
  picker,
  /unavailableSourceIsConfirmed[\s\S]*?Убрать недоступные[\s\S]*?Отменить изменения и закрыть/,
  "a ready-but-removed source must expose explicit recovery and cancel actions"
);

console.log("P0 impurity picker state 19/19 PASS");
