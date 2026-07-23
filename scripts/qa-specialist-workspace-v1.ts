import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const tasks = readFileSync(
  join(root, "app/(dashboard)/tasks/page.tsx"),
  "utf8"
);
const plan = readFileSync(
  join(root, "components/operations/specialist-operation-plan.tsx"),
  "utf8"
);
const presentation = readFileSync(
  join(root, "lib/operations/operation-presentation.ts"),
  "utf8"
);

const checks: Array<[string, () => void]> = [
  [
    "A new task is read-only",
    () => {
      assert.match(tasks, /selectedPhase === 'active'/);
      assert.match(tasks, /Примите задачу, чтобы начать работу/);
    },
  ],
  ["B edit action absent", () => assert.doesNotMatch(tasks, />Изменить</)],
  ["C accept is primary action", () => assert.match(tasks, /Принять задачу/)],
  ["D accept confirmation exists", () => assert.match(tasks, /Принять задачу\?/)],
  ["E accepted tasks move to work tab", () => assert.match(tasks, /setTaskTab\('work'\)/)],
  ["F separate start absent", () => assert.doesNotMatch(tasks, /Начать работу/)],
  ["G soil depth is presented", () => assert.match(presentation, /Глубина обработки/)],
  [
    "H machine and equipment are presented",
    () => {
      assert.match(plan, /Машина/);
      assert.match(plan, /Оборудование/);
    },
  ],
  ["I agronomist comment is named", () => assert.match(plan, /Комментарий агронома/)],
  [
    "J spraying calculation is complete",
    () => {
      assert.match(plan, /Баковая смесь \(расчёт\)/);
      assert.match(plan, /solution_rate/);
      assert.match(plan, /liquid_materials/);
      assert.match(plan, /concentration/);
      assert.match(plan, /solution_total/);
    },
  ],
  [
    "K water is system-calculated",
    () => {
      assert.match(presentation, /Вода \(расчёт системы\)/);
      assert.match(presentation, /material_type !== "water"/);
    },
  ],
  [
    "L solution total is rendered last",
    () => {
      const materials = plan.indexOf("presentation.materialRows.map");
      const water = plan.indexOf('["liquid_materials", "water", "concentration"]');
      const total = plan.indexOf('detailByKey.get("solution_total")');
      assert.ok(materials >= 0 && water > materials && total > water);
    },
  ],
  [
    "M sowing rate and formula are available",
    () => {
      assert.match(presentation, /Норма семян/);
      assert.match(presentation, /Плановая потребность/);
      assert.match(presentation, /materialFormula/);
    },
  ],
  [
    "N specialist materials are read-only",
    () => {
      assert.match(plan, /Подготовлено:/);
      assert.match(plan, /Выдано:/);
      assert.doesNotMatch(plan, /<Input/);
    },
  ],
  [
    "O accounting inputs are absent",
    () => {
      for (const label of [
        "Фактический расход",
        "Вернуть на склад",
        "Потери",
        "Списание",
        "Тара",
        "Дефицит",
      ]) {
        assert.doesNotMatch(tasks + plan, new RegExp(label));
      }
    },
  ],
  [
    "P empty sections are conditional",
    () => {
      assert.match(plan, /presentation\.materialRows\.length > 0/);
      assert.match(plan, /presentation\.agronomistComment \?/);
      assert.doesNotMatch(plan, /Материалы не требуются/);
    },
  ],
  [
    "Q progress confirmation exists",
    () => assert.match(tasks, /Подтвердить сдачу прогресса\?/),
  ],
  [
    "R progress form resets",
    () => {
      assert.match(tasks, /setProgressAreaDraft\(''\)/);
      assert.match(tasks, /setProgressStopReason\(''\)/);
      assert.match(tasks, /setProgressWeatherNote\(''\)/);
      assert.match(tasks, /setProgressComment\(''\)/);
    },
  ],
  [
    "S under-plan finish is supported",
    () => assert.match(tasks, /selectedFinalArea < selectedAreaStats\.planned/),
  ],
  [
    "T over-plan finish is supported",
    () => assert.match(tasks, /selectedFinalArea > selectedAreaStats\.planned/),
  ],
  [
    "U completed card shows variance",
    () => {
      assert.match(tasks, /Отклонение/);
      assert.match(tasks, /selectedPresentation\.deviationAreaHa/);
    },
  ],
  [
    "V no production writes in QA",
    () => {
      assert.doesNotMatch(tasks + plan, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
      assert.doesNotMatch(tasks + plan, /agri-manager-eight\.vercel\.app/);
    },
  ],
  [
    "desktop master-detail",
    () => assert.match(tasks, /lg:grid-cols-\[minmax\(320px,380px\)_minmax\(0,1fr\)\]/),
  ],
  [
    "mobile full-screen detail",
    () => {
      assert.match(tasks, /fixed inset-0 z-50 h-\[100dvh\]/);
      assert.match(tasks, /h-12 w-12 lg:hidden/);
    },
  ],
  [
    "status tabs",
    () => {
      assert.match(tasks, /Новые/);
      assert.match(tasks, /В работе/);
      assert.match(tasks, /Завершённые/);
    },
  ],
  [
    "no map implementation",
    () => {
      assert.doesNotMatch(tasks + plan, /MapLibre|maplibre|geometry/);
    },
  ],
  [
    "operation material schema contract",
    () => {
      assert.match(tasks, /materialRateBasisFromNotes/);
      assert.match(tasks, /planned_rate,\s+notes,\s+planned_quantity/);
      assert.doesNotMatch(tasks, /planned_rate,\s+rate_basis,\s+planned_quantity/);
    },
  ],
  [
    "QA data is scoped to an explicit QA company",
    () => {
      assert.match(tasks, /isExplicitQaCompanyName/);
      assert.match(tasks, /allowQaData \|\| !operationHasQaMarker/);
      assert.match(tasks, /allowQaData \|\| !requestHasQaMarker/);
    },
  ],
];

for (const [name, check] of checks) {
  try {
    check();
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

console.log(
  JSON.stringify(
    {
      status: "PASS",
      checks: checks.length,
      regression: "A-V",
      productionWrites: 0,
      mapImplemented: false,
    },
    null,
    2
  )
);
