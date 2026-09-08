import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let checks = 0;

const check = (name: string, run: () => void) => {
  run();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
};

const source = read("components/fields-map/fields-map-page.tsx");
const activeRenderStart = source.indexOf("  const hasOpenInspector");
const legacyRenderStart = source.indexOf("  /*", activeRenderStart);
assert.notEqual(activeRenderStart, -1, "active Fields Map render marker is missing");
assert.notEqual(legacyRenderStart, -1, "legacy Fields Map render marker is missing");
const activeRender = source.slice(activeRenderStart, legacyRenderStart);
const styles = read("app/globals.css");

check("Fields Map uses the scoped TravkinFlow 2 shell", () => {
  assert.match(activeRender, /className="tf2-shell /);
  assert.match(styles, /\.tf2-shell\s*\{/);
});

check("top controls and search share one dock", () => {
  const beforeMeasurementDock = activeRender.slice(0, activeRender.indexOf("absolute bottom-4 left-1\/2"));
  assert.equal((beforeMeasurementDock.match(/tf2-dock/g) || []).length, 1);
  assert.match(beforeMeasurementDock, /placeholder="Найти поле\.\.\."/);
  assert.match(beforeMeasurementDock, />Карта<\/Button>/);
  assert.match(beforeMeasurementDock, />KML<\/Button>/);
});

check("season selector is absent from the active map toolbar", () => {
  assert.doesNotMatch(activeRender, /placeholder="Сезон"/);
  assert.doesNotMatch(activeRender, /handleSeasonChange\(value\)/);
});

check("map icon controls have accessible names", () => {
  assert.match(activeRender, /aria-label="Найти поле"/);
  assert.match(activeRender, /aria-label="Моё местоположение"/);
  assert.match(activeRender, /aria-label=\{`\$\{showFieldListMobile/);
});

check("measurement actions share the same dock surface", () => {
  const measurementDock = activeRender.slice(activeRender.indexOf("absolute bottom-4 left-1\/2"));
  assert.match(measurementDock, /tf2-dock pointer-events-auto/);
  assert.match(measurementDock, />Расстояние<\/Button>/);
  assert.match(measurementDock, />Площадь<\/Button>/);
  assert.match(measurementDock, />Очистить<\/Button>/);
});

check("inspectors are bottom sheets on compact screens and side panels on desktop", () => {
  assert.equal((activeRender.match(/className="tf2-panel/g) || []).length, 2);
  assert.equal((activeRender.match(/bottom-20[^\n]+xl:right-3[^\n]+xl:top-3/g) || []).length, 2);
});

check("motion respects the operating-system preference", () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.tf2-shell \*,/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
});

console.log(`TravkinFlow 2 Fields Map UI contract: ${checks} checks passed.`);
