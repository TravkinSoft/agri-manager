import type { SummaryShift } from "./operational-summary";

/** Operational day, not browser timezone or the date a night shift closed. */
export function summaryDayKey(value: string, startHour = 7): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.parse(value) - startHour * 3_600_000));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export function previousSummaryDay(serverTime: string, startHour = 7): string {
  return summaryDayKey(new Date(Date.parse(serverTime) - 86_400_000).toISOString(), startHour);
}
export function summaryDateLabel(day: string): string { return day.split("-").reverse().join("."); }
export function isSummaryDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

export function weighbridgePeriodOptions(shifts: SummaryShift[], serverTime: string, startHour = 7) {
  const yesterday = previousSummaryDay(serverTime, startHour);
  const closed = shifts.filter(shift => shift.closedAt || shift.status !== "open")
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  for (const shift of closed) { const day = summaryDayKey(shift.openedAt, startHour); counts.set(day, (counts.get(day) ?? 0) + 1); }
  const option = (shift: SummaryShift) => {
    const day = summaryDayKey(shift.openedAt, startHour);
    const time = new Date(shift.openedAt).toLocaleTimeString("ru-RU", { timeZone: "Asia/Qyzylorda", hour: "2-digit", minute: "2-digit" });
    return { value: shift.id, label: `${day === yesterday ? "Вчера" : summaryDateLabel(day)}${counts.get(day)! > 1 ? ` · ${time}` : ""}` };
  };
  const yesterdayShifts = closed.filter(shift => summaryDayKey(shift.openedAt, startHour) === yesterday);
  return [
    { value: "active_shift", label: shifts.some(shift => shift.status === "open" && !shift.closedAt) || !closed.length ? "Активная смена" : "Последняя закрытая смена" },
    ...(yesterdayShifts.length ? yesterdayShifts.map((shift, index) => ({ ...option(shift), value: index === 0 ? "previous_day" : shift.id })) : [{ value: "previous_day", label: "Вчера" }]),
    ...closed.filter(shift => summaryDayKey(shift.openedAt, startHour) !== yesterday).map(option),
  ];
}
