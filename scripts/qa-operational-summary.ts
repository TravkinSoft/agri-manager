import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { presenceState, presenceLabel, summaryShiftLabel, PRESENCE_TTL_MS, impurityPercent, summaryKg } from "../lib/dashboard/operational-summary";
const now = Date.parse("2026-09-22T08:00:00Z");
assert.equal(presenceState(new Date(now - 30_000).toISOString(), now), "online");
assert.equal(presenceState(new Date(now - PRESENCE_TTL_MS - 1).toISOString(), now), "offline");
assert.equal(presenceState(null, now), "unknown");
assert.equal(presenceState("invalid", now), "unknown");
assert.equal(presenceState(new Date(now + 60_000).toISOString(), now), "unknown");
assert.equal(presenceState(new Date(now).toISOString(), now, false), "unknown");
assert.equal(impurityPercent(100000, 20000), 20);
assert.equal(impurityPercent(0, 1000), null);
assert.equal(impurityPercent(1000, null), null);
assert.equal(summaryKg(null), "Нет данных");
assert.match(summaryKg(0), /^0 кг$/);
assert.match(summaryKg(825730).replace(/\s/g, ""), /^825730кг$/);
const openShift = { id: "shift", status: "open", openedAt: "2026-09-22T07:00:00Z", closedAt: null };
assert.equal(summaryShiftLabel(openShift, true), "Смена открыта");
assert.equal(summaryShiftLabel({ ...openShift, closedAt: "2026-09-22T08:00:00Z" }, true), "Смена закрыта");
assert.equal(summaryShiftLabel(null, true), "Смена не открыта");
assert.equal(summaryShiftLabel(undefined, true), "Проверяем смену");
assert.equal(summaryShiftLabel(openShift, false), "Проверяем смену");
assert.equal(presenceLabel("online"), "Онлайн");
assert.equal(presenceLabel("offline"), "Нет сигнала");
assert.equal(presenceLabel("unknown"), "Ждём сигнал");

async function main() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.companies(id uuid primary key); create table public.profiles(id uuid primary key);`);
  await db.exec(readFileSync("supabase/migrations/20260922082059_dashboard_operator_presence_v1.sql", "utf8"));
  const rights = await db.query<{ role: string; can_read: boolean; can_write: boolean }>(`select r as role,
    has_table_privilege(r,'public.dashboard_operator_presence','SELECT') as can_read,
    has_table_privilege(r,'public.dashboard_operator_presence','INSERT') as can_write
    from unnest(array['anon','authenticated','service_role']) r`);
  assert.equal(rights.rows[0].can_read, false); assert.equal(rights.rows[0].can_write, false);
  assert.equal(rights.rows[1].can_read, false); assert.equal(rights.rows[1].can_write, false);
  assert.equal(rights.rows[2].can_read, true); assert.equal(rights.rows[2].can_write, true);
  const rls = await db.query<{ enabled: boolean }>(`select relrowsecurity as enabled from pg_class where oid='public.dashboard_operator_presence'::regclass`);
  assert.equal(rls.rows[0].enabled, true);
  const c = "10000000-0000-0000-0000-000000000001", p = "20000000-0000-0000-0000-000000000001";
  await db.exec(`insert into companies values('${c}'); insert into profiles values('${p}'); set role service_role;
    insert into dashboard_operator_presence(company_id,profile_id,workspace) values('${c}','${p}','weighbridge');
    insert into dashboard_operator_presence(company_id,profile_id,workspace) values('${c}','${p}','weighbridge')
    on conflict(company_id,profile_id,workspace) do update set last_seen_at=now(); reset role;`);
  assert.equal((await db.query<{ count: number }>("select count(*)::int as count from dashboard_operator_presence")).rows[0].count, 1);
  await assert.rejects(db.exec(`insert into dashboard_operator_presence(company_id,profile_id,workspace) values('${c}','${p}','traffic')`));
  await db.close();
  console.log("PASS 29 presence, independent shift status, exact-weight, percent and DB-isolation checks");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
