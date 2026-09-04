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
type Call = { client: string; table: string; filters: Array<[string, unknown]>; scopes: string[]; page?: [number, number]; order?: string };
let checks = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); checks++; console.log("PASS " + name);
}
function harness(options: { row?: Row; profile?: Row | null; hidden?: boolean; invalid?: boolean; ledger?: Row[]; catalog?: Row[]; catalogErrorAt?: number } = {}) {
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
        const call: Call = { client: kind, table, filters: [], scopes: [] };
        calls.push(call);
        const result = (single = false) => {
          let data: any[] = [];
          if (table === "profiles" && !(kind === "jwt" && options.hidden !== false) && profile) data = [profile];
          if (table === "warehouses") data = [{ id: warehouse, company_id: company, name: "Existing warehouse", place_type: "WAREHOUSE", archived: false, is_archived: false }];
          if (table === "products") data = options.catalog || [{ id: product, company_id: company, name: "Existing material", archived: false, is_active: true, unit: "kg", base_uom: "kg" }];
          if (table === "stock_ledger_entries") data = options.ledger || [];
          data = data.filter((item) => call.filters.every(([key, value]) => item[key] === value));
          if (table === "products") {
            if (options.catalogErrorAt === (call.page?.[0] || 0)) return { data: null, error: { message: "catalog page unavailable" } };
            data = data.filter((item) => item.company_id === company || item.company_id === null);
            const referenceScope = call.scopes.find((scope) => scope.includes("id.in.("));
            if (referenceScope) {
              const ids = (referenceScope.match(/,id\.in\.\(([^)]*)\)/)?.[1] || "").split(",");
              data = data.filter((item) => item.company_id === company || ids.includes(item.id) || ids.includes(item.master_product_id));
            }
            if (call.order === "id") data = [...data].sort((a, b) => String(a.id).localeCompare(String(b.id)));
            data = call.page ? data.slice(call.page[0], call.page[1] + 1) : data.slice(0, 1000);
          }
          return { data: single ? data[0] || null : data, error: null };
        };
        const query: any = {
          select: () => query,
          eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
          in: () => query, order: (key: string) => { call.order = key; return query; }, limit: () => query,
          range: (from: number, to: number) => { call.page = [from, to]; return query; },
          or: (scope: string) => { call.scopes.push(scope); return query; }, gt: () => query, is: () => query,
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
const catalog = [
  ...Array.from({ length: 1200 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, company_id: null, name: `Catalog product ${index}`, archived: false, is_active: true, unit: "kg", base_uom: "kg" })),
  { id: product, company_id: null, name: "NPK 16-16-16", archived: false, is_active: true, unit: "kg", base_uom: "kg" },
];
const npkLedger = [{ id: "npk", company_id: company, warehouse_id: warehouse, product_id: product, uom: "kg", direction: "in", quantity: 8000, delta_qty_signed: 8000, batch_class: "material" }];
await test("balances retain material referenced beyond the first 1000 catalog rows", async () => {
  const h = harness({ catalog, ledger: npkLedger });
  const response = await invoke(h, routes[1]);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.balances.find((r: Row) => r.product_id === product)?.material_quantity, 8000);
  const calls = h.calls.filter((c) => c.table === "products");
  assert.equal(calls.length, 1, "unrelated globals are not enumerated");
  assert.ok(calls.every((c) => c.client === "jwt" && c.order === "id" && c.scopes.includes(`company_id.eq.${company},company_id.is.null`)));
});
await test("material detail hydrates the same product beyond page one", async () => {
  const h = harness({ catalog, ledger: npkLedger }); const route = routes[2];
  const response = await invoke(h, route, h.request("GET", route.query + "&batchClass=material&stockOrigin=material"));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.details.quantity, 8000);
  assert.equal(h.calls.filter((c) => c.table === "products").length, 3, "unchanged detail route still paginates its complete catalog");
});
await test("referenced stock keeps company master override, never a foreign override", async () => {
  const localId = "77777777-7777-4777-8777-777777777777";
  const h = harness({ ledger: npkLedger, catalog: [
    ...catalog,
    { ...catalog.at(-1), id: localId, company_id: company, master_product_id: product },
    { ...catalog.at(-1), id: "88888888-8888-4888-8888-888888888888", company_id: foreign, master_product_id: product },
  ] });
  const response = await invoke(h, routes[1]);
  assert.equal(response.status, 200);
  assert.equal(response.body.balances.length, 1);
  assert.equal(response.body.balances[0].product_id, localId);
  assert.equal(response.body.balances[0].material_quantity, 8000);
});
await test("referenced stock retains identity-based company override beyond page one", async () => {
  const localId = "77777777-7777-4777-8777-777777777777";
  const h = harness({ ledger: npkLedger, catalog: [
    ...catalog.map((item) => ({ ...item, company_id: item.id === product ? null : company })),
    { ...catalog.at(-1), id: localId, company_id: company },
  ] });
  const response = await invoke(h, routes[1]);
  assert.equal(response.status, 200);
  assert.equal(response.body.balances[0].product_id, localId);
  assert.equal(response.body.balances[0].material_quantity, 8000);
  assert.equal(h.calls.filter((c) => c.table === "products").length, 3);
});
await test("empty stock does not enumerate any product catalog", async () => {
  const h = harness({ catalog });
  const response = await invoke(h, routes[1]);
  assert.equal(response.status, 200);
  assert.equal(response.body.balances.length, 0);
  assert.equal(h.calls.filter((c) => c.table === "products").length, 0);
});
for (const route of [routes[1], routes[2]]) {
  await test(route.file + ": later catalog failure never succeeds with partial stock", async () => {
    const h = harness({ catalog: catalog.map((item) => ({ ...item, company_id: company })), ledger: npkLedger, catalogErrorAt: 500 });
    const response = await invoke(h, route);
    assert.ok(response.status >= 400);
    assert.match(response.body.error, /catalog page unavailable/);
    assert.equal(response.body.balances, undefined); assert.equal(response.body.details, undefined);
  });
}
await test("material drill-down accepts canonical class and preserves exact class/tenant stock", async () => {
  const base = { company_id: company, warehouse_id: warehouse, product_id: product, uom: "kg", direction: "in", occurred_at: "2026-09-04T00:00:00Z" };
  const h = harness({ ledger: [
    { ...base, id: "material", batch_class: "material", quantity: 3, delta_qty_signed: 3 },
    { ...base, id: "commodity", batch_class: "commodity", quantity: 99, delta_qty_signed: 99 },
    { ...base, id: "foreign", company_id: foreign, batch_class: "material", quantity: 999, delta_qty_signed: 999 },
  ] });
  const route = routes[2];
  const response = await invoke(h, route, h.request("GET", route.query + "&batchClass=material&stockOrigin=material"));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.details.batch_class, "material");
  assert.equal(response.body.details.stock_origin, "material");
  assert.equal(response.body.details.quantity, 3);
  assert.equal(response.body.details.available_quantity, 3);
  assert.equal(response.body.details.movements.length, 1);
});
await test("unknown stock class is still rejected before reads", async () => {
  const h = harness(); const route = routes[2];
  assert.equal((await invoke(h, route, h.request("GET", route.query + "&batchClass=invented"))).status, 400);
  assert.equal(h.calls.length, 0);
});
await test("stock-detail classes match the existing seven-class DB contract", () => {
  const route = readFileSync(resolve(root, routes[2].file), "utf8");
  const block = route.match(/const STOCK_BATCH_CLASSES = new Set\(\[([\s\S]*?)\]\)/)?.[1] || "";
  assert.deepEqual(Array.from(block.matchAll(/"([a-z]+)"/g), (match) => match[1]).sort(), ["commodity", "seed", "material", "feed", "waste", "processing", "rejected"].sort());
});
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
