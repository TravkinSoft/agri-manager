import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { buildHarvestOverview, resolveHarvestPeriod, type HarvestPlotSummary } from "../lib/dashboard/harvest-summary";
import { confirmedPlotHectares } from "../lib/dashboard/harvest-plot-hectares";
import { buildTrafficBoard, TRAFFIC_BOARD_ROLES } from "../lib/traffic/read-only-board";
import type { WeighbridgeTicket } from "../lib/types/weighbridge";
import type { FleetVehicle } from "../lib/fleet/model";
import type { TrafficVehicle } from "../lib/traffic/model";

let checks = 0;
function check(name: string, fn: () => void) { fn(); checks++; console.log(`PASS ${name}`); }
const period = resolveHarvestPeriod({ preset: "current_day", now: new Date("2026-09-21T15:00:00Z") });
function plot(id: string, overrides: Partial<HarvestPlotSummary> = {}): HarvestPlotSummary {
  return { cropStructureAllocationId: id, fieldId: "field92", fieldName: "Виноградовка", fieldAreaHa: 92,
    seasonId: "season26", cropId: "potato", cropName: "Картофель", varietyId: "gala", varietyName: "Гала",
    reproductionId: id, reproductionName: id === "a24" ? "1" : "4", areaHa: id === "a24" ? 24 : 68,
    completedAreaHa: null, harvestedAreaHa: id === "a24" ? 10 : 30,
    acceptedKg: 0, totalAcceptedKg: 0, yieldTPerHa: null, status: "active", isCurrent: id === "a24",
    startedAt: period.start, lastChangedAt: period.start, ...overrides };
}
function ticket(id: string, plotId: string, cleanKg: number, overrides: Partial<WeighbridgeTicket> = {}): WeighbridgeTicket {
  return { id, company_id: "company", ticket_no: id, ticket_type: "weighbridge", op_type: "harvest_incoming",
    status: "finalized", direction: "incoming", source_kind: "field", destination_kind: "warehouse",
    weigh_method: "double_weighing", is_finalized: true, is_voided: false, net_weight_kg: cleanKg + 7000,
    accepted_weight_kg: cleanKg + 3000, harvest_clean_weight_kg: cleanKg,
    created_at: "2026-09-21T04:00:00Z", updated_at: "2026-09-21T05:00:00Z", finalized_at: "2026-09-21T05:00:00Z",
    field_id: "field92", crop_structure_allocation_id: plotId, season_id: "season26",
    lines: [{ id: `line-${id}`, product_id: "potato", crop_id: "potato", crop_name: "Картофель", product_name: "Картофель",
      quantity: cleanKg, uom: "kg", variety_id: "gala", variety_name: "Гала", reproduction_id: plotId, reproduction_name: "1" }],
    ...overrides };
}
const plots = [plot("a24"), plot("a68")];
const receipts = [ticket("one", "a24", 200_000), ticket("two", "a68", 300_000)];
const summary = (p = plots, t = receipts, filters = {}) => buildHarvestOverview(t, { period, harvestPlots: p, filters, includeDriverStats: false });
check("92 ha = 24 + 68, clean mass and confirmed hectares summed", () => {
  const result = summary(); const field = result.harvestFields[0];
  assert.equal(field.allocationCount, 2); assert.equal(field.fieldAreaHa, 92); assert.equal(field.plannedAreaHa, 92);
  assert.equal(field.areaVarianceHa, 0); assert.equal(field.totalAcceptedKg, 500_000); assert.equal(field.harvestedAreaHa, 40);
  assert.equal(field.yieldTPerHa, 12.5); assert.notEqual(field.yieldTPerHa, (20 + 10) / 2);
  assert.deepEqual(result.harvestPlots.map(row => row.yieldTPerHa), [20, 10]);
});
check("open shift with previous hectares suppresses entire field yield", () => {
  const field = summary([plots[0], plot("a68", { combineShiftOpen: true })]).harvestFields[0];
  assert.equal(field.yieldTPerHa, null); assert.equal(field.areaPending, true);
});
check("mass without combine history cannot silently disappear or yield", () => {
  const field = summary([plots[0], plot("a68", { harvestedAreaHa: null })]).harvestFields[0];
  assert.equal(field.totalAcceptedKg, 500000); assert.equal(field.yieldTPerHa, null);
});
check("unstarted empty sibling does not prevent a confirmed result", () => {
  const field = summary([plots[0], plot("a68", { harvestedAreaHa: null })], [receipts[0]]).harvestFields[0];
  assert.equal(field.yieldTPerHa, 20); assert.equal(field.harvestedAreaHa, 10);
});
check("51 closed hectares on a 24 ha plot is a data issue, not a publishable yield", () => {
  const result = summary([plot("a24", { harvestedAreaHa: 51 }), plots[1]]);
  assert.match(result.harvestFields[0].areaIssue!, /24.*51/);
  assert.equal(result.harvestFields[0].yieldTPerHa, null);
  assert.equal(result.harvestPlots[0].yieldTPerHa, null);
  assert.equal(result.harvestFields[0].totalAcceptedKg, 500000);
  assert.equal(summary().harvestFields[0].areaIssue, null);
});
check("void, replaced, open, future and repeated tickets cannot inflate field mass", () => {
  const variants = [receipts[0], receipts[0], ticket("void", "a24", 99999, { is_voided: true }),
    ticket("replaced", "a24", 99999, { replacement_ticket_id: "one" }),
    ticket("open", "a24", 99999, { status: "active", is_finalized: false }),
    ticket("tomorrow", "a24", 99999, { finalized_at: "2026-09-22T08:00:00Z" })];
  assert.equal(summary(plots, variants).harvestFields[0].totalAcceptedKg, 200000);
});
check("same names, other seasons and other crops stay separate; plots deduplicated", () => {
  const result = summary([...plots, plots[0], plot("otherField", { fieldId: "old54" }),
    plot("otherSeason", { seasonId: "season25" }), plot("carrot", { cropId: "carrot" }),
    plot("unknown", { cropId: null }), plot("unknown2", { cropId: null })]);
  assert.equal(result.harvestFields.length, 6); assert.equal(result.harvestFields[0].allocationCount, 2);
});
check("field yield not distorted by a partial reproduction/warehouse filter", () => {
  assert.equal(summary(plots, receipts, { reproductionId: "a24" }).harvestFields[0].yieldTPerHa, 12.5);
  assert.equal(summary(plots, receipts, { warehouseId: "otherWarehouse" }).harvestFields[0].totalAcceptedKg, 500000);
});
const segment = { id: "segment", shift_id: "shift", closed_at: "2026-09-21T08:00:00Z", hectares_segment: "2.4" };
check("closed segment in OPEN parent shift is not confirmed hectares", () => {
  assert.deepEqual(confirmedPlotHectares([segment], [{ id: "shift", closed_at: null }], period.end),
    { harvestedAreaHa: null, areaPending: true, combineShiftOpen: true });
});
check("closed shift confirms fractional hectares once, not planned/cumulative area", () => {
  assert.deepEqual(confirmedPlotHectares([segment, segment], [{ id: "shift", closed_at: "2026-09-21T09:00:00Z" }], period.end),
    { harvestedAreaHa: 2.4, areaPending: false, combineShiftOpen: false });
});
check("missing, future-closed or invalid-area shift cannot certify hectares", () => {
  assert.equal(confirmedPlotHectares([segment], [], period.end).areaPending, true);
  assert.equal(confirmedPlotHectares([segment], [{ id: "shift", closed_at: "2026-09-22T08:00:00Z" }], period.end).areaPending, true);
  for (const hectares_segment of [null, -1, "invalid"]) {
    assert.equal(confirmedPlotHectares([{ ...segment, hectares_segment }], [{ id: "shift", closed_at: segment.closed_at }], period.end).areaPending, true);
  }
});
const fleet: FleetVehicle[] = ["empty", "loaded", "unloading", "repair", "offline"].map((group, i) => ({
  id: group, name: `Машина ${i}`, brand: "HOWO", plate: `${754 + i}`, driver: `Водитель ${i}`,
  assigned: group !== "offline", state: group === "loaded" || group === "unloading" ? group : "empty",
  inRepair: group === "repair", repairVersion: 2, repairChangedAt: segment.closed_at, lastActivity: segment.closed_at,
}));
const states: TrafficVehicle[] = fleet.slice(0, 4).map(vehicle => ({ vehicle_id: vehicle.id, name: vehicle.name, brand: vehicle.brand,
  plate: vehicle.plate, driver: vehicle.driver, state: vehicle.state!, version: 5, since: vehicle.lastActivity!,
  cycle: 1, assigned: true, inRepair: vehicle.inRepair, repairVersion: 2, repairChangedAt: segment.closed_at }));
