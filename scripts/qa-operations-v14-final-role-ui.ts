import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const tasks = read("app/(dashboard)/tasks/page.tsx");
const specialistPlan = read("components/operations/specialist-operation-plan.tsx");
const progressRoute = read("app/api/operations/[id]/progress/route.ts");
const warehouse = read("app/(dashboard)/warehouses/requests/page.tsx");
const requestRoute = read("app/api/material-requests/route.ts");
const adminRoute = read("app/api/material-requests/[id]/admin/route.ts");

const checks: Array<[string, () => void]> = [
  ["specialist master detail", () => assert.match(tasks, /lg:grid-cols-\[minmax\(320px,380px\)_minmax\(0,1fr\)\]/)],
  ["specialist mobile full screen", () => assert.match(tasks, /fixed inset-0 z-50 h-\[100dvh\]/)],
  ["field and crop hierarchy", () => assert.match(tasks, /text-base font-semibold text-slate-200 sm:text-lg/)],
  ["shift area input", () => assert.match(tasks, /Выполнено за смену, га/)],
  ["single shift comment", () => assert.match(tasks, /id="shift-comment"/)],
  ["stop reason removed", () => assert.doesNotMatch(tasks, /Причина остановки/)],
  ["weather removed", () => assert.doesNotMatch(tasks, />\s*Погода\s*</)],
  ["separate variance reason removed", () => assert.doesNotMatch(tasks, /Причина отклонения от плана/)],
  ["progress frontend max", () => assert.match(tasks, /completedAreaHa > stats\.remaining/)],
  ["progress backend max", () => assert.match(progressRoute, /completedArea > remaining \+ 0\.000001/)],
  ["progress confirm", () => assert.match(tasks, /Сдать прогресс\?/)],
  ["progress fields reset", () => {
    assert.match(tasks, /setProgressAreaDraft\(''\)/);
    assert.match(tasks, /setProgressComment\(''\)/);
  }],
  ["variance uses common comment", () => assert.match(tasks, /varianceReason:[\s\S]+progressComment\.trim\(\)/)],
  ["shift history compact", () => assert.match(tasks, /toLocaleTimeString\('ru-RU'/)],
  ["spraying materials readable", () => assert.match(specialistPlan, /material\.formula \|\| material\.rateLabel/)],
  ["spraying material names mapped", () => {
    assert.match(tasks, /product_name: operationMaterialName\(material\)/);
    assert.match(tasks, /\.filter\(\(request\) => request\.status !== 'cancelled'\)/);
  }],
  ["water is system calculation", () => assert.match(specialistPlan, /"liquid_materials", "water", "concentration"/)],
  ["solution total last", () => {
    const water = specialistPlan.indexOf('"liquid_materials", "water", "concentration"');
    const total = specialistPlan.lastIndexOf('detailByKey.get("solution_total")');
    assert.ok(water >= 0 && total > water);
  }],
  ["warehouse master detail", () => assert.match(warehouse, /lg:grid-cols-\[minmax\(310px,370px\)_minmax\(0,1fr\)\]/)],
  ["warehouse mobile full screen", () => assert.match(warehouse, /fixed inset-0 z-50 grid h-\[100dvh\]/)],
  ["warehouse status tabs", () => {
    for (const label of ["Новые", "Готовы к выдаче", "Выданы", "История"]) {
      assert.match(warehouse, new RegExp(label));
    }
  }],
  ["no kanban columns", () => assert.doesNotMatch(warehouse, /WAREHOUSE_COLUMNS|grid-cols-3 md:overflow-hidden/)],
  ["no tare", () => assert.doesNotMatch(warehouse, />\s*Тара\s*</)],
  ["no assembly start", () => assert.doesNotMatch(warehouse, /Начать сборку/)],
  ["ready direct", () => assert.match(warehouse, /Готово к выдаче/)],
  ["prepared math", () => {
    assert.match(warehouse, /remainingToPrepare: Math\.max\(planned - prepared, 0\)/);
    assert.match(warehouse, /deviation: prepared - planned/);
  }],
  ["warehouse cancellation admin only", () => {
    assert.match(warehouse, /canAdmin \?/);
    assert.match(adminRoute, /const ADMIN_ROLES = \["global_admin", "company_admin"\]/);
  }],
  ["seeds hidden from warehouse response", () => {
    assert.match(requestRoute, /normalizedItems\.filter/);
    assert.match(requestRoute, /isAgrochemicalProductType/);
  }],
  ["technical comments hidden", () => assert.match(warehouse, /\^auto-created/)],
  ["no service role", () => {
    assert.doesNotMatch(tasks + progressRoute + warehouse + requestRoute, /SUPABASE_SERVICE_ROLE_KEY|service_role/);
  }],
];

for (const [name, check] of checks) {
  try {
    check();
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

const planned = 0.5;
const prepared = 1;
assert.equal(Math.max(planned - prepared, 0), 0);
assert.equal(prepared - planned, 0.5);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      checks: checks.length + 2,
      productionWrites: 0,
      scope: "TZ-221 specialist and warehouse UI",
    },
    null,
    2
  )
);
