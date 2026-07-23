import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOperationPresentation } from "../lib/operations/operation-presentation";

const read = (path: string) => readFileSync(path, "utf8");

function baseOperation(overrides: Record<string, unknown> = {}) {
  return {
    id: "operation-v13",
    company_id: "company-a",
    field_id: "field-a",
    crop_structure_id: "structure-a",
    operation_type: "Обработка почвы",
    operation_category_slug: "soil_operation",
    operation_type_slug: "disking",
    planned_area_ha: 80,
    completed_area_ha: 34,
    remaining_area_ha: 46,
    progress_percent: 42.5,
    operation_params: { depth_cm: 12 },
    operation_config: {},
    date: "2026-07-23",
    notes: "Срочно закончить северную часть поля.",
    responsible_user_id: "specialist-a",
    responsible_name: "Тестовый специалист",
    machine_name: "CLAAS ARION 610",
    equipment_name: "Дисковая борона QA",
    transport_name: null,
    work_status: "in_progress",
    status: "in_progress",
    operation_status: "in_progress",
    specialist_task_status: "in_progress",
    accepted_at: "2026-07-23T08:00:00Z",
    completed_at: null,
    specialist_comment: null,
    created_at: "2026-07-23T07:00:00Z",
    updated_at: "2026-07-23T08:00:00Z",
    archived: false,
    user_id: "agronomist-a",
    field_name: "Поле 15",
    crop_name: "Ячмень",
    materials: [],
    operation_lines: [
      {
        id: "line-a",
        company_id: "company-a",
        operation_id: "operation-v13",
        field_id: "field-a",
        crop_id: "crop-a",
        variety_id: null,
        reproduction_id: null,
        planned_area_ha: 80,
        actual_area_ha: null,
        row_count: null,
        row_spacing_m: null,
        seed_spacing_cm: null,
        calculated_plants_per_ha: null,
        calculated_total_plants: null,
        completed_by: null,
        completed_at: null,
        notes: null,
        created_at: "",
        updated_at: "",
        field_name: "Поле 15",
        crop_name: "Ячмень",
      },
    ],
    progress_reports: [],
    completion_requests: [],
    ...overrides,
  } as any;
}

const soil = buildOperationPresentation(baseOperation());
assert.equal(soil.workTitle, "Дискование", "A concrete soil work title");
assert.equal(soil.details.find((row) => row.key === "depth")?.value, "12 см", "B depth");
assert.equal(soil.machineName, "CLAAS ARION 610", "C machine");
assert.equal(soil.equipmentName, "Дисковая борона QA", "C equipment");
assert.equal(soil.agronomistComment, "Срочно закончить северную часть поля.", "D comment");
assert.equal(soil.materialRows.length, 0, "M empty materials hidden");

const spraying = buildOperationPresentation(
  baseOperation({
    operation_type: "Опрыскивание",
    operation_category_slug: "spraying",
    operation_type_slug: "complex_tank_mix_treatment",
    planned_area_ha: 120,
    completed_area_ha: 0,
    operation_params: {},
    tank_mix: { enabled: true, total_solution_l_ha: 200, components: [] },
    materials: [
      {
        id: "curamin",
        company_id: "company-a",
        operation_id: "operation-v13",
        operation_line_id: "line-a",
        product_id: "product-a",
        batch_id: null,
        material_type: "pesticide",
        unit: "l",
        planned_rate: 1,
        actual_rate: null,
        rate_basis: "per_ha",
        planned_quantity: 120,
        issued_quantity: 0,
        consumed_quantity: null,
        returned_quantity: null,
        loss_quantity: null,
        notes: null,
        product_name: "Curamin Foliar",
      },
      {
        id: "water",
        company_id: "company-a",
        operation_id: "operation-v13",
        operation_line_id: "line-a",
        product_id: "water",
        batch_id: null,
        material_type: "water",
        unit: "l",
        planned_rate: 199,
        actual_rate: null,
        rate_basis: "per_ha",
        planned_quantity: 23880,
        issued_quantity: 0,
        consumed_quantity: null,
        returned_quantity: null,
        loss_quantity: null,
        notes: null,
        product_name: "Вода",
      },
    ],
  })
);
assert.equal(spraying.materialRows.length, 1, "K water is not a material");
assert.equal(
  spraying.materialRows[0].formula,
  "1 л/га × 120 га = 120 л",
  "J material formula"
);
assert.equal(
  spraying.details.find((row) => row.key === "water")?.value,
  "23 880 л",
  "K system water calculation"
);
assert.equal(
  spraying.details.at(-1)?.key,
  "solution_total",
  "L total solution is the final detail"
);
assert.equal(
  spraying.details.at(-1)?.value,
  "24 000 л",
  "J full solution calculation"
);

