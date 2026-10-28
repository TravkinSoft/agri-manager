import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildCombineWorkday, type CombineShiftRow, type CombineSegmentRow } from "../lib/dashboard/combine-workday";
import { hasSummarySections, showMainMenuRoute } from "../lib/dashboard/summary-sections";
import { canAccessPath } from "../lib/auth/role-access";
import { resolveHarvestPeriod } from "../lib/dashboard/harvest-summary";

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
const period = { start: "2026-09-21T02:00:00Z", end: "2026-09-22T02:00:00Z", label: "21.09 07:00 — 22.09 07:00" };
const shifts: CombineShiftRow[] = [
  { id: "first", operator_user_id: "operator", operator_name: "Комбайнёр", opened_at: "2026-09-21T02:14:14Z", closed_at: "2026-09-21T15:55:45Z", current_crop_structure_id: "new24", hectares_shift: 14.3 },
  { id: "second", operator_user_id: "operator", operator_name: "Комбайнёр", opened_at: "2026-09-21T15:56:58Z", closed_at: "2026-09-21T19:48:22Z", current_crop_structure_id: "new24", hectares_shift: 5.87 },
];
const segments: CombineSegmentRow[] = [
  { id: "a", shift_id: "first", crop_structure_id: "old54", field_id: "old", planned_area_ha: 54, ended_field_total_ha: 52, hectares_segment: 14.3, closed_at: shifts[0].closed_at },
  { id: "excluded", shift_id: "first", crop_structure_id: "new24", field_id: "new", planned_area_ha: 24, ended_field_total_ha: 0, hectares_segment: 0, closed_at: shifts[0].closed_at },
  { id: "b", shift_id: "second", crop_structure_id: "new24", field_id: "new", planned_area_ha: 24, ended_field_total_ha: 5.87, hectares_segment: 5.87, closed_at: shifts[1].closed_at },
];
const input = { companyId: "tenant", serverTime: "2026-09-21T20:00:00Z", period, shifts, segments,
  plots: [{ id: "old54", label: "Старый54", areaHa: 54, totalHa: 52, status: "completed" }, { id: "new24", label: "Новый24", areaHa: 24, totalHa: 5.87, status: "active" }] };
