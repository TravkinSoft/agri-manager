import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

// Execute the real routes, session resolver and ACL; only the database transport is mocked.
// No credentials, network access, business writes or schema mutations.
const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const company = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const target = "44444444-4444-4444-8444-444444444444";
const warehouse = "55555555-5555-4555-8555-555555555555";
const product = "66666666-6666-4666-8666-666666666666";
type Row = Record<string, any>;
type Call = { client: string; table: string; filters: Array<[string, unknown]> };
let checks = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); checks++; console.log("PASS " + name);
}
function harness(options: { row?: Row; profile?: Row | null; hidden?: boolean; invalid?: boolean } = {}) {
  const calls: Call[] = [];
  const row: Row = {
    auth_user_id: admin, profile_id: admin, role: "global_admin", status: "active",
    company_id: foreign, context_company_id: company,
    impersonated_profile_id: target, impersonated_company_id: company,
    impersonated_role: "agronomist", impersonated_status: "active", ...options.row,
  };
  const profile = options.profile === undefined
    ? { id: target, role: "agronomist", status: "active", company_id: company }
    : options.profile;
  function client(kind: "jwt" | "service") {
    return {
      rpc: async (name: string) => {
        assert.equal(kind, "jwt", "No privileged session resolver fallback");
        assert.equal(name, "resolve_actor_context_from_session_v1");
        return options.invalid ? { data: null, error: { message: "invalid JWT" } } : { data: [row], error: null };
      },
      auth: { getUser: async () => ({ data: { user: null }, error: { message: "invalid JWT" } }) },
      from: (table: string) => {
        if (kind === "service") assert.equal(table, "profiles", "Privileged client must never read stock");
        const call: Call = { client: kind, table, filters: [] };
        calls.push(call);
        const result = (single = false) => {
          let data: any[] = [];
          if (table === "profiles" && !(kind === "jwt" && options.hidden !== false) && profile) data = [profile];
          if (table === "warehouses") data = [{ id: warehouse, company_id: company, name: "Existing warehouse", place_type: "WAREHOUSE", archived: false, is_archived: false }];
          if (table === "products") data = [{ id: product, company_id: company, name: "Existing material", archived: false, is_active: true, unit: "kg", base_uom: "kg" }];
          data = data.filter((item) => call.filters.every(([key, value]) => item[key] === value));
          return { data: single ? data[0] || null : data, error: null };
        };
        const query: any = {
          select: () => query,
          eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
          in: () => query, order: () => query, limit: () => query, range: () => query,
          or: () => query, gt: () => query, is: () => query,
          maybeSingle: async () => result(true),
          then: (yes: (value: unknown) => unknown, no: (reason: unknown) => unknown) => Promise.resolve(result()).then(yes, no),
        };
        return query;
      },
    };
  }
  const jwt = client("jwt");
  const service = client("service");
  const cache = new Map<string, { exports: any }>();
  function load(file: string): any {
    const path = resolve(root, file);
    const found = cache.get(path);
    if (found) return found.exports;
    const testModule = { exports: {} as any };
    cache.set(path, testModule);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const scopedRequire = (name: string): any => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status || 200, body }) } };
      if (name === "@/lib/supabase/service") return { getServiceClient: () => service };
      if (name === "@supabase/supabase-js") return { createClient: (_url: string, _key: string, config: any) => {
        if (config.global) assert.match(config.global.headers.Authorization, /^Bearer test-/);
        return jwt;
      } };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
        const dependency = [base, base + ".ts", resolve(base, "index.ts")].find((p) => existsSync(p) && p.endsWith(".ts"));
        if (!dependency) throw new Error("Unresolved dependency " + name);
        return load(dependency);
      }
      return nativeRequire(name);
    };
    vm.runInNewContext(code, {
      exports: testModule.exports, module: testModule, require: scopedRequire, console, URL, URLSearchParams,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public" } },
      Buffer, setTimeout, clearTimeout,
    }, { filename: path });
    return testModule.exports;
  }
  function request(method = "GET", query = "", authorized = true) {
    return {
      method, nextUrl: new URL("https://test.invalid/api?companyId=" + company + query),
      headers: new Headers(authorized ? { authorization: "Bearer test-session", "x-actor-id": admin, "x-role": "global_admin" } : { "x-actor-id": admin }),
      cookies: { get: () => undefined },
    };
  }
  return { calls, row, profile, jwt, load, request };
}
const routes = [
  { file: "app/api/warehouses/summaries/route.ts", status: 200, query: "" },
  { file: "app/api/warehouses/balances/route.ts", status: 200, query: "" },
  { file: "app/api/warehouses/[id]/stock-details/route.ts", status: 200, query: "&productId=" + product + "&unit=kg" },
  { file: "app/api/weighbridge/harvest-batches/route.ts", status: 200, query: "" },
  { file: "app/api/weighbridge/tickets/[id]/route.ts", status: 404, query: "" },
];
async function invoke(h: ReturnType<typeof harness>, route: typeof routes[number], request = h.request("GET", route.query)) {
  return h.load(route.file).GET(request, { params: Promise.resolve({ id: warehouse }) });
}
async function main() {
await test("BEFORE: hidden target profile fails old JWT ACL; ordinary control passes", async () => {
  const h = harness();
  const acl = h.load("lib/auth/server-acl.ts");
  await assert.rejects(() => acl.assertActorAccess({ supabase: h.jwt, actorUserId: target, companyId: company, allowedRoles: ["agronomist"] }), /Actor profile not found/);
  const ordinary = harness({ hidden: false });
  await ordinary.load("lib/auth/server-acl.ts").assertActorAccess({ supabase: ordinary.jwt, actorUserId: target, companyId: company, allowedRoles: ["agronomist"] });
});
for (const route of routes) {
  await test(route.file + ": authorized impersonation keeps stock on JWT", async () => {
    const h = harness();
    const response = await invoke(h, route);
    assert.equal(response.status, route.status, JSON.stringify(response.body));
    assert.ok(h.calls.some((c) => c.client === "service" && c.table === "profiles"));
    assert.ok(h.calls.some((c) => c.client === "jwt" && c.table !== "profiles"));
    assert.ok(h.calls.filter((c) => c.client === "service").every((c) => c.filters.some(([k, v]) => k === "id" && v === target)));
    assert.ok(h.calls.filter((c) => ["warehouses", "stock_ledger_entries", "inventory_batches", "tickets", "warehouse_issue_requests"].includes(c.table)).every((c) => c.filters.some(([k, v]) => k === "company_id" && v === company)));
  });
  for (const [name, options, status] of [
    ["missing target", { profile: null }, 403],
    ["inactive target", { profile: { id: target, role: "agronomist", status: "inactive", company_id: company } }, 403],
    ["foreign target", { profile: { id: target, role: "agronomist", status: "active", company_id: foreign } }, 403],
    ["forbidden target role", { profile: { id: target, role: "fuel_operator", status: "active", company_id: company } }, 403],
    ["inactive original admin", { row: { status: "inactive" } }, 403],
    ["invalid impersonation", { row: { impersonated_status: "inactive" } }, 403],
    ["invalid JWT", { invalid: true }, 401],
  ] as const) {
    await test(route.file + ": " + name, async () => assert.equal((await invoke(harness(options), route)).status, status));
  }
  await test(route.file + ": missing JWT cannot be replaced by actor headers", async () => {
    const h = harness(); assert.equal((await invoke(h, route, h.request("GET", route.query, false))).status, 401);
    assert.equal(h.calls.length, 0);
  });
  await test(route.file + ": query tenant mismatch rejected before business reads", async () => {
    const h = harness(); const req = h.request("GET", route.query); req.nextUrl.searchParams.set("companyId", foreign);
    assert.equal((await invoke(h, route, req)).status, 403); assert.equal(h.calls.length, 0);
  });
  await test(route.file + ": direct agronomist session still works", async () => {
    const h = harness({ hidden: false, row: { auth_user_id: target, profile_id: target, role: "agronomist", company_id: company } });
    assert.equal((await invoke(h, route)).status, route.status);
    assert.equal(h.calls.filter((c) => c.client === "service").length, 0);
  });
}
await test("ordinary user cannot activate an impersonation row", async () => {
  const h = harness({ row: { role: "agronomist", company_id: foreign } });
  await assert.rejects(() => h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(h.request(), { serverProfileRead: true }), /Company mismatch/);
});
await test("trusted session preserves original auth id and target privileges", async () => {
  const h = harness(); const ctx = await h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(h.request(), { serverProfileRead: true });
  assert.equal(ctx.actor.authUserId, admin); assert.equal(ctx.actor.id, target);
  assert.equal(ctx.actor.role, "agronomist"); assert.equal(ctx.supabase, h.jwt);
});
await test("HEAD remains compatible with Next automatic GET handler", async () => {
  const h = harness();
  const context = await h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(h.request("HEAD"), { serverProfileRead: true });
  assert.equal(context.supabase, h.jwt);
  assert.equal(context.actor.role, "agronomist");
});
for (const method of ["POST", "PATCH", "DELETE"]) {
  await test(method + " cannot opt into privileged profile read", async () => {
    const h = harness();
    await assert.rejects(() => h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(h.request(method), { serverProfileRead: true }), /only allowed for GET/);
    assert.equal(h.calls.length, 0);
  });
}
await test("normal write resolver remains JWT-only and rejects agronomist write role", async () => {
  const h = harness({ hidden: false });
  await assert.rejects(() => h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(h.request("POST"), { allowedRoles: ["global_admin", "company_admin", "weighman"] }), /Access denied/);
  assert.equal(h.calls.filter((c) => c.client === "service").length, 0);
});
await test("unknown company syntax fails closed", async () => {
  const h = harness(); const req = h.request(); req.nextUrl.searchParams.set("companyId", "invalid,company");
  await assert.rejects(() => h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(req, { serverProfileRead: true }), /Invalid company/);
});
console.log("PASS warehouse impersonation read: " + checks + "/" + checks);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
