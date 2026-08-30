import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const historical = read(
  "supabase/migrations/20260829200243_warehouse_admin_server_only_dml_v1.sql",
);
const corrective = read(
  "supabase/migrations/20260830125129_warehouse_admin_active_harvest_guard_corrective_v1.sql",
);
const archiveCorrective = read(
  "supabase/migrations/20260830130442_warehouse_admin_archive_guard_canonical_v2.sql",
);
const archiveBlock = archiveCorrective.slice(
  archiveCorrective.indexOf("if v_archive_started then"),
  archiveCorrective.indexOf("return new;"),
);
const typeChangeBlock = archiveCorrective.slice(
  archiveCorrective.indexOf("if v_type_changed and ("),
  archiveCorrective.indexOf("if v_archive_started then"),
);

assert.match(
  historical,
  /create trigger active_harvests_warehouse_guard_v1 before insert or update of warehouse_id\s+on public\.weighbridge_active_harvests\s+for each row execute function public\.guard_active_warehouse_reference_v1\('warehouse_id'\);/,
);

assert.doesNotMatch(corrective, /\b(?:revoke|grant|drop policy|create policy)\b/i);
assert.doesNotMatch(corrective, /create\s+(?:or\s+replace\s+)?function/i);
assert.doesNotMatch(corrective, /drop\s+trigger/i);

assert.match(corrective, /if not found then[\s\S]*?create trigger active_harvests_warehouse_guard_v1/);
assert.match(
  corrective,
  /execute function public\.guard_active_warehouse_reference_v1\('warehouse_id'\)/,
);

for (const invariant of [
  "v_trigger.tgfoid <> v_guard_function",
  "v_trigger.tgenabled <> 'O'",
  "v_trigger.tgtype <> v_expected_tgtype",
  "v_trigger.tgattr_text <> v_warehouse_attnum::text",
  "v_trigger.tgnargs <> 1",
  "v_trigger.tgargs_hex <> v_expected_args_hex",
]) {
  assert.ok(corrective.includes(invariant), invariant);
}

assert.match(corrective, /errcode = '55000'/);
assert.match(corrective, /do not replace this trigger silently/i);
assert.match(corrective, /^begin;[\s\S]*commit;\s*$/);

assert.doesNotMatch(archiveCorrective, /\b(?:revoke|grant|drop policy|create policy|drop trigger)\b/i);
assert.match(
  archiveCorrective,
  /if to_regprocedure\('public\.guard_warehouse_lifecycle_v1\(\)'\) is null/,
);
assert.match(archiveCorrective, /create or replace function public\.guard_warehouse_lifecycle_v1\(\)/);
assert.match(typeChangeBlock, /from public\.inventory_batches/);
assert.match(typeChangeBlock, /from public\.processing_nodes/);
assert.match(archiveBlock, /from public\.v_stock_balance_canonical/);
assert.doesNotMatch(archiveBlock, /from public\.inventory_batches/);
assert.doesNotMatch(archiveBlock, /from public\.processing_nodes/);
assert.match(archiveBlock, /from public\.batch_transformations/);
assert.match(archiveBlock, /from public\.processing_documents/);
assert.match(archiveCorrective, /^begin;[\s\S]*commit;\s*$/);

console.log("WAREHOUSE ADMIN CORRECTIVE REGRESSION PASS");
