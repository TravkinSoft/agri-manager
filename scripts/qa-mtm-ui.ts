import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { canAccessPath, getDefaultPathForRole } from "../lib/auth/role-access";
import { CANONICAL_ROLES } from "../lib/auth/role-contract";
import { normalizeScan, RequestEpoch, resolveScan, shouldOpenCatalogItem } from "../lib/mtm/scan";

let passed = 0;
function test(name: string, action: () => void) { action(); passed++; console.log(`PASS ${name}`); }

test("scan preserves leading zeros and full alphanumeric code", () => {
  assert.equal(normalizeScan("001234500\r\n"), "001234500");
  assert.equal(normalizeScan(" 00-AB/19 "), "00-AB/19");
});
test("scan refuses empty, control characters and overlong input", () => {
  for (const value of ["", "  ", "001\n002", "01\t02", "1".repeat(129)]) assert.throws(() => normalizeScan(value));
});
const item = { product_id: "part-a", barcode: "00123" };
test("exact lookup cannot turn 00123 into 123", () => {
  assert.equal(resolveScan("00123", [item], null).status, "found");
  assert.deepEqual(resolveScan("123", [item], null), { status: "unknown", item: null });
});
test("repeat scan returns same selection without mutating item", () => {
  const frozen = Object.freeze({ ...item });
  const result = resolveScan("00123", [frozen], frozen.product_id);
  assert.equal(result.status, "repeated"); assert.strictEqual(result.item, frozen);
  assert.deepEqual(Object.keys(result).sort(), ["item", "status"]);
});
test("unknown and ambiguous scans never select an arbitrary item", () => {
  assert.deepEqual(resolveScan("00123", [], "part-old"), { status: "unknown", item: null });
  assert.deepEqual(resolveScan("00123", [item, { ...item, product_id: "part-b" }], null), { status: "ambiguous", item: null });
});
test("late scan response is ignored after newer scan and company unmount", () => {
  const requests = new RequestEpoch();
  const first = requests.next(); const second = requests.next();
  assert.equal(requests.isCurrent(first), false); assert.equal(requests.isCurrent(second), true);
  requests.invalidate(); assert.equal(requests.isCurrent(second), false);
});
test("only an explicit newer card selection can replace the current revision", () => {
  const current = { product_id: "a", revision: 2 };
  assert.equal(shouldOpenCatalogItem(current, { ...current, revision: 3 }), false, "scan must not overwrite draft");
  assert.equal(shouldOpenCatalogItem(current, { ...current, revision: 3 }, true), true, "explicit reload after conflict");
  assert.equal(shouldOpenCatalogItem(current, { ...current, revision: 1 }, true), false, "never regress revision");
  assert.equal(shouldOpenCatalogItem(current, current, true), false);
  assert.equal(shouldOpenCatalogItem(current, { product_id: "b", revision: 1 }), true);
});
const allowed = new Set(["global_admin", "company_admin", "warehouse", "warehouse_operator", "mechanic_operator", "fleet_manager", "agronomist", "director", "accountant"]);
test("MTM route allows exactly agreed roles", () => {
  for (const role of CANONICAL_ROLES) assert.equal(canAccessPath(role, "/mtm"), allowed.has(role), role);
  assert.equal(canAccessPath(null, "/mtm"), false); assert.equal(canAccessPath(undefined, "/mtm"), false);
});

// Compare actual behavior of the unmodified base, rather than a guessed legacy policy.
const baselineSource = execFileSync("git", ["show", "HEAD:lib/auth/role-access.ts"], { encoding: "utf8" });
const baselineModule = { exports: {} as { canAccessPath: typeof canAccessPath; getDefaultPathForRole: typeof getDefaultPathForRole } };
const compiled = ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(compiled, { exports: baselineModule.exports, module: baselineModule });
test("all prior cabinet permissions and default routes remain unchanged", () => {
  const paths = ["/", "/dashboard", "/traffic", "/traffic-operator", "/fleet", "/auth", "/auth/reset-password", "/fields", "/fields-map", "/crop-structure", "/warehouses", "/warehouses/manage", "/warehouses/requests", "/weighbridge", "/weighbridge/dashboard", "/weighbridge/history", "/operations", "/tasks", "/inventory", "/ledger", "/settings", "/platform", "/references", "/notifications", "/fuel", "/technique"];
  for (const role of [...CANONICAL_ROLES, null]) {
    for (const path of paths) assert.equal(canAccessPath(role, path), baselineModule.exports.canAccessPath(role, path), `${role}:${path}`);
    assert.equal(getDefaultPathForRole(role), baselineModule.exports.getDefaultPathForRole(role), `${role}:default`);
  }
});
test("new UI files transpile without syntax diagnostics", () => {
  for (const file of ["app/(dashboard)/mtm/page.tsx", "components/mtm/catalog-workspace.tsx", "components/mtm/item-editor.tsx", "components/mtm/option-picker.tsx", "lib/services/mtm.ts"]) {
    const result = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
    assert.equal((result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error).length, 0, file);
  }
});
console.log(`MTM UI: ${passed}/${passed} PASS; no browser, hardware, shared DB or network used.`);
