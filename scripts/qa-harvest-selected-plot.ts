import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { harvestQueuePlotPatch } from "../lib/weighbridge/harvest-queue-plot";

const page = readFileSync("app/(dashboard)/weighbridge/page.tsx", "utf8");
const route = readFileSync("app/api/weighbridge/tickets/route.ts", "utf8");
let passed = 0;
const check = (name: string, action: () => void) => { action(); console.log(`PASS ${++passed} ${name}`); };
const oldPlot = { allocationId: "old-plot", cropId: "crop", varietyId: "variety", reproductionId: "repro" };
const newPlot = { ...oldPlot, allocationId: "new-plot" };
const trip = { ptcEventId: "event", ptcCycle: 80, vehicleId: "truck", driverId: "driver", fieldId: "old-field", cropStructureId: "old-plot" };
const blank = { operationType: "harvest_incoming", fieldId: "", cropStructureAllocationId: "", vehicleId: "", driverId: "", grossKg: "", ptcEventId: "", ptcCycle: null };
const selected = { ...blank, fieldId: "new-field", cropStructureAllocationId: "new-plot", cropId: "crop", varietyId: "variety", reproductionId: "repro", warehouseToId: "warehouse" };

function ui(initial: any) {
  const context: any = {
    form: { ...initial }, ptcQueue: [trip], workspaceReady: true, coreDataReady: true,
    harvestFieldOptions: [{ value: "old-field" }, { value: "new-field" }],
    harvestStructureByField: { "old-field": [oldPlot], "new-field": [newPlot] },
    automaticHarvestAllocation: (items: any[]) => items[0] || null,
    harvestQueuePlotPatch,
  };
  context.setForm = (update: any) => { context.form = update(context.form); };
  context.useEffect = (effect: any) => { context.queueEffect = effect; };
  const source = page.slice(page.indexOf("  const changeHarvestField ="), page.indexOf("  const changeHarvestDestination ="));
  assert(source.includes("harvestQueuePlotPatch"));
  vm.runInNewContext(ts.transpileModule(`${source}\nglobalThis.handlers = { changeHarvestField, changeHarvestTarget, changeHarvestTransport };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context;
}

check("blank workspace receives the queue plot", () => {
  const c = ui(blank); c.queueEffect(); assert.equal(c.form.fieldId, "old-field"); assert.equal(c.form.driverId, "driver");
});
check("new workspace plot survives automatic next-truck selection", () => {
  const c = ui(selected); c.queueEffect(); assert.equal(c.form.fieldId, "new-field"); assert.equal(c.form.cropStructureAllocationId, "new-plot"); assert.equal(c.form.ptcEventId, "event");
});
check("manual transport selection cannot replace the selected plot or warehouse", () => {
  const c = ui(selected); c.handlers.changeHarvestTransport("truck", "driver");
  assert.equal(c.form.fieldId, "new-field"); assert.equal(c.form.cropStructureAllocationId, "new-plot"); assert.equal(c.form.warehouseToId, "warehouse");
});
check("changing the field keeps the physical PTC trip", () => {
  const c = ui({ ...blank, ...{ vehicleId: "truck", driverId: "driver", ptcEventId: "event", ptcCycle: 80, fieldId: "old-field", cropStructureAllocationId: "old-plot" } });
  c.handlers.changeHarvestField("new-field"); assert.equal(c.form.fieldId, "new-field"); assert.equal(c.form.ptcEventId, "event"); assert.equal(c.form.ptcCycle, 80);
});
check("changing allocation keeps the physical trip", () => {
  const c = ui({ ...selected, cropStructureAllocationId: "", ptcEventId: "event", ptcCycle: 80 });
  c.handlers.changeHarvestTarget("new-plot"); assert.equal(c.form.cropStructureAllocationId, "new-plot"); assert.equal(c.form.ptcEventId, "event");
});
check("partially selected field is not silently replaced", () => {
  assert.deepEqual(harvestQueuePlotPatch({ fieldId: "new-field", cropStructureAllocationId: "" }, "old-field", oldPlot), {});
});

async function api(overrides: { event?: any; state?: any; existing?: any; error?: any } = {}) {
  const ticket: any = { ptc_event_id: "event", ptc_cycle: 80, vehicle_id: "truck", driver_id: "driver", field_id: "new-field", crop_structure_allocation_id: "new-plot" };
  const results: any = {
    ptc_events: { data: { id: "event", vehicle_id: "truck", driver_id: "driver", cycle: 80, to_state: "loaded", field_id: "old-field", crop_structure_id: "old-plot", ...overrides.event }, error: overrides.error },
    ptc_vehicle_states: { data: { assigned: true, state: "loaded", cycle: 80, ...overrides.state } },
    tickets: { data: overrides.existing || null },
  };
  const scope: any = { ticket, companyId: "company", actor: { id: "actor" }, NextResponse: { json: (data: any, init: any) => ({ data, status: init.status }) } };
  scope.getServiceClient = () => ({ from: (table: string) => {
    const query: any = { maybeSingle: async () => results[table] };
    for (const method of ["select", "eq", "neq", "limit"]) query[method] = () => query;
    return query;
  } });
  const begin = route.indexOf("      const hasPtcEvent = Boolean(ticket.ptc_event_id)");
  const end = route.indexOf("      if (lines.length !== 1)", begin);
  assert(begin > route.indexOf("if (harvestContext.status !== \"ready\")"));
  const body = route.slice(begin, end);
  const code = ts.transpileModule(`async function run() { ${body} return { status: 200, ticket }; } globalThis.run = run;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, scope);
  return scope.run();
}

async function main() {
  const accepted = await api();
  check("valid trip accepts the weighman's different, previously validated plot", () => {
    assert.equal(accepted.status, 200); assert.equal(accepted.ticket.field_id, "new-field");
    const audit = accepted.ticket.audit_json.harvest_plot_selection;
    assert.equal(audit.differs_from_ptc, true); assert.equal(audit.ptc_field_id, "old-field"); assert.equal(audit.actor_profile_id, "actor");
  });
  for (const [name, change] of Object.entries({
    "wrong vehicle": { event: { vehicle_id: "other" } },
    "wrong driver": { event: { driver_id: "other" } },
    "old event cycle": { event: { cycle: 79 } },
    "old state cycle": { state: { cycle: 81 } },
    "already unloading": { state: { state: "unloading" } },
    "off line": { state: { assigned: false } },
    "missing trip": { event: { id: null } },
    "used trip": { existing: { id: "existing", ticket_no: "WB-EXISTING" } },
    "read failed": { error: { message: "database unavailable" } },
  })) {
    const response = await api(change);
    check(`${name} still blocks creation`, () => assert.equal(response.status, 409));
  }
  console.log(`Selected harvest plot: ${passed} PASS`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
