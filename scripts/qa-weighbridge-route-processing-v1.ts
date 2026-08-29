import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isHarvestDestinationPlace,
  isOperationalStoragePlace,
  isProcessingPlace,
} from "@/lib/warehouse/warehouse-scope";
import { canUseGrainProcessing, isVegetableCropForProcessing } from "@/lib/weighbridge/crop-processing";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const workspace = read("components/weighbridge/processing-workspace.tsx");
const transformationsRoute = read("app/api/processing/transformations/route.ts");
const processingWorkspace = read("components/weighbridge/processing-workspace.tsx");
const ticketRoute = read("app/api/weighbridge/tickets/route.ts");
const activeHarvestRoute = read("app/api/weighbridge/active-harvests/route.ts");
const harvestAllocationsRoute = read("app/api/weighbridge/harvest-allocations/route.ts");
const harvestBatchesRoute = read("app/api/weighbridge/harvest-batches/route.ts");
const warehousePage = read("app/(dashboard)/warehouses/page.tsx");
const warehouseSummaryRoute = read("app/api/warehouses/summaries/route.ts");
const harvestBatchDialog = read("components/warehouses/harvest-batch-dialog.tsx");
const migration = read("supabase/migrations/20260826103000_weighbridge_route_processing_contract_v1.sql");
const cropGuardMigration = read("supabase/migrations/20260827110000_weighbridge_crop_processing_guard_v1.sql");

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
};

check("yard is storage while dryer and cleaner are processing places", () => {
  assert.equal(isProcessingPlace("YARD"), false);
  assert.equal(isProcessingPlace("DRYER"), true);
  assert.equal(isProcessingPlace("CLEANER"), true);
  assert.equal(isOperationalStoragePlace("YARD"), true);
  assert.equal(isHarvestDestinationPlace("temporary", "YARD"), true);
});

check("finalized routes create processing inputs only at dryer or cleaner", () => {
  assert.match(migration, /not in \('DRYER', 'CLEANER'\)/);
  assert.match(migration, /attach_route_processing_input_ticket_v1\(new\.id\)/);
  assert.match(migration, /perform public\.sync_grain_movement_shadow_v1\(new\.id\)/);
  assert.match(migration, /YARD remains ordinary storage movement/);
  assert.doesNotMatch(migration, /\b(?:delete\s+from|truncate|drop\s+table|drop\s+column)\b/i);
});

check("weighman uses one ordinary A to B transfer form", () => {
  assert.match(page, /isTransfer \? "Откуда"/);
  assert.match(page, /<Label>Куда \*<\/Label>/);
  assert.match(page, /placeholder="Выберите место назначения"/);
  assert.match(page, /Партия и источник определены маршрутом/);
  assert.doesNotMatch(page, /openProcessingOutput/);
  assert.doesNotMatch(workspace, /Добавить выход/);
});

check("route identifies one cycle silently and asks only on ambiguity", () => {
  assert.match(page, /processingCandidates\.length === 1 \? processingCandidates\[0\] : null/);
  assert.match(page, /processingCandidates\.length > 1/);
  assert.match(page, /От какой обработки\?/);
  assert.match(page, /linked_processing_id: isProcessingOutput \? processingOutputContext\?\.transformationId/);
});

check("dryer has one output and cleaner exposes six fractions", () => {
  assert.match(page, /Зерно после сушки/);
  for (const label of [
    "Основная продукция",
    "Отсев",
    "Фураж / кормовая фракция",
    "Веяльные отходы",
    "Триерные отходы",
    "Прочие отходы",
  ]) assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(ticketRoute, /sourcePlaceType === "DRYER" && processingOutputRole !== "GRAIN"/);
  assert.match(ticketRoute, /Источник не является действующей сушилкой или очисткой/);
});

check("open tickets stay first in the permanent right rail", () => {
  assert.match(page, /xl:grid-cols-\[minmax\(0,1fr\)_340px\]/);
  assert.match(page, /aria-label="Открытые талоны и партии на объектах"/);
  const ticketsIndex = page.indexOf("Открытые талоны", page.indexOf('aria-label="Открытые талоны и партии на объектах"'));
  const workspaceIndex = page.indexOf("<ProcessingWorkspace", ticketsIndex);
  assert.ok(ticketsIndex >= 0 && workspaceIndex > ticketsIndex);
  assert.match(page, /xl:sticky xl:top-16/);
});

