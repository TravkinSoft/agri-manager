import { PlanCalculationError } from "@/lib/materials/operation-plan-calculation";

type JsonObject = Record<string, any>;
const protectedContext = new Set([
  "season_id", "season_year", "field_id", "crop_structure_id", "crop_id", "variety_id", "reproduction_id",
  "scope", "target_scope", "crop_requirement", "land_use_type", "targets", "target_count", "seed_material_context",
]);
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

function mergeParameters(stored: JsonObject, patch: JsonObject, depth = 0): JsonObject {
  if (depth > 32) throw new PlanCalculationError("Слишком глубокая структура параметров плана.");
  const result = { ...stored };
  for (const [key, value] of Object.entries(patch)) {
    if (protectedContext.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) continue;
    result[key] = object(value) ? mergeParameters(object(stored[key]) ? stored[key] : {}, value, depth + 1) : value;
  }
  return result;
}

/** A calculation revision may edit parameters, purposes and mixture settings.
 * Identity, targets, workflow, provenance and unknown existing metadata remain server-owned.
 * The DB repeats this merge under the operation lock for direct RPC/DML callers. */
export function mergeTreatmentPlanContext(storedValue: unknown, requestedValue: unknown): JsonObject {
  const stored = object(storedValue) ? storedValue : {};
  if (requestedValue !== undefined && !object(requestedValue)) {
    throw new PlanCalculationError("Параметры плана должны быть объектом.");
  }
  const requested = (requestedValue || {}) as JsonObject;
  const result = { ...stored };
  for (const key of ["operation_params", "tank_mix"] as const) {
    if (!Object.hasOwn(requested, key)) continue;
    if (!object(requested[key])) throw new PlanCalculationError(`Поле ${key} должно быть объектом.`);
    result[key] = mergeParameters(object(stored[key]) ? stored[key] : {}, requested[key]);
  }
  if (Object.hasOwn(requested, "purposes")) {
    if (!Array.isArray(requested.purposes) || requested.purposes.some((p: unknown) => typeof p !== "string")) {
      throw new PlanCalculationError("Цели операции должны быть списком строк.");
    }
    result.purposes = requested.purposes;
  }
  return result;
}
