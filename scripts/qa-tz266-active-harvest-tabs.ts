import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildWeighbridgeTransportPickerData,
  normalizeTransportSearchText,
} from "../lib/weighbridge/transport-pairing";
import {
  UNIVERSAL_WORKSPACE_MAX_TABS,
  UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
  createUniversalWorkspace,
  parseUniversalWorkspaceState,
  serializeUniversalWorkspaceState,
  universalWorkspaceStorageKey,
} from "../lib/weighbridge/universal-workspaces";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("app/(dashboard)/weighbridge/page.tsx");
const tabs = read("components/weighbridge/universal-workspace-tabs.tsx");
const harvestPicker = read("components/weighbridge/active-harvest-tabs.tsx");
const transportSelects = read("components/weighbridge/transport-driver-picker.tsx");
const transportPairing = read("lib/weighbridge/transport-pairing.ts");
const transportApi = read("app/api/weighbridge/transport-pairs/route.ts");
const ticketApi = read("app/api/weighbridge/tickets/route.ts");
const migration = read("supabase/migrations/20260813015157_tz266_active_harvest_routes_v1.sql");
const mutableSlotsMigration = read("supabase/migrations/20260814002730_tz266_mutable_harvest_slots_v2.sql");

const initialWorkspaceForm = {
  operationType: "harvest_incoming",
  fieldId: "",
  cropStructureAllocationId: "",
  warehouseFromId: "",
  warehouseToId: "",
  vehicleId: "",
  driverId: "",
  grossKg: "",
  notes: "",
};
const createResultIndex = page.indexOf("const result = await createTicket");
const resetStart = page.indexOf("setForm((prev) => {", createResultIndex);
const resetEnd = page.indexOf("setSupplierReceiptLines", resetStart);
const postGrossReset = page.slice(resetStart, resetEnd);
const harvestPostGrossReset = postGrossReset.match(/if \(prev\.operationType === "harvest_incoming"\) \{[\s\S]*?\n        \}/)?.[0] || "";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