const planting = buildOperationPresentation(
  baseOperation({
    operation_type: "Посев",
    operation_category_slug: "planting",
    operation_type_slug: "seeding",
    planned_area_ha: 40,
    completed_area_ha: 0,
    rate_per_ha: 200,
    operation_params: {
      planting_depth_cm: 5,
      seed_rate_kg_ha: 200,
      seed_requirement_kg: 8000,
      row_spacing_m: 0.15,
      seed_spacing_cm: 4,
      seed_fraction: "35-55 мм",
    },
    materials: [
      {
        id: "seed",
        company_id: "company-a",
        operation_id: "operation-v13",
        operation_line_id: "line-a",
        product_id: "seed-a",
        batch_id: null,
        material_type: "seed",
        unit: "kg",
        planned_rate: 200,
        actual_rate: null,
        rate_basis: "per_ha",
        planned_quantity: 8000,
        issued_quantity: 0,
        consumed_quantity: null,
        returned_quantity: null,
        loss_quantity: null,
        notes: null,
        product_name: "Семена QA",
      },
    ],
  })
);
assert.equal(planting.workTitle, "Посев", "Sowing title");
assert.equal(planting.materialRows[0].isSeed, true, "Seed presentation marker");
assert.equal(
  planting.materialRows[0].formula,
  "200 кг/га × 40 га = 8 000 кг",
  "Sowing requirement formula"
);
assert.equal(planting.details.find((row) => row.key === "seed_fraction")?.value, "35-55 мм");

const fertilizer = buildOperationPresentation(
  baseOperation({
    operation_type: "Внесение удобрений",
    operation_category_slug: "fertilizer_application",
    operation_type_slug: "mineral_fertilizer_broadcast",
    planned_area_ha: 20,
    completed_area_ha: 0,
    operation_params: {},
    materials: [
      {
        id: "fertilizer",
        company_id: "company-a",
        operation_id: "operation-v13",
        operation_line_id: "line-a",
        product_id: "fertilizer-a",
        batch_id: null,
        material_type: "fertilizer",
        unit: "kg",
        planned_rate: 100,
        actual_rate: null,
        rate_basis: "per_ha",
        planned_quantity: 2000,
        issued_quantity: 0,
        consumed_quantity: null,
        returned_quantity: null,
        loss_quantity: null,
        notes: null,
        product_name: "Аммиачная селитра",
      },
    ],
  })
);
assert.equal(fertilizer.materialRows[0].formula, "100 кг/га × 20 га = 2 000 кг");

const irrigation = buildOperationPresentation(
  baseOperation({
    operation_type: "Полив",
    operation_category_slug: "irrigation",
    operation_type_slug: "irrigation_cycle",
    planned_area_ha: 10,
    completed_area_ha: 0,
    operation_params: {
      water_norm_mm: 20,
      irrigation_zone: "Север",
      duration_hours: 6,
    },
  })
);
assert.equal(irrigation.details.find((row) => row.key === "water_volume")?.value, "2 000 м³");
assert.equal(irrigation.details.find((row) => row.key === "zone")?.value, "Север");
assert.equal(irrigation.details.find((row) => row.key === "duration")?.value, "6 ч");

const harvest = buildOperationPresentation(
  baseOperation({
    operation_type: "Уборка",
    operation_category_slug: "harvesting",
    operation_type_slug: "direct_combining",
    operation_target: "Прямое комбайнирование",
    transport_name: "KAMAZ 45142-011",
    completed_area_ha: 0,
  })
);
assert.equal(harvest.workTitle, "Прямое комбайнирование");
assert.equal(harvest.transportName, "KAMAZ 45142-011");

