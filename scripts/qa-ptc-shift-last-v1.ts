import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { calculateTrafficAnalytics } from "../lib/traffic/analytics";

let checks = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
const rejects = async (call: () => Promise<unknown>, code: string) => {
  await assert.rejects(call, new RegExp(code));
  checks++;
};

async function main() {
  const shift = {
    id: randomUUID(), operatorName: "Комбайнёр", openedAt: "2026-09-07T08:00:00Z",
    closedAt: null, hectaresShift: null, hectaresFieldTotal: null, status: "open" as const,
  };
  const events = [
    ["car", "empty", "loaded", 1, "2026-09-07T08:00:00Z"],
    ["car", "loaded", "unloading", 1, "2026-09-07T08:05:00Z"],
    ["car", "unloading", "empty", 1, "2026-09-07T08:08:00Z"],
    ["car", "empty", "loaded", 2, "2026-09-07T08:10:00Z"],
    ["car", "loaded", "unloading", 2, "2026-09-07T08:16:00Z"],
    ["car", "unloading", "empty", 2, "2026-09-07T08:20:00Z"],
    ["car", "empty", "loaded", 3, "2026-09-07T08:40:00Z"],
  ].map(([vehicle_id, from_state, to_state, cycle, created_at]) => ({
    vehicle_id: String(vehicle_id), from_state: from_state as "empty" | "loaded" | "unloading",
    to_state: to_state as "empty" | "loaded" | "unloading", cycle: Number(cycle), created_at: String(created_at),
  }));
  const analytics = calculateTrafficAnalytics(events, "2026-09-07T08:50:00Z", shift, 2);
  equal(analytics.completedLoads, 3);
  equal(analytics.lastLoadIntervalMinutes, 30);
  equal(analytics.averageLoadIntervalMinutes, 20);
  equal(analytics.averageFieldToWeighbridgeMinutes, 6);
  equal(analytics.averageUnloadingMinutes, 4);
  equal(analytics.averageReturnToLoadMinutes, 11);
  equal(analytics.averageVehicleCycleMinutes, 20);
  equal(analytics.latestFleetRoundMinutes, 40);
  equal(analytics.probableDowntimeCount, 1);
  equal(analytics.probableDowntimeMinutes, 15);
  equal(analytics.currentProbableDowntimeMinutes, null);
  const activeIdle = calculateTrafficAnalytics(events, "2026-09-07T09:10:00Z", shift);
  equal(activeIdle.currentProbableDowntimeMinutes, 15);
  equal(activeIdle.probableDowntimeCount, 2);
  equal(activeIdle.probableDowntimeMinutes, 30);
  const emptyShiftIdle = calculateTrafficAnalytics([], "2026-09-07T08:16:00Z", shift);
  equal(emptyShiftIdle.completedLoads, 0);
  equal(emptyShiftIdle.currentProbableDowntimeMinutes, 1);
  equal(emptyShiftIdle.probableDowntimeCount, 1);
  equal(emptyShiftIdle.probableDowntimeMinutes, 1);
  const emptyShiftBeforeWholeMinute = calculateTrafficAnalytics([], "2026-09-07T08:15:59.999Z", shift);
  equal(emptyShiftBeforeWholeMinute.currentProbableDowntimeMinutes, null);
  equal(emptyShiftBeforeWholeMinute.probableDowntimeCount, 0);
  equal(emptyShiftBeforeWholeMinute.probableDowntimeMinutes, 0);
  const firstLoadOnly = calculateTrafficAnalytics(events.slice(0, 1), "2026-09-07T08:10:00Z", shift);
  equal(firstLoadOnly.completedLoads, 1);
  equal(firstLoadOnly.lastLoadIntervalMinutes, null);
  equal(firstLoadOnly.currentProbableDowntimeMinutes, null);

  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid,role text,status text,full_name text);
    create table fields(id uuid primary key,company_id uuid,archived boolean);
    create table reference_vehicles(id uuid primary key,company_id uuid,is_active boolean,archived boolean,status text default 'in_trip');
    create table company_people(id uuid primary key,company_id uuid,user_id uuid,full_name text,status text,deleted_at timestamptz);
    grant select on all tables in schema public to service_role;
    grant update on profiles,company_people,reference_vehicles to service_role;`);
  for (const file of [
    "20260904103550_ptc_independent_machine_turnover_v1.sql",
    "20260904112119_ptc_unified_account_auth_v1.sql",
    "20260905041243_fleet_vehicle_repair_v1.sql",
    "20260905103242_ptc_vehicle_line_actions_v1.sql",
    "20260906221526_ptc_fleet_manager_only_mutations.sql",
    "20260907085500_ptc_weighman_handoff_v1.sql",
    "20260907103717_ptc_last_vehicle_combine_shifts_v1.sql",
  ]) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

  const company = randomUUID(), car1 = randomUUID(), car2 = randomUUID();
  await db.query("insert into companies values($1)", [company]);
  await db.query("insert into reference_vehicles(id,company_id,is_active,archived) values($1,$3,true,false),($2,$3,true,false)", [car1, car2, company]);
  await db.query("select ptc_configure_v1($1,true,null,$2)", [company, [car1, car2]]);
  const actor = async (role: string) => {
    const id = randomUUID();
    await db.query("insert into profiles(id,company_id,role,status,full_name) values($1,$2,$3,'active',$3)", [id, company, role]);
    await db.query("insert into company_people values($1,$2,$3,$4,'active',null)", [randomUUID(), company, id, role]);
    return id;
  };
  const harvester = await actor("mechanic_operator"), weighman = await actor("weighman");
  const receiver = await actor("vegetable_brigadier"), manager = await actor("fleet_manager");
  await db.exec("set role service_role");
  const mark = async (who: string, vehicle: string, command: "mark" | "clear", key = randomUUID()) =>
    (await db.query<{ value: any }>("select ptc_set_last_vehicle_v1($1,$2,$3,$4) value", [who, vehicle, command, key])).rows[0].value;
  const transition = async (who: string, vehicle: string, version: number, target: string, key = randomUUID()) =>
    (await db.query<{ value: any }>("select ptc_actor_transition_v1($1,$2,$3,$4,$5) value", [who, vehicle, version, target, key])).rows[0].value;
  const marker = async () => (await db.query<{ vehicle_id: string }>("select vehicle_id::text from ptc_last_vehicle_markers")).rows;

  await rejects(() => mark(receiver, car1, "mark"), "PTC_LAST_VEHICLE_FORBIDDEN");
  const markKey = randomUUID();
  equal((await mark(harvester, car1, "mark", markKey)).replayed, false);
  equal((await mark(harvester, car1, "mark", markKey)).replayed, true);
  equal(await marker(), [{ vehicle_id: car1 }]);
  await transition(harvester, car1, 0, "loaded");
  equal(await marker(), [{ vehicle_id: car1 }]);
  await transition(weighman, car1, 1, "unloading");
  equal(await marker(), [{ vehicle_id: car1 }]);
  const finishKey = randomUUID();
  equal((await transition(receiver, car1, 2, "empty", finishKey)).replayed, false);
  equal(await marker(), []);
  equal((await transition(receiver, car1, 2, "empty", finishKey)).replayed, true);
  equal((await db.query<{ count: number }>("select count(*)::int count from ptc_last_vehicle_events where action='auto_cleared'")).rows[0].count, 1);

  await mark(harvester, car1, "mark");
  equal((await mark(harvester, car2, "mark")).marker.vehicleId, car2);
  equal(await marker(), [{ vehicle_id: car2 }]);
  equal((await db.query<{ action: string; previous_vehicle_id: string }>("select action,previous_vehicle_id::text from ptc_last_vehicle_events where action='transferred'")).rows,
    [{ action: "transferred", previous_vehicle_id: car1 }]);
  const repair = await db.query<{ value: any }>("select fleet_set_vehicle_repair_v1($1,$2,$3,true,0) value", [manager, company, car2]);
  equal(repair.rows[0].value.inRepair, true);
  equal(await marker(), []);

  await mark(harvester, car1, "mark");
  const revision = (await db.query<{ value: string }>("select updated_at::text value from ptc_flows where company_id=$1", [company])).rows[0].value;
  await db.query("select ptc_set_vehicle_line_v1($1,$2,$3,false,$4)", [manager, company, [car1], revision]);
  equal(await marker(), []);

  const setShift = async (who: string, command: "open" | "close", shiftId: string | null, shiftHa: number | null, totalHa: number | null, key = randomUUID()) =>
    (await db.query<{ value: any }>("select ptc_set_combine_shift_v1($1,$2,$3,$4,$5,$6) value", [who, command, shiftId, shiftHa, totalHa, key])).rows[0].value;
  await rejects(() => setShift(receiver, "open", null, null, null), "PTC_SHIFT_FORBIDDEN");
  const openKey = randomUUID();
  const firstOpen = await setShift(harvester, "open", null, null, null, openKey);
  equal(firstOpen.status, "open");
  equal((await setShift(harvester, "open", null, null, null, openKey)).replayed, true);
  await rejects(() => setShift(harvester, "open", null, null, null), "PTC_SHIFT_ALREADY_OPEN");
  const firstClose = await setShift(harvester, "close", firstOpen.shiftId, 13, 30);
  equal({ status: firstClose.status, shift: Number(firstClose.hectaresShift), total: Number(firstClose.hectaresFieldTotal) },
    { status: "closed", shift: 13, total: 30 });
  const secondOpen = await setShift(harvester, "open", null, null, null);
  const secondClose = await setShift(harvester, "close", secondOpen.shiftId, 14, 21);
  equal({ shift: Number(secondClose.hectaresShift), total: Number(secondClose.hectaresFieldTotal) }, { shift: 14, total: 21 });
  equal((await db.query<{ count: number }>("select count(*)::int count from ptc_combine_shifts")).rows[0].count, 2);

  await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    for (const signature of [
      "ptc_set_last_vehicle_v1(uuid,uuid,text,uuid)",
      "ptc_set_combine_shift_v1(uuid,text,uuid,numeric,numeric,uuid)",
    ]) equal((await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows, [{ allowed: false }]);
    for (const table of ["ptc_last_vehicle_markers", "ptc_last_vehicle_events", "ptc_combine_shifts", "ptc_combine_shift_events"])
      equal((await db.query("select has_table_privilege($1,$2,'select,insert,update,delete') allowed", [role, table])).rows, [{ allowed: false }]);
  }

  const board = readFileSync("components/traffic/traffic-board.tsx", "utf8");
  equal(board.includes("TrafficShiftControls"), false);
  const operatorPage = readFileSync("app/traffic-operator/page.tsx", "utf8");
  assert.match(operatorPage, /live\.data\.role === "harvester"[\s\S]{0,120}<TrafficShiftControls/); checks++;
  const shiftControls = readFileSync("components/traffic/traffic-shift-controls.tsx", "utf8");
  assert.match(shiftControls, /aria-label="Меню смены комбайнёра"/); checks++;
  assert.match(board, /traffic-last-vehicle-banner/); checks++;
  assert.match(board, /event\.stopPropagation\(\)/); checks++;
  const dashboard = readFileSync("app/(dashboard)/traffic/page.tsx", "utf8");
  assert.match(dashboard, /managed\?\.managerRole === "agronomist"[\s\S]*TrafficAnalyticsPanel/); checks++;
  const boardRender = dashboard.indexOf("<TrafficBoard", dashboard.indexOf("live.data ?"));
  const analyticsRender = dashboard.indexOf("<TrafficAnalyticsPanel", boardRender);
  equal(boardRender >= 0 && analyticsRender > boardRender, true);
  assert.match(dashboard, /lg:col-start-2 lg:row-start-1/); checks++;
  assert.match(dashboard, /compactAgronomistMobile=\{managed\?\.managerRole === "agronomist"\}/); checks++;
  const analyticsPanel = readFileSync("components/traffic/traffic-analytics-panel.tsx", "utf8");
  for (const label of [
    "Между двумя последними загрузками",
    "В среднем между загрузками",
    "От загрузки до весовой",
    "От весовой до конца выгрузки",
    "От выгрузки до новой загрузки",
    "Вероятный простой комбайна",
  ]) { assert.match(analyticsPanel, new RegExp(label)); checks++; }
  equal(analyticsPanel.includes(" эп."), false);
  assert.match(analyticsPanel, /Загрузок пока нет/); checks++;
  const server = readFileSync("lib/traffic/server.ts", "utf8");
  assert.match(server, /role === "manager" && includeAnalytics[\s\S]*\.is\("closed_at", null\)[\s\S]*\.order\("opened_at", \{ ascending: true \}\)/); checks++;
  assert.match(server, /const LIVE_ANALYTICS_MAX_WINDOW_MS = 24 \* 60 \* 60 \* 1000/); checks++;
  assert.match(server, /analyticsWindowCapped[\s\S]*liveWindowFloor[\s\S]*Текущая смена · последние 24 часа/); checks++;
  assert.match(server, /const rollingStartedAt = new Date\(Date\.parse\(serverTime\) - 12 \* 60 \* 60 \* 1000\)/); checks++;
  assert.match(server, /readTrafficAnalyticsEvents[\s\S]*\.gte\("created_at", startedAt\)[\s\S]*\.lte\("created_at", endedAt\)[\s\S]*\.range\(from, from \+ pageSize - 1\)/); checks++;
  equal(server.includes(".limit(500)"), false);
  const trafficRoute = readFileSync("app/api/traffic/route.ts", "utf8");
  assert.match(trafficRoute, /get\("analytics"\) === "1"/); checks++;
  assert.match(trafficRoute, /actor\.role === "agronomist"[\s\S]*includeAnalytics/); checks++;
  assert.match(trafficRoute, /managerRole: actor\.role/); checks++;
  await db.close();
  console.log(`PTC shift/last PASS: ${checks} checks; actual PostgreSQL transactions, role isolation and analytics; no hosted writes.`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
