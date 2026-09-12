import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readClosedTrafficShiftHistoryPage,
  readClosedTrafficShiftSummaryById,
  TrafficShiftHistoryInputError,
  TrafficShiftReconstructionLimitError,
} from "../lib/traffic/shift-summary-server";
import { normalizeTrafficClosedShiftHistoryPage } from "../lib/traffic/shift-summary-normalize";

let checks = 0;
function equal(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  checks += 1;
}
function matches(value: string, pattern: RegExp) {
  assert.match(value, pattern);
  checks += 1;
}
function excludes(value: string, pattern: RegExp) {
  assert.doesNotMatch(value, pattern);
  checks += 1;
}

const companyId = "00000000-0000-4000-8000-000000000501";
const operatorId = "00000000-0000-4000-8000-000000000503";
const fieldIds = [
  "00000000-0000-4000-8000-000000000601",
  "00000000-0000-4000-8000-000000000602",
];
const shiftRows = Array.from({ length: 12 }, (_, index) => {
  const closedAt = new Date(Date.UTC(2026, 8, 8, 18, 0) - index * 60 * 60_000);
  return {
    id: "00000000-0000-4000-8000-" + String(700 + index).padStart(12, "0"),
    operator_user_id: operatorId,
    operator_name: "Комбайнёр " + (index + 1),
    field_id: fieldIds[index % fieldIds.length],
    opened_at: new Date(closedAt.getTime() - 60 * 60_000).toISOString(),
    closed_at: closedAt.toISOString(),
    hectares_shift: String(index + 1),
    hectares_field_total: String(100 + index),
  };
});

type QueryRecord = {
  table: string;
  eqs: Array<[string, unknown]>;
  inValues: unknown[];
  orFilter: string | null;
  limit: number | null;
};
type FakeResult = { data: unknown; error: null };
const calls: QueryRecord[] = [];

function resultFor(record: QueryRecord): FakeResult {
  if (record.table === "ptc_combine_shifts") {
    const requestedId = record.eqs.find(([column]) => column === "id")?.[1];
    if (requestedId) {
      return {
        data: shiftRows.find((row) => row.id === requestedId) ?? null,
        error: null,
      };
    }
    const source = record.orFilter ? shiftRows.slice(10) : shiftRows;
    return {
      data: source.slice(0, record.limit ?? source.length),
      error: null,
    };
  }
  if (record.table === "fields") {
    const requestedId = record.eqs.find(([column]) => column === "id")?.[1];
    const ids = requestedId ? [requestedId] : record.inValues;
    return {
      data: ids.map((id, index) => ({ id, name: "Поле " + (index + 1) })),
      error: null,
    };
  }
  if (record.table === "ptc_events") {
    return {
      data: [{
        id: "event-1",
        vehicle_id: "vehicle-1",
        actor_user_id: operatorId,
        from_state: "empty",
        to_state: "loaded",
        cycle: 1,
        created_at: shiftRows[1].opened_at,
      }],
      error: null,
    };
  }
  if (record.table === "reference_vehicles") {
    return {
      data: [{
        id: "vehicle-1",
        name: "КамАЗ",
        brand: "КамАЗ",
        license_plate: "247 AP 15",
        plate_number: null,
        source_machine_id: null,
      }],
      error: null,
    };
  }
  throw new Error("Unexpected table " + record.table);
}

class FakeQuery {
  private readonly record: QueryRecord;

  constructor(table: string) {
    this.record = { table, eqs: [], inValues: [], orFilter: null, limit: null };
    calls.push(this.record);
  }

