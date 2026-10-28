import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import * as roleContract from "../lib/auth/role-contract";
import * as catalogValidation from "../lib/mtm/validation";
import * as validation from "../lib/mtm/stock-validation";
import * as types from "../lib/mtm/stock-types";

// Real HTTP handlers and server ACL with isolated session/transport fixtures.
// No env files, live user, network, shared DB, or stock writes.
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  } }, { filename: file });
  return exports;
}
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), foreign = id(2), warehouse = id(3), product = id(4), actorId = id(5), key = id(6);
const body = { companyId: company, kind: "issue", warehouse_id: warehouse, product_id: product,
  quantity: "2", uom: "pcs", purpose: "Перчатки для общих работ", recipient_id: null,
  asset_kind: null, asset_id: null, task_id: null, original_issue_id: null };
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.info(`PASS ${name}`); };

check("general issue does not require fake equipment or employee", () => assert.ok(validation.mtmOperationSchema.safeParse(body).success));
check("quantities reject rounding, exponent, negative, numeric and excessive values", () => {
  for (const quantity of [0, 2, "0", "-1", "1e3", " 2", "2 ", "1,2", "1.0001", "NaN", "Infinity", "01", "1000000000", "999999999.001"]) {
    assert.equal(validation.mtmOperationSchema.safeParse({ ...body, quantity }).success, false, String(quantity));
  }
});
check("three decimal liquids accepted, pieces integral, zero minimum allowed", () => {
  assert.ok(validation.mtmOperationSchema.safeParse({ ...body, quantity: "0.001", uom: "l" }).success);
  assert.equal(validation.mtmOperationSchema.safeParse({ ...body, quantity: "0.001" }).success, false);
  assert.equal(validation.mtmOperationSchema.parse({ ...body, quantity: "2.000" }).quantity, "2");
  assert.ok(validation.mtmMinimumSchema.safeParse({ companyId: company, warehouse_id: warehouse, product_id: product, quantity: "0", expected_revision: 0 }).success);
});
check("strict links distinguish receipt issue return and source", () => {
  for (const extra of [{ kind: "receipt", recipient_id: id(8) }, { kind: "return" },
    { kind: "return", original_issue_id: id(9), asset_kind: "machine", asset_id: id(8) },
    { asset_id: id(8) }, { asset_kind: "machine" }, { original_issue_id: id(9) },
    { balance: 100 }, { purpose: " " }]) assert.equal(validation.mtmOperationSchema.safeParse({ ...body, ...extra }).success, false);
  assert.ok(validation.mtmOperationSchema.safeParse({ ...body, kind: "return", original_issue_id: id(9) }).success);
});
check("minimum requires exact optimistic revision and text quantity", () => {
  for (const extra of [{ expected_revision: -1 }, { expected_revision: 0.5 }, { quantity: 1 }, { available: "1" }]) {
    assert.equal(validation.mtmMinimumSchema.safeParse({ companyId: company, warehouse_id: warehouse, product_id: product, quantity: "1", expected_revision: 0, ...extra }).success, false);
  }
});

class SessionAuthError extends Error { constructor(message: string, public status = 401) { super(message); } }
let actor = { id: actorId, role: "warehouse_operator", companyId: company, isImpersonating: false };
let profile = { id: actorId, role: actor.role, company_id: company, status: "active" };
let sessionError: Error | null = null;
let calls: Array<{ name: string; args: any }> = [];
let rpcData: any = null, rpcError: any = null;
const client = {
  from(name: string) {
    assert.equal(name, "profiles");
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: profile, error: null }) };
    return query;
  },
  async rpc(name: string, args: unknown) { calls.push({ name, args }); return { data: rpcData, error: rpcError }; },
};
const session = {
  SessionAuthError,
  getServerActorFromSession: async () => { if (sessionError) throw sessionError; return actor; },
  getUserScopedClientFromRequest: async () => client,
  resolveCompanyForActor: (_: unknown, requested: string | null) => requested || actor.companyId,
};
const acl = load("lib/auth/server-acl.ts", { "@/lib/auth/role-contract": roleContract, "@/lib/auth/server-session": session });
const base = load("app/api/mtm/_helpers.ts", { "next/server": { NextResponse }, "@/lib/auth/server-acl": acl,
  "@/lib/auth/server-session": session, "@/lib/mtm/validation": catalogValidation });
const helpers = load("app/api/mtm/_stock-helpers.ts", { "next/server": { NextResponse }, "@/lib/auth/server-acl": acl,
  "@/lib/auth/role-contract": roleContract, "@/lib/auth/server-session": session, "./_helpers": base, "@/lib/mtm/stock-validation": validation });
const deps = { "next/server": { NextResponse }, "../_stock-helpers": helpers, "../_helpers": base,
  "@/lib/mtm/validation": catalogValidation, "@/lib/mtm/stock-validation": validation, "@/lib/mtm/stock-types": types };
