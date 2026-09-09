import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";

const file = "app/(dashboard)/weighbridge/dashboard/page.tsx";
const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const before = execFileSync("git", ["show", `a7dc858:${file}`], { encoding: "utf8" }).replace(/\r\n/g, "\n");
const guard = "  if (authLoading || isOperationalRole) return null;\n\n";
assert.equal(source, before.replace(guard, "").replace("  }, [tickets]);\n\n", `  }, [tickets]);\n\n${guard}`),
  "Only relocate the early render return; ticket reads, formulas and output remain identical");

let auth = { loading: true, profile: { role: "company_admin", company_id: "qa", id: "qa-user" } };
let calls: string[] = [];
let externalReads = 0;
const fakeReact = {
  useState: (value: unknown) => { calls.push("useState"); return [value, () => {}]; },
  useEffect: () => { calls.push("useEffect"); },
  useMemo: (compute: () => unknown) => { calls.push("useMemo"); return compute(); },
};
const exports: Record<string, any> = {};
const requireMock = (name: string) => {
  if (name === "react") return fakeReact;
  if (name === "react/jsx-runtime") return { jsx: () => ({}), jsxs: () => ({}) };
  if (name === "@/lib/contexts/auth-context") return { useAuth: () => auth };
  if (name === "next/navigation") return { useRouter: () => ({ replace: () => {} }) };
  if (name === "@/lib/services/weighbridge") return { listTickets: () => { externalReads++; throw new Error("No database calls in hook test"); } };
  if (name === "@/lib/dates/date-only") return { todayDateOnlyLocal: () => "2026-09-10" };
  return new Proxy({}, { get: () => () => null });
};
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(compiled, { exports, require: requireMock }, { filename: file });
const sequence: string[][] = [];
for (const [loading, role] of [[true, "company_admin"], [false, "company_admin"], [false, "weighman"], [true, "weighman"], [false, "agronomist"]] as const) {
  auth = { ...auth, loading, profile: { ...auth.profile, role } };
  calls = [];
  const result = exports.default();
  sequence.push([...calls]);
  if (loading || role === "weighman") assert.equal(result, null, "Existing loading/role redirect stays hidden");
  else assert.notEqual(result, null, "Observer dashboard renders after auth");
}
for (const current of sequence) assert.deepEqual(current, ["useState", "useState", "useEffect", "useEffect", "useMemo"]);
assert.equal(externalReads, 0);
console.log("Weighbridge Dashboard hooks: five auth/role renders keep exact hook order; read/formula contract unchanged PASS");
