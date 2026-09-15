import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImpuritySourcePicker } from "../components/weighbridge/impurity-source-picker";
import { isImpuritySourceSelectionBlocked } from "../lib/weighbridge/impurity-source-selection";

// tsx follows the repository's preserve JSX setting; server markup uses React.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

const exactA = { key: "lot-a:field-49-elite", label: "Гала · Элита", supportsSharedSelection: true };
const exactB = { key: "lot-b:field-49-first", label: "Гала · 1 репродукция", supportsSharedSelection: true };
const legacy = { key: "legacy:lot-c", label: "Балтик Роуз", supportsSharedSelection: false };
const options = [exactA, exactB, legacy];
assert.equal(isImpuritySourceSelectionBlocked([exactA.key], exactB, options), false);
assert.equal(isImpuritySourceSelectionBlocked([exactA.key], legacy, options), true);
assert.equal(isImpuritySourceSelectionBlocked([legacy.key], exactA, options), true);
assert.equal(isImpuritySourceSelectionBlocked([], legacy, options), false);
const render = (value: string[], rows = options) => renderToStaticMarkup(React.createElement(ImpuritySourcePicker, {options: rows, value, onChange: () => {}}));
assert.match(render([exactA.key]), /Гала · Элита/);
assert.match(render([exactA.key, exactB.key]), /Выбрано партий: 2/);
assert.match(render([exactA.key, exactB.key], []), /Выбрано партий: 2/);
assert.match(render([exactA.key], []), /Ранее выбранная партия/);
assert.match(render([exactA.key], []), /Выбор сохранён/);
assert.doesNotMatch(render([exactA.key], []), /Выберите участки или партии урожая/);
const picker = fs.readFileSync(path.join(process.cwd(), "components/weighbridge/impurity-source-picker.tsx"), "utf8");
const page = fs.readFileSync(path.join(process.cwd(), "app/(dashboard)/weighbridge/page.tsx"), "utf8");
assert.doesNotMatch(picker, /SheetContent|DialogContent|setDraftValue|commitPicker/);
assert.match(picker, /onChange\(\[\.\.\.availableSelection, option.key\]\)/);
assert.match(picker, /onChange\(selected.filter/);
assert.match(picker, /normalizeImpuritySourceSelection\(selected, options\)/);
assert.doesNotMatch(picker, /unavailableKeys\.length \|\| isImpuritySourceSelectionBlocked/);
assert.match(page, /hydratedWorkspaceKeyRef.current === universalWorkspacePersistKey\) return/);
assert.match(page, /The just-created ticket owns\/reserves its sources[\s\S]*?sourceBatchId: "",\s*impuritySourceSelections: \[\],/);
assert.doesNotMatch(page, /return harvestBatchDetailLoading \? "Данные партии ещё загружаются"/);
assert.match(page, /selectedImpuritySourceOptions.length !== impuritySourceSelectionKeys.length/);
assert.match(page, /harvestBatchDetailRequestedKey !==/);
console.log("P0 impurity controlled selection: 20 checks PASS (browser fixture covers interaction sequence)");
