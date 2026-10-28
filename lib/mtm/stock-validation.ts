import { z } from "zod";
import { MTM_ASSET_KINDS, MTM_OPERATION_KINDS } from "./stock-types";

// stock_ledger_entries stores numeric(14,3). Reject extra precision instead of rounding.
// The smaller explicit bound is shared with SQL; transport remains decimal text.
export function normalizeMtmQuantity(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${integer}.${trimmed}` : integer;
}
export const mtmQuantitySchema = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/, "Количество: до 3 знаков после точки")
  .refine((value) => Number(value) <= 999999999, "Количество слишком велико")
  .transform(normalizeMtmQuantity);
const uuidOrNull = z.string().uuid().nullable();
export const mtmOperationSchema = z.object({
  companyId: z.string().uuid(), kind: z.enum(MTM_OPERATION_KINDS),
  warehouse_id: z.string().uuid(), product_id: z.string().uuid(),
  quantity: mtmQuantitySchema.refine((value) => Number(value) > 0, "Укажите положительное количество"),
  uom: z.enum(["kg", "l", "pcs"]), purpose: z.string().trim().min(1).max(1000),
  recipient_id: uuidOrNull, asset_kind: z.enum(MTM_ASSET_KINDS).nullable(), asset_id: uuidOrNull,
  task_id: uuidOrNull, original_issue_id: uuidOrNull,
}).strict().superRefine((value, ctx) => {
  const error = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.uom === "pcs" && value.quantity.includes(".")) error("quantity", "Количество штук должно быть целым");
  if (Boolean(value.asset_kind) !== Boolean(value.asset_id)) error("asset_id", "Выберите конкретную технику и её тип");
  if (value.kind === "return") {
    if (!value.original_issue_id) error("original_issue_id", "Выберите исходную выдачу");
    if (value.recipient_id || value.asset_id || value.task_id) error("original_issue_id", "Связи возврата берутся из исходной выдачи");
  } else if (value.original_issue_id) error("original_issue_id", "Исходная выдача нужна только для возврата");
  if (value.kind === "receipt" && (value.recipient_id || value.asset_id || value.task_id)) error("kind", "Приход не назначает получателя или технику");
});
export const mtmMinimumSchema = z.object({
  companyId: z.string().uuid(), warehouse_id: z.string().uuid(), product_id: z.string().uuid(),
  quantity: mtmQuantitySchema, expected_revision: z.number().int().min(0).max(2147483646),
}).strict();
export const mtmIdempotencySchema = z.string().uuid();

export function mtmStockFailure(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message || "";
  const known = (key: string, status: number, text: string) => ({ status, code: key, error: text });
  if (["42P01", "42703", "42883", "PGRST202", "PGRST205"].includes(error?.code || "") || /MTM_(?:STOCK_)?SCHEMA_NOT_READY/.test(message)) {
    return known("MTM_STOCK_SCHEMA_NOT_READY", 503, "Складские операции МТМ пока недоступны. Обратитесь к администратору.");
  }
  if (message.includes("FORBIDDEN") || error?.code === "42501") return known("MTM_FORBIDDEN", 403, "Недостаточно прав для складских операций этой компании.");
  if (message.includes("IDEMPOTENCY_CONFLICT")) return known("MTM_IDEMPOTENCY_CONFLICT", 409, "Ключ запроса уже связан с другой операцией. Не создавайте повторную операцию.");
  if (message.includes("STOCK_IDENTITY_CONFLICT")) return known("MTM_STOCK_IDENTITY_CONFLICT", 409, "Остатки этой позиции требуют сверки единиц и класса учёта. Движение не выполнено.");
  if (message.includes("UNIT_MISMATCH")) return known("MTM_UNIT_MISMATCH", 400, "Единица операции не совпадает с учётной единицей товара.");
  if (message.includes("UNSUPPORTED_ISOLATION")) return known("MTM_UNSUPPORTED_ISOLATION", 409, "Операция недоступна в текущем режиме базы. Нужна проверка администратором.");
  if (message.includes("INSUFFICIENT") || message.includes("NEGATIVE_STOCK")) return known("MTM_INSUFFICIENT_STOCK", 409, "Недостаточно доступного остатка с учётом резервов.");
  if (message.includes("RETURN_EXCEEDED")) return known("MTM_RETURN_EXCEEDED", 409, "Возврат превышает невозвращённое количество исходной выдачи.");
  if (message.includes("REVISION_CONFLICT")) return known("MTM_REVISION_CONFLICT", 409, "Минимум уже изменён. Обновите остатки перед повторной правкой.");
  if (message.includes("INVENTORY") && (message.includes("LOCK") || message.includes("BLOCK"))) return known("MTM_INVENTORY_LOCKED", 409, "На складе идёт инвентаризация. Движения временно недоступны.");
  if (message.includes("UNAVAILABLE") || message.includes("INCOMPATIBLE")) return known("MTM_ENTITY_UNAVAILABLE", 409, "Товар, склад или выбранная связь недоступны. Обновите данные.");
  if (message.includes("INVALID") || ["22P02", "22003", "23514"].includes(error?.code || "")) return known("MTM_INVALID", 400, "Проверьте количество, единицу, основание и связанные записи.");
  return known("MTM_STOCK_REQUEST_FAILED", 500, "Результат операции не подтверждён. Повторите тот же запрос с сохранённым ключом.");
}
