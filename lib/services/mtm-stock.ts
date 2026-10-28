import { supabase } from "@/lib/supabase/client";
import type { MtmMinimumRequest, MtmMinimumResponse, MtmOperation, MtmOperationsResponse, MtmStockOptionKind, MtmStockOptionsResponse, MtmStockResponse } from "@/lib/mtm/stock-types";
import type { MtmPendingRequest } from "@/lib/mtm/stock-client-state";
import { normalizeMtmQuantity } from "@/lib/mtm/stock-validation";

export class MtmStockApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); }
}

export function isConfirmedMtmRejection(error: unknown, firstAttempt: boolean): boolean {
  // Even an authoritative rejection of a retry cannot settle an earlier unknown outcome.
  if (!firstAttempt || !(error instanceof MtmStockApiError)) return false;
  if (error.status === 400) return ["MTM_INVALID", "MTM_UNIT_MISMATCH"].includes(error.code || "");
  return error.status === 409 && ["MTM_INSUFFICIENT_STOCK", "MTM_RETURN_EXCEEDED", "MTM_REVISION_CONFLICT", "MTM_INVENTORY_LOCKED", "MTM_ENTITY_UNAVAILABLE", "MTM_STOCK_IDENTITY_CONFLICT"].includes(error.code || "");
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (init.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  if (error || !data.session?.access_token) throw new MtmStockApiError("Сессия истекла. Войдите снова.", 401);
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new MtmStockApiError(payload?.error || "Не удалось выполнить запрос склада МТМ.", response.status, payload?.code);
  if (!payload || typeof payload !== "object") throw new MtmStockApiError("Сервер не подтвердил результат запроса.", 500, "MTM_UNCONFIRMED_RESPONSE");
  return payload as T;
}

type Page = { companyId: string; search?: string; offset?: number; limit?: number };
function query(values: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  return params.toString();
}

export async function getMtmStock(values: Page & { warehouseId?: string; belowMinimum?: boolean }, signal?: AbortSignal) {
  const data = await request<MtmStockResponse>(`/api/mtm/stock?${query(values)}`, { signal });
  if (!Array.isArray(data.items) || typeof data.total !== "number" || typeof data.can_operate !== "boolean" || typeof data.can_manage_minimums !== "boolean") throw new MtmStockApiError("Не удалось получить подтверждённые остатки.", 500);
  return data;
}
export async function getMtmOperations(values: Omit<Page, "search"> & { warehouseId?: string; productId?: string }, signal?: AbortSignal) {
  const data = await request<MtmOperationsResponse>(`/api/mtm/operations?${query(values)}`, { signal });
  if (!Array.isArray(data.items) || typeof data.total !== "number") throw new MtmStockApiError("Не удалось получить журнал операций.", 500);
  return data;
}
export async function getMtmStockOptions(values: Page & { kind: MtmStockOptionKind }, signal?: AbortSignal) {
  const data = await request<MtmStockOptionsResponse>(`/api/mtm/stock-options?${query(values)}`, { signal });
  if (!Array.isArray(data.items) || typeof data.total !== "number") throw new MtmStockApiError("Не удалось получить справочник.", 500);
  return data;
}
export async function postMtmOperation(pending: MtmPendingRequest) {
  const result = await request<{ operation: MtmOperation }>("/api/mtm/operations", { method: "POST", headers: { "Idempotency-Key": pending.key }, body: pending.body });
  const operation = result.operation;
  const sent = JSON.parse(pending.body);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!operation?.id || operation.id !== pending.key || !uuid.test(operation.id) || !uuid.test(operation.ledger_entry_id || "") || !uuid.test(operation.inventory_transaction_id || "")
    || operation.company_id !== sent.companyId || operation.kind !== sent.kind
    || operation.warehouse_id !== sent.warehouse_id || operation.product_id !== sent.product_id
    || operation.uom !== sent.uom || typeof operation.quantity !== "string"
    || !/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(operation.quantity)
    || normalizeMtmQuantity(operation.quantity) !== normalizeMtmQuantity(sent.quantity) || operation.purpose !== sent.purpose.trim()
    || (operation.original_issue_id || null) !== (sent.original_issue_id || null)
    || (sent.kind !== "return" && ((operation.recipient_id || null) !== (sent.recipient_id || null)
      || (operation.asset_kind || null) !== (sent.asset_kind || null) || (operation.asset_id || null) !== (sent.asset_id || null)
      || (operation.task_id || null) !== (sent.task_id || null)))) {
    throw new MtmStockApiError("Операция не подтверждена сервером. Проверьте тот же запрос.", 500, "MTM_UNCONFIRMED_RESPONSE");
  }
  return operation;
}
export async function saveMtmMinimum(body: MtmMinimumRequest) {
  const result = await request<MtmMinimumResponse>("/api/mtm/minimums", { method: "PUT", body: JSON.stringify(body) });
  if (typeof result.minimum_quantity !== "string" || !/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(result.minimum_quantity) || normalizeMtmQuantity(result.minimum_quantity) !== normalizeMtmQuantity(body.quantity) || !Number.isInteger(result.minimum_revision) || result.minimum_revision !== body.expected_revision + 1) throw new MtmStockApiError("Изменение минимума не подтверждено. Обновите данные.", 500);
  return result;
}
