import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(resolve("app/api/crop-structure/fields/[id]/route.ts"), "utf8");
const migrationSource = readFileSync(
  resolve("supabase/migrations/20260915104822_p0_crop_structure_history_safe_save.sql"),
  "utf8"
);

const checks: Array<[string, () => void]> = [
  ["API uses the history-safe save RPC", () => {
    assert.match(routeSource, /rpc\("save_crop_structure_field_v6"/);
  }],
  ["omitted active rows are archived before the validated save", () => {
    const archiveAt = migrationSource.indexOf("update public.crop_structure as cs");
    const saveAt = migrationSource.indexOf("public.save_crop_structure_field_v5(");
    assert.ok(archiveAt >= 0);
    assert.ok(saveAt > archiveAt);
    assert.match(migrationSource, /set archived = true/);
    assert.match(migrationSource, /not exists \([\s\S]*jsonb_array_elements\(p_rows\)/);
  }],
  ["the migration never deletes crop structure history", () => {
    assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.crop_structure\b/i);
    assert.doesNotMatch(migrationSource, /update\s+public\.tickets\b/i);
    assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.tickets\b/i);
  }],
  ["authorization is checked before the archive update", () => {
    const authAt = migrationSource.indexOf("public.assert_operation_mutation_actor_v1");
    const archiveAt = migrationSource.indexOf("update public.crop_structure as cs");
    assert.ok(authAt >= 0);
    assert.ok(archiveAt > authAt);
  }],
  ["the wrapper keeps the existing server validation atomic", () => {
    assert.match(migrationSource, /v_result := public\.save_crop_structure_field_v5\(/);
    assert.match(migrationSource, /return v_result;/);
  }],
  ["the RPC is not executable by anonymous users", () => {
    assert.match(migrationSource, /revoke all on function public\.save_crop_structure_field_v6[\s\S]*from public, anon;/);
    assert.match(migrationSource, /grant execute on function public\.save_crop_structure_field_v6[\s\S]*to authenticated, service_role;/);
  }],
  ["the raw ticket foreign-key error is translated", () => {
    assert.match(routeSource, /tickets_crop_structure_allocation_id_fkey/);
    assert.match(routeSource, /Старые талоны связаны с этим участком/);
  }],
];

for (const [name, run] of checks) {
  run();
  console.log(`PASS ${name}`);
}

console.log(`Crop structure history-safe save: ${checks.length}/${checks.length} PASS`);
