import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTrafficClosedShiftSummary } from "../lib/traffic/shift-summary";
import { readLatestClosedTrafficShiftSummary } from "../lib/traffic/shift-summary-server";

let checks = 0;
function equal(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  checks += 1;
}

const shift = {
  id: "00000000-0000-4000-8000-000000000001",
  operatorUserId: "00000000-0000-4000-8000-000000000003",
  operatorName: "Комбайнёр Тестовый",
  fieldId: "00000000-0000-4000-8000-000000000002",
  openedAt: "2026-09-07T08:00:00.000Z",
  closedAt: "2026-09-07T09:00:00.000Z",
  hectaresShift: 13,
  hectaresFieldTotal: 30,
};
const event = (
  vehicle_id: string,
  from_state: "empty" | "loaded" | "unloading",
  to_state: "empty" | "loaded" | "unloading",
  cycle: number,
  created_at: string,
  actor_user_id = shift.operatorUserId,
) => ({ vehicle_id, from_state, to_state, cycle, created_at, actor_user_id });
const events = [
  event("car-ignored-before", "empty", "loaded", 1, "2026-09-07T07:59:59.999Z"),
  event("car-1", "empty", "loaded", 1, "2026-09-07T08:00:00.000Z"),
  event("car-1", "loaded", "unloading", 1, "2026-09-07T08:05:00.000Z"),
  event("car-1", "unloading", "empty", 1, "2026-09-07T08:08:00.000Z"),
  event("car-2", "empty", "loaded", 1, "2026-09-07T08:10:00.000Z"),
  event("car-2", "loaded", "unloading", 1, "2026-09-07T08:18:00.000Z"),
  event("car-2", "unloading", "empty", 1, "2026-09-07T08:20:00.000Z"),
  event("car-1", "empty", "loaded", 2, "2026-09-07T08:25:00.000Z"),
  event("car-2", "empty", "loaded", 2, "2026-09-07T08:45:00.000Z"),
  event("other-operator", "empty", "loaded", 1, "2026-09-07T08:50:00.000Z", "00000000-0000-4000-8000-000000000099"),
  event("other-operator", "loaded", "unloading", 1, "2026-09-07T08:55:00.000Z", "00000000-0000-4000-8000-000000000010"),
  event("car-ignored-after", "empty", "loaded", 1, "2026-09-07T09:00:00.001Z"),
];
const summary = buildTrafficClosedShiftSummary(shift, events, [
  { id: "car-1", name: "КамАЗ 45143", brand: "KAMAZ", plate: "247 AP 15" },
  { id: "car-2", name: "HOWO", brand: "HOWO", plate: "754" },
], "Поле 1");

equal(summary.durationMinutes, 60);
equal(summary.totalTrips, 4);
equal(summary.participatingVehicles, 2);
equal(summary.averageLoadIntervalMinutes, 15);
equal(summary.averageVehicleCycleMinutes, 30);
equal(summary.latestFleetRoundMinutes, 35);
equal(summary.probableDowntimeCount, 1);
equal(summary.probableDowntimeMinutes, 5);
equal(summary.vehicles.map((row) => [row.vehicleId, row.trips]).sort(), [["car-1", 2], ["car-2", 2]]);
equal(summary.fieldName, "Поле 1");
equal("driver" in summary.vehicles[0], false);

