import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const localRequire = createRequire(import.meta.url);
let checks = 0;
function check(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  checks++;
}
function load(path: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as any };
  vm.runInNewContext(output, {
    module: loaded, exports: loaded.exports, Error, Date,
    require: (name: string) => dependencies[name] ?? localRequire(name),
  });
  return loaded.exports;
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const companyId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const personId = "30000000-0000-4000-8000-000000000003";
const vehicleId = "40000000-0000-4000-8000-000000000004";
const eventId = "50000000-0000-4000-8000-000000000005";
const key = "60000000-0000-4000-8000-000000000006";
const foreignId = "90000000-0000-4000-8000-000000000009";
const input = { vehicleId, version: 7, target: "loaded", key };
const state = {
  vehicle_id: vehicleId, state: "loaded", version: 8,
  since: "2026-09-04T11:30:00.123+00:00", cycle: 3, assigned: true,
};
class SessionAuthError extends Error {
  constructor(message: string, public status = 401) { super(message); }
}
type Options = {
  role?: string;
  profileStatus?: string;
  profileCompany?: string;
  people?: any[];
  identityId?: string;
  sessionError?: boolean;
  profileError?: boolean;
  personError?: boolean;
  profileGate?: Promise<void>;
  rpcData?: unknown;
  rpcError?: { message: string; code?: string };
  current?: unknown;
  readError?: boolean;
  readThrow?: boolean;
};
function setup(options: Options = {}) {
  const calls: Array<{ table: string; filters: any[]; select: string; limit?: number }> = [];
  const rpcCalls: any[] = [], authCalls: any[] = [], sequence: string[] = [];
  let snapshots = 0;
  const role = options.role ?? "mechanic_operator";
  const people = options.people ?? [{
    id: personId, full_name: "Local test person", user_id: actorId,
    company_id: companyId, status: "active", deleted_at: null,
  }];
  const db = {
    from(table: string) {
      const filters: any[] = [];
      let selection = "", max: number | undefined, single = false;
      const execute = async () => {
        calls.push({ table, filters: plain(filters), select: selection, limit: max });
        sequence.push(table);
        let rows: any[];
        if (table === "profiles") {
          if (options.profileGate) await options.profileGate;
          if (options.profileError) return { data: null, error: new Error("profile read") };
          rows = [{ id: actorId, company_id: options.profileCompany ?? companyId,
            role, status: options.profileStatus ?? "active" }];
        } else if (table === "company_people") {
          if (options.personError) return { data: null, error: new Error("person read") };
          rows = people;
        } else if (table === "ptc_vehicle_states") {
          if (options.readThrow) throw new Error("read unavailable");
          if (options.readError) return { data: state, error: new Error("read unavailable") };
          // Return injected malformed data verbatim to test receipt validation.
          return { data: "current" in options ? options.current : state, error: null };
        } else throw new Error(`Unexpected table ${table}`);
        rows = rows.filter(row => filters.every(([, field, value]) => row[field] === value));
        if (max !== undefined) rows = rows.slice(0, max);
        const selected = rows.map(row => Object.fromEntries(selection.split(",").map(field => [field, row[field]])));
        return { data: single ? selected[0] ?? null : selected, error: null };
      };
      const q: any = {
        select(value: string) { selection = value; return q; },
        eq(field: string, value: unknown) { filters.push(["eq", field, value]); return q; },
        is(field: string, value: unknown) { filters.push(["is", field, value]); return q; },
        limit(value: number) { max = value; return q; },
        maybeSingle() { single = true; return execute(); },
        then(resolve: any, reject: any) { return execute().then(resolve, reject); },
      };
      return q;
    },
    async rpc(name: string, params: unknown) {
      rpcCalls.push([name, plain(params)]); sequence.push("rpc");
      return { data: "rpcData" in options ? options.rpcData : { eventId, replayed: false }, error: options.rpcError ?? null };
    },
  };
  const next = { NextResponse: {
    json: (data: unknown, init: ResponseInit) => new Response(JSON.stringify(data), init),
  } };
  const service = { getServiceClient: () => db };
  const server = load("lib/traffic/server.ts", {
    "next/server": next, "@/lib/supabase/service": service,
    "@/lib/auth/server-session": {
      SessionAuthError,
      getServerActorFromSession: async (_request: unknown, settings: unknown) => {
        authCalls.push(plain(settings)); sequence.push("auth");
        if (options.sessionError) throw new SessionAuthError("Expired test session");
        return { id: options.identityId ?? actorId, authUserId: actorId, companyId, role };
      },
      resolveCompanyForActor: (actor: any) => actor.companyId,
    },
    "@/lib/auth/server-acl": {},
    "./model": load("lib/traffic/model.ts", {}),
  });
  const api = load("app/api/traffic/operator/route.ts", {
    "next/server": next, "@/lib/supabase/service": service,
    "@/lib/traffic/server": { ...server,
      readSnapshot: async (...args: unknown[]) => { snapshots++; return { args }; },
    },
  });
  function request(body: unknown = input, origin = "https://example.test", site = "same-origin") {
    return {
      nextUrl: new URL("https://example.test/api/traffic/operator"),
      headers: new Headers({ origin, "sec-fetch-site": site }),
      json: async () => body,
    };
  }
  return { api, server, request, calls, rpcCalls, authCalls, sequence, snapshotCount: () => snapshots };
}

