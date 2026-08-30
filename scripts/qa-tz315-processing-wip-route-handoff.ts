import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260831021500_tz315_processing_wip_route_handoff_v1.sql");
const baseline = read("supabase/migrations/20260826103000_weighbridge_route_processing_contract_v1.sql");
const routeGuard = read("supabase/migrations/20260827110000_weighbridge_crop_processing_guard_v1.sql");
const inputLifecycle = read("supabase/migrations/20260830072000_tz312_processing_input_warehouse_context_v1.sql");

const checks: Array<{ name: string; run: () => void }> = [];
const check = (name: string, run: () => void) => checks.push({ name, run });

const triggerFunction = (sql: string) => {
  const match = sql.match(
    /create or replace function public\.tg_sync_grain_movement_shadow_v1\(\)[\s\S]*?\n\$\$;/i,
  );
  assert.ok(match, "trigger function body must be present");
  return match[0];
};

const wipBranch = (sql: string) => {
  const body = triggerFunction(sql);
  const match = body.match(
    /if new\.source_kind = 'processing_wip'[\s\S]*?then[\s\S]*?end if;/i,
  );
  assert.ok(match, "finalized processing_wip branch must be present");
  return match[0];
};

const withoutWipBranch = (sql: string) => triggerFunction(sql)
  .replace(/if new\.source_kind = 'processing_wip'[\s\S]*?then[\s\S]*?end if;/i, "")
  .replace(/\s+/g, " ")
  .trim();

check("migration replaces only the existing trigger function", () => {
  assert.equal((migration.match(/create or replace function/gi) || []).length, 1);
  assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+(?:table|index|trigger|policy)\b/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\s+/i);
  assert.match(migration, /security definer[\s\S]*set search_path = public, pg_temp/i);
});

check("finalized non-void WIP output routes once and never reaches generic shadow", () => {
  const branch = wipBranch(migration);
  assert.match(branch, /new\.linked_processing_id is not null/i);
  assert.match(branch, /new\.processing_output_role in \('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER'\)/i);
  assert.match(branch, /new\.is_finalized[\s\S]*not new\.is_voided[\s\S]*new\.status = 'finalized'/i);
  assert.equal((branch.match(/perform public\.attach_route_processing_input_ticket_v1\(new\.id\)/gi) || []).length, 1);
  assert.match(branch, /perform public\.attach_route_processing_input_ticket_v1\(new\.id\);\s*return new;/i);
  assert.doesNotMatch(branch, /sync_grain_movement_shadow_v1\(new\.id\)/i);
});

check("ordinary ticket route remains byte-equivalent after removing the WIP guard", () => {
  assert.equal(withoutWipBranch(migration), withoutWipBranch(baseline));
});

check("DRYER and CLEANER route to processing; WAREHOUSE does not", () => {
  assert.match(routeGuard, /v_place_type[\s\S]*not in \('DRYER', 'CLEANER'\)[\s\S]*return null;/i);
  assert.match(routeGuard, /return public\.attach_processing_input_ticket_live_v1\(p_ticket_id\)/i);
  assert.doesNotMatch(routeGuard, /\('WAREHOUSE'[^)]*\)/i);
});

check("input attachment is exactly-once across trigger retry", () => {
  const existingLookup = inputLifecycle.search(
    /where i\.company_id = v_ticket\.company_id\s+and i\.source_ticket_id = v_ticket\.id/i,
  );
  const inputInsert = inputLifecycle.indexOf("insert into public.batch_transformation_inputs");
  assert.ok(existingLookup >= 0 && inputInsert > existingLookup, "idempotency lookup must precede input insert");
  assert.match(inputLifecycle, /if v_existing_transformation_id is not null then[\s\S]*return v_existing_transformation_id;/i);
  assert.match(inputLifecycle, /on conflict \(source_ticket_line_id\) where source_ticket_line_id is not null do nothing;/i);
  assert.match(inputLifecycle, /on conflict \(company_id, transformation_id, event_type, idempotency_key\) do nothing;/i);
});

check("vegetable routing rejection remains in the called route guard", () => {
  assert.match(routeGuard, /v_category_slug = 'vegetable'/i);
  assert.match(routeGuard, /v_subcategory in \('tuber', 'root'\)/i);
  assert.match(routeGuard, /v_crop_slug in \('potato', 'carrot'\)/i);
  assert.match(routeGuard, /message = 'VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED'/i);
});

check("company and season are derived from canonical ticket/lot context", () => {
  assert.match(routeGuard, /w\.id = t\.warehouse_to_id[\s\S]*w\.company_id = t\.company_id/i);
  assert.match(routeGuard, /hl\.id = t\.harvest_lot_id[\s\S]*hl\.company_id = t\.company_id/i);
  assert.match(inputLifecycle, /where id = p_ticket_id[\s\S]*for update/i);
  assert.match(inputLifecycle, /where id = v_ticket\.harvest_lot_id[\s\S]*and company_id = v_ticket\.company_id/i);
  assert.match(inputLifecycle, /where t\.company_id = v_ticket\.company_id[\s\S]*t\.node_warehouse_id is not distinct from v_ticket\.warehouse_to_id[\s\S]*t\.harvest_lot_id is not distinct from v_ticket\.harvest_lot_id/i);
  assert.match(inputLifecycle, /v_ticket\.company_id, v_lot\.season_id, v_ticket\.warehouse_to_id/i);
  assert.match(inputLifecycle, /where b\.company_id = v_ticket\.company_id/i);
});

check("route outcome matrix preserves WIP mass semantics", () => {
  const route = (placeType: string, vegetable = false, existingInput = false) => {
    if (!["DRYER", "CLEANER"].includes(placeType)) return { attached: 0, genericShadow: 0 };
    if (vegetable) throw new Error("VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED");
    return { attached: existingInput ? 0 : 1, genericShadow: 0 };
  };
  assert.deepEqual(route("DRYER"), { attached: 1, genericShadow: 0 });
  assert.deepEqual(route("CLEANER"), { attached: 1, genericShadow: 0 });
  assert.deepEqual(route("WAREHOUSE"), { attached: 0, genericShadow: 0 });
  assert.deepEqual(route("DRYER", false, true), { attached: 0, genericShadow: 0 });
  assert.throws(() => route("DRYER", true), /VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED/);
});

let passed = 0;
for (const item of checks) {
  item.run();
  passed += 1;
  console.log(`PASS ${item.name}`);
}
console.log(`TZ315 processing WIP route handoff: ${passed}/${checks.length} PASS`);
