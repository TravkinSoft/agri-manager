import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const crop = read("app/(dashboard)/crop-structure/page.tsx");
const harvest = read("components/crop-structure/field-harvest-live.tsx");
const warehouses = read("app/(dashboard)/warehouses/page.tsx");
const stock = read("components/warehouses/stock-availability.tsx");
const dashboard = read("components/dashboard/harvest-dashboard.tsx");

const checks: string[] = [];
const check = (name: string, run: () => void) => {
  run();
  checks.push(name);
  console.log(`PASS ${checks.length}: ${name}`);
};

check("crop workspace omits the empty page masthead and status filter", () => {
  assert.doesNotMatch(crop, /<PageHeader title="Структура посевов"/);
  assert.doesNotMatch(crop, /Все статусы/);
  assert.doesNotMatch(crop, /statusFilter/);
});

check("crop dossier omits decorative field rollups", () => {
  const dossier = crop.slice(crop.indexOf("const renderFieldDossier ="), crop.indexOf("const renderDesktopFieldWorkspace ="));
  assert.doesNotMatch(dossier, /Состояние поля в сезоне|>Участков<|>В структуре</);
  assert.match(dossier, /item\.operationsForAllocation\.length \? <div>/);
  assert.match(dossier, /item\.materialRows\.length \? <div>/);
});

check("harvest fact remains available in a compact surface", () => {
  assert.match(harvest, /data-testid="field-harvest-live"/);
  assert.match(harvest, /rounded-lg border border-emerald/);
  assert.doesNotMatch(harvest, /min-h-\[132px\]/);
  assert.match(harvest, /selectedAllocation\(data, allocationId\)/);
});

check("warehouse page omits the empty masthead and temporary actions", () => {
  assert.doesNotMatch(warehouses, /<PageHeader title="Склады"|Изменить порядок|Начальный остаток/);
  assert.match(warehouses, /Управление складами/);
  assert.match(warehouses, /Инвентаризация/);
});

check("warehouse cards use personal hold-to-drag ordering", () => {
  assert.match(warehouses, /WAREHOUSE_REORDER_HOLD_MS = 320/);
  assert.match(warehouses, /data-personal-warehouse-order="enabled"/);
  assert.match(warehouses, /window\.localStorage\.setItem\(orderPreferenceKey/);
  assert.match(warehouses, /onPointerDown=\{reorderable \? \(event\) => beginPointerReorder/);
  assert.match(warehouses, /touch-none/);
  assert.match(warehouses, /window\.scrollBy\(\{ top: -deltaY, behavior: "auto" \}\)/);
  assert.doesNotMatch(warehouses, /await reorderWarehouses/);
});

check("closed stock disclosures point up and open disclosures point down", () => {
  assert.match(stock, /ChevronUp/);
  assert.match(stock, /group-open\/crop:rotate-180/);
  assert.match(stock, /group-open\/identity:rotate-180/);
  assert.doesNotMatch(stock, /ChevronDown/);
});

check("dashboard moves live context into the field row", () => {
  assert.doesNotMatch(dashboard, /tf-manor-heading text-3xl/);
  assert.match(dashboard, /<span>Картофель<\/span><span>·<\/span><span>\{clock/);
  assert.match(dashboard, /text-emerald-700">Live/);
});

check("yield calculator is width-bounded", () => {
  assert.match(dashboard, /aria-label="Калькулятор урожайности"/);
  assert.match(dashboard, /grid max-w-md grid-cols-/);
  assert.doesNotMatch(dashboard.slice(dashboard.indexOf('aria-label="Калькулятор урожайности"') - 800), /Принятый вес/);
});

console.log(`Owner annotations UI PASS: ${checks.length}/${checks.length}`);