async function main() {
  let h = setup();
  let response = await h.api.POST(h.request());
  let body = await response.json();
  check(response.status, 200);
  check(body.vehicle, state);
  check(body.eventId, eventId); check(body.replayed, false); check(body.refreshRequired, false);
  check(Number.isFinite(Date.parse(body.serverTime)), true);
  check(response.headers.get("Cache-Control"), "no-store, private");
  check(response.headers.get("Vary"), "Cookie, Authorization");
  check(/^auth;dur=\d+, rpc;dur=\d+, read;dur=\d+, total;dur=\d+$/.test(response.headers.get("Server-Timing") ?? ""), true);
  check(h.authCalls, [{ ignoreImpersonation: true, skipCache: true }]);
  check(h.rpcCalls, [["ptc_actor_transition_v1", { p_actor: actorId, p_vehicle: vehicleId, p_version: 7, p_target: "loaded", p_key: key }]]);
  check(h.sequence, ["auth", "profiles", "company_people", "rpc", "ptc_vehicle_states"]);
  check(h.snapshotCount(), 0);
  check(h.calls[2], { table: "ptc_vehicle_states", select: "vehicle_id,state,version,since,cycle,assigned",
    filters: [["eq", "company_id", companyId], ["eq", "vehicle_id", vehicleId]], limit: undefined });
  check(h.calls[0].filters, [["eq", "id", actorId], ["eq", "company_id", companyId]]);
  check(h.calls[1].filters, [["eq", "user_id", actorId], ["eq", "company_id", companyId], ["eq", "status", "active"], ["is", "deleted_at", null]]);
  check(h.calls[1].limit, 2);

  // The company-person read must start while the fresh profile read is pending.
  let releaseProfile!: () => void;
  const gate = new Promise<void>(resolve => { releaseProfile = resolve; });
  h = setup({ profileGate: gate });
  const pending = h.api.POST(h.request());
  await flush();
  check(h.sequence, ["auth", "profiles", "company_people"]);
  check(h.rpcCalls.length, 0);
  releaseProfile();
  check((await pending).status, 200);

  // Old replay must report a newer real state, not the submitted old target.
  const laterState = { ...state, state: "empty", version: 10, assigned: false };
  h = setup({ rpcData: { eventId, replayed: true, secret: "must not return" }, current: laterState });
  body = await (await h.api.POST(h.request())).json();
  check(body.vehicle, laterState); check(body.replayed, true); check(body.secret, undefined);
  check(body.refreshRequired, false);

  for (const options of [
    { readError: true }, { readThrow: true }, { current: null },
    { current: { ...state, vehicle_id: foreignId } },
    { current: { ...state, version: 7 } }, { current: { ...state, version: 6 } },
    { current: { ...state, version: 8.5 } }, { current: { ...state, state: "unknown" } },
    { current: { ...state, since: "invalid date" } }, { current: { ...state, cycle: -1 } },
    { current: { ...state, assigned: "true" } },
  ] as Options[]) {
    h = setup(options); response = await h.api.POST(h.request()); body = await response.json();
    check(response.status, 200); check(body.eventId, eventId);
    check(body.vehicle, null); check(body.refreshRequired, true); check(h.rpcCalls.length, 1);
  }
  for (const [options, status] of [
    [{ sessionError: true }, 401], [{ identityId: foreignId }, 403],
    [{ profileStatus: "inactive" }, 403], [{ profileStatus: "pending" }, 403],
    [{ profileCompany: foreignId }, 403], [{ people: [] }, 403],
    [{ profileError: true }, 500], [{ personError: true }, 500],
    ...["global_admin", "company_admin", "agronomist", "weighman", "brigadier"].map(role => [{ role }, 403]),
  ] as Array<[Options, number]>) {
    h = setup(options); response = await h.api.POST(h.request());
    check(response.status, status); check(h.rpcCalls.length, 0);
    check(h.calls.some(call => call.table === "ptc_vehicle_states"), false);
  }
  const validPerson = { id: personId, full_name: "Test", user_id: actorId, company_id: companyId, status: "active", deleted_at: null };
  for (const people of [
    [{ ...validPerson, company_id: foreignId }], [{ ...validPerson, status: "inactive" }],
    [{ ...validPerson, deleted_at: "2026-09-04" }], [validPerson, { ...validPerson, id: foreignId }],
  ]) {
    h = setup({ people }); response = await h.api.POST(h.request());
    check(response.status, 403); check(h.rpcCalls.length, 0);
  }
  for (const target of ["unloading", "empty"]) {
    h = setup({ role: "vegetable_brigadier", current: { ...state, state: target } });
    response = await h.api.POST(h.request({ ...input, target }));
    check(response.status, 200); check((await response.json()).vehicle.state, target);
  }
  for (const [rpcError, status] of [
    [{ code: "23505", message: "duplicate" }, 409],
    [{ message: "PTC_VERSION_CONFLICT" }, 409], [{ message: "PTC_KEY_CONFLICT" }, 409],
    [{ message: "PTC_DISABLED" }, 409], [{ message: "PTC_NOT_ASSIGNED" }, 403],
    [{ message: "PTC_FORBIDDEN_TRANSITION" }, 403], [{ message: "PTC_UNAUTHORIZED" }, 401],
    [{ message: "PTC_PERSON_LINK_REQUIRED" }, 403],
  ] as Array<[{ message: string; code?: string }, number]>) {
    h = setup({ rpcError }); response = await h.api.POST(h.request());
    check(response.status, status); check(h.calls.some(call => call.table === "ptc_vehicle_states"), false);
  }
  for (const rpcData of [null, {}, { eventId: "bad", replayed: false }, { eventId, replayed: "true" }]) {
    h = setup({ rpcData }); response = await h.api.POST(h.request());
    check(response.status, 500); check(h.calls.some(call => call.table === "ptc_vehicle_states"), false);
  }
  for (const malformed of [{ ...input, companyId: foreignId }, { ...input, actorId: foreignId }, { ...input, version: -1 }, { ...input, target: "anything" }]) {
    h = setup(); response = await h.api.POST(h.request(malformed));
    check(response.status, 400); check(h.rpcCalls.length, 0);
  }
  for (const [origin, site] of [["https://foreign.test", "same-origin"], ["https://example.test", "cross-site"]]) {
    h = setup(); response = await h.api.POST(h.request(input, origin, site));
    check(response.status, 403); check(h.authCalls.length, 0); check(h.rpcCalls.length, 0);
  }
  h = setup(); response = await h.api.GET(h.request());
  check(response.status, 200); check(h.snapshotCount(), 1);
  check((await response.json()).args, [companyId, "harvester", "Local test person"]);
  console.log(`PTC transition receipt PASS: ${checks} checks (real route + operator helper with injected DB/auth; no network or hosted writes)`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
