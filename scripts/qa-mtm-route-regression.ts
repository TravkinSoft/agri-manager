import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { CANONICAL_ROLES } from "../lib/auth/role-contract";
import { canAccessPath, getDefaultPathForRole } from "../lib/auth/role-access";

// Compare all existing cabinets against the unchanged source revision. This
// checks that adding MTM has not silently expanded other PTC/warehouse rights.
const before = execFileSync("git", ["show", "HEAD:lib/auth/role-access.ts"], { encoding: "utf8" });
const exportsBefore: Record<string, any> = {};
vm.runInNewContext(ts.transpileModule(before, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsBefore });

const paths = new Set([
  ...Array.from(before.matchAll(/"(\/[a-zA-Z0-9_/-]*)"/g), (match) => match[1]),
  "/platform/catalogs", "/warehouses/manage", "/warehouses/requests", "/warehouses/transactions",
  "/weighbridge/dashboard", "/weighbridge/history", "/traffic-operator", "/traffic", "/fleet",
  "/api", "/unknown", "/mtm-extra", "/mtmish", "/mtm2",
  "/weighbridge/10000000-0000-4000-8000-000000000001/print",
]);
let comparisons = 0;
for (const role of CANONICAL_ROLES) {
  assert.equal(getDefaultPathForRole(role), exportsBefore.getDefaultPathForRole(role), `${role}: default cabinet changed`);
  for (const path of Array.from(paths)) {
    for (const variant of [path, `${path}/child`]) {
      assert.equal(canAccessPath(role, variant), exportsBefore.canAccessPath(role, variant), `${role}: existing access changed for ${variant}`);
      comparisons++;
    }
  }
}
const readers = new Set([
  "global_admin", "company_admin", "warehouse", "warehouse_operator", "mechanic_operator",
  "fleet_manager", "agronomist", "director", "accountant",
]);
for (const role of CANONICAL_ROLES) {
  assert.equal(canAccessPath(role, "/mtm"), readers.has(role), `${role}: MTM role boundary`);
}
console.info(`MTM route regression PASS: ${comparisons} existing-path comparisons, ${CANONICAL_ROLES.length} default cabinets and MTM role boundaries`);
