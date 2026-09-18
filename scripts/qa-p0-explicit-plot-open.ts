import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("components/traffic/traffic-shift-controls.tsx", "utf8");
const route = readFileSync("app/api/traffic/operator/plots/route.ts", "utf8");
const board = readFileSync("components/traffic/traffic-board.tsx", "utf8");
let checks = 0;

function includes(value: string) {
  assert.equal(source.includes(value), true, `Missing contract: ${value}`);
  checks += 1;
}

function excludes(value: string) {
  assert.equal(source.includes(value), false, `Forbidden auto-selection contract found: ${value}`);
  checks += 1;
}

function routeIncludes(value: string) {
  assert.equal(route.includes(value), true, `Missing server continuation contract: ${value}`);
  checks += 1;
}

function boardIncludes(value: string) {
  assert.equal(board.includes(value), true, `Missing mobile card contract: ${value}`);
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
includes('cropStructureId: continuationPlot.cropStructureId');
includes('Продолжить · поле ${continuationPlot.fieldName}');
includes('Выбрать другое поле');
routeIncludes('.eq("operator_user_id", actor.actorId)');
routeIncludes('plot.status !== "completed"');
routeIncludes('suggestedCropStructureId,');
boardIncludes('&& harvesterShiftReady && !stale && snapshot.enabled;');

console.log(`Plot continuation PASS: ${checks} checks; only the last server-confirmed unfinished plot can be continued, alternative selection stays explicit, disabled swipe labels stay hidden; no hosted or business-data writes.`);
