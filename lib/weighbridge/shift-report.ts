export type WeighbridgeShiftReport = {
  version: string; reportVersion: 2; shiftId: string; reviewToken: string;
  companyName: string; operatorName: string | null; openedAt: string; closedAt: string | null; capturedAt: string;
  ticketCount: number; closedTicketCount: number; voidedTicketCount: number; replacedTicketCount: number;
  openTicketCount: number; unsyncedTicketCount: number; manualCorrectionCount: number;
  harvestReceiptCount: number; potatoReceiptCount: number; impurityTripCount: number;
  potatoNetKg: number; potatoPeriodImpuritiesKg: number | null; potatoPeriodResultKg: number | null; potatoPeriodImpurityTripCount?: number;
  potatoCleanKg: number; impuritiesRemovedKg: number; periodAccountingBasis: string;
  operations: Array<{ op_type: string; trips: number; net_kg: number }>;
  plots: Array<{ field_id: string | null; crop_structure_allocation_id: string | null; field_name: string; crop_name: string; variety_name?: string; reproduction_name?: string; warehouse_name?: string; trips: number; net_kg: number; clean_kg: number }>;
  tickets: Array<{ id: string; ticket_no: string; op_type: string; status: string; is_finalized: boolean; created_at: string; finalized_at: string | null;
    gross_weight_kg: number | null; tare_weight_kg: number | null; net_weight_kg: number | null;
    is_voided: boolean; replacement_ticket_id: string | null; driver_name: string; vehicle_plate: string; vehicle_name: string;
    field_name: string; crop_name: string; variety_name: string; reproduction_name: string; warehouse_from: string; warehouse_to: string }>;
};

export function isWeighbridgeShiftReport(value: unknown): value is WeighbridgeShiftReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<WeighbridgeShiftReport>;
  return report.reportVersion === 2 && typeof report.shiftId === "string" && typeof report.reviewToken === "string"
    && Number.isFinite(report.closedTicketCount) && Number.isFinite(report.openTicketCount)
    && Array.isArray(report.operations) && Array.isArray(report.plots) && Array.isArray(report.tickets);
}

export function canCloseWeighbridgeReport(report: WeighbridgeShiftReport | null): boolean {
  return !!report && !report.closedAt && report.openTicketCount === 0 && report.unsyncedTicketCount === 0
    && report.potatoPeriodResultKg != null;
}

const OPERATION_LABELS: Record<string, string> = {
  harvest_incoming: "Урожай с поля", weighbridge_impurities: "Вывоз примесей", shipment: "Отгрузка",
  outgoing: "Отгрузка", transfer: "Перемещение", warehouse_transfer: "Перемещение", supplier_receipt: "Поставка",
  processing: "Переработка", processing_output: "Выход переработки", processing_input: "В переработку",
  shipment_outbound: "Отгрузка", issue_to_field: "Выдача в поле", disposal: "Списание", drying: "Сушка",
};
export const shiftOperationLabel = (value: string) => OPERATION_LABELS[value] || value;
export const shiftReportKg = (value: number | null | undefined) => value != null && Number.isFinite(value)
  ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг` : "Не определено";
export const shiftReportTime = (value: string) => new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Qyzylorda" });
