import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { acknowledgeMtmPendingRequest, createMtmPendingRequest, forgetRejectedMtmRequest, mtmPendingStorageKey, persistMtmPendingRequest, readMtmPendingRequest } from "../lib/mtm/stock-client-state";
import type { MtmPendingRequest } from "../lib/mtm/stock-client-state";
import type * as StockService from "../lib/services/mtm-stock";
import { normalizeMtmQuantity } from "../lib/mtm/stock-validation";

const company = "10000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const productId = "40000000-0000-4000-8000-000000000001";
const warehouseId = "50000000-0000-4000-8000-000000000001";
const operationId = requestId;
const ledgerId = "70000000-0000-4000-8000-000000000001";
const transactionId = "80000000-0000-4000-8000-000000000001";
const payload = { companyId: company, kind: "issue", warehouse_id: warehouseId, product_id: productId, quantity: "2", uom: "pcs", purpose: "Перчатки для работ", recipient_id: null, asset_kind: null, asset_id: null, task_id: null, original_issue_id: null };
const operation = { ...payload, company_id: company, id: operationId, inventory_transaction_id: transactionId, ledger_entry_id: ledgerId, created_by: actor, created_at: "2026-10-27T12:00:00.000Z", remaining_returnable: "2" };
const storageKey = mtmPendingStorageKey(actor, company);
let passed = 0;
async function test(name: string, action: () => void | Promise<void>) { await action(); passed++; console.log(`PASS ${name}`); }
function storage() {
  const values = new Map<string, string>(); const calls: string[] = [];
  return { values, calls, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { calls.push(`set:${key}`); values.set(key, value); }, removeItem: (key: string) => { calls.push(`remove:${key}`); values.delete(key); } };
}

const requests: Array<{ url: string; init: RequestInit }> = [];
let sessionAvailable = true;
let reply: { status: number; body: unknown } = { status: 200, body: { operation } };
let transportError = false;
const exportsObject = {} as typeof StockService;
const compiled = ts.transpileModule(readFileSync("lib/services/mtm-stock.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(compiled, { exports: exportsObject, module: { exports: exportsObject }, Headers, URLSearchParams, DOMException,
  require: (id: string) => {
    if (id === "@/lib/mtm/stock-validation") return { normalizeMtmQuantity };
    assert.equal(id, "@/lib/supabase/client");
    return { supabase: { auth: { getSession: async () => ({ error: null, data: { session: sessionAvailable ? { access_token: "synthetic-test-token" } : null } }) } } };
  },
  fetch: async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (transportError) throw new Error("synthetic network loss");
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  },
});

