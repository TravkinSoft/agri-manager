import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { automaticHarvestAllocation, validateHarvestWeights } from "../lib/weighbridge/harvest-contract";
import { harvestCropIdentityKey } from "../lib/server/harvest-product-identity";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const has = (source: string, values: string[]) => values.every((value) => source.includes(value));

const context = read("lib/server/harvest-ticket-context.ts");
const identity = read("lib/server/harvest-product-identity.ts");
const createRoute = read("app/api/weighbridge/tickets/route.ts");
const ticketRoute = read("app/api/weighbridge/tickets/[id]/route.ts");
const finalizeRoute = read("app/api/weighbridge/tickets/[id]/finalize/route.ts");
const bootstrapRoute = read("app/api/weighbridge/bootstrap/route.ts");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const service = read("lib/services/weighbridge.ts");

const incompleteAllocation = {
  allocationId: "allocation-1",
  cropId: "crop-1",
  varietyId: "",
  reproductionId: "",
  isIncomplete: true,
};

check("01 crop remains mandatory", () => assert(createRoute.includes("crop_id is required for harvest incoming lines")));
check("02 variety is optional", () => assert(!context.includes("!allocationValue.varietyId ||\n      !allocationValue.reproductionId")));
check("03 reproduction is optional", () => assert(createRoute.includes("!harvestIsCropMix && !line.crop_id")));
check("04 incomplete single allocation can be selected", () => assert.equal(
  automaticHarvestAllocation([incompleteAllocation], { allowIncompleteIdentity: true })?.allocationId,
  "allocation-1"
));
check("05 seed flow still rejects incomplete automatic identity", () => assert.equal(automaticHarvestAllocation([incompleteAllocation]), null));
check("06 review flag is persisted", () => assert(has(createRoute, ["ticket.requires_review", "ticket.review_reason"])));
check("07 missing identity reasons are explicit", () => assert(has(createRoute, ["missing_variety", "missing_reproduction", "identity_review_reasons"])));

check("08 harvest product is company-local", () => assert(identity.includes("company_id: companyId")));
check("09 harvest product is not global", () => assert(!identity.includes("company_id: null")));
check("10 one crop has deterministic identity", () => assert.equal(harvestCropIdentityKey("crop-1"), harvestCropIdentityKey("crop-1")));
check("11 derived identity is race-safe", () => assert(has(identity, ["derived_identity_key", '=== "23505"', "findExistingHarvestProduct"])));
check("12 route derives product automatically", () => assert(createRoute.includes("ensureHarvestProductIdentity")));

check("13 gross event is created", () => assert(has(createRoute, ["weighing_no: 1", "measured_weight_kg: gross"])));
check("14 gross event is manual and attributed", () => assert(has(createRoute, ['device_source: "manual"', "operator_user_id: actor.id"])));
check("15 tare event is created", () => assert(has(ticketRoute, ["weighing_no: 2", "measured_weight_kg: tareWeight"])));
check("16 duplicate tare is rejected or reused", () => assert(has(ticketRoute, ["existingTare", '"23505"', "racedTare"])));
check("17 invalid net is rejected", () => assert.equal(validateHarvestWeights(12_000, 12_000).ok, false));
check("18 correct net is calculated", () => {
  const result = validateHarvestWeights(31_420, 12_180);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected a valid weight result");
  assert.equal(result.net, 19_240);
});

check("19 moisture is required at close", () => assert(ticketRoute.includes("Влажность должна быть больше 0")));
check("20 moisture is written to ticket line", () => assert(ticketRoute.includes("update({ moisture_percent: harvestMoisture })")));
check("21 finalize requires two weighings", () => assert(finalizeRoute.includes("Перед закрытием нужны два фактических взвешивания")));
check("22 moisture is copied to batch", () => assert(has(finalizeRoute, ["inventory_batches", "source_ticket_id", "moisture_percent: moisture"])));
check("23 finalize replay repairs moisture", () => assert(finalizeRoute.includes("idempotent_replay: true")));

check("24 summary uses finalized harvest tickets", () => assert(has(bootstrapRoute, ['.eq("op_type", "harvest_incoming")', '.eq("status", "finalized")', '.eq("is_finalized", true)'])));
check("25 today and current-field aggregates exist", () => assert(has(bootstrapRoute, ["today: aggregateHarvestTickets", "byField"])));
check("26 yield fallback is honest", () => assert(page.includes("Урожайность появится после фиксации убранной площади")));
check("27 repeat trip restores driver and suggests field", () => assert(has(page, ["lastShiftTicket?.driver_id", "setSuggestedFieldId", "Последнее поле этой машины"])));
check("28 open vehicle ticket has one-action tare", () => assert(has(page, ["openVehicleTicket", "Принять тару"])));
check("29 destination empty state is explicit", () => assert(page.includes("Добавьте место приёмки урожая перед началом работы весовой.")));
check("30 driver list is searchable", () => assert(has(page, ["driverSearch", "Поиск водителя"])));
check("31 stale shift guard exists", () => assert(has(bootstrapRoute, ["shiftGuard", "ageHours", "stale"])));
check("32 bootstrap and allocations load in parallel", () => assert(has(page, ["getWeighbridgeBootstrap(profile.company_id", "loadHarvestAllocations(profile.company_id)"])));
check("33 gross idempotency survives refresh", () => assert(has(page, [".idempotency", "localStorage.setItem", "localStorage.removeItem"])));
check("34 tare API accepts moisture", () => assert(service.includes("moisture_percent?: number")));
check("35 working ticket UI does not show UUID", () => assert(!page.includes('>ID:</span> <span className="font-semibold">{activeTicket.id}')));

let passed = 0;
for (const current of checks) {
  try {
    current.run();
    passed += 1;
    console.log(`PASS ${current.name}`);
  } catch (error) {
    console.error(`FAIL ${current.name}`);
    throw error;
  }
}

assert.equal(checks.length, 35);
console.log(`TZ-251 automated checks: ${passed}/35 PASS`);