const route = readFileSync("app/api/dashboard/traffic-shift-summary/route.ts", "utf8");
assert.match(route, /const \{ actor, companyId \} = await manager\(request\)/); checks += 1;
assert.match(route, /actor\.role !== "agronomist"/); checks += 1;
assert.doesNotMatch(route, /searchParams|requestedCompany|companyId\s*:/); checks += 1;
assert.doesNotMatch(route, /\.(?:insert|update|upsert|delete|rpc)\s*\(/); checks += 1;

const server = readFileSync("lib/traffic/shift-summary-server.ts", "utf8");
assert.match(server, /const EVENT_PAGE_SIZE = 500/); checks += 1;
assert.match(server, /\.gte\("created_at", openedAt\)[\s\S]*\.lte\("created_at", closedAt\)/); checks += 1;
assert.match(server, /select\("id,vehicle_id,actor_user_id,from_state,to_state,cycle,created_at"\)/); checks += 1;
assert.match(server, /select\("id,operator_user_id,operator_name,field_id,opened_at,closed_at,hectares_shift,hectares_field_total"\)/); checks += 1;
assert.match(server, /\.order\("created_at", \{ ascending: true \}\)[\s\S]*\.order\("id", \{ ascending: true \}\)/); checks += 1;
assert.match(server, /\.range\(from, from \+ EVENT_PAGE_SIZE - 1\)/); checks += 1;
assert.match(server, /if \(page\.length < EVENT_PAGE_SIZE\) return events/); checks += 1;
assert.match(server, /const SUMMARY_CACHE_MAX_COMPANIES = 100/); checks += 1;
assert.match(server, /const closedShiftSummaryCache = new Map<string, CachedClosedShiftSummary>\(\)/); checks += 1;
assert.match(server, /const SUMMARY_CACHE_TTL_MS = 60_000/); checks += 1;
assert.match(server, /const shiftIdentity = closedShiftIdentity\(row\)/); checks += 1;
assert.match(server, /cached\?\.shiftIdentity === shiftIdentity/); checks += 1;
assert.match(server, /Date\.now\(\) - cached\.cachedAt < SUMMARY_CACHE_TTL_MS/); checks += 1;
assert.match(server, /cacheClosedShiftSummary\(companyId, entry\)/); checks += 1;
assert.match(server, /closedShiftSummaryCache\.get\(companyId\) === entry/); checks += 1;
assert.doesNotMatch(server, /\.from\([^)]*\)[\s\S]{0,300}?\.(?:insert|update|upsert|delete)\s*\(|\.rpc\s*\(/); checks += 1;

const component = readFileSync("components/dashboard/traffic-shift-summary.tsx", "utf8");
assert.match(component, /Последняя закрытая смена/); checks += 1;
assert.match(component, /По отметкам загрузки комбайнёра/); checks += 1;
assert.doesNotMatch(component, /averageTripsPerVehicle/); checks += 1;
assert.match(component, /subscribeTrafficChanges\(companyId, wake\)/); checks += 1;
assert.match(component, /window\.setInterval\(visible, 60_000\)/); checks += 1;
assert.match(component, /window\.addEventListener\("focus", wake\)/); checks += 1;
assert.match(component, /window\.addEventListener\("online", wake\)/); checks += 1;
assert.match(component, /document\.addEventListener\("visibilitychange", visible\)/); checks += 1;
assert.match(component, /if \(running\)[\s\S]*pending = true/); checks += 1;
assert.match(component, /setSummary\(null\)/); checks += 1;
assert.match(component, /failure\.status === 401 \|\| failure\.status === 403[\s\S]*setSummary\(null\)/); checks += 1;

const summaryService = readFileSync("lib/services/traffic-shift-summary.ts", "utf8");
assert.match(summaryService, /\{ status: response\.status \}/); checks += 1;
assert.match(summaryService, /startsWith\("Missing authorization token"\)[\s\S]*\{ status: 401 \}/); checks += 1;

const dashboard = readFileSync("components/dashboard/harvest-dashboard.tsx", "utf8");
assert.match(dashboard, /profile\?\.role === "agronomist" && profile\.company_id \? <TrafficShiftSummary key=\{profile\.company_id\}/); checks += 1;

type FakeResult = { data: unknown; error: null };

async function verifyClosedShiftSummaryCache() {
  const companyId = "00000000-0000-4000-8000-000000000501";
  let latestShift = {
    ...shift,
    id: "00000000-0000-4000-8000-000000000511",
    closed_at: shift.closedAt,
    opened_at: shift.openedAt,
    operator_user_id: shift.operatorUserId,
    operator_name: shift.operatorName,
    field_id: shift.fieldId,
    hectares_shift: shift.hectaresShift,
    hectares_field_total: shift.hectaresFieldTotal,
  };
  const reads = { shifts: 0, events: 0, fields: 0, vehicles: 0 };

  const resultFor = (table: string): FakeResult => {
    if (table === "ptc_combine_shifts") {
      reads.shifts += 1;
      return { data: latestShift, error: null };
    }
    if (table === "ptc_events") {
      reads.events += 1;
      return {
        data: [{
          id: `event-${latestShift.id}`,
          vehicle_id: "car-1",
          actor_user_id: shift.operatorUserId,
          from_state: "empty",
          to_state: "loaded",
          cycle: 1,
          created_at: latestShift.opened_at,
        }],
        error: null,
      };
    }
    if (table === "fields") {
      reads.fields += 1;
      return { data: { id: shift.fieldId, name: "Поле 1" }, error: null };
    }
    if (table === "reference_vehicles") {
      reads.vehicles += 1;
      return {
        data: [{
          id: "car-1",
          name: "КамАЗ",
          brand: "КамАЗ",
          license_plate: "247 AP 15",
          plate_number: null,
          source_machine_id: null,
        }],
        error: null,
      };
    }
    throw new Error(`Unexpected fake table: ${table}`);
  };

  class FakeQuery {
    constructor(private readonly table: string) {}
    select() { return this; }
    eq() { return this; }
    not() { return this; }
    gte() { return this; }
    lte() { return this; }
    order() { return this; }
    limit() { return this; }
    in() { return this; }
    maybeSingle() { return Promise.resolve(resultFor(this.table)); }
    range() { return Promise.resolve(resultFor(this.table)); }
    then(
      onFulfilled: (value: FakeResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(resultFor(this.table)).then(onFulfilled, onRejected);
    }
  }

  const fakeDb = {
    from(table: string) {
      return new FakeQuery(table);
    },
  } as unknown as SupabaseClient;

  const first = await readLatestClosedTrafficShiftSummary(companyId, fakeDb);
  const second = await readLatestClosedTrafficShiftSummary(companyId, fakeDb);
  equal(first?.shiftId, latestShift.id);
  equal(second?.shiftId, latestShift.id);
  equal(reads, { shifts: 2, events: 1, fields: 1, vehicles: 1 });

  latestShift = {
    ...latestShift,
    id: "00000000-0000-4000-8000-000000000512",
    opened_at: "2026-09-07T10:00:00.000Z",
    closed_at: "2026-09-07T11:00:00.000Z",
  };
  const third = await readLatestClosedTrafficShiftSummary(companyId, fakeDb);
  equal(third?.shiftId, latestShift.id);
  equal(reads, { shifts: 3, events: 2, fields: 2, vehicles: 2 });
}

void verifyClosedShiftSummaryCache()
  .then(() => {
    console.log(`PTC agronomist shift summary PASS: ${checks} checks; cached immutable history, strict role and full pagination.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
