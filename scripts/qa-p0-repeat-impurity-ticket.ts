import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isImpuritySourceSelectionBlocked,
  normalizeImpuritySourceSelection,
} from "../lib/weighbridge/impurity-source-selection";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/(dashboard)/weighbridge/page.tsx"), "utf8");
const picker = fs.readFileSync(path.join(root, "components/weighbridge/impurity-source-picker.tsx"), "utf8");

const exactA = { key: "lot-a:field-49-elite", supportsSharedSelection: true };
const exactB = { key: "lot-a:field-49-first", supportsSharedSelection: true };
const legacy = { key: "legacy:lot-b", supportsSharedSelection: false };
const options = [exactA, exactB, legacy];

assert.deepEqual(
  normalizeImpuritySourceSelection(["released:first-ticket", exactB.key], options),
  [exactB.key],
  "a stale selection from the finalized first ticket must not survive the refreshed source list"
);
assert.equal(
  isImpuritySourceSelectionBlocked(["released:first-ticket"], exactA, options),
  false,
  "a stale first-ticket key must not block a valid second-ticket source"
);
assert.equal(
  isImpuritySourceSelectionBlocked([exactA.key], exactB, options),
  false,
  "two exact field sources must remain selectable together"
);
assert.equal(
  isImpuritySourceSelectionBlocked([legacy.key], exactA, options),
  true,
  "a real legacy whole-lot choice remains single-source"
);
assert.match(
  page,
  /The just-created ticket owns\/reserves its sources[\s\S]*?sourceBatchId: "",\s*impuritySourceSelections: \[\],/,
  "creating a ticket must reset its consumed source before the next ticket"
);
assert.match(
  picker,
  /const availableSelection = normalizeImpuritySourceSelection\(selected, options\)[\s\S]*?onChange\(\[\.\.\.availableSelection, option\.key\]\)/,
  "a stale selection must be discarded when the weighman selects a valid source"
);
assert.doesNotMatch(
  picker,
  /unavailableKeys\.length \|\| isImpuritySourceSelectionBlocked/,
  "a stale source must not block the next source"
);

console.log("P0 repeat impurity ticket 7/7 PASS");
