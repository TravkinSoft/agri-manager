import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isImpuritySourceSelectionBlocked,
  normalizeImpuritySourceSelection,
} from "../lib/weighbridge/impurity-source-selection";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/(dashboard)/weighbridge/page.tsx"), "utf8");

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
  /sourceBatchId: "",\s*impuritySourceSelections: \[\],/,
  "creating a ticket must reset its consumed source before the next ticket"
);

console.log("P0 repeat impurity ticket 5/5 PASS");
