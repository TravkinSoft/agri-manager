import { z } from "zod";
import { MTM_CATEGORIES, MTM_MODEL_KINDS } from "./types";

const nullableText = (max: number) => z.string().trim().max(max).nullable().transform((value) => value || null);
export const mtmApplicabilitySchema = z.object({
  model_kind: z.enum(MTM_MODEL_KINDS),
  model_id: z.string().uuid(),
  node: z.string().trim().min(1).max(200),
  status: z.enum(["pending", "confirmed", "rejected"]),
  source: nullableText(1000),
  restrictions: nullableText(1000),
}).strict().superRefine((entry, context) => {
  if (entry.status === "confirmed" && !entry.source) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["source"], message: "Укажите источник подтверждённой применяемости" });
  }
});

export const mtmSaveSchema = z.object({
  companyId: z.string().uuid(),
  expected_revision: z.number().int().min(0).max(2147483646),
  category: z.enum(MTM_CATEGORIES),
  part_number: nullableText(200),
  barcode: nullableText(128).refine((value) => value === null || !/[\u0000-\u001f\u007f]/.test(value), "Штрихкод содержит управляющие символы"),
  internal_code: nullableText(200),
  specifications: z.string().trim().min(1).max(4000),
  accounting_unit_note: z.string().trim().min(1).max(500),
  applicability: z.array(mtmApplicabilitySchema).max(100),
}).strict().superRefine((value, context) => {
  const keys = value.applicability.map((entry) => JSON.stringify([entry.model_kind, entry.model_id.toLowerCase(), entry.node, entry.restrictions]));
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["applicability"], message: "Одинаковая применяемость указана повторно" });
  }
});

export function parseMtmPage(params: URLSearchParams) {
  const offset = Number(params.get("offset") ?? 0);
  const limit = Number(params.get("limit") ?? 25);
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("MTM_INVALID_PAGE");
  }
  const search = (params.get("search") || "").trim();
  const barcode = (params.get("barcode") || "").trim();
  if (search.length > 200 || barcode.length > 128 || /[\u0000-\u001f\u007f]/.test(search + barcode)) {
    throw new Error("MTM_INVALID_SEARCH");
  }
  return { offset, limit, search, barcode };
}

export function mtmDatabaseFailure(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message || "";
  if (["42P01", "42703", "42883", "PGRST202", "PGRST205"].includes(error?.code || "")) {
    return { status: 503, code: "MTM_SCHEMA_NOT_READY", error: "Каталог МТМ пока недоступен. Обратитесь к администратору." };
  }
  if (message.includes("MTM_REVISION_CONFLICT")) return { status: 409, code: "MTM_REVISION_CONFLICT", error: "Карточка уже изменена. Обновите каталог и повторите правку." };
  if (message.includes("MTM_BARCODE_CONFLICT")) return { status: 409, code: "MTM_BARCODE_CONFLICT", error: "Этот штрихкод уже используется другим товаром компании." };
  if (message.includes("MTM_FORBIDDEN") || error?.code === "42501") return { status: 403, code: "MTM_FORBIDDEN", error: "Недостаточно прав для работы с каталогом этой компании." };
  if (message.includes("MTM_PRODUCT_UNAVAILABLE")) return { status: 409, code: "MTM_PRODUCT_UNAVAILABLE", error: "Товар недоступен: проверьте компанию, категорию и архивный статус." };
  if (message.includes("MTM_MODEL_UNAVAILABLE")) return { status: 409, code: "MTM_MODEL_UNAVAILABLE", error: "Одна из моделей техники недоступна в существующем справочнике." };
  if (message.includes("MTM_INVALID")) return { status: 400, code: "MTM_INVALID", error: "Проверьте реквизиты карточки, источник применяемости и единицу учёта." };
  return { status: 500, code: "MTM_REQUEST_FAILED", error: "Не удалось выполнить запрос каталога МТМ." };
}
