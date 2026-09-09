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
const service = read("lib/services/fields-map.ts");

check("Fields Map uses the scoped TravkinFlow 2 shell", () => {
  assert.match(activeRender, /className="tf2-shell /);
  assert.match(styles, /\.tf2-shell(?:\s*,|\s*\{)/);
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

check("field selection collapses the compact search rail before opening the inspector", () => {
  const selectHandler = source.slice(
    source.indexOf("const handleSelectField"),
    source.indexOf("const handleShowAllFields")
  );
  const searchHandler = source.slice(
    source.indexOf("const runFieldSearch"),
    source.indexOf("const focusGeometryOnMap")
  );
  for (const handler of [selectHandler, searchHandler]) {
    assert.match(handler, /setFieldSearch\(""\)/);
    assert.match(handler, /setShowFieldListMobile\(false\)/);
  }
});

check("compact map controls and dock zoom controls expose 44px touch targets", () => {
  assert.match(styles, /@media \(max-width: 1023px\)/);
  assert.match(styles, /\.tf2-shell button,[^}]*min-width: 44px;/s);
  assert.match(styles, /\.tf2-shell input,[^}]*min-height: 44px;/s);
  assert.match(activeRender, /aria-label="Приблизить карту"[^\n]+h-11 w-11/);
  assert.match(activeRender, /aria-label="Отдалить карту"[^\n]+h-11 w-11/);
  assert.doesNotMatch(source, /new maplibre\.NavigationControl/);
});

check("measurement actions share the same dock surface", () => {
  const measurementDock = activeRender.slice(activeRender.indexOf("absolute bottom-4 left-1\/2"));
  assert.match(measurementDock, /tf2-dock[^"\n]*pointer-events-auto/);
  assert.match(measurementDock, />Расстояние<\/Button>/);
  assert.match(measurementDock, />Площадь<\/Button>/);
  assert.match(measurementDock, />Очистить<\/Button>/);
  assert.match(measurementDock, /overflow-x-auto/);
  assert.match(measurementDock, /min-w-max flex-nowrap/);
});

check("inspectors are bottom sheets on compact screens and side panels on desktop", () => {
  assert.equal((activeRender.match(/data-testid="fields-map-inspector"/g) || []).length, 2);
  assert.equal((activeRender.match(/bottom-28[^\n]+top-\[10\.5rem\][^\n]+xl:right-3[^\n]+xl:top-3/g) || []).length, 2);
  assert.match(styles, /data-has-open-inspector="true"[^}]+\.tf2-map-measure-dock[^}]+display: none/s);
});

check("map viewport and native scale reserve responsive shell space", () => {
  assert.match(activeRender, /data-testid="fields-map-viewport"/);
  assert.match(activeRender, /h-\[calc\(100dvh_-_9\.75rem_-_env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(activeRender, /min-h-\[720px\]/);
  assert.match(styles, /@media \(max-width: 1279px\)[^}]+maplibregl-ctrl-scale[^}]+display: none/s);
  assert.match(styles, /@media \(min-width: 1280px\)[^}]+maplibregl-ctrl-bottom-right[^}]+bottom: 4\.75rem/s);
});

check("motion respects the operating-system preference", () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.tf2-shell \*,/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
  assert.match(source, /function mapMotionDuration/);
  assert.match(source, /duration: mapMotionDuration\(650\)/);
  assert.match(source, /duration: mapMotionDuration\(700\)/);
});

check("preview responses cannot resurrect a cancelled or stale draft", () => {
  assert.match(source, /previewGenerationRef/);
  assert.match(source, /previewAbortControllerRef/);
  assert.match(source, /runGeneration !== previewGenerationRef\.current/);
  assert.match(service, /signal: options\.signal/);
});

check("boundary editing is keyboard-operable and preserves complex geometry", () => {
  assert.match(source, /boundaryRequiresKmlReplacement/);
  assert.match(activeRender, /Заменить через KML/);
  assert.match(activeRender, /aria-label="Долгота вершины"/);
  assert.match(activeRender, /aria-label="Широта вершины"/);
  assert.match(source, /boundaryBusyRef\.current/);
});

console.log(`TravkinFlow 2 Fields Map UI contract: ${checks} checks passed.`);
