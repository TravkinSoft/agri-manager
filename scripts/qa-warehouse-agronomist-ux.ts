import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStockAvailability, compareStoragePlaces, parseWarehouseView, warehouseViewKey } from "../lib/warehouse/stock-availability";
import type { Warehouse, InventoryBalance } from "../lib/types/warehouse";
import type { HarvestBatchSummary } from "../lib/types/weighbridge";

let checks = 0;
const test = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`); };
const places = [
  { id: "w2", name: "Кымызхана", place_type: "WAREHOUSE", company_id: "c1" },
  { id: "dryer", name: "Сушилка", place_type: "DRYER", company_id: "c1" },
  { id: "w1", name: "Номер 1", place_type: "WAREHOUSE", company_id: "c1" },
  { id: "yard", name: "Площадка", place_type: "YARD", company_id: "c1" },
  { id: "foreign", name: "Private foreign warehouse", place_type: "WAREHOUSE", company_id: "c2" },
] as Warehouse[];
const lot = { id: "lot-a", aggregateLotId: "lot-a", warehouseId: "w1", warehouseName: "Номер 1", cropId: "wheat", cropName: "Пшеница", varietyId: "var-a", varietyName: "Ламис", reproductionId: "rep-2", reproductionName: "РС2", cleanMassKg: 100, receivedKg: 10000, companyCurrentKg: 99999, productId: "p1", reviewState: "confirmed" } as HarvestBatchSummary;
const material = { warehouse_id: "w1", product_id: "p1", product_name: "Пшеница", batch_class: "commodity", unit: "kg", quantity: 130, harvest_represented_quantity: 100, material_quantity: 30 } as InventoryBalance;
const build = (batches: HarvestBatchSummary[], balances: InventoryBalance[] = []) => buildStockAvailability("c1", places, batches, balances);

test("default view", () => assert.equal(parseWarehouseView(null), "availability"));
test("invalid saved view", () => assert.equal(parseWarehouseView("invented"), "availability"));
test("last warehouse view", () => assert.equal(parseWarehouseView("warehouses"), "warehouses"));
test("user-scoped preference", () => assert.notEqual(warehouseViewKey("u1", "c1"), warehouseViewKey("u2", "c1")));
test("company-scoped preference", () => assert.notEqual(warehouseViewKey("u1", "c1"), warehouseViewKey("u1", "c2")));
test("yard first processing last", () => assert.deepEqual(places.filter((w) => w.company_id === "c1").sort(compareStoragePlaces).map((w) => w.id), ["yard", "w2", "w1", "dryer"]));
test("same-name warehouses remain separate", () => assert.notEqual(compareStoragePlaces({ ...places[0], name: "Same" }, { ...places[2], name: "Same" }), 0));
test("physical quantity only, not receipt/provenance/company totals", () => assert.equal(build([lot]).crops[0].identities[0].quantity, 100));
test("same lot across warehouses counted once per slice", () => { const r = build([lot, { ...lot, warehouseId: "w2", cleanMassKg: 50 }]); assert.equal(r.crops[0].identities[0].quantity, 150); assert.equal(r.crops[0].identities[0].positions.length, 2); });
test("duplicate slice flagged, not double counted", () => { const r = build([lot, lot]); assert.equal(r.crops[0].identities[0].quantity, 100); assert.equal(r.anomalies.length, 1); });
test("same labels different lot/season identity not merged", () => assert.equal(build([lot, { ...lot, id: "lot-b", aggregateLotId: "lot-b" }]).crops[0].identities.length, 2));
test("unknown crop identity never merged by name", () => assert.equal(build([{ ...lot, cropId: null }, { ...lot, cropId: null, id: "b", aggregateLotId: "b" }]).crops.length, 2));
test("provisional lots remain separate", () => assert.equal(build([{ ...lot, reviewState: "requires_review" }, { ...lot, reviewState: "requires_review", id: "b", aggregateLotId: "b" }]).crops[0].identities.length, 2));
test("zero/history stock hidden", () => assert.equal(build([{ ...lot, cleanMassKg: 0 }]).crops.length, 0));
test("negative stock is a visible anomaly", () => { const r = build([{ ...lot, cleanMassKg: -4 }]); assert.equal(r.crops.length, 0); assert.match(r.anomalies[0].message, /отрицательный/); });
test("invalid stock is a visible anomaly", () => assert.equal(build([{ ...lot, cleanMassKg: NaN }]).anomalies.length, 1));
test("class and physical state not mixed", () => { const r = build([{ ...lot, stockComponents: [{ batchClass: "commodity", physicalState: "SOURCE", quantityKg: 90, tripCount: 1 }, { batchClass: "waste", physicalState: "SCREENINGS", quantityKg: 10, tripCount: 1 }] }]); assert.equal(r.crops[0].identities.length, 2); assert.equal(r.crops[0].identities.reduce((s, i) => s + i.quantity, 0), 100); });
test("material remainder excludes represented harvest", () => assert.equal(build([lot], [material]).crops.flatMap((c) => c.identities).reduce((s, i) => s + i.quantity, 0), 130));
test("zero material remainder hidden", () => assert.equal(build([lot], [{ ...material, material_quantity: 0 }]).crops.length, 1));
test("units not combined", () => assert.equal(build([], [material, { ...material, unit: "l" }]).crops[0].identities.length, 2));
test("negative ledger exposed even when material remainder zero", () => assert.equal(build([], [{ ...material, quantity: -10, material_quantity: 0 }]).anomalies.length, 1));
test("missing material contract not guessed", () => { const r = build([], [{ ...material, material_quantity: undefined }]); assert.equal(r.crops.length, 0); assert.equal(r.anomalies.length, 1); });
test("foreign warehouse excluded with nonleaking anomaly", () => { const r = build([{ ...lot, warehouseId: "foreign" }]); assert.equal(r.crops.length, 0); assert.doesNotMatch(JSON.stringify(r), /Private foreign/); });
test("foreign company cannot reuse current stock", () => assert.equal(buildStockAvailability("c2", places, [lot], [material]).crops.length, 0));
test("inputs and real spelling unchanged", () => { const before = JSON.stringify({ places, lot, material }); build([lot], [material]); assert.equal(JSON.stringify({ places, lot, material }), before); assert.equal(places[0].name, "Кымызхана"); });
const page = readFileSync(new URL("../app/(dashboard)/warehouses/page.tsx", import.meta.url), "utf8");
const component = readFileSync(new URL("../components/warehouses/stock-availability.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../components/warehouses/harvest-batch-dialog.tsx", import.meta.url), "utf8");
test("tabs limited to agronomist", () => assert.match(page, /isAgronomist = profile\?\.role === "agronomist"/));
test("capacity warning does not stretch neighboring cards", () => assert.equal((page.match(/grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4/g) || []).length, 2));
test("availability without required search", () => assert.match(page, /selectedView === "availability"/));
test("abort and stale scope isolation", () => { assert.match(component, /resource.cancel/); assert.match(component, /payload\?\.scope === scope/); assert.match(component, /new ScopedReadResource/); });
test("identity change clears open details and stale requests", () => { const effect = page.slice(page.indexOf("const cached = warehousePageCache.get(cacheKey);"), page.indexOf("  useLiveRefresh({")); assert.match(effect, /selectedBatchRequestGeneration.current \+= 1/); assert.match(effect, /setSelectedBatch\(null\)/); assert.match(effect, /setDetailBalance\(null\)/); assert.match(effect, /profile\?\.id, profile\?\.company_id, profile\?\.role, user\?\.id/); });
test("summary only no detail preload", () => { assert.match(component, /summaryOnly: true/); assert.doesNotMatch(component, /\.tripBatches|\.outgoingDocuments|\.tickets|\.receivedKg|companyCurrentKg/); });
test("errors visible instead of empty stock", () => assert.match(component, /Наличие не подтверждено/));
test("one current balance in dialog", () => assert.equal((dialog.match(/kg\(batch.cleanMassKg\)/g) || []).length, 1));
test("no repeated accounting formula", () => { assert.doesNotMatch(dialog, /По движениям:|Осталось сейчас|accountingRows/); assert.match(dialog, /label: "Поступило"/); assert.match(dialog, /label: "Выбыло"/); });
test("origin and fields collapsed", () => { assert.match(dialog, /<details className="group\/origin/); assert.match(dialog, /<details key=/); assert.doesNotMatch(dialog, /<details[^>]*\sopen[\s=>]/); });
test("mismatch and documents preserved", () => { assert.match(dialog, /Учёт не сходится/); assert.match(dialog, /openTicketPreview/); assert.match(dialog, /formatMoisturePercent/); });
console.log(`PASS warehouse agronomist UX: ${checks}/${checks}`);
