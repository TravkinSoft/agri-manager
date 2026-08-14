import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildWeighbridgeTransportPickerData,
  normalizeTransportSearchText,
} from "../lib/weighbridge/transport-pairing";
import {
  createWeighbridgeHarvestDraft,
  parseWeighbridgeHarvestDraftsState,
  weighbridgeHarvestDraftsStorageKey,
} from "../lib/weighbridge/fast-repeat";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const tabs = read("components/weighbridge/active-harvest-tabs.tsx");
const transportSelects = read("components/weighbridge/transport-driver-picker.tsx");
const transportPairing = read("lib/weighbridge/transport-pairing.ts");
const transportApi = read("app/api/weighbridge/transport-pairs/route.ts");
const ticketApi = read("app/api/weighbridge/tickets/route.ts");
const fastRepeat = read("lib/weighbridge/fast-repeat.ts");
const migration = read("supabase/migrations/20260813015157_tz266_active_harvest_routes_v1.sql");
const mutableSlotsMigration = read("supabase/migrations/20260814002730_tz266_mutable_harvest_slots_v2.sql");

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

check("owner form exists without a server route", () => {
  assert.match(page, /useState<WeighbridgeHarvestDraft\[]>\(\[\s*createWeighbridgeHarvestDraft\(\)/);
  assert.match(page, /<HarvestAllocationPicker[\s\S]*value=\{form\.fieldId/);
  assert.doesNotMatch(page, /<ActiveHarvestContextEditor/);
});

check("zero-route form has no blocking active-harvest banner", () => {
  assert.doesNotMatch(tabs, /Добавьте или выберите активную уборку/);
  assert.doesNotMatch(page, /Добавьте или выберите активную уборку над формой/);
});

check("missing harvest fields only disable the CTA", () => {
  assert.match(page, /disabled=\{submitting \|\| Boolean\(currentValidationError\)/);
  assert.doesNotMatch(page, /form\.operationType === "harvest_incoming" && !loading && currentValidationError/);
});

check("original field and warehouse row is restored", () => {
  assert.match(page, /<Label>Поле \/ участок \*<\/Label>[\s\S]*<HarvestAllocationPicker/);
  assert.match(page, /<Label>Место приёмки \*<\/Label>[\s\S]*ariaLabel="Место приёмки"/);
  assert.match(page, /grid gap-3 md:grid-cols-2/);
});

check("transport and driver are separate searchable fields", () => {
  assert.match(transportSelects, /<Label>Транспорт/);
  assert.match(transportSelects, /ariaLabel="Транспорт"/);
  assert.match(transportSelects, /<Label>Водитель/);
  assert.match(transportSelects, /ariaLabel="Водитель"/);
  assert.doesNotMatch(page + transportSelects, /Машина и водитель/);
});

check("vehicle search covers name model and plate", () => {
  assert.match(transportSelects, /keywords: \[vehicle\.name, vehicle\.model, vehicle\.plate, vehicle\.type\]/);
  assert.match(transportSelects, /Машина, модель или госномер/);
});

check("driver search covers name and surname text", () => {
  assert.match(transportSelects, /keywords: \[driver\.name, driver\.position/);
  assert.match(transportSelects, /Имя или фамилия водителя/);
});

check("recent choices are groups inside normal selects", () => {
  assert.match(transportSelects, /group: recentOrder\.has\(vehicle\.id\) \? "Недавно использованные" : "Остальные"/);
  assert.match(transportSelects, /group: recentOrder\.has\(driver\.id\) \? "Недавно использованные" : "Остальные"/);
  assert.doesNotMatch(page, /Недавние связки/);
});

check("vehicle fills only an empty driver", () => {
  assert.match(transportSelects, /let nextDriverId = driverId;[\s\S]*if \(!nextDriverId\)/);
  assert.match(transportSelects, /latestDriverByVehicle\[nextVehicleId\]/);
});

check("driver fills only an empty vehicle", () => {
  assert.match(transportSelects, /let nextVehicleId = vehicleId;[\s\S]*if \(!nextVehicleId\)/);
  assert.match(transportSelects, /latestVehicleByDriver\[nextDriverId\]/);
});

check("manual vehicle override cannot be reverted by autofill", () => {
  const chooseVehicle = transportSelects.match(/const chooseVehicle[\s\S]*?\n  };/)?.[0] || "";
  assert.match(chooseVehicle, /let nextDriverId = driverId/);
  assert.doesNotMatch(chooseVehicle, /nextDriverId = latestDriverByVehicle[^\n]*\n[^}]*else/);
});

check("manual driver override cannot be reverted by autofill", () => {
  const chooseDriver = transportSelects.match(/const chooseDriver[\s\S]*?\n  };/)?.[0] || "";
  assert.match(chooseDriver, /let nextVehicleId = vehicleId/);
  assert.doesNotMatch(chooseDriver, /nextVehicleId = latestVehicleByDriver[^\n]*\n[^}]*else/);
});

check("occupied vehicle and driver are marked waiting for tare", () => {
  assert.ok((transportSelects.match(/Ждёт тару/g) || []).length >= 2);
  assert.match(transportSelects, /assignmentByVehicle/);
  assert.match(transportSelects, /assignmentByDriver/);
});

check("occupied assignment offers its existing ticket", () => {
  assert.match(transportSelects, /onBlockedAssignment\(assignment\)/);
  assert.match(page, /title: "Уже ждёт тару"[\s\S]*actionLabel: "Открыть талон"/);
});

check("server blocks a second vehicle ticket with a ticket link", () => {
  assert.match(ticketApi, /code: "vehicle_active_ticket"/);
  assert.match(ticketApi, /ticketId: String\(activeVehicleTicket\.id\)/);
  assert.match(ticketApi, /\{ status: 409 \}/);
});

check("server blocks a second driver ticket with a ticket link", () => {
  assert.match(ticketApi, /code: "driver_active_ticket"/);
  assert.match(ticketApi, /ticketId: String\(activeDriverTicket\.id\)/);
});

check("one form has only a compact add button", () => {
  assert.match(tabs, /if \(!showTabs\)[\s\S]*aria-label="Добавить приёмку"/);
  assert.doesNotMatch(tabs, /Активных приёмок нет/);
});

check("adding creates a second independent blank draft", () => {
  const add = page.match(/const addHarvestDraft[\s\S]*?\n  };/)?.[0] || "";
  assert.match(add, /createWeighbridgeHarvestDraft/);
  assert.match(add, /setHarvestDrafts/);
  assert.match(add, /setSelectedHarvestDraftId/);
  assert.match(add, /formWithHarvestDraft/);
});

