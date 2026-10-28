import assert from "node:assert/strict";
import { isSummaryDate, previousSummaryDay, summaryDayKey, weighbridgePeriodOptions } from "../lib/dashboard/summary-periods";
const now = "2026-09-25T07:00:00Z";
let checks = 0;
function test(name: string, fn: () => void) { fn(); checks++; console.log(`PASS ${name}`); }
const shifts = [
  { id: "active", status: "open", openedAt: "2026-09-25T02:57:00Z", closedAt: null },
  { id: "yesterday", status: "closed", openedAt: "2026-09-24T02:00:00Z", closedAt: "2026-09-24T19:40:00Z" },
  { id: "older", status: "closed", openedAt: "2026-09-23T02:00:00Z", closedAt: "2026-09-24T00:00:00Z" },
];
test("exact requested order and no active duplicate", () => assert.deepEqual(weighbridgePeriodOptions(shifts, now), [
  { value: "active_shift", label: "Активная смена" }, { value: "previous_day", label: "Вчера" }, { value: "older", label: "23.09.2026" },
]));
test("07:00 Kazakhstan is boundary, independent of browser timezone", () => { assert.equal(summaryDayKey("2026-09-25T01:59:59Z"), "2026-09-24"); assert.equal(summaryDayKey("2026-09-25T02:00:00Z"), "2026-09-25"); });
test("yesterday before 07:00 uses previous operational day", () => assert.equal(previousSummaryDay("2026-09-25T01:00:00Z"), "2026-09-23"));
test("month/year boundaries", () => assert.equal(previousSummaryDay("2027-01-01T08:00:00Z"), "2026-12-31"));
test("different company boundary", () => assert.equal(summaryDayKey("2026-09-25T03:00:00Z", 9), "2026-09-24"));
test("closed fallback is labelled honestly; missing yesterday retained", () => assert.deepEqual(weighbridgePeriodOptions([shifts[2]], now).slice(0,2), [{value:"active_shift",label:"Последняя закрытая смена"},{value:"previous_day",label:"Вчера"}]));
test("multiple shifts same date distinguish by time, neither lost", () => { const options=weighbridgePeriodOptions([...shifts,{...shifts[1],id:"second",openedAt:"2026-09-24T10:00:00Z"}],now); assert.equal(options[1].label,"Вчера · 15:00"); assert.equal(options[2].label,"Вчера · 07:00"); assert.equal(new Set(options.map(o=>o.value)).size,4); });
test("strict date validation", () => { for(const date of ["bad","2026-02-30","2026-13-01","2026-9-1"]) assert.equal(isSummaryDate(date),false); assert(isSummaryDate("2028-02-29")); });
console.log(`PASS ${checks} period checks`);
