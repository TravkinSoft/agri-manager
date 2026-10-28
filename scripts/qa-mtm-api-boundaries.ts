import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import * as validation from "../lib/mtm/validation";
import * as roleContract from "../lib/auth/role-contract";

// Execute the real route and ACL source with a session and transport fixture.
// No Supabase connection, env file, real account or HTTP request is used.
function loadModule(file: string, dependencies: Record<string, unknown>) {
  const result: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports: result,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return result;
}

const company = "10000000-0000-4000-8000-000000000001";
const foreign = "10000000-0000-4000-8000-000000000002";
const product = "30000000-0000-4000-8000-000000000001";
class SessionAuthError extends Error { constructor(message: string, public status = 401) { super(message); } }
let sessionError: Error | null = null;
let actor = { id: "20000000-0000-4000-8000-000000000001", role: "company_admin", companyId: company, isImpersonating: false };
let profile = { id: actor.id, role: actor.role, company_id: company, status: "active" };
let rpcResult: { data: any; error: any };
let calls: Array<{ name: string; args: any }> = [];
const client = {
  from(name: string) {
    assert.equal(name, "profiles");
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: profile, error: null }) };
    return query;
  },
  async rpc(name: string, args: unknown) { calls.push({ name, args }); return rpcResult; },
};
const session = {
  SessionAuthError,
  getServerActorFromSession: async () => { if (sessionError) throw sessionError; return actor; },
  getUserScopedClientFromRequest: async () => client,
  resolveCompanyForActor: (_actor: unknown, requested: string | null) => requested || actor.companyId,
};
const acl = loadModule("lib/auth/server-acl.ts", {
  "@/lib/auth/role-contract": roleContract, "@/lib/auth/server-session": session,
});
const helpers = loadModule("app/api/mtm/_helpers.ts", {
  "next/server": { NextResponse }, "@/lib/auth/server-acl": acl,
  "@/lib/auth/server-session": session, "@/lib/mtm/validation": validation,
});
const getRoute = loadModule("app/api/mtm/catalog/route.ts", {
  "next/server": { NextResponse }, "../_helpers": helpers, "@/lib/mtm/validation": validation,
});
const putRoute = loadModule("app/api/mtm/catalog/[productId]/route.ts", {
  "next/server": { NextResponse }, "../../_helpers": helpers, "@/lib/mtm/validation": validation,
});

const body = { companyId: company, expected_revision: 0, category: "ppe", part_number: null,
  barcode: "00012345", internal_code: "PPE-001", specifications: "Перчатки, размер 9",
  accounting_unit_note: "1 шт = 1 пара", applicability: [] };
function reset(role = "company_admin") {
  actor = { ...actor, role, isImpersonating: false };
  profile = { id: actor.id, role, company_id: company, status: "active" };
  sessionError = null; calls = [];
  rpcResult = { data: { items: [], total: 0, offset: 0, limit: 25 }, error: null };
}
const get = (query = `companyId=${company}`) => getRoute.GET(new NextRequest(`http://localhost/api/mtm/catalog?${query}`));
const put = (payload: any = body) => putRoute.PUT(new NextRequest(`http://localhost/api/mtm/catalog/${product}`, {
  method: "PUT", body: JSON.stringify(payload), headers: { "content-type": "application/json" },
}), { params: Promise.resolve({ productId: product }) });

async function main() {
  let count = 0;
  const status = async (response: Response, expected: number) => { assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); count++; };
  reset(); sessionError = new SessionAuthError("Session required");
  await status(await get(), 401); assert.equal(calls.length, 0);
  reset(); profile.status = "inactive";
  await status(await get(), 403); assert.equal(calls.length, 0);
  reset(); await status(await get(`companyId=${foreign}`), 403); assert.equal(calls.length, 0);
  reset(); await status(await put({ ...body, companyId: foreign }), 403); assert.equal(calls.length, 0);
  reset(); actor.isImpersonating = true;
  await status(await get(), 403); assert.equal(calls.length, 0);
  for (const role of ["warehouse", "warehouse_operator", "mechanic_operator", "fleet_manager", "director", "accountant", "agronomist"]) {
    reset(role); const response = await get(); await status(response, 200);
    assert.equal((await response.json()).can_edit, false);
    calls = []; await status(await put(), 403); assert.equal(calls.length, 0);
  }
  reset("specialist"); await status(await get(), 403); assert.equal(calls.length, 0);
  reset(); await status(await get(`companyId=${company}&offset=-1`), 400); assert.equal(calls.length, 0);
  reset(); await status(await put({ ...body, part_number: 1234 }), 400); assert.equal(calls.length, 0);
  reset(); await status(await put({ ...body, quantity: 10 }), 400); assert.equal(calls.length, 0);
  reset(); rpcResult = { data: { ...body, product_id: product, revision: 1 }, error: null };
  await status(await put(), 200);
  assert.equal(calls.length, 1); assert.equal(calls[0].name, "mtm_catalog_save_v1");
  assert.equal(calls[0].args.p_metadata.barcode, "00012345");
  assert.equal(calls[0].args.p_metadata.part_number, null);
  reset(); await status(await get(`companyId=${company}&barcode=00012345`), 200);
  await status(await get(`companyId=${company}&barcode=00012345`), 200);
  assert.equal(calls.length, 2);
  for (const call of calls) { assert.equal(call.name, "mtm_catalog_list_v1"); assert.equal(call.args.p_barcode, "00012345"); }
  reset(); rpcResult = { data: null, error: { code: "PGRST202", message: "internal transport detail" } };
  const missing = await get(); await status(missing, 503);
  assert.equal((await missing.json()).code, "MTM_SCHEMA_NOT_READY");
  reset(); rpcResult = { data: null, error: { message: "MTM_REVISION_CONFLICT" } };
  await status(await put(), 409);
  reset(); rpcResult = { data: null, error: { message: "private transport information" } };
  const failure = await get(); await status(failure, 500);
  assert.ok(!JSON.stringify(await failure.json()).includes("private transport"));
  console.info(`MTM API boundaries PASS: ${count} real-handler status checks; ACL, scan reads and save payload verified; no network`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