const result = buildCombineWorkday(input);
check("14.30 + 5.87 = 20.17, not last record only", () => assert.equal(result.totalHa, 20.17));
check("old plot daily delta is 14.3, lifetime 52", () => assert.deepEqual([result.plots[0].workdayHa, result.plots[0].totalHa], [14.3, 52]));
check("new plot daily and lifetime both 5.87", () => assert.deepEqual([result.plots[1].workdayHa, result.plots[1].totalHa], [5.87, 5.87]));
check("technical shifts are retained individually", () => assert.deepEqual(result.shifts.map(row => row.hectares), [14.3, 5.87]));
check("completed old plot not current", () => assert.deepEqual(result.plots.map(row => row.isCurrent), [false, true]));
check("immutable source", () => assert.equal(shifts[0].hectares_shift, 14.3));
check("duplicates cannot double hectares", () => assert.equal(buildCombineWorkday({ ...input, shifts: [...shifts, shifts[0]], segments: [...segments, segments[0]] }).totalHa, 20.17));
check("after-midnight closure remains in opening day", () => assert.equal(result.shifts[1].hectares, 5.87));
check("yesterday excluded by exact half-open period", () => assert.equal(buildCombineWorkday({ ...input, shifts: [...shifts, { ...shifts[0], id: "yesterday", opened_at: "2026-09-21T01:59:59Z" }] }).shifts.length, 2));
check("next day 07:00 excluded", () => assert.equal(buildCombineWorkday({ ...input, shifts: [...shifts, { ...shifts[0], id: "tomorrow", opened_at: period.end }] }).shifts.length, 2));
check("00:48 local belongs to September21", () => assert.equal(resolveHarvestPeriod({ preset: "current_day", now: new Date("2026-09-21T19:48:22Z"), operationalDayStartHour: 7 }).start, "2026-09-21T02:00:00.000Z"));
check("07:00 local starts next day", () => assert.equal(resolveHarvestPeriod({ preset: "current_day", now: new Date("2026-09-22T02:00:00Z"), operationalDayStartHour: 7 }).start, "2026-09-22T02:00:00.000Z"));
check("open parent prevents final hectare claim", () => { const r = buildCombineWorkday({ ...input, shifts: [shifts[0], { ...shifts[1], closed_at: null }] }); assert.equal(r.totalHa, null); assert.equal(r.confirmedHa, 14.3); assert.equal(r.pending, true); });
check("missing hectare not zero", () => { const r = buildCombineWorkday({ ...input, segments: [...segments.slice(0, 2), { ...segments[2], hectares_segment: null }] }); assert.equal(r.plots[1].workdayHa, null); assert.equal(r.totalHa, null); });
check("51 on 24 blocks total", () => { const r = buildCombineWorkday({ ...input, segments: [...segments.slice(0, 2), { ...segments[2], hectares_segment: 51, ended_field_total_ha: 51 }] }); assert.equal(r.issue, true); assert.equal(r.totalHa, null); });
check("parent/segment mismatch is visible", () => { const r = buildCombineWorkday({ ...input, shifts: [shifts[0], { ...shifts[1], hectares_shift: 6 }] }); assert.equal(r.issue, true); assert.equal(r.totalHa, null); });
check("negative hectares never counted", () => assert.equal(buildCombineWorkday({ ...input, segments: [{ ...segments[0], hectares_segment: -3 }] }).totalHa, null));
check("empty day does not invent zero work", () => assert.equal(buildCombineWorkday({ ...input, shifts: [], segments: [] }).totalHa, null));
check("valid reported zero remains zero", () => { const r = buildCombineWorkday({ ...input, shifts: [{ ...shifts[0], hectares_shift: 0, current_crop_structure_id: "old54" }], segments: [{ ...segments[0], hectares_segment: 0 }] }); assert.equal(r.totalHa, 0); });
check("invalid cumulative area is not shown as truth", () => { const r = buildCombineWorkday({ ...input, plots: [input.plots[0], { ...input.plots[1], totalHa: 51 }] }); assert.equal(r.plots[1].totalHa, null); assert.equal(r.totalHa, null); });
check("different operators' plot deltas summed once", () => { const r = buildCombineWorkday({ ...input, shifts: [shifts[0], { ...shifts[1], operator_user_id: "other" }] }); assert.equal(r.totalHa, 20.17); });
for (const role of ["agronomist", "director", "company_admin", "global_admin"]) check(`${role} has summary tabs`, () => assert.equal(hasSummarySections(role), true));
for (const role of ["weighman", "mechanic_operator", "accountant", "pending", null]) check(`${role} has no new tabs`, () => assert.equal(hasSummarySections(role), false));
for (const path of ["/weighbridge", "/weighbridge/history"]) check(`agronomist no menu ${path}`, () => assert.equal(showMainMenuRoute("agronomist", path), false));
check("weighman's menu and authorization unchanged", () => { assert.equal(showMainMenuRoute("weighman", "/weighbridge"), true); assert.equal(canAccessPath("weighman", "/weighbridge"), true); });
check("agronomist does not gain weighbridge write page", () => assert.equal(canAccessPath("agronomist", "/weighbridge"), false));
check("director does not gain manager page", () => assert.equal(canAccessPath("director", "/traffic"), false));
const dashboard = readFileSync("components/dashboard/harvest-dashboard.tsx", "utf8");
check("no champions or closed-shift-only report fetch", () => assert.doesNotMatch(dashboard, /TrafficShiftSummary|PotatoDriverSummary|useDashboardTraffic/));
check("unvisited combine and traffic panels do not mount", () => { assert.match(dashboard, /visited.includes\("combine"\)/); assert.match(dashboard, /visited.includes\("traffic"\)/); });
check("identity keyed, no previous tenant frame", () => assert.match(dashboard, /key=\{`\$\{profile\?\.id\}:\$\{profile\?\.role\}:\$\{profile\?\.company_id\}`\}/));
check("no online claim from shift state", () => assert.doesNotMatch(dashboard, /\? "Online" : "Offline"/));
const route = readFileSync("app/api/dashboard/combine-summary/route.ts", "utf8");
check("read-only endpoint", () => { assert.match(route, /export async function GET/); assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)|\.rpc\(|\.insert\(|\.update\(|\.delete\(/); });
check("server role and company checks before queries", () => { assert.match(route, /getServerActorFromSession\(request, \{ skipCache: true \}\)/); assert.match(route, /resolveCompanyForActor/); assert.match(route, /await assertActorAccess/); assert.match(route, /allowedRoles: \[\.\.\.SUMMARY_SECTION_ROLES\]/); });
check("paged reads, bounded IN requests", () => { assert.match(route, /range\(from, from \+ 499\)/); assert.match(route, /offset \+= 100/); });
check("hidden resource has no polling and clears revoked data", () => { const hook = readFileSync("components/dashboard/use-summary-resource.ts", "utf8"); assert.match(hook, /if \(!enabled/); assert.match(hook, /revoked \|\| previous\?\.key !== key \? null/); assert.match(hook, /started !== generation.current/); });
if (existsSync("scripts/output/summary-sections/live-combine-readonly.json")) {
  const live = JSON.parse(readFileSync("scripts/output/summary-sections/live-combine-readonly.json", "utf8"));
  check("read-only Production snapshot yields 20.17 ha", () => assert.equal(buildCombineWorkday({ ...input, ...live }).totalHa, 20.17));
}
console.log(`Summary sections: ${checks} PASS`);
