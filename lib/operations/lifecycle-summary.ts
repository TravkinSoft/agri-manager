import type { OperationPresentation } from "./operation-presentation";
import type { WarehouseIssueRequest } from "../types/warehouse-request";
export type LifecycleSummaryRow = {
  id: string; title: string; href: string; status: string; next: string;
  issues: string[]; date: string; timing?: string; closed: boolean;
  plannedHa?: number; completedHa?: number;
};
export type DeliveryPlan = { version: 1; timezone: string; start_hour: number; revision: number; due_at: string; planned_date: string; recipient_id: string };
export function readDeliveryPlan(config: unknown): DeliveryPlan | null {
  const d = (config as { task_delivery?: DeliveryPlan } | null)?.task_delivery;
  return d?.version === 1 ? d : null;
}
export function localCalendarDay(now: Date, timezone = "Asia/Qyzylorda"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(k => parts.find(p => p.type === k)!.value).join("-");
}
export function deliveryTiming(config: unknown, date: string, closed: boolean, now = new Date()): string | undefined {
  const d = readDeliveryPlan(config);
  if (!d || closed) return undefined;
  if (date < localCalendarDay(now, d.timezone)) return "Дата плана прошла";
  if (Date.parse(d.due_at) > now.getTime()) return "План заранее · уведомление " + new Date(d.due_at).toLocaleString("ru-RU", { timeZone: d.timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " (" + d.timezone + ")";
  return "Подготовка по плану уже актуальна";
}
export function operationSummaryRow(p: OperationPresentation, op: { id: string; operation_number?: string | null; date: string; operation_config?: unknown }, requests: WarehouseIssueRequest[], role: "specialist" | "agronomist", now = new Date()): LifecycleSummaryRow {
  const active = requests.filter(r => r.status !== "cancelled");
  const closed = ["completed", "cancelled"].includes(p.status);
  const ready = active.some(r => r.status === "ready");
  const waitingIssue = active.some(r => !r.issued_at && r.status === "received_confirmed");
  const waitingPreparation = active.some(r => ["new","active","preparing"].includes(r.status));
  const next = p.status === "cancelled" ? "Отменено — действий нет"
    : p.status === "completed" ? "Открыть принятый факт"
    : p.status === "planned" ? (role === "specialist" ? "Принять план" : "Ждём принятия специалистом")
    : p.status === "awaiting_reconciliation" ? (role === "specialist" ? "Сверить со складом чистый возврат" : "Ждём сверки склада")
    : p.status === "awaiting_approval" ? (role === "agronomist" ? "Проверить и принять отчёт" : "Ждём приёмки агрономом")
    : ready ? (role === "specialist" ? "Подтвердить получение материалов" : "Ждём получения специалистом")
    : waitingIssue ? "Ждём фактической выдачи склада"
    : waitingPreparation ? "Ждём подготовки материалов"
    : p.status === "paused" ? (role === "specialist" ? "Возобновить работу" : "Уточнить причину паузы")
    : p.status === "accepted" ? (role === "specialist" ? "Начать работу" : "Ждём начала работы")
    : role === "specialist" ? "Сдать прогресс или итоговый отчёт" : "Проверить ход работы";
  const issues: string[] = [];
  if ((p.pendingCompletion || closed) && p.status !== "cancelled" && Math.abs(p.completedAreaHa - p.plannedAreaHa) > .0001)
    issues.push("Отклонение площади: " + (p.completedAreaHa - p.plannedAreaHa).toLocaleString("ru-RU", { maximumFractionDigits: 4 }) + " га");
  const mixture = p.latestMixtureReport?.mixture_facts;
  if (mixture && mixture.remaining_l > 0) issues.push("Остаток готовой смеси " + mixture.remaining_l + " л; дальнейшее использование не оформлено");
  return { id: op.id, title: [op.operation_number, p.workTitle, p.fieldName].filter(Boolean).join(" · "),
    href: "/" + (role === "specialist" ? "tasks" : "operations") + "?operation=" + op.id,
    date: op.date, status: p.statusLabel, next, issues, closed, plannedHa: p.plannedAreaHa, completedHa: p.completedAreaHa,
    timing: deliveryTiming(op.operation_config, op.date, closed, now) };
}
export function warehouseSummaryRow(r: WarehouseIssueRequest): LifecycleSummaryRow {
  const state = r.warehouse_request_status || r.status;
  const closed = ["closed","cancelled","return_received"].includes(state);
  const returning = state === "return_expected" || Boolean(r.return_expected_at && !r.return_closed_at);
  const next = closed ? "Открыть историю сверки" : returning ? "Сверить чистый возврат и потери"
    : r.status === "received_confirmed" && !r.issued_at ? "Подтвердить фактическую выдачу"
    : r.status === "ready" ? "Ждём получения специалистом"
    : r.issued_at ? "Ждём итогового отчёта специалиста" : "Подготовить материалы";
  const issues = r.items.flatMap((i, index) => {
    const values: string[] = [];
    const label = i.product_name || "Позиция " + (index + 1);
    if (Number(i.shortage_quantity) > 0 && (r.status === "partially_issued" || returning))
      values.push(label + " · недостача: " + i.shortage_quantity + " " + i.unit);
    if (returning && Number(i.returned_quantity) > Number(i.return_received_quantity || 0))
      values.push(label + " · не сверено чистого возврата: " + (Number(i.returned_quantity) - Number(i.return_received_quantity || 0)) + " " + i.unit);
    return values;
  });
  return { id: r.id, title: [r.request_number,r.operation_number,r.operation_type,r.field_name].filter(Boolean).join(" · "),
    href: "/warehouses/requests?request=" + r.id, date: r.operation_date || r.planned_datetime?.slice(0,10) || "",
    status: closed ? "История" : returning ? "Сверка" : r.issued_at ? "Выдано" : "Подготовка и выдача",
    next, issues, closed };
}
export function summarizeLifecycle(rows: LifecycleSummaryRow[]) {
  const unique = Array.from(new Map(rows.map(r => [r.id,r])).values());
  return { rows: unique, active: unique.filter(r => !r.closed).length, discrepancies: unique.filter(r => r.issues.length > 0).length };
  // No cross-operation hectare/material total: operations can cover the same field repeatedly.
}