check("owner form exists without a server route", () => {
  assert.match(page, /useState<WeighbridgeWorkspace\[]>\(\[\s*createEmptyWorkspace\("harvest_incoming", "workspace-default"\)/);
  assert.match(page, /<HarvestAllocationPicker[\s\S]*value=\{form\.fieldId/);
  assert.doesNotMatch(page, /<ActiveHarvestContextEditor/);
});

check("zero-route form has no blocking active-harvest banner", () => {
  assert.doesNotMatch(harvestPicker, /Добавьте или выберите активную уборку/);
  assert.doesNotMatch(page, /Добавьте или выберите активную уборку над формой/);
});

check("missing harvest fields only disable the CTA", () => {
  assert.match(page, /disabled=\{submitting \|\| Boolean\(currentValidationError\)/);
  assert.doesNotMatch(page, /form\.operationType === "harvest_incoming" && !loading && currentValidationError/);
});

check("original field and warehouse row is restored", () => {
  assert.match(page, /<Label>Поле \*<\/Label>[\s\S]*<HarvestAllocationPicker/);
  assert.match(page, /<Label>Участок \/ культура \*<\/Label>[\s\S]*<HarvestAllocationPicker/);
  assert.match(page, /<Label>Место приёмки \*<\/Label>[\s\S]*ariaLabel="Место приёмки"/);
  assert.match(page, /grid gap-3 md:grid-cols-2 xl:grid-cols-3/);
});

check("transport and driver are separate searchable fields", () => {
  assert.match(transportSelects, /<Label>Транспорт/);
  assert.match(transportSelects, /ariaLabel="Транспорт"/);
  assert.match(transportSelects, /<Label>Водитель/);
  assert.match(transportSelects, /ariaLabel="Водитель"/);
  assert.doesNotMatch(page + transportSelects, /Машина и водитель/);
});

check("vehicle search covers name model and plate", () => {
  assert.match(transportSelects, /keywords: \[vehicle\.name, vehicle\.model, vehicle\.plate, vehicle\.type,/);
  assert.match(transportSelects, /vehicle\.searchTerms/);
  assert.match(transportSelects, /formatVehiclePlate\(vehicle\.plate\)/);
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

check("base form is immediately usable and exposes the universal add action", () => {
  assert.match(page, /createEmptyWorkspace\("harvest_incoming", "workspace-default"\)/);
  assert.match(tabs, /aria-label="Добавить вкладку"/);
  assert.doesNotMatch(tabs, /Активных приёмок нет|Добавить приёмку/);
});

check("adding creates a second independent blank workspace", () => {
  const add = page.match(/const addWorkspace[\s\S]*?\n  };/)?.[0] || "";
  assert.match(add, /createEmptyWorkspace\(operationType\)/);
  assert.match(add, /setWorkspaces/);
  assert.match(add, /activateWorkspace\(next\)/);
  assert.doesNotMatch(add, /fetch\(|createTicket\(|supabase\.|\.insert\(/);
});

check("each workspace stores the complete owner input", () => {
  const workspace = createUniversalWorkspace({
    ...initialWorkspaceForm,
    fieldId: "field-1",
    cropStructureAllocationId: "allocation-1",
    warehouseToId: "destination-1",
    vehicleId: "vehicle-1",
    driverId: "driver-1",
    grossKg: "31000",
  }, "harvest_incoming", "workspace-1");
  const restored = parseUniversalWorkspaceState(serializeUniversalWorkspaceState({
    version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
    selectedId: workspace.id,
    workspaces: [workspace],
    migratedLegacyHarvest: true,
  }), initialWorkspaceForm);
  assert.deepEqual(restored?.workspaces[0].form, workspace.form);
});

check("tab switch saves current workspace and loads target workspace", () => {
  const select = page.match(/const selectWorkspace[\s\S]*?\n  };/)?.[0] || "";
  assert.match(select, /setWorkspaces/);
  assert.match(select, /form, supplierReceiptLines, showSupplierExtraFields/);
  assert.match(select, /activateWorkspace\(next\)/);
  assert.doesNotMatch(select, /fetch\(|router\.refresh|location\.reload/);
});

check("tab switch never clears another form", () => {
  const select = page.match(/const selectWorkspace[\s\S]*?\n  };/)?.[0] || "";
  assert.doesNotMatch(select, /vehicleId: ""|driverId: ""|grossKg: ""/);
});

check("gross preserves field warehouse and the selected tab", () => {
  assert.match(harvestPostGrossReset, /operationType: "harvest_incoming"[\s\S]*fieldId: prev\.fieldId[\s\S]*cropStructureAllocationId: prev\.cropStructureAllocationId[\s\S]*warehouseToId: prev\.warehouseToId/);
  assert.doesNotMatch(harvestPostGrossReset, /setSelectedWorkspaceId/);
});

check("gross clears vehicle driver weight and notes", () => {
  assert.match(harvestPostGrossReset, /return \{[\s\S]*\.\.\.INITIAL_FORM,[\s\S]*operationType: "harvest_incoming"/);
  assert.doesNotMatch(harvestPostGrossReset, /vehicleId: prev\.vehicleId|driverId: prev\.driverId|grossKg: prev\.grossKg|notes: prev\.notes/);
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
  assert.match(page, /isPending \? "Сохраняется" : correctionOriginal \? "Исправляется" : ticketStageLabel\(t\)/);
  assert.match(page, /disabled=\{isPending\}/);
});

check("optimistic harvest title uses crop identity without material flicker", () => {
  assert.match(page, /harvestCropName = form\.operationType === "harvest_incoming"[\s\S]*selectedHarvestAllocation\?\.cropName/);
  assert.match(page, /productName = harvestCropName \|\| productById\.get\(item\.product_id\)\?\.name \|\| "Материал"/);
  assert.match(page, /createdTicket\.lines \|\| buildLocalLines\(createdTicket\.id\)/);
  assert.match(page, /finally \{[\s\S]*setPendingOpenTicket\(null\)/);
});

check("workspace changes never patch old tickets", () => {
  const handlerStart = page.indexOf("const selectWorkspace");
  const handlerEnd = page.indexOf("const changeHarvestTarget", handlerStart);
  const workspaceHandlers = page.slice(handlerStart, handlerEnd);
  assert.ok(workspaceHandlers.length > 0);
  assert.doesNotMatch(workspaceHandlers, /patchTicket|adminTicketAction|finalizeTicket|setTickets|fetch\(|supabase\./);
});

check("universal tabs are visible for the base form and additional forms", () => {
  assert.match(page, /<UniversalWorkspaceTabs/);
  assert.match(tabs, /\{tabs\.map\(\(tab\) =>/);
  assert.doesNotMatch(tabs, /const showTabs|if \(!showTabs\)/);
});

check("six tabs use a responsive grid without horizontal page overflow", () => {
  assert.match(tabs, /grid-cols-2/);
  assert.match(tabs, /md:grid-cols-3/);
  assert.match(tabs, /xl:grid-cols-6/);
  assert.match(tabs, /min-w-0/);
  assert.doesNotMatch(tabs, /overflow-x-auto|overflow-x-scroll|whitespace-nowrap/);
});

check("tab labels are exactly two truncated lines with tooltip", () => {
  assert.match(tabs, /title=\{tab\.fullLabel\}/);
  assert.match(tabs, /block truncate text-xs font-semibold/);
  assert.match(tabs, /block truncate text-\[10px\]/);
});

check("seventh workspace is blocked with the owner message", () => {
  assert.equal(UNIVERSAL_WORKSPACE_MAX_TABS, 6);
  assert.match(page, /workspaces\.length >= UNIVERSAL_WORKSPACE_MAX_TABS/);
  assert.match(page, /Можно открыть не более 6 рабочих вкладок\./);
  assert.match(tabs, /const atLimit = tabs\.length >= UNIVERSAL_WORKSPACE_MAX_TABS/);
});

check("parallel workspaces survive F5", () => {
  assert.match(page, /parseUniversalWorkspaceState<FormState, SupplierReceiptLineDraft>\([\s\S]*localStorage\.getItem\(universalWorkspacePersistKey\)/);
  assert.match(page, /localStorage\.setItem\(universalWorkspacePersistKey, serializeUniversalWorkspaceState/);
});

check("workspace persistence is company season workstation scoped and survives handover", () => {
  assert.equal(
    universalWorkspaceStorageKey("company", "season", "terminal"),
    "travkin.weighbridge.universalWorkspaces.v3.company.season.terminal"
  );
  assert.match(page, /universalWorkspaceStorageKey\([\s\S]*profile\?\.company_id,[\s\S]*activeHarvestSeasonId,[\s\S]*workstationId/);
});

check("base workspace starts as one clean usable harvest form", () => {
  const workspace = createUniversalWorkspace(initialWorkspaceForm, "harvest_incoming", "workspace-default");
  assert.equal(workspace.id, "workspace-default");
  assert.deepEqual(workspace.form, initialWorkspaceForm);
  assert.deepEqual(workspace.supplierReceiptLines, []);
});

check("workspace parser caps restored tabs at six", () => {
  const workspaces = ["1", "2", "3", "4", "5", "6", "7"].map((id) =>
    createUniversalWorkspace(initialWorkspaceForm, "harvest_incoming", id)
  );
  const parsed = parseUniversalWorkspaceState(serializeUniversalWorkspaceState({
    version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
    selectedId: "7",
    workspaces,
    migratedLegacyHarvest: true,
  }), initialWorkspaceForm);
  assert.equal(parsed?.workspaces.length, 6);
  assert.equal(parsed?.selectedId, "1");
});

check("workspace parser rejects an empty or broken payload", () => {
  assert.equal(parseUniversalWorkspaceState("{}", initialWorkspaceForm), null);
  assert.equal(parseUniversalWorkspaceState("broken", initialWorkspaceForm), null);
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
  assert.doesNotMatch(tabs + harvestPicker + transportSelects, /window\.location|location\.reload|router\.refresh/);
});

const switchStarted = performance.now();
const performanceWorkspaces = [
  createUniversalWorkspace({ ...initialWorkspaceForm, fieldId: "field-1" }, "harvest_incoming", "workspace-1"),
  createUniversalWorkspace({ ...initialWorkspaceForm, fieldId: "field-2" }, "harvest_incoming", "workspace-2"),
];
let selected = performanceWorkspaces[0];
for (let index = 0; index < 100; index += 1) selected = performanceWorkspaces[index % 2];
const switchElapsed = performance.now() - switchStarted;
check("one hundred local tab switches stay below 100 ms", () => {
  assert.equal(selected.id, "workspace-2");
  assert.equal(selected.form.fieldId, "field-2");
  assert.ok(switchElapsed < 100, `local switching took ${switchElapsed.toFixed(3)} ms`);
});

console.log(`TZ266 ${passed}/${passed} PASS; local switch loop ${switchElapsed.toFixed(3)} ms`);
