import assert from "node:assert/strict";
import { buildOperationPresentation } from "../lib/operations/operation-presentation";

const progressRows = [
  {
    id: "progress-1",
    operation_id: "operation-1",
    company_id: "company-1",
    reported_by: "specialist-1",
    reported_at: "2026-07-23T10:00:00Z",
    completed_area_ha: 34,
    remaining_area_ha: 46,
    progress_percent: 42.5,
    status_after_report: "paused",
    stop_reason: "Конец смены",
    comment: null,
    weather_note: null,
  },
  {
    id: "progress-2",
    operation_id: "operation-1",
    company_id: "company-1",
    reported_by: "specialist-1",
    reported_at: "2026-07-24T10:00:00Z",
    completed_area_ha: 48,
    remaining_area_ha: 0,
    progress_percent: 102.5,
    status_after_report: "ready_to_close",
    stop_reason: null,
    comment: null,
    weather_note: null,
  },
];

const operation = {
  id: "operation-1",
  field_id: "field-1",
  crop_structure_id: null,
  operation_type: "Обработка почвы",
  operation_category_slug: "soil_operation",
  operation_type_slug: "disking",
  planned_area_ha: 80,
  operation_config: { operation_params: { depth_cm: 12 } },
  operation_params: { depth_cm: 12 },
  date: "2026-07-23",
  notes: "Срочно",
  responsible_user_id: "specialist-1",
  work_status: "in_progress",
  status: "in_progress",
  operation_status: "in_progress",
  specialist_task_status: "in_progress",
  accepted_at: null,
  completed_at: null,
  specialist_comment: null,
  created_at: "",
  updated_at: "",
  archived: false,
  user_id: "user-1",
  field_name: "Поле 15",
  crop_name: "Ячмень",
  machine_name: "Трактор QA",
  equipment_name: "Дисковая борона QA",
  operation_lines: [{ planned_area_ha: 80, actual_area_ha: 82 }],
  progress_reports: progressRows,
  materials: [],
  completion_requests: [],
} as any;

const view = buildOperationPresentation(operation);
assert.equal(view.workTitle, "Дискование");
assert.equal(view.plannedAreaHa, 80);
assert.equal(view.completedAreaHa, 82);
assert.equal(view.remainingAreaHa, 0);
assert.equal(view.deviationAreaHa, 2);
assert.equal(view.progressPercent, 102.5);
assert.equal(view.details.find((row) => row.key === "depth")?.value, "12 см");
assert.equal(view.machineName, "Трактор QA");
assert.equal(view.equipmentName, "Дисковая борона QA");
assert.equal(view.agronomistComment, "Срочно");

const pending = buildOperationPresentation({
  ...operation,
  completed_area_ha: 78,
  operation_lines: [{ planned_area_ha: 80, actual_area_ha: 78 }],
  progress_reports: [{ ...progressRows[0], completed_area_ha: 78 }],
  operation_status: "awaiting_approval",
  specialist_task_status: "awaiting_approval",
  completion_requests: [
    {
      id: "request-1",
      operation_id: "operation-1",
      company_id: "company-1",
      requested_by: "specialist-1",
      planned_area_ha: 80,
      actual_area_ha: 78,
      deviation_area_ha: -2,
      variance_reason: "Часть участка недоступна",
      specialist_comment: "Готово",
      material_facts: [],
      status: "pending",
      reviewed_by: null,
      review_comment: null,
      requested_at: "2026-07-24T11:00:00Z",
      reviewed_at: null,
    },
  ],
});

assert.equal(pending.plannedAreaHa, 80);
assert.equal(pending.completedAreaHa, 78);
assert.equal(pending.deviationAreaHa, -2);
assert.equal(pending.status, "awaiting_approval");
assert.equal(pending.pendingCompletion?.actual_area_ha, 78);

const legacyIrrigation = buildOperationPresentation({
  ...operation,
  operation_type: "irrigation",
  operation_category_slug: null,
  operation_type_slug: null,
  operation_config: {},
});
assert.equal(legacyIrrigation.workTitle, "Полив");

console.log("OPERATION_PRESENTATION_TESTS=PASS");