async function run() {
  await test("request freezes exact bytes before a changed form can affect retry", () => {
    const draft = { ...payload };
    const pending = createMtmPendingRequest(draft, requestId);
    draft.quantity = "9";
    assert.equal(JSON.parse(pending.body).quantity, "2"); assert.equal(Object.isFrozen(pending), true);
  });
  await test("pending storage is scoped to actor and company", () => {
    assert.notEqual(storageKey, mtmPendingStorageKey(actor, "10000000-0000-4000-8000-000000000002"));
    assert.notEqual(storageKey, mtmPendingStorageKey("20000000-0000-4000-8000-000000000002", company));
  });
  const pending = createMtmPendingRequest(payload, requestId, "2026-10-27T12:00:00.000Z");
  await test("restored pending retains the original key/body with no request", () => {
    const store = storage(); persistMtmPendingRequest(store, storageKey, pending);
    assert.deepEqual(readMtmPendingRequest(store, storageKey, company), pending); assert.equal(requests.length, 0);
  });
  await test("corrupt or foreign-company pending fails closed without removal", () => {
    const store = storage(); store.setItem(storageKey, "not JSON");
    assert.throws(() => readMtmPendingRequest(store, storageKey, company)); assert.equal(store.getItem(storageKey), "not JSON");
    store.setItem(storageKey, JSON.stringify(pending)); assert.throws(() => readMtmPendingRequest(store, storageKey, "10000000-0000-4000-8000-000000000002"));
  });
  await test("another pending cannot be overwritten or cleared by this request", () => {
    const store = storage(); const other = createMtmPendingRequest(payload, "30000000-0000-4000-8000-000000000002");
    persistMtmPendingRequest(store, storageKey, other);
    assert.throws(() => persistMtmPendingRequest(store, storageKey, pending));
    assert.throws(() => acknowledgeMtmPendingRequest(store, storageKey, pending, operationId));
    assert.throws(() => forgetRejectedMtmRequest(store, storageKey, pending));
    assert.equal(store.getItem(storageKey), JSON.stringify(other));
  });
  await test("receipt is saved before removing a matching pending request", () => {
    const store = storage(); persistMtmPendingRequest(store, storageKey, pending); store.calls.length = 0;
    acknowledgeMtmPendingRequest(store, storageKey, pending, operationId);
    assert.deepEqual(store.calls, [`set:${storageKey}:receipt`, `remove:${storageKey}`]);
    assert.equal(store.getItem(storageKey), null); assert.equal(JSON.parse(store.getItem(`${storageKey}:receipt`)!).operationId, operationId);
  });
  await test("storage write failure prevents creation of a durable pending request", () => {
    const store = storage(); store.setItem = () => { throw new Error("storage unavailable"); };
    assert.throws(() => persistMtmPendingRequest(store, storageKey, pending)); assert.equal(requests.length, 0);
  });
  await test("network-loss retry uses identical bytes and Idempotency-Key", async () => {
    transportError = true; await assert.rejects(exportsObject.postMtmOperation(pending));
    transportError = false; const result = await exportsObject.postMtmOperation(pending); assert.equal(result.id, operationId);
    const last = requests.slice(-2); assert.equal(last[0].init.body, last[1].init.body);
    for (const call of last) { assert.equal(new Headers(call.init.headers).get("Idempotency-Key"), requestId); assert.equal(call.init.cache, "no-store"); assert.equal(call.url, "/api/mtm/operations"); }
  });
  await test("auth, unknown responses and idempotency conflicts cannot release pending", () => {
    for (const [status, code] of [[401, undefined], [403, "MTM_FORBIDDEN"], [404, undefined], [400, undefined], [409, "MTM_IDEMPOTENCY_CONFLICT"], [500, "MTM_STOCK_REQUEST_FAILED"], [503, "MTM_STOCK_SCHEMA_NOT_READY"]] as const) assert.equal(exportsObject.isConfirmedMtmRejection(new exportsObject.MtmStockApiError("test", status, code), true), false);
    assert.equal(exportsObject.isConfirmedMtmRejection(new exportsObject.MtmStockApiError("test", 409, "MTM_INSUFFICIENT_STOCK"), true), true);
    assert.equal(exportsObject.isConfirmedMtmRejection(new exportsObject.MtmStockApiError("test", 409, "MTM_INSUFFICIENT_STOCK"), false), false, "a failed retry cannot disprove an earlier commit");
  });
  await test("expired session makes no HTTP call", async () => {
    sessionAvailable = false; const before = requests.length;
    await assert.rejects(exportsObject.postMtmOperation(pending)); assert.equal(requests.length, before); sessionAvailable = true;
  });
  await test("unrelated or incomplete successful response is not a receipt", async () => {
    for (const altered of [{ ...operation, id: "60000000-0000-4000-8000-000000000001" }, { ...operation, company_id: "10000000-0000-4000-8000-000000000002" }, { ...operation, quantity: "3" }, { ...operation, ledger_entry_id: null }, { ...operation, recipient_id: actor }]) {
      reply = { status: 200, body: { operation: altered } }; await assert.rejects(exportsObject.postMtmOperation(pending));
    }
    reply = { status: 200, body: null }; await assert.rejects(exportsObject.postMtmOperation(pending));
    reply = { status: 200, body: { operation } };
  });
  await test("minimum success must confirm requested quantity and next revision", async () => {
    const body = { companyId: company, warehouse_id: warehouseId, product_id: productId, quantity: "4", expected_revision: 2 };
    reply = { status: 200, body: { minimum_quantity: "5", minimum_revision: 3 } }; await assert.rejects(exportsObject.saveMtmMinimum(body));
    reply = { status: 200, body: { minimum_quantity: "4", minimum_revision: 2 } }; await assert.rejects(exportsObject.saveMtmMinimum(body));
    reply = { status: 200, body: { minimum_quantity: "4", minimum_revision: 3 } }; assert.equal((await exportsObject.saveMtmMinimum(body)).minimum_revision, 3);
  });
  await test("picker query preserves search, tenant and pagination", async () => {
    reply = { status: 200, body: { items: [], total: 0, offset: 20, limit: 20 } };
    await exportsObject.getMtmStockOptions({ companyId: company, kind: "employee", search: "Иван + Пётр", offset: 20, limit: 20 });
    const call = requests[requests.length - 1]; const url = new URL(call.url, "http://synthetic.invalid");
    assert.equal(url.searchParams.get("companyId"), company); assert.equal(url.searchParams.get("offset"), "20"); assert.equal(url.searchParams.get("search"), "Иван + Пётр");
  });
  await test("all new UI files transpile without syntax diagnostics", () => {
    for (const file of ["app/(dashboard)/mtm/page.tsx", "components/mtm/mtm-workspace.tsx", "components/mtm/stock-workspace.tsx", "components/mtm/stock-operation-dialog.tsx", "components/mtm/stock-entity-picker.tsx", "lib/services/mtm-stock.ts", "lib/mtm/stock-client-state.ts"]) {
      const compiledFile = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
      assert.equal((compiledFile.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error).length, 0, file);
    }
  });
  console.log(`MTM stock UI/client: ${passed}/${passed} PASS; isolated mocks and syntax only, no browser/shared DB/network/hardware.`);
}
void run().catch((error) => { console.error(error); process.exitCode = 1; });
