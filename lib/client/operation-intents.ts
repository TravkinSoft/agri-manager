import { supabase } from "@/lib/supabase/client";

export type OperationIntent = {
  key: string; userId: string; companyId: string; operationId: string; action: string;
  payload: Record<string, unknown>; createdAt: string;
};
const prefix = "tf-operation-intent-v1:";
const storageKey = (intent: Pick<OperationIntent, "userId" | "companyId" | "operationId">) =>
  prefix + [intent.userId, intent.companyId, intent.operationId].join(":");
const changed = () => window.dispatchEvent(new Event("tf-operation-intents"));
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value);
};
export function pendingOperationIntents(userId: string, companyId: string): OperationIntent[] {
  const results: OperationIntent[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix + userId + ":" + companyId + ":")) continue;
    const intent = JSON.parse(localStorage.getItem(key) || "null") as OperationIntent | null;
    if (intent?.key && intent.userId === userId && intent.companyId === companyId) results.push(intent);
  }
  return results;
}
export async function retryOperationIntent(intent: OperationIntent) {
  const { data } = await supabase.auth.getSession();
  if (!data.session || data.session.user.id !== intent.userId) throw new Error("Войдите в ту же учётную запись, чтобы проверить отправку.");
  const warehouseReturn = intent.action === "warehouse_return";
  const endpoint = warehouseReturn ? "/api/material-requests/" + encodeURIComponent(intent.operationId) + "/warehouse-return" : "/api/operations/" + encodeURIComponent(intent.operationId) + "/lifecycle";
  const body = warehouseReturn ? { ...intent.payload, companyId: intent.companyId, idempotency_key: intent.key } : { companyId: intent.companyId, action: intent.action, payload: intent.payload, idempotency_key: intent.key };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.session.access_token, "Idempotency-Key": intent.key },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    // Auth and uncertain transport failures retain the exact saved intent for relogin/retry.
    if ([400, 404, 409].includes(response.status)) { localStorage.removeItem(storageKey(intent)); changed(); }
    throw new Error(result.error || "Ответ не получен. Проверьте сохранённую отправку.");
  }
  localStorage.removeItem(storageKey(intent)); changed();
  return result;
}
export async function submitOperationIntent(companyId: string, operationId: string, action: string, payload: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Для отправки войдите в систему.");
  const proposed: OperationIntent = { key: crypto.randomUUID(), userId: data.session.user.id, companyId, operationId, action, payload, createdAt: new Date().toISOString() };
  const key = storageKey(proposed);
  const saved = localStorage.getItem(key);
  const intent: OperationIntent = saved ? JSON.parse(saved) : proposed;
  if (intent.action !== action || canonical(intent.payload) !== canonical(payload)) throw new Error("Сначала проверьте предыдущую отправку этой задачи. Её результат пока не подтверждён.");
  // Synchronous persistence precedes all network I/O. If storage is unavailable, do not send.
  if (!saved) { localStorage.setItem(key, JSON.stringify(intent)); changed(); }
  return retryOperationIntent(intent);
}