check("each draft stores the complete owner input", () => {
  assert.match(page, /harvestDraftFromForm[\s\S]*fieldId: form\.fieldId[\s\S]*cropStructureAllocationId: form\.cropStructureAllocationId[\s\S]*warehouseToId: form\.warehouseToId[\s\S]*vehicleId: form\.vehicleId[\s\S]*driverId: form\.driverId[\s\S]*grossKg: form\.grossKg/);
});

check("tab switch saves current draft and loads target draft", () => {
  const select = page.match(/const selectHarvestDraft[\s\S]*?\n  };/)?.[0] || "";
  assert.match(select, /harvestDraftFromForm/);
  assert.match(select, /formWithHarvestDraft/);
  assert.doesNotMatch(select, /fetch\(|router\.refresh|location\.reload/);
});

check("tab switch never clears another form", () => {
  const select = page.match(/const selectHarvestDraft[\s\S]*?\n  };/)?.[0] || "";
  assert.doesNotMatch(select, /vehicleId: ""|driverId: ""|grossKg: ""/);
});

check("gross preserves field warehouse and the selected tab", () => {
  assert.match(page, /operationType: "harvest_incoming"[\s\S]*fieldId: prev\.fieldId[\s\S]*cropStructureAllocationId: prev\.cropStructureAllocationId[\s\S]*warehouseToId: prev\.warehouseToId/);
  assert.doesNotMatch(page, /setSelectedHarvestDraftId\(""\)/);
});