const stock = load("app/api/mtm/stock/route.ts", deps);
const operations = load("app/api/mtm/operations/route.ts", deps);
const options = load("app/api/mtm/stock-options/route.ts", deps);
const minimum = load("app/api/mtm/minimums/route.ts", deps);
const receipt = () => ({ ...body, company_id: company, id: key, inventory_transaction_id: id(21), ledger_entry_id: id(22) });
function reset(role = "warehouse_operator") {
  actor = { ...actor, role, isImpersonating: false };
  profile = { id: actorId, role, company_id: company, status: "active" };
  calls = []; sessionError = null; rpcError = null; rpcData = receipt();
}
const post = (payload: any = body, requestKey: string | null = key) => operations.POST(new NextRequest("http://localhost/api/mtm/operations", {
  method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json", ...(requestKey ? { "Idempotency-Key": requestKey } : {}) },
}));
const get = (handler: any, query = `companyId=${company}`) => handler.GET(new NextRequest(`http://localhost/api/mtm/test?${query}`));
const put = () => minimum.PUT(new NextRequest("http://localhost/api/mtm/minimums", {
  method: "PUT", body: JSON.stringify({ companyId: company, warehouse_id: warehouse, product_id: product, quantity: "0", expected_revision: 2 }),
}));
async function status(response: Response, expected: number) { assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); checks++; }

async function main() {
  reset(); sessionError = new SessionAuthError("Required"); await status(await post(), 401); assert.equal(calls.length, 0);
  reset(); profile.status = "inactive"; await status(await post(), 403); assert.equal(calls.length, 0);
  reset(); actor.isImpersonating = true; await status(await post(), 403); assert.equal(calls.length, 0);
  reset(); await status(await post({ ...body, companyId: foreign }), 403); assert.equal(calls.length, 0);
  for (const role of ["company_admin", "mechanic_operator", "fleet_manager", "agronomist", "director", "accountant"]) {
    reset(role); await status(await post(), 403); await status(await put(), 403); assert.equal(calls.length, 0);
    rpcData = { items: [], total: 0, can_write: true };
    const response = await get(stock); await status(response, 200); assert.equal((await response.json()).can_operate, false);
  }
  for (const role of ["warehouse", "warehouse_operator", "global_admin"]) { reset(role); await status(await post(), 200); }
  reset(); actor.role = "global_admin"; profile.role = "accountant"; await status(await post(), 403); assert.equal(calls.length, 0);
  reset(); for (const requestKey of [null, "not-uuid"]) await status(await post(body, requestKey), 400); assert.equal(calls.length, 0);
  reset(); await status(await post({ ...body, quantity: "1.0001" }), 400); await status(await post({ ...body, balance: "100" }), 400); assert.equal(calls.length, 0);
  reset(); await status(await post({ ...body, quantity: "2.000" }), 200); await status(await post({ ...body, quantity: "2.000" }), 200);
  assert.equal(calls.length, 2); assert.equal(calls[0].name, "mtm_post_operation_v1");
  assert.equal(calls[0].args.p_idempotency_key, key); assert.equal(calls[0].args.p_payload.quantity, "2");
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(calls[1])); assert.ok(!("companyId" in calls[0].args.p_payload));
  reset(); rpcData = null; await status(await post(), 500);
  reset(); rpcData = { ...receipt(), product_id: foreign }; await status(await post(), 500);
  reset(); rpcData = { ...receipt(), ledger_entry_id: "fake" }; await status(await post(), 500);
  reset(); rpcData = { ...receipt(), id: id(25) }; await status(await post(), 500);
  const failures: Array<[string, number]> = [["MTM_INSUFFICIENT_STOCK",409],["MTM_RETURN_EXCEEDED",409],["MTM_IDEMPOTENCY_CONFLICT",409],["MTM_REVISION_CONFLICT",409],["MTM_INVENTORY_LOCKED",409],["MTM_PRODUCT_UNAVAILABLE",409],["MTM_FORBIDDEN",403],["MTM_INVALID_QUANTITY",400],["unexpected private details",500]];
  for (const [message, code] of failures) { reset(); rpcError = { message }; await status(await post(), code); }
  reset(); rpcError = { code: "PGRST202", message: "secret internal detail" }; const missing = await post(); await status(missing, 503); assert.ok(!JSON.stringify(await missing.json()).includes("secret"));
  reset(); rpcData = { items: [], total: 0, can_write: true }; const response = await get(stock, `companyId=${company}&warehouseId=${warehouse}&belowMinimum=true&offset=10&limit=5`);
  await status(response,200); assert.equal((await response.json()).can_manage_minimums,true); assert.equal(calls[0].args.p_offset,10); assert.equal(calls[0].args.p_below_minimum,true);
  for (const query of [`companyId=${company}&warehouseId=bad`, `companyId=${company}&offset=-1`, `companyId=${company}&belowMinimum=maybe`]) { reset(); await status(await get(stock,query),400); assert.equal(calls.length,0); }
  reset(); rpcData = { items: [], total: 0 }; await status(await get(operations,`companyId=${company}&productId=${product}`),200); assert.equal(calls[0].args.p_product_id,product);
  reset(); rpcData = { items: [], total: 0 }; await status(await get(options,`companyId=${company}&kind=employee`),200); assert.equal(calls[0].args.p_kind,"employee");
  reset(); await status(await get(options,`companyId=${company}&kind=unknown`),400); assert.equal(calls.length,0);
  reset(); rpcData = { minimum_quantity:"0", minimum_revision:3 }; await status(await put(),200); assert.equal(calls[0].args.p_expected_revision,2);
  reset(); rpcData = {}; await status(await put(),500);
  console.info(`MTM stock domain/API PASS ${checks} checks; real handlers + ACL, fixture transport, no network`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