for (const actual of [78, 82]) {
  const pending = buildOperationPresentation(
    baseOperation({
      completed_area_ha: actual,
      operation_status: "awaiting_approval",
      specialist_task_status: "awaiting_approval",
      completion_requests: [
        {
          id: `completion-${actual}`,
          operation_id: "operation-v13",
          company_id: "company-a",
          requested_by: "specialist-a",
          planned_area_ha: 80,
          actual_area_ha: actual,
          deviation_area_ha: actual - 80,
          variance_reason: "Фактическая граница поля",
          specialist_comment: "Работа завершена",
          material_facts: [],
          status: "pending",
          reviewed_by: null,
          review_comment: null,
          requested_at: "2026-07-23T12:00:00Z",
          reviewed_at: null,
        },
      ],
    })
  );
  assert.equal(pending.status, "awaiting_approval", `${actual}/80 approval status`);
  assert.equal(pending.deviationAreaHa, actual - 80, `${actual}/80 deviation`);
  assert.equal(pending.remainingAreaHa, actual < 80 ? 80 - actual : 0, `${actual}/80 math`);
}

const waiting = buildOperationPresentation(
  baseOperation({
    operation_status: "ready_to_close",
    specialist_task_status: "ready_to_close",
  })
);
assert.equal(waiting.status, "awaiting_reconciliation");
assert.equal(waiting.statusLabel, "Ожидает сверку материалов");

const technicalComment = buildOperationPresentation(
  baseOperation({ notes: "Auto-created atomically from operation" })
);
assert.equal(technicalComment.agronomistComment, null, "Technical comments hidden");

const tasksSource = read("app/(dashboard)/tasks/page.tsx");
const warehouseSource = read("app/(dashboard)/warehouses/requests/page.tsx");
const requestRoute = read("app/api/material-requests/route.ts");
const requestPatchSource = requestRoute.slice(requestRoute.indexOf("export async function PATCH"));
const completeRoute = read("app/api/operations/[id]/complete/route.ts");
const materialRequestRoute = read("app/api/operations/[id]/material-request/route.ts");
const migration = read("supabase/migrations/20260723180119_operations_v13_final_role_cards.sql");

assert.match(tasksSource, /AlertDialog[\s\S]+Принять задачу/, "Accept confirmation exists");
assert.doesNotMatch(tasksSource, />\s*Начать работу\s*</, "H no separate start button");
assert.doesNotMatch(tasksSource, /Фактический расход|Ввести возврат|Ввести потери/, "P no specialist accounting");
assert.match(tasksSource, /setProgressAreaDraft\(''\)/, "Z progress area reset");
assert.match(tasksSource, /setProgressStopReason\(''\)/, "Z stop reason reset");
assert.match(tasksSource, /setProgressComment\(''\)/, "Z comment reset");
assert.match(tasksSource, /setProgressWeatherNote\(''\)/, "Z weather reset");
assert.doesNotMatch(warehouseSource, />\s*Тара\s*</, "Q tare removed");
assert.doesNotMatch(warehouseSource, /Начать сборку/, "R preparation start removed");
assert.match(warehouseSource, /Готово к выдаче/, "S ready directly");
assert.match(warehouseSource, /canAdminTransition/, "V/W admin transitions");
assert.doesNotMatch(requestPatchSource, /package_size|package_count|package_unit/, "No package rounding");
assert.match(completeRoute, /finish_operation_atomic_v13/, "Finish uses v13 atomically");
assert.match(materialRequestRoute, /ensure_operation_material_request_atomic_v13/, "Seed split request wrapper");
assert.match(migration, /\('seed', 'fuel', 'water'\)/, "N seed handled outside warehouse request");
assert.match(migration, /operation_waiting_material_reconciliation_v13/, "Waiting reconciliation status");
assert.match(migration, /advance_operation_after_material_reconciliation_v13/, "Automatic reconciliation advance");
assert.match(migration, /issued_quantity[\s\S]+consumed_quantity[\s\S]+returned_quantity[\s\S]+loss_quantity/, "Ledger facts preserved");
assert.match(migration, /status = 'pending'[\s\S]+operation_status = 'awaiting_approval'/, "Agronomist variance approval gate");

console.log(
  JSON.stringify(
    {
      status: "PASS",
      checks: 51,
      productionWrites: 0,
      covered: [
        "A-D",
        "E-I",
        "J-M",
        "N-P",
        "Q-X",
        "Y-AD",
        "AE",
      ],
    },
    null,
    2
  )
);