check("compact cards expose dryer cleaner and yard state without operator creation controls", () => {
  assert.match(workspace, /node_place_type/);
  assert.match(workspace, /\["DRYER", "CLEANER"\]/);
  assert.match(workspace, /data-place-type="YARD"/);
  assert.match(workspace, />Площадка</);
  assert.match(workspace, />Вход</);
  assert.match(workspace, />Выход</);
  assert.match(workspace, />Остаток</);
  assert.doesNotMatch(workspace, /onAddOutput/);
  assert.match(workspace, /const transformationsPromise = getProcessingTransformations/);
  assert.match(workspace, /const summariesPromise = getWarehouseSummaries/);
});

check("processing DTO carries method and physical place type", () => {
  assert.match(transformationsRoute, /processing_method:/);
  assert.match(transformationsRoute, /node_place_type:/);
  assert.match(transformationsRoute, /select\("id,name,place_type"\)/);
});

check("vegetables never enter grain dryer or cleaner processing", () => {
  assert.equal(isVegetableCropForProcessing({ categorySlug: "vegetable" }), true);
  assert.equal(isVegetableCropForProcessing({ cropSlug: "potato" }), true);
  assert.equal(isVegetableCropForProcessing({ cropName: "Морковь" }), true);
  assert.equal(canUseGrainProcessing({ categorySlug: "cereal", cropSlug: "wheat" }), true);
  assert.match(page, /canUseGrainProcessing/);
  assert.match(ticketRoute, /Овощные культуры направляйте на склад/);
  assert.match(activeHarvestRoute, /Овощные культуры направляйте на склад/);
  assert.match(transformationsRoute, /processing_eligible: processingEligible/);
  assert.match(processingWorkspace, /row\.processing_eligible !== false/);
  assert.match(cropGuardMigration, /VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED/);
  assert.match(cropGuardMigration, /v_category_slug = 'vegetable'/);
  assert.doesNotMatch(cropGuardMigration, /\b(?:delete\s+from|truncate|drop\s+table|drop\s+column)\b/i);
});

check("field allocation is a stable visible identity", () => {
  assert.match(harvestAllocationsRoute, /allocationCode:/);
  assert.match(harvestAllocationsRoute, /plotLabel: `Посевная строка №/);
  assert.match(page, /Выберите точную посевную строку/);
  assert.match(page, /selectedHarvestAllocation\.allocationCode/);
});

check("weighbridge forms omit decorative section captions", () => {
  assert.doesNotMatch(page, />Маршрут<\/span>/);
  assert.doesNotMatch(page, />Документ<\/span>/);
  assert.doesNotMatch(page, />Партия и вид примесей<\/Label>/);
  assert.doesNotMatch(page, />Транспорт<\/Label>/);
  assert.doesNotMatch(page, />Вес<\/Label>/);
});

check("warehouse uses staged loading and exact lot details", () => {
  assert.match(page, /listHarvestBatchSummaries\(profile\.company_id, \{[\s\S]*?aggregateLots: true,[\s\S]*?summaryOnly: true/);
  assert.match(page, /lotId: selectedHarvestBatch\.aggregateLotId/);
  assert.match(page, /warehouseId: selectedHarvestBatch\.warehouseId/);
  assert.match(page, /selectedHarvestBatch\.detailLevel === "full"/);
  assert.match(page, /Данные партии ещё загружаются/);
  assert.match(page, /batch\.batchCode[\s\S]*?остаток/);
  assert.match(warehousePage, /getWarehouses/);
  assert.match(warehousePage, /summaryOnly: true/);
  assert.match(warehousePage, /warehouseDetailsRequestCache/);
  assert.match(warehousePage, /lotId: batch\.aggregateLotId \|\| batch\.id/);
  assert.match(harvestBatchesRoute, /detail\"\) === \"summary\"/);
  assert.match(warehouseSummaryRoute, /\.limit\(1\)/);
  assert.doesNotMatch(warehouseSummaryRoute, /\.limit\(5000\)/);
  assert.match(harvestBatchDialog, /Историческое поступление партии/);
  assert.match(harvestBatchDialog, /История партии/);
});

check("processing cards render without waiting for warehouse summaries", () => {
  assert.match(processingWorkspace, /const transformationsPromise = getProcessingTransformations/);
  assert.match(processingWorkspace, /const summariesPromise = getWarehouseSummaries/);
  assert.match(processingWorkspace, /setItems\(transformations\)/);
  assert.doesNotMatch(processingWorkspace, /await Promise\.allSettled/);
});

console.log(`ROUTE PROCESSING REGRESSION PASS (${passed}/${passed})`);
