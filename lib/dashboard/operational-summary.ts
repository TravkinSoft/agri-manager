import type { WeighbridgeShiftReport } from "@/lib/weighbridge/shift-report";

export type SummaryPresence = {
  companyId: string; readOnly: true; serverTime: string;
  weighbridge: { lastSeenAt: string | null; shift?: SummaryShift | null };
  combine: { lastSeenAt: string | null; shift?: SummaryShift | null };
};
export const PRESENCE_TTL_MS = 90_000;
export function presenceState(lastSeenAt: string | null, now: number, healthy = true): "online" | "offline" | "unknown" {
  if (!healthy || !lastSeenAt || !Number.isFinite(Date.parse(lastSeenAt))) return "unknown";
  const age = now - Date.parse(lastSeenAt);
  if (age < -5000) return "unknown";
  return age <= PRESENCE_TTL_MS ? "online" : "offline";
}
export type SummaryShift = { id: string; status: string; openedAt: string; closedAt: string | null };
export function summaryShiftLabel(shift: SummaryShift | null | undefined, healthy: boolean): string {
  if (!healthy || shift === undefined) return "Проверяем смену";
  if (!shift) return "Смена не открыта";
  if (shift.closedAt) return "Смена закрыта";
  return shift.status === "open" ? "Смена открыта" : "Проверяем смену";
}
export function presenceLabel(state: ReturnType<typeof presenceState>): string {
  return state === "online" ? "Онлайн" : state === "offline" ? "Нет сигнала" : "Ждём сигнал";
}
export type WeighbridgeOperationalSummary = {
  companyId: string; readOnly: true; serverTime: string;
  operationalDayStartHour?: number;
  shifts: SummaryShift[]; selectedShift: SummaryShift | null;
  report: null | Pick<WeighbridgeShiftReport, "operatorName" | "potatoNetKg" | "potatoPeriodImpuritiesKg" | "potatoPeriodResultKg" | "potatoReceiptCount" | "openTicketCount" | "unsyncedTicketCount" | "capturedAt" | "impurityAdjustmentKg" | "impurityAdjustmentCount" | "periodPlots">;
};
export type SummaryStock = {
  companyId: string; readOnly: true; serverTime: string; totalKg: number;
  warehouses: Array<{ id: string; name: string; totalKg: number; lastReceiptAt: string | null;
    parties: Array<{ id: string; label: string; season: string; kg: number }> }>;
};
export const summaryKg = (value: number | null | undefined) => value != null && Number.isFinite(value)
  ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг` : "Нет данных";
export const summaryTime = (value: string) => new Date(value).toLocaleString("ru-RU", {
  timeZone: "Asia/Qyzylorda", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});
export function impurityPercent(receivedKg: number, removedKg: number | null): number | null {
  return receivedKg > 0 && removedKg != null && Number.isFinite(removedKg) ? removedKg / receivedKg * 100 : null;
}
/** Use the close-preview accounting fields, never the differently scoped receipt-cohort clean mass. */
export function projectShiftReport(report: WeighbridgeShiftReport): NonNullable<WeighbridgeOperationalSummary["report"]> {
  return { operatorName: report.operatorName, potatoNetKg: report.potatoNetKg,
    potatoPeriodImpuritiesKg: report.potatoPeriodImpuritiesKg, potatoPeriodResultKg: report.potatoPeriodResultKg,
    potatoReceiptCount: report.potatoReceiptCount, openTicketCount: report.openTicketCount,
    unsyncedTicketCount: report.unsyncedTicketCount, capturedAt: report.capturedAt,
    impurityAdjustmentKg: report.impurityAdjustmentKg, impurityAdjustmentCount: report.impurityAdjustmentCount,
    periodPlots: report.periodPlots };
}