check("all five columns including offline and broken fleet, no duplicate cars", () => {
  const board = buildTrafficBoard("company", { vehicles: [...states, { ...states[0], vehicle_id: "notPTC" }], serverTime: period.end }, [...fleet, fleet[0]]);
  assert.equal(board.vehicles.length, 5); assert.equal(new Set(board.vehicles.map(row => row.group)).size, 5);
  assert.equal(board.readOnly, true); assert(!JSON.stringify(board).includes("repairVersion")); assert(!JSON.stringify(board).includes("role"));
  assert.equal(board.vehicles.find(row => row.id === "offline")?.plate, "758");
});
check("latest repair wins and missing time is not invented", () => {
  const board = buildTrafficBoard("company", { vehicles: [{ ...states[0], repairVersion: 3, inRepair: true }], serverTime: period.end },
    [fleet[0], { ...fleet[4], lastActivity: null, repairChangedAt: null }]);
  assert.equal(board.vehicles.find(row => row.id === "empty")?.group, "repair");
  assert.equal(board.vehicles.find(row => row.id === "offline")?.since, null);
});

function moduleFrom(source: string, imports: Record<string, any>, globals: Record<string, any> = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, require: (name: string) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency ${name}`);
    return imports[name];
  }, ...globals });
  return exports;
}
async function main() {
  class AuthError extends Error { constructor(message: string, public status: number) { super(message); } }
  let actor: any = { id: "user", role: "weighman", companyId: "company" };
  let aclReject = false; let reads = 0; let tripReads = 0; let tripFailure = false;
  const source = readFileSync("app/api/traffic/board/route.ts", "utf8");
  const route = moduleFrom(source, {
    "@/lib/auth/server-session": {
      getServerActorFromSession: async (_: any, options: any) => { assert.equal(options.skipCache, true); if (!actor) throw new AuthError("no session", 401); return actor; },
      resolveCompanyForActor: (user: any, requested: string) => { if (requested && requested !== user.companyId) throw new AuthError("wrong company", 403); return user.companyId; },
    },
    "@/lib/auth/server-acl": { assertActorAccess: async (params: any) => { assert.equal(params.companyId, "company"); assert.equal(params.actorUserId, "user"); if (aclReject) throw new AuthError("inactive profile", 403); } },
    "@/lib/supabase/service": { getServiceClient: () => ({}) },
    "@/lib/fleet/server": { readCompanyFleet: async (_: any, companyId: string) => { reads++; assert.equal(companyId, "company"); return fleet; } },
    "@/lib/traffic/read-only-board": { buildTrafficBoard, TRAFFIC_BOARD_ROLES },
    "@/lib/traffic/shift-trip-counts-server": { readShiftTripCounts: async (_: any, companyId: string) => { assert.equal(companyId,"company"); reads++;tripReads++; if(tripFailure)throw Error("unavailable");return new Map(); } },
    "@/lib/traffic/server": {
      TrafficError: AuthError, failed: (error: any) => ({ status: error.status || 500 }), noStore: (body: any) => ({ status: 200, body }),
      readSnapshot: async (...args: any[]) => { reads++; assert.deepEqual(args, ["company", "manager", "", false, undefined, false, false]); return { vehicles: states, serverTime: period.end }; },
    },
  });
  const request = (company = "company") => ({ nextUrl: new URL(`https://fixture.local/api/traffic/board?companyId=${company}`) });
  for (const role of TRAFFIC_BOARD_ROLES) {
    actor.role = role; const response = await route.GET(request());
    check(`read-only route admits active ${role} with full scoped fleet`, () => { assert.equal(response.status, 200); assert.equal(response.body.vehicles.length, 5); });
  }
  check("plain weighbridge board does not request trip data",()=>assert.equal(tripReads,0));
  const withTrips=request();withTrips.nextUrl.searchParams.set("includeShiftTrips","true");
  let counted=await route.GET(withTrips);
  check("trip counts opt-in remains read-only and scoped",()=>{assert.equal(counted.status,200);assert.equal(tripReads,1);assert(counted.body.vehicles.every((vehicle:any)=>"shiftTrips" in vehicle))});
  tripFailure=true;counted=await route.GET(withTrips);tripFailure=false;
  check("trip read failure preserves fleet and displays unknown rather than zero",()=>{assert.equal(counted.status,200);assert.equal(counted.body.vehicles.length,5);assert(counted.body.vehicles.every((vehicle:any)=>vehicle.shiftTrips===null))});
  for (const role of ["mechanic_operator", "vegetable_brigadier", "accountant", "specialist"]) {
    actor.role = role; const before = reads; const response = await route.GET(request());
    check(`role ${role} rejected before data reads`, () => { assert.equal(response.status, 403); assert.equal(reads, before); });
  }
  actor.role = "weighman";
  let before = reads; let response = await route.GET(request("foreign"));
  check("foreign company cannot be supplied by query", () => { assert.equal(response.status, 403); assert.equal(reads, before); });
  aclReject = true; response = await route.GET(request());
  check("revoked/pending account rejected before fleet reads", () => { assert.equal(response.status, 403); assert.equal(reads, before); });
  actor = null; response = await route.GET(request());
  check("anonymous denied", () => assert.equal(response.status, 401));
  check("no mutation route and no existing manager write permissions broadened", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(route[method], undefined);
    const manager = readFileSync("lib/traffic/server.ts", "utf8").split("export async function manager(request: NextRequest)")[1].split("export async function dashboardSummaryReader")[0];
    assert(!manager.includes('"weighman"'));
  });

  // Exercise the actual timeline loader with company-filtered fixture queries.
  // The 68 ha plot deliberately has NO segments and NO receipts.
  const routeSource = readFileSync("app/api/dashboard/harvest-summary/route.ts", "utf8");
  const start = routeSource.indexOf("async function loadHarvestPlotTimeline(");
  const loader = routeSource.slice(start, routeSource.indexOf("function readFilters(", start));
  const calls: string[] = [];
  const tables: Record<string, any[]> = {
    ptc_combine_field_segments: [{ ...segment, company_id: "company", crop_structure_id: "a24", field_id: "field92", opened_at: period.start }],
    ptc_combine_shifts: [{ id: "shift", company_id: "company", closed_at: segment.closed_at }], ptc_field_progress: [],
    crop_structure: [...plots, plot("foreign", { fieldId: "field92" })].map(p => ({ id: p.cropStructureAllocationId, company_id: p.cropStructureAllocationId === "foreign" ? "foreign" : "company", field_id: p.fieldId, season_id: p.seasonId, crop_id: p.cropId, variety_id: p.varietyId, reproduction_id: p.reproductionId, area: p.areaHa, archived: false })),
    fields: [{ id: "field92", company_id: "company", name: "Виноградовка", area: 92 }],
    crops: [{ id: "potato", name: "Картофель" }], varieties: [{ id: "gala", name: "Гала" }], seed_reproductions: [{ id: "a24", name: "1" }, { id: "a68", name: "4" }],
  };
  const db = { from(table: string) {
    let rows = tables[table] || []; let companyFiltered = false;
    const q: any = { select() { return q; }, eq(key: string, value: any) { rows = rows.filter(row => row[key] === value); if (key === "company_id") companyFiltered = true; return q; },
      in(key: string, values: any[]) { rows = rows.filter(row => values.includes(row[key])); return q; },
      lt(key: string, value: any) { rows = rows.filter(row => row[key] < value); return q; }, order() { return q; },
      range(from: number, to: number) { rows = rows.slice(from, to + 1); return q; },
      then(resolve: any) { if (!["crops", "varieties", "seed_reproductions"].includes(table)) assert(companyFiltered, `${table} tenant scope missing`); calls.push(table); return Promise.resolve({ data: rows, error: null }).then(resolve); } };
    return q;
  } };
  const actualLoader = moduleFrom(`${loader}\nexports.load = loadHarvestPlotTimeline;`, {}, {
    getServiceClient: () => db, confirmedPlotHectares, uniqueIds: (ids: any[]) => Array.from(new Set(ids.filter(Boolean))),
    loadInChunks: async (ids: string[], query: any) => ids.length ? (await query(ids)).data : [],
  });
  const timeline = await actualLoader.load("company", period, null, [receipts[0]]);
  check("actual API loader includes unstarted 68 ha sibling, never foreign company", () => {
    assert.deepEqual(Array.from(timeline, (row: any) => row.cropStructureAllocationId).sort(), ["a24", "a68"]);
    assert.equal(timeline.find((row: any) => row.cropStructureAllocationId === "a24").harvestedAreaHa, 2.4);
    assert.equal(timeline.find((row: any) => row.cropStructureAllocationId === "a68").harvestedAreaHa, null);
    assert(timeline.every((row: any) => row.fieldAreaHa === 92)); assert(calls.includes("ptc_combine_shifts"));
  });
  console.log(`Field yield and read-only PTC PASS: ${checks} checks. No hosted writes.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