  select() { return this; }
  not() { return this; }
  gte() { return this; }
  lte() { return this; }
  order() { return this; }
  eq(column: string, value: unknown) {
    this.record.eqs.push([column, value]);
    return this;
  }
  in(_column: string, values: unknown[]) {
    this.record.inValues = values;
    return this;
  }
  or(filter: string) {
    this.record.orFilter = filter;
    return this;
  }
  limit(value: number) {
    this.record.limit = value;
    return this;
  }
  maybeSingle() {
    return Promise.resolve(resultFor(this.record));
  }
  range() {
    return Promise.resolve(resultFor(this.record));
  }
  then(
    onFulfilled: (value: FakeResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) {
    return Promise.resolve(resultFor(this.record)).then(onFulfilled, onRejected);
  }
}

const fakeDb = {
  from(table: string) {
    return new FakeQuery(table);
  },
} as unknown as SupabaseClient;

async function verifyHistoryContract() {
  const first = await readClosedTrafficShiftHistoryPage(companyId, { limit: 10 }, fakeDb);
  equal(first.items.length, 10);
  equal(first.items[0].shiftId, shiftRows[0].id);
  equal(first.items[9].shiftId, shiftRows[9].id);
  equal(first.items[0].hectaresShift, 1);
  equal(first.items[0].fieldName, "Поле 1");
  equal(typeof first.nextCursor, "string");
  equal(calls.filter((call) => call.table === "ptc_events").length, 0);
  equal(calls.filter((call) => call.table === "reference_vehicles").length, 0);
  equal(calls.filter((call) => call.table === "fields").length, 1);
  equal(calls.find((call) => call.table === "ptc_combine_shifts")?.limit, 11);

  const second = await readClosedTrafficShiftHistoryPage(
    companyId,
    { cursor: first.nextCursor, limit: 10 },
    fakeDb,
  );
  equal(second.items.map((item) => item.shiftId), shiftRows.slice(10).map((row) => row.id));
  equal(second.nextCursor, null);
  const cursorCall = calls.filter((call) => call.table === "ptc_combine_shifts")[1];
  matches(cursorCall.orFilter || "", /closed_at\.lt\..+and\(closed_at\.eq\..+,id\.lt\.[0-9a-f-]+\)/);
  equal(cursorCall.limit, 11);

  const readsBeforeInvalidCursor = calls.length;
  await assert.rejects(
    readClosedTrafficShiftHistoryPage(companyId, { cursor: "bad!", limit: 10 }, fakeDb),
    TrafficShiftHistoryInputError,
  );
  checks += 1;
  equal(calls.length, readsBeforeInvalidCursor);

  await readClosedTrafficShiftHistoryPage(companyId, { limit: 99 }, fakeDb);
  equal(calls.filter((call) => call.table === "ptc_combine_shifts").at(-1)?.limit, 26);

  const readsBeforeInvalidId = calls.length;
  await assert.rejects(
    readClosedTrafficShiftSummaryById(companyId, "not-a-uuid", fakeDb),
    TrafficShiftHistoryInputError,
  );
  checks += 1;
  equal(calls.length, readsBeforeInvalidId);

  const detail = await readClosedTrafficShiftSummaryById(companyId, shiftRows[1].id, fakeDb);
  equal(detail?.shiftId, shiftRows[1].id);
  equal(detail?.totalTrips, 1);
  equal(detail?.vehicles.length, 1);
  equal(calls.filter((call) => call.table === "ptc_events").length, 1);
  equal(calls.filter((call) => call.table === "reference_vehicles").length, 1);

  const companyScoped = calls
    .filter((call) => ["ptc_combine_shifts", "fields", "ptc_events", "reference_vehicles"].includes(call.table))
    .every((call) => call.eqs.some(([column, value]) => column === "company_id" && value === companyId));
  equal(companyScoped, true);

  const normalized = normalizeTrafficClosedShiftHistoryPage({
    items: [first.items[0], { shiftId: null }],
    nextCursor: 123,
  });
  equal(normalized.items.length, 1);
  equal(normalized.nextCursor, null);
}

async function verifyReconstructionBudgets() {
  const baseShift = {
    ...shiftRows[0],
    field_id: null,
  };
  let eventReads = 0;
  let eventCursorReads = 0;

  class BudgetQuery {
    private limitValue = 0;
    private cursorFilter = "";

    constructor(private readonly table: string, private readonly shift: typeof baseShift) {}
    select() { return this; }
    eq() { return this; }
    not() { return this; }
    gte() { return this; }
    lte() { return this; }
    order() { return this; }
    or(filter: string) {
      this.cursorFilter = filter;
      return this;
    }
    limit(value: number) {
      this.limitValue = value;
      return this;
    }
    maybeSingle() {
      return Promise.resolve({ data: this.shift, error: null });
    }
    then(
      onFulfilled: (value: FakeResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      if (this.table !== "ptc_events") {
        return Promise.resolve({ data: this.shift, error: null }).then(onFulfilled, onRejected);
      }
      eventReads += 1;
      if (this.cursorFilter) eventCursorReads += 1;
      const first = (eventReads - 1) * 500;
      const data = Array.from({ length: this.limitValue }, (_, index) => ({
        id: "event-" + String(first + index + 1).padStart(5, "0"),
        vehicle_id: "vehicle-1",
        actor_user_id: operatorId,
        from_state: "empty",
        to_state: "loaded",
        cycle: first + index + 1,
        created_at: new Date(Date.parse(baseShift.opened_at) + (first + index) * 1_000).toISOString(),
      }));
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
    }
  }

  const budgetDb = {
    from(table: string) {
      return new BudgetQuery(table, baseShift);
    },
  } as unknown as SupabaseClient;
  await assert.rejects(
    readClosedTrafficShiftSummaryById(companyId, baseShift.id, budgetDb),
    TrafficShiftReconstructionLimitError,
  );
  checks += 1;
  equal(eventReads, 20);
  equal(eventCursorReads, 19);

  const overlongShift = {
    ...baseShift,
    opened_at: "2026-09-06T00:00:00.000Z",
    closed_at: "2026-09-08T00:00:00.001Z",
  };
  let overlongEventReads = 0;
  class OverlongQuery extends BudgetQuery {
    constructor(table: string) {
      super(table, overlongShift);
      if (table === "ptc_events") overlongEventReads += 1;
    }
  }
  const overlongDb = {
    from(table: string) {
      return new OverlongQuery(table);
    },
  } as unknown as SupabaseClient;
  await assert.rejects(
    readClosedTrafficShiftSummaryById(companyId, overlongShift.id, overlongDb),
    TrafficShiftReconstructionLimitError,
  );
  checks += 1;
  equal(overlongEventReads, 0);
}

const route = readFileSync("app/api/dashboard/traffic-shift-history/route.ts", "utf8");
const release = readFileSync("lib/travkinflow-2/release.ts", "utf8");
matches(route, /const \{ companyId \} = await dashboardSummaryReader\(request\)/);
excludes(route, /await manager\(request\)|actor\.role !== "agronomist"/);
matches(route, /readClosedTrafficShiftHistoryPage\(companyId/);
matches(route, /readClosedTrafficShiftSummaryById\(companyId, shiftId\)/);
matches(route, /const MAX_PAGE_SIZE = 25/);
matches(route, /if \(!TRAVKINFLOW_2_FUNCTIONS_RELEASED\)/);
matches(route, /TrafficShiftReconstructionLimitError[\s\S]*422/);
excludes(route, /requestedCompany|company_id|companyId\s*:/);
excludes(route, /\.(?:insert|update|upsert|delete|rpc)\s*\(/);

const trafficServer = readFileSync("lib/traffic/server.ts", "utf8");
const dashboardSummaryReaderHelper = trafficServer.slice(
  trafficServer.indexOf("export async function dashboardSummaryReader"),
  trafficServer.indexOf("export async function fleetManager"),
);
matches(dashboardSummaryReaderHelper, /getServerActorFromSession\(request, \{\s*skipCache: true,\s*\}\)/);
excludes(dashboardSummaryReaderHelper, /ignoreImpersonation:\s*true/);
matches(dashboardSummaryReaderHelper, /\["agronomist", "director"\]\.includes\(actor\.role\)/);
matches(dashboardSummaryReaderHelper, /actorUserId: actor\.id/);
matches(dashboardSummaryReaderHelper, /allowedRoles: \["agronomist", "director"\]/);

const server = readFileSync("lib/traffic/shift-summary-server.ts", "utf8");
matches(server, /const HISTORY_PAGE_SIZE = 10/);
matches(server, /const HISTORY_PAGE_SIZE_MAX = 25/);
matches(server, /const MAX_SHIFT_DURATION_MS = 36 \* 60 \* 60 \* 1_000/);
matches(server, /const MAX_SHIFT_EVENT_ROWS = 10_000/);
matches(server, /\.limit\(limit \+ 1\)/);
matches(server, /\.order\("closed_at", \{ ascending: false \}\)[\s\S]*\.order\("id", \{ ascending: false \}\)/);
matches(server, /\.in\("id", fieldIds\)/);
matches(server, /readSummaryForClosedShiftRow\(db, companyId, row\)/);
matches(server, /created_at\.gt\.\$\{cursor\.createdAt\},and\(created_at\.eq\.\$\{cursor\.createdAt\},id\.gt\.\$\{cursor\.id\}\)/);
matches(server, /query\.limit\(pageSize \+ 1\)/);
matches(server, /remainingBudget <= EVENT_PAGE_SIZE[\s\S]*throw new TrafficShiftReconstructionLimitError/);
excludes(server, /\.range\(/);
excludes(server, /\.from\([^)]*\)[\s\S]{0,300}?\.(?:insert|update|upsert|delete)\s*\(|\.rpc\s*\(/);

const service = readFileSync("lib/services/traffic-shift-summary.ts", "utf8");
matches(service, /getClosedTrafficShiftHistoryPage/);
matches(service, /getClosedTrafficShiftSummaryById/);
matches(service, /method: "GET"/);
matches(service, /signal,/);
excludes(service, /companyId|company_id/);

const component = readFileSync("components/dashboard/traffic-shift-summary.tsx", "utf8");
matches(component, /PTC · Итоги последней смены/);
matches(component, /История закрытых смен/);
matches(component, /if \(nextOpen && !loaded && !loading\) void loadPage\(null, false\)/);
matches(component, /getClosedTrafficShiftSummaryById\(shiftId, controller\.signal\)/);
matches(component, /aria-expanded=\{expanded\}/);
matches(component, /TRAFFIC_SHIFT_HISTORY_ENABLED = TRAVKINFLOW_2_FUNCTIONS_RELEASED/);
matches(component, /failure\.status === 422[\s\S]*failure\.message/);
matches(component, /new AbortController\(\)/);
matches(component, /generation !== detailGenerationRef\.current/);

const migration = readFileSync("supabase/migrations/20260907103717_ptc_last_vehicle_combine_shifts_v1.sql", "utf8");
matches(migration, /create table public\.ptc_combine_shifts/);
matches(migration, /closed_at timestamptz/);
matches(migration, /hectares_shift numeric/);

const historyIndexMigration = readFileSync("supabase/migrations/20260908231010_ptc_closed_shift_history_index_v1.sql", "utf8");
matches(historyIndexMigration, /create index if not exists ptc_combine_shift_company_closed_history_v1/);
matches(historyIndexMigration, /ptc_combine_shifts\(company_id, closed_at desc, id desc\)/);
matches(historyIndexMigration, /where closed_at is not null/);

matches(release, /export const TRAVKINFLOW_2_FUNCTIONS_RELEASED = true/);

async function verifyHistoryIndexMigration() {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema if not exists public;
      create table public.ptc_combine_shifts (
        id uuid primary key,
        company_id uuid not null,
        closed_at timestamptz
      );
    `);
    await db.exec(historyIndexMigration);
    const result = await db.query<{ indexdef: string }>(`
      select indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'ptc_combine_shift_company_closed_history_v1'
    `);
    equal(result.rows.length, 1);
    matches(
      result.rows[0].indexdef,
      /\(company_id, closed_at DESC, id DESC\) WHERE \(closed_at IS NOT NULL\)/i,
    );
  } finally {
    await db.close();
  }
}

void Promise.all([
  verifyHistoryContract(),
  verifyReconstructionBudgets(),
  verifyHistoryIndexMigration(),
])
  .then(() => {
    console.log("PTC closed shift history PASS: " + checks + " checks; durable cursor list, bounded keyset detail, fail-closed rollout, company scope and no writes.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
