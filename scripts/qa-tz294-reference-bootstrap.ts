import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTransportIdentity } from "../lib/weighbridge/transport";
import {
  isHarvestDestinationPlace,
  storagePlaceTypeGroupLabel,
} from "../lib/warehouse/warehouse-scope";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
let checks = 0;
const check = (name: string, test: () => void) => {
  test();
  checks += 1;
  console.log(`PASS ${String(checks).padStart(2, "0")} ${name}`);
};

const resourcesRoute = read("app/api/weighbridge/resources/route.ts");
const activeHarvestRoute = read("app/api/weighbridge/active-harvests/route.ts");
const ticketsRoute = read("app/api/weighbridge/tickets/route.ts");
const ticketDetailsRoute = read("app/api/weighbridge/tickets/[id]/route.ts");
const ticketPdfRoute = read("app/api/weighbridge/tickets/[id]/pdf/route.ts");
const harvestBatchesRoute = read("app/api/weighbridge/harvest-batches/route.ts");
const harvestSummaryRoute = read("app/api/dashboard/harvest-summary/route.ts");
const ticketPaper = read("components/weighbridge/weighbridge-ticket-paper.tsx");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const machineQuery = resourcesRoute.match(/\.from\("reference_machines"\)([\s\S]*?)\.from\("company_people"\)/)?.[1] || "";

check("reference_machines queries license_plate", () => {
  assert.match(machineQuery, /license_plate/);
});

check("reference_machines never queries absent plate_number", () => {
  const runtimeSources = [resourcesRoute, ticketsRoute, ticketDetailsRoute, ticketPdfRoute, harvestBatchesRoute, harvestSummaryRoute];
  runtimeSources.forEach((source) => {
    const machineQueries = source.match(/\.from\("reference_machines"\)[\s\S]*?\.select\("[^"]*"\)/g) || [];
    machineQueries.forEach((query) => assert.doesNotMatch(query, /plate_number/));
  });
});

check("reference_vehicles retain both compatible plate fields", () => {
  const vehicleQuery = resourcesRoute.match(/\.from\("reference_vehicles"\)([\s\S]*?)\.from\("reference_machines"\)/)?.[1] || "";
  assert.match(vehicleQuery, /plate_number/);
  assert.match(vehicleQuery, /license_plate/);
});

check("resources isolate database reads", () => {
  assert.match(resourcesRoute, /Promise\.allSettled/);
  assert.match(resourcesRoute, /resourceErrors/);
  assert.match(resourcesRoute, /WB_RESOURCES_MACHINES/);
  assert.match(resourcesRoute, /WB_RESOURCES_FIELDS/);
  assert.match(resourcesRoute, /WB_RESOURCES_DESTINATIONS/);
  assert.match(resourcesRoute, /fields,\s*destinations,\s*vehicles/);
});

check("client isolates reference bootstrap reads", () => {
  assert.match(page, /Promise\.allSettled\(\[/);
  assert.match(page, /WB_HARVEST_ALLOCATIONS/);
  assert.match(page, /failedResources\.has\("fields"\)/);
  assert.match(page, /failedResources\.has\("warehouses"\)/);
  assert.doesNotMatch(page, /supabase\.from\("fields"\).*?getWeighbridgeResources/s);
});

check("client preserves cached source on partial transport failure", () => {
  assert.match(page, /failedResources\.has\("reference_machines"\)[\s\S]*?previous\.filter\(\(row\) => row\.source === "reference_machines"\)/);
  assert.match(page, /failedResources\.has\("reference_vehicles"\)[\s\S]*?previous\.filter\(\(row\) => row\.source === "reference_vehicles"\)/);
});

check("client never renders a raw schema error", () => {
  assert.match(page, /Не удалось обновить транспорт и водителей/);
  assert.doesNotMatch(page, /column reference_machines\.plate_number does not exist/);
});

check("machine identity uses license_plate", () => {
  const identity = resolveTransportIdentity({
    name: "МТЗ 82 #3",
    brand: "МТЗ",
    model: "82",
    license_plate: "T 075 ALB",
  });
  assert.equal(identity.label, "МТЗ 82 · T 075 ALB");
});

check("harvest destination taxonomy includes universal storage and processing places", () => {
  assert.equal(isHarvestDestinationPlace("universal", "WAREHOUSE"), true);
  assert.equal(isHarvestDestinationPlace("agrochemical", "WAREHOUSE"), false);
  assert.equal(isHarvestDestinationPlace("agrochemical", "YARD"), true);
  assert.equal(isHarvestDestinationPlace("agrochemical", "DRYER"), true);
  assert.equal(isHarvestDestinationPlace("agrochemical", "CLEANER"), true);
});

check("harvest destination groups use operator-facing labels", () => {
  assert.equal(storagePlaceTypeGroupLabel("WAREHOUSE"), "Склады");
  assert.equal(storagePlaceTypeGroupLabel("YARD"), "Площадки");
  assert.equal(storagePlaceTypeGroupLabel("DRYER"), "Сушилки");
  assert.equal(storagePlaceTypeGroupLabel("CLEANER"), "Очистка");
});

check("resources and client preserve destination place type", () => {
  assert.match(resourcesRoute, /warehouse_type,place_type/);
  assert.match(resourcesRoute, /placeType: String\(row\.place_type \|\| "WAREHOUSE"\)/);
  assert.match(page, /isHarvestDestinationPlace\(warehouse\.warehouseType, warehouse\.placeType\)/);
  assert.match(page, /storagePlaceTypeGroupLabel\(warehouse\.placeType\)/);
});

check("ticket and active-harvest writes use the canonical destination validator", () => {
  assert.match(activeHarvestRoute, /warehouse_type,place_type,archived/);
  assert.match(activeHarvestRoute, /isHarvestDestinationPlace\(warehouseRes\.data\.warehouse_type, warehouseRes\.data\.place_type\)/);
  assert.match(ticketsRoute, /warehouse_type,place_type,archived,is_archived/);
  assert.match(ticketsRoute, /isHarvestDestinationPlace\(destinationWarehouse\.warehouse_type, destinationWarehouse\.place_type\)/);
});

check("harvest closure keeps moisture visible without exposing specialist deductions", () => {
  assert.match(ticketPaper, /Влажность, %/);
  assert.match(ticketPaper, /showMoistureEditor/);
  assert.match(page, /label="Влажность, %"/);
  assert.doesNotMatch(page, /Влажность, % \(необязательно\)/);
  assert.match(page, /onMoistureCommit: \(\) => undefined/);
  assert.match(page, /lg:overflow-y-auto/);
  assert.doesNotMatch(ticketPaper, /Явное удержание|Причина удержания|Принято на склад/);
  assert.doesNotMatch(page, /closingDeduction|deduction_kg:|deduction_percent:|deduction_reason:/);
});

assert.equal(checks, 13);
console.log(`TZ294 reference bootstrap regression PASS: ${checks}/13`);
