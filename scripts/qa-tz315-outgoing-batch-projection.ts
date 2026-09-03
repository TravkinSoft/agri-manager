import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260903093624_tz315_outgoing_batch_projection_reconcile_v1.sql",
  "utf8",
);

let passed = 0;
const check = (name: string, run: () => void) => {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
};

check("fails closed when the physical finalize body drifts", () => {
  assert.match(migration, /md5\(v_proc\.prosrc\) <> 'f1cccf47f239fb9cc19001f66fd5c9bd'/);
  assert.match(migration, /outgoing projection function drift/);
});

check("reconciles only after outgoing finalization", () => {
  assert.match(migration, /if v_ticket\.direction::text = ''outgoing'' then/);
  assert.doesNotMatch(migration, /v_ticket\.direction::text <> ''outgoing''/);
});

check("uses the canonical inventory batch trace written by the ledger trigger", () => {
  assert.match(migration, /sle\.ticket_id = v_ticket\.id/);
  assert.match(migration, /sle\.inventory_batch_id is not null/);
  assert.match(migration, /select distinct sle\.inventory_batch_id/);
});

check("uses the correct local and harvest-lot reconciliation contracts", () => {
  assert.match(migration, /private\.reconcile_harvest_lot_batch_balance_v1\(v_reconcile_batch_id\)/);
  assert.match(migration, /private\.reconcile_warehouse_local_batch_balance_v1\(v_reconcile_batch_id\)/);
  assert.match(migration, /public\.harvest_lot_batches hlb/);
  assert.match(migration, /hlb\.company_id = v_ticket\.company_id/);
});

check("preserves function owner security configuration and ACL", () => {
  assert.match(migration, /v_proc\.proowner is distinct from v_before_owner/);
  assert.match(migration, /v_proc\.prosecdef is distinct from v_before_security/);
  assert.match(migration, /v_proc\.proconfig is distinct from v_before_config/);
  assert.match(migration, /v_proc\.proacl is distinct from v_before_acl/);
});

check("contains no business-data backfill or destructive DML", () => {
  assert.doesNotMatch(migration, /delete\s+from|truncate\s+|update\s+public\.inventory_batches|insert\s+into\s+public\./i);
});

check("is repeat-safe through a unique body marker", () => {
  assert.match(migration, /TZ315_OUTGOING_BATCH_PROJECTION_RECONCILE_V1/);
  assert.match(migration, /pg_catalog\.strpos\(v_definition, 'TZ315_OUTGOING_BATCH_PROJECTION_RECONCILE_V1'\) = 0/);
  assert.match(migration, /pg_catalog\.replace\(v_definition, 'TZ315_OUTGOING_BATCH_PROJECTION_RECONCILE_V1', ''\)/);
});

console.log(`TZ315 outgoing batch projection ${passed}/${passed} PASS`);
