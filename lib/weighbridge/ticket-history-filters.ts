export const HISTORY_TIME_ZONE = "Asia/Qyzylorda";
export const HISTORY_OPERATIONS: Record<string, string> = {
  harvest_incoming: "Урожай с поля", weighbridge_impurities: "Вывоз земли и примесей",
  supplier_receipt: "Поставка", warehouse_transfer: "Перемещение", shipment_outbound: "Отгрузка",
  issue_to_field: "Выдача в поле", disposal: "Списание", drying: "Сушка",
};
export type TicketHistoryFilters = {
  shiftId?: string; from?: string; to?: string; operation?: string; status?: "finalized" | "voided";
};
export type TicketHistoryShift = { id: string; status: string; opened_at: string; closed_at: string | null };

export function historyDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: HISTORY_TIME_ZONE, day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

// Business dates must not depend on the browser's OS time zone.
export function historyDay(offset = 0, now = new Date()): string {
  return new Date(now.getTime() + 5 * 60 * 60 * 1000 + offset * 86400000).toISOString().slice(0, 10);
}

export function historyPeriod(fromDate: string, fromTime: string, toDate: string, toTime: string): TicketHistoryFilters {
  const parse = (date: string, time: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Укажите дату и время начала и конца периода.");
    const value = Date.parse(`${date}T${time}:00+05:00`);
    if (!Number.isFinite(value) || new Date(value + 5 * 3600000).toISOString().slice(0, 16) !== `${date}T${time}`) throw new Error("Проверьте дату периода.");
    return value;
  };
  const from = parse(fromDate, fromTime);
  const lastMinute = parse(toDate, toTime);
  if (lastMinute < from) throw new Error("Конец периода должен быть не раньше начала.");
  // Inclusive UI minute -> exclusive SQL upper bound, including its seconds/microseconds.
  return { from: new Date(from).toISOString(), to: new Date(lastMinute + 60000).toISOString() };
}

export function parseTicketHistoryFilters(params: URLSearchParams): TicketHistoryFilters {
  const result: TicketHistoryFilters = {};
  const shiftId = params.get("historyShiftId");
  if (shiftId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shiftId)) throw new Error("Некорректная смена истории.");
    result.shiftId = shiftId;
  }
  for (const [param, key] of [["historyFrom", "from"], ["historyTo", "to"]] as const) {
    const value = params.get(param);
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Некорректная дата истории.");
    const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Некорректная дата истории.");
    result[key] = value;
  }
  if (result.from && result.to && Date.parse(result.from) >= Date.parse(result.to)) throw new Error("Проверьте начало и конец периода.");
  const operation = params.get("historyOperation");
  if (operation) {
    if (!Object.prototype.hasOwnProperty.call(HISTORY_OPERATIONS, operation)) throw new Error("Неизвестный тип операции.");
    result.operation = operation;
  }
  const status = params.get("historyStatus");
  if (status) {
    if (status !== "finalized" && status !== "voided") throw new Error("Неизвестный статус талона.");
    result.status = status;
  }
  return result;
}
