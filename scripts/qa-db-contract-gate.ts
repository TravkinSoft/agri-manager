import assert from "node:assert/strict";
import { compareContracts, type ContractSnapshot, type MigrationFact, type RequiredObject } from "./audit/db-contract-core";

const column = (dataType = "numeric(18,6)") => ({ dataType, nullable: true, defaultExpr: "", identity: "", generated: "", enumType: null });
const table = (columns: Record<string, ReturnType<typeof column>> = {}) => ({ rlsEnabled: true, columns, indexes: {}, foreignKeys: {}, checks: {}, policies: {} });
const fn = (definitionHash = "same") => ({ returnType: "void", securityDefiner: true, searchPath: "search_path=public,pg_temp", definitionHash, grants: "authenticated=X/owner" });
const snapshot = (): ContractSnapshot => ({
  projectRef: "test", capturedAt: "2026-08-19T00:00:00Z",
  tables: { "public.ticket_lines": table({ mass_kg: column() }) },
  functions: { "public.finalize_ticket(uuid)": fn() }, triggers: {}, views: {}, enums: {},
  migrations: [{ version: "1", name: "tz271_restore_weighbridge_unit_contract_columns" }],
});
const required: RequiredObject[] = [
  { kind: "table", key: "public.ticket_lines" },
  { kind: "column", key: "public.ticket_lines.mass_kg", dataType: "numeric(18,6)" },
  { kind: "function", key: "public.finalize_ticket(uuid)" },
];
const facts: MigrationFact[] = [{ migrationName: "tz271_restore_weighbridge_unit_contract_columns", requiredObjects: [required[1]] }];
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks += 1; console.log(`PASS ${checks} ${name}`); };
const compare = (qa = snapshot(), production = snapshot()) => compareContracts({ qa, production, requiredObjects: required, migrationFacts: facts });

check("identical schema passes", () => assert.equal(compare().ok, true));
check("missing column fails", () => { const qa = snapshot(); delete qa.tables["public.ticket_lines"].columns.mass_kg; assert.equal(compare(qa).ok, false); });
check("wrong uuid/text type fails", () => { const qa = snapshot(); qa.tables["public.ticket_lines"].columns.mass_kg = column("text"); assert.equal(compare(qa).ok, false); });
check("missing function fails", () => { const qa = snapshot(); delete qa.functions["public.finalize_ticket(uuid)"]; assert.equal(compare(qa).ok, false); });
check("different function hash fails", () => { const qa = snapshot(); qa.functions["public.finalize_ticket(uuid)"] = fn("changed"); assert.equal(compare(qa).ok, false); });
check("migration history without required object fails", () => { const qa = snapshot(); delete qa.tables["public.ticket_lines"].columns.mass_kg; const result = compare(qa); assert.ok(result.findings.some((finding) => finding.code === "MIGRATION_HISTORY_OBJECT_MISSING")); });
check("extra safe QA column is warning", () => { const qa = snapshot(); qa.tables["public.ticket_lines"].columns.safe_note = column("text"); const result = compare(qa); assert.equal(result.ok, true); assert.ok(result.warnings > 0); });
assert.equal(checks, 7);
console.log(`DB contract gate regression PASS: ${checks}/7`);
