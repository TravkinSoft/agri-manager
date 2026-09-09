import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const company = "11111111-1111-4111-8111-111111111111";
const foreignCompany = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const target = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;
type ClientCall = { client: "jwt" | "service"; table: string; filters: Array<[string, unknown]> };

let checks = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

function harness(options: {
  actorRow?: Row;
  targetProfile?: Row | null;
  jwtCanSeeTarget?: boolean;
} = {}) {
  const calls: ClientCall[] = [];
  const actorRow: Row = options.actorRow || {
    auth_user_id: admin,
    profile_id: admin,
    role: "global_admin",
    status: "active",
    company_id: foreignCompany,
    context_company_id: foreignCompany,
    impersonated_profile_id: target,
    impersonated_company_id: company,
    impersonated_role: "agronomist",
    impersonated_status: "active",
  };
  const targetProfile = options.targetProfile === undefined
    ? { id: target, company_id: company, role: "agronomist", status: "active" }
    : options.targetProfile;

  function client(kind: "jwt" | "service") {
    return {
      rpc: async (name: string) => {
        assert.equal(kind, "jwt");
        assert.equal(name, "resolve_actor_context_from_session_v1");
        return { data: [actorRow], error: null };
      },
      auth: {
        getUser: async () => ({ data: { user: null }, error: { message: "fast path expected" } }),
      },
      from: (table: string) => {
        assert.equal(table, "profiles");
        const call: ClientCall = { client: kind, table, filters: [] };
        calls.push(call);
        const query: any = {
          select: () => query,
          eq: (key: string, value: unknown) => {
            call.filters.push([key, value]);
            return query;
          },
          limit: () => query,
          maybeSingle: async () => {
            const visible = kind === "service" || options.jwtCanSeeTarget === true;
            const matches = targetProfile
              && visible
              && call.filters.every(([key, value]) => targetProfile[key] === value);
            return { data: matches ? targetProfile : null, error: null };
          },
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
    const cached = cache.get(path);
    if (cached) return cached.exports;
    const testModule = { exports: {} as any };
    cache.set(path, testModule);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText;
    const scopedRequire = (name: string): any => {
      if (name === "@/lib/supabase/service") return { getServiceClient: () => service };
      if (name === "@supabase/supabase-js") {
        return {
          createClient: (_url: string, _key: string, config: any) => {
            if (config.global) assert.match(config.global.headers.Authorization, /^Bearer test-session$/);
            return jwt;
          },
        };
      }
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
        const dependency = [base, `${base}.ts`, resolve(base, "index.ts")]
          .find((candidate) => existsSync(candidate) && candidate.endsWith(".ts"));
        if (!dependency) throw new Error(`Unresolved dependency ${name}`);
        return load(dependency);
      }
      return nativeRequire(name);
    };
    vm.runInNewContext(code, {
      exports: testModule.exports,
      module: testModule,
      require: scopedRequire,
      console,
      URL,
      URLSearchParams,
      Headers,
      Buffer,
      setTimeout,
      clearTimeout,
      process: {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public",
        },
      },
    }, { filename: path });
    return testModule.exports;
  }

  function request(method = "GET", requestedCompanyId = company) {
    return {
      method,
      nextUrl: new URL(`https://test.invalid/api/dashboard/harvest-summary?companyId=${requestedCompanyId}`),
      headers: new Headers({ authorization: "Bearer test-session" }),
      cookies: { get: () => undefined },
    };
  }

  return { calls, jwt, load, request };
}

async function main() {
await test("harvest summary explicitly enables server-only profile ACL reads", () => {
  const route = readFileSync(resolve(root, "app/api/dashboard/harvest-summary/route.ts"), "utf8");
  assert.match(
    route,
    /resolveWeighbridgeSession\(request,\s*\{[\s\S]*?allowedRoles:\s*DASHBOARD_ROLES,[\s\S]*?serverProfileRead:\s*true,[\s\S]*?\}\)/,
  );
});

await test("direct agronomist keeps profile ACL and business client on JWT", async () => {
  const h = harness({
    jwtCanSeeTarget: true,
    actorRow: {
      auth_user_id: target,
      profile_id: target,
      role: "agronomist",
      status: "active",
      company_id: company,
    },
  });
  const context = await h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(
    h.request(),
    { allowedRoles: ["agronomist"], serverProfileRead: true },
  );
  assert.equal(context.actor.isImpersonating, false);
  assert.equal(context.supabase, h.jwt);
  assert.deepEqual(h.calls.map((call) => call.client), ["jwt"]);
});

await test("impersonated agronomist uses service only for the target profile ACL", async () => {
  const h = harness();
  const context = await h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(
    h.request(),
    { allowedRoles: ["agronomist"], serverProfileRead: true },
  );
  assert.equal(context.actor.id, target);
  assert.equal(context.actor.authUserId, admin);
  assert.equal(context.actor.isImpersonating, true);
  assert.equal(context.companyId, company);
  assert.equal(context.supabase, h.jwt);
  assert.deepEqual(h.calls, [{ client: "service", table: "profiles", filters: [["id", target]] }]);
});

for (const [name, targetProfile, message] of [
  ["missing target", null, /Actor profile not found/],
  ["inactive target", { id: target, company_id: company, role: "agronomist", status: "inactive" }, /not active/],
  ["target company mismatch", { id: target, company_id: foreignCompany, role: "agronomist", status: "active" }, /does not belong/],
] as const) {
  await test(`impersonation fails closed for ${name}`, async () => {
    const h = harness({ targetProfile });
    await assert.rejects(
      () => h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(
        h.request(),
        { allowedRoles: ["agronomist"], serverProfileRead: true },
      ),
      message,
    );
    assert.ok(h.calls.every((call) => call.client === "service" && call.table === "profiles"));
  });
}

await test("request company mismatch fails before any profile read", async () => {
  const h = harness();
  await assert.rejects(
    () => h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(
      h.request("GET", foreignCompany),
      { allowedRoles: ["agronomist"], serverProfileRead: true },
    ),
    /Company mismatch/,
  );
  assert.equal(h.calls.length, 0);
});

await test("privileged profile read cannot be enabled on a write request", async () => {
  const h = harness();
  await assert.rejects(
    () => h.load("app/api/weighbridge/_auth.ts").resolveWeighbridgeSession(
      h.request("POST"),
      { allowedRoles: ["agronomist"], serverProfileRead: true },
    ),
    /only allowed for GET\/HEAD/,
  );
  assert.equal(h.calls.length, 0);
});

console.log(`DASHBOARD HARVEST IMPERSONATION: ${checks}/${checks} PASS`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
