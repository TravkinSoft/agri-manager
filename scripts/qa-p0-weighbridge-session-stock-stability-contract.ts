import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260908123000_p0_weighbridge_session_and_stock_stability.sql";
const migration = readFileSync(resolve(root, migrationPath), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const viewStart = migration.indexOf("create or replace view public.v_harvest_lot_stock_v2");
const viewEnd = migration.indexOf("revoke all on table public.v_harvest_lot_stock_v2", viewStart);
const viewSql = migration.slice(viewStart, viewEnd);
const candidatesStart = viewSql.indexOf("resolution_candidates as materialized");
const candidatesEnd = viewSql.indexOf("), resolved_ledger as materialized", candidatesStart);
const candidateBranches = viewSql
  .slice(candidatesStart, candidatesEnd)
  .split(/\n\s*union all\s*\n/);

const unlockStart = migration.indexOf("create or replace function public.open_or_unlock_weighbridge_shift_v1");
const unlockEnd = migration.indexOf("$function$;", unlockStart) + "$function$;".length;
const unlockSql = migration.slice(unlockStart, unlockEnd);
const revokeStart = unlockSql.indexOf("update private.weighbridge_operator_sessions");
const revokeEnd = unlockSql.indexOf("v_token :=", revokeStart);
const revokeSql = unlockSql.slice(revokeStart, revokeEnd);

check("migration adds v2 without replacing or dropping v1", () => {
  assert.ok(viewStart >= 0);
  assert.doesNotMatch(migration, /(?:create or replace|drop) view public\.v_harvest_lot_stock_v1/);
});

check("v2 keeps caller RLS through security invoker", () => {
  assert.match(viewSql, /with \(security_invoker = true\)/);
});

check("v2 materializes ledger resolution once", () => {
  assert.match(viewSql, /ledger_base as materialized/);
  assert.match(viewSql, /resolution_candidates as materialized/);
  assert.match(viewSql, /resolved_ledger as materialized/);
  assert.match(viewSql, /ledger_by_batch as materialized/);
  assert.doesNotMatch(viewSql, /join lateral/);
});

check("v2 preserves direct, text UUID and ticket fallback precedence", () => {
  assert.equal(candidateBranches.length, 3);
  assert.match(candidateBranches[0], /0 as precedence/);
  assert.match(candidateBranches[0], /ib\.id = lb\.inventory_batch_id/);
  assert.match(candidateBranches[1], /\n\s*1,/);
  assert.match(candidateBranches[1], /ib\.id = lb\.batch_text_uuid/);
  assert.match(candidateBranches[2], /\n\s*2,/);
  assert.match(candidateBranches[2], /ib\.source_ticket_id = lb\.ticket_id/);
  assert.match(
    viewSql,
    /partition by ledger_entry_id[\s\S]*?order by precedence, resolved_batch_created_at, resolved_inventory_batch_id/,
  );
});

check("v2 preserves aggregate stock output contract", () => {
  for (const contract of [
    /hl\.company_id/,
    /hl\.id as harvest_lot_id/,
    /lbs\.warehouse_id/,
    /::integer as trip_count/,
    /::numeric\(18,3\) as current_weight_kg/,
    /as batch_class/,
    /as physical_state/,
  ]) {
    assert.match(viewSql, contract);
  }
});

check("v2 keeps canonical trip lineage precedence", () => {
  assert.match(
    viewSql,
    /hlb\.source_ticket_id,[\s\S]*?ib\.source_ticket_id,[\s\S]*?parent_link\.source_ticket_id,[\s\S]*?parent_batch\.source_ticket_id/,
  );
});

check("v2 is not exposed to public or anon", () => {
  assert.match(migration, /revoke all on table public\.v_harvest_lot_stock_v2 from public, anon;/);
});

check("v2 is readable by authenticated and service role", () => {
  assert.match(
    migration,
    /grant select on table public\.v_harvest_lot_stock_v2 to authenticated, service_role;/,
  );
});

check("unlock replaces only the intended function", () => {
  assert.ok(unlockStart >= 0);
  assert.doesNotMatch(migration, /create or replace function public\.handover_weighbridge_shift_v1/);
});

check("same shift and person sessions survive another unlock", () => {
  assert.match(revokeSql, /where company_id = p_company_id/);
  assert.match(revokeSql, /and status = 'active'/);
  assert.match(
    revokeSql,
    /and \(\s*shift_id is distinct from v_shift\.id\s*or person_id is distinct from p_person_id\s*\);/,
  );
  assert.doesNotMatch(revokeSql, /where company_id = p_company_id and status = 'active';/);
});

check("unlock still serializes shift mutation and creates a fresh token", () => {
  assert.match(unlockSql, /pg_advisory_xact_lock/);
  assert.match(unlockSql, /order by opened_at desc limit 1 for update/);
  assert.match(unlockSql, /insert into private\.weighbridge_operator_sessions/);
  assert.match(unlockSql, /extensions\.gen_random_bytes\(32\)/);
});

check("operator mismatch still requires the separate transfer flow", () => {
  assert.match(
    unlockSql,
    /v_shift\.operator_person_id <> p_person_id[\s\S]*?'handover_required'/,
  );
});

check("session revocation predicate models multi-browser preservation", () => {
  const companyId = "company-a";
  const shiftId = "shift-current";
  const personId = "person-current";
  const sessions = [
    { id: "same-browser-a", companyId, shiftId, personId, status: "active" },
    { id: "same-browser-b", companyId, shiftId, personId, status: "active" },
    { id: "old-shift", companyId, shiftId: "shift-old", personId, status: "active" },
    { id: "other-person", companyId, shiftId, personId: "person-other", status: "active" },
    { id: "already-expired", companyId, shiftId: "shift-old", personId, status: "expired" },
    { id: "other-company", companyId: "company-b", shiftId: "shift-old", personId, status: "active" },
  ];
  const revoked = sessions
    .filter((session) =>
      session.companyId === companyId
      && session.status === "active"
      && (session.shiftId !== shiftId || session.personId !== personId),
    )
    .map((session) => session.id);

  assert.deepEqual(revoked, ["old-shift", "other-person"]);
});

check("migration remains additive and reloads the API schema", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /notify pgrst, 'reload schema';/);
  assert.match(migration, /commit;\s*$/);
  assert.doesNotMatch(migration, /\btruncate\b|\bdrop table\b|\bdelete from\b/i);
});

assert.equal(passed, 14);
console.log(`P0 weighbridge session/stock source contract PASS: ${passed}/14`);
