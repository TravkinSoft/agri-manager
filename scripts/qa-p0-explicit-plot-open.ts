import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("components/traffic/traffic-shift-controls.tsx", "utf8");
let checks = 0;

function includes(value: string) {
  assert.equal(source.includes(value), true, `Missing contract: ${value}`);
  checks += 1;
}

function excludes(value: string) {
  assert.equal(source.includes(value), false, `Forbidden auto-selection contract found: ${value}`);
  checks += 1;
}

includes('function beginPlotDialog(mode: Exclude<PlotDialogMode, null>)');
includes('setSelectedPlotId("");');
excludes('setSelectedPlotId(candidate?.cropStructureId || "");');
includes('if (!selectedPlotId) return;');
includes('aria-label="Управление сменой комбайнёра"');
includes('aria-pressed={selected}');
includes('onClick={() => setSelectedPlotId(plot.cropStructureId)}');
includes('disabled={busy || !selectedPlotId}');
excludes('<select value={selectedPlotId}');

console.log(`Explicit plot selection PASS: ${checks} checks; no hosted or business-data writes.`);