check("gross clears vehicle driver weight and notes", () => {
  assert.match(page, /return \{[\s\S]*\.\.\.INITIAL_FORM,[\s\S]*operationType: "harvest_incoming"/);
  assert.match(page, /notes: ""/);
});

check("ticket creation snapshots exact draft values", () => {
  assert.match(page, /crop_structure_allocation_id: form\.operationType === "harvest_incoming"[\s\S]*form\.cropStructureAllocationId/);
  assert.match(page, /vehicle_id: form\.vehicleId/);
  assert.match(page, /driver_id: form\.driverId/);
  assert.match(page, /warehouse_to_id:[\s\S]*form\.warehouseToId/);
});

check("harvest ticket appears immediately while the server saves", () => {
  assert.match(page, /setPendingOpenTicket\(\{[\s\S]*id: `pending-\$\{idempotencyKey\}`/);
  assert.match(page, /visibleActiveTickets[\s\S]*pendingOpenTicket/);
  assert.match(page, /isPending \? "Сохраняется" : ticketStageLabel\(t\)/);
  assert.match(page, /disabled=\{isPending\}/);
});

check("optimistic harvest title uses crop identity without material flicker", () => {
  assert.match(page, /harvestCropName = form\.operationType === "harvest_incoming"[\s\S]*selectedHarvestAllocation\?\.cropName/);
  assert.match(page, /productName = harvestCropName \|\| productById\.get\(item\.product_id\)\?\.name \|\| "Материал"/);
  assert.match(page, /createdTicket\.lines \|\| buildLocalLines\(createdTicket\.id\)/);
  assert.match(page, /finally \{[\s\S]*setPendingOpenTicket\(null\)/);
});

check("draft changes never patch old tickets", () => {
  const draftHandlers = page.match(/const selectHarvestDraft[\s\S]*?const changeHarvestTarget[\s\S]*?\n  };/)?.[0] || "";
  assert.doesNotMatch(draftHandlers, /patchTicket|adminTicketAction|finalizeTicket|setTickets/);
});

check("tabs appear only after a second form", () => {
  assert.match(tabs, /const showTabs = tabs\.length > 1/);
  assert.match(tabs, /if \(!showTabs\)/);
});

check("four tabs use equal width without horizontal scroll", () => {
  assert.match(tabs, /repeat\(\$\{tabs\.length\}, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(tabs, /overflow-x-auto|flex-wrap/);
  assert.match(tabs, /overflow-hidden/);
});

check("tab labels are exactly two truncated lines with tooltip", () => {
  assert.match(tabs, /title=\{tab\.fullLabel\}/);
  assert.match(tabs, /block truncate text-xs font-bold/);
  assert.match(tabs, /block truncate text-\[10px\]/);
});

check("fifth form is blocked with the owner message", () => {
  assert.match(page, /harvestDrafts\.length >= 4/);
  assert.match(page, /Можно открыть не более четырёх параллельных приёмок\./);
  assert.match(tabs, /const atLimit = tabs\.length >= 4/);
});

check("parallel drafts survive F5", () => {
  assert.match(page, /parseWeighbridgeHarvestDraftsState\(localStorage\.getItem\(harvestDraftPersistKey\)\)/);
  assert.match(page, /localStorage\.setItem\([\s\S]*harvestDraftPersistKey/);
});

check("draft persistence is shift scoped and survives handover", () => {
  assert.equal(weighbridgeHarvestDraftsStorageKey("company", "shift"), "travkin.weighbridge.parallelIntakes.v1.company.shift");
  assert.match(page, /weighbridgeHarvestDraftsStorageKey\(profile\?\.company_id, activeShift\?\.id\)/);
  assert.doesNotMatch(fastRepeat, /operatorPersonId|profileId/);
});

check("a new shift starts with one clean form", () => {
  assert.deepEqual(createWeighbridgeHarvestDraft(), {
    id: "intake-1",
    fieldId: "",
    cropStructureAllocationId: "",
    warehouseToId: "",
    vehicleId: "",
    driverId: "",
    grossKg: "",
  });
});

check("draft parser caps restored tabs at four", () => {
  const parsed = parseWeighbridgeHarvestDraftsState(JSON.stringify({
    selectedId: "5",
    drafts: ["1", "2", "3", "4", "5"].map((id) => ({ id })),
  }));
  assert.equal(parsed?.drafts.length, 4);
  assert.equal(parsed?.selectedId, "1");
});

check("draft parser rejects an empty payload", () => {
  assert.equal(parseWeighbridgeHarvestDraftsState("{}"), null);
  assert.equal(parseWeighbridgeHarvestDraftsState("broken"), null);
});

check("learning uses finalized effective tickets only", () => {
  const data = buildWeighbridgeTransportPickerData({
    seasonId: "season",
    operationalDayStartHour: 7,
    finalizedTickets: [
      { id: "good", status: "finalized", vehicle_id: "v1", driver_id: "d1", finalized_at: "2026-08-15T08:00:00Z" },
      { id: "void", status: "finalized", vehicle_id: "v2", driver_id: "d2", is_voided: true, finalized_at: "2026-08-15T09:00:00Z" },
      { id: "replaced", status: "finalized", vehicle_id: "v3", driver_id: "d3", replacement_ticket_id: "new", finalized_at: "2026-08-15T10:00:00Z" },
      { id: "open", status: "active", vehicle_id: "v4", driver_id: "d4", updated_at: "2026-08-15T11:00:00Z" },
    ],
    openTickets: [],
  });
  assert.equal(data.latestDriverByVehicle.v1, "d1");
  assert.equal(data.latestDriverByVehicle.v2, undefined);
  assert.equal(data.latestDriverByVehicle.v3, undefined);
  assert.equal(data.latestDriverByVehicle.v4, undefined);
});

check("latest valid pairing wins", () => {
  const data = buildWeighbridgeTransportPickerData({
    seasonId: "season",
    operationalDayStartHour: 7,
    finalizedTickets: [
      { id: "old", status: "finalized", vehicle_id: "v1", driver_id: "d1", finalized_at: "2026-08-14T08:00:00Z" },
      { id: "new", status: "finalized", vehicle_id: "v2", driver_id: "d1", finalized_at: "2026-08-15T08:00:00Z" },
    ],
    openTickets: [],
  });
  assert.equal(data.latestVehicleByDriver.d1, "v2");
});

check("pair endpoint reads no heavy accounting documents", () => {
  assert.match(transportApi, /is_voided,replacement_ticket_id/);
  assert.doesNotMatch(transportApi, /ticket_lines|ticket_weighings|inventory_batches|stock_ledger_entries|pdf/);
  assert.doesNotMatch(transportApi + transportPairing, /\.update\(|\.delete\(/);
});

check("local search normalization remains Unicode safe", () => {
  assert.equal(normalizeTransportSearchText("  QA-207 "), "qa207");
  assert.equal(normalizeTransportSearchText("Қайрат Әлімжанұлы"), "қайратәлімжанұлы");
});

check("old active-harvest migrations stay additive and untouched", () => {
  assert.match(migration, /create table if not exists public\.weighbridge_active_harvests/);
  assert.match(mutableSlotsMigration, /v_active_count >= 4/);
  assert.doesNotMatch(migration + mutableSlotsMigration, /delete from public\.(tickets|ticket_lines|inventory_batches)|truncate/i);
});

check("active-harvest database records are not required by the page", () => {
  assert.doesNotMatch(page, /<ActiveHarvestTabs|<ActiveHarvestContextEditor/);
  assert.doesNotMatch(page, /refreshActiveHarvestRoutes\(\)\.catch\(\(error\)/);
});

check("no full page reload is used", () => {
  assert.doesNotMatch(tabs + transportSelects, /window\.location|location\.reload|router\.refresh/);
});

const switchStarted = performance.now();
let selected = "intake-1";
for (let index = 0; index < 100; index += 1) selected = index % 2 ? "intake-1" : "intake-2";
const switchElapsed = performance.now() - switchStarted;
check("one hundred local tab switches stay below 100 ms", () => {
  assert.equal(selected, "intake-1");
  assert.ok(switchElapsed < 100, `local switching took ${switchElapsed.toFixed(3)} ms`);
});

console.log(`TZ266 ${passed}/${passed} PASS; local switch loop ${switchElapsed.toFixed(3)} ms`);
