import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260902221052_tz315_impurity_place_type_source_corrective_v1.sql",
  "utf8",
);

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

check("patches the exact canonical impurity finalize RPC", () => {
  assert.match(migration, /finalize_weighbridge_impurity_ticket_for_session_v1\(uuid\)/);
  assert.match(migration, /TZ315_IMPURITY_PLACE_TYPE_SOURCE_V1/);
});

check("accepts every canonical place_type", () => {
  for (const placeType of ["WAREHOUSE", "YARD", "DRYER", "CLEANER"]) {
    assert.match(migration, new RegExp(`'${placeType}'`));
  }
});

check("retains the legacy warehouse_type fallback", () => {
  assert.match(migration, /warehouse_type/);
  assert.match(migration, /grain_storage/);
  assert.match(migration, /elevator/);
});

check("fails closed if the concurrency gate or patch anchor drifts", () => {
  assert.match(migration, /TZ315_UNIVERSAL_PROCESSING_GATE_V1/);
  assert.match(migration, /TZ315_IMPURITY_PROCESSING_GATE_MISSING/);
  assert.match(migration, /TZ315_IMPURITY_SOURCE_VALIDATION_ANCHOR_COUNT/);
});

check("preserves SECURITY DEFINER owner search_path and execute ACL", () => {
  assert.match(migration, /v_owner is distinct from 'postgres'/);
  assert.match(migration, /v_security_definer is distinct from true/);
  assert.match(migration, /search_path=pg_catalog, public/);
  assert.match(migration, /has_function_privilege\('anon'/);
  assert.match(migration, /has_function_privilege\('authenticated'/);
  assert.match(migration, /has_function_privilege\('service_role'/);
  assert.match(migration, /aclexplode/);
  assert.match(migration, /acl\.grantee = 0/);
});

check("contains no business-row or crop-structure writes", () => {
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+)\b/i);
  assert.doesNotMatch(migration, /crop_structure|\bfields\b|seed_reproductions/i);
});

console.log(`TZ315 impurity place_type source ${passed}/${passed} PASS`);
