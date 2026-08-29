"use client";

import { cn } from "@/lib/utils";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";
import { formatWeightKg, formatWeightNumber } from "@/lib/weighbridge/weight-format";
import { ticketOperatorFacts } from "@/lib/weighbridge/ticket-operator";
import { transportPickerLabel } from "@/lib/weighbridge/transport";

export type WeighbridgeTicketPaperLabels = {
  company?: string | null;
  field?: string | null;
  warehouseFrom?: string | null;
  warehouseTo?: string | null;
  supplier?: string | null;
  buyer?: string | null;
  vehicle?: string | null;
  vehiclePlate?: string | null;
  trailer?: string | null;
  trailerPlate?: string | null;
  driver?: string | null;
  combineOperator?: string | null;
};

export type WeighbridgeTicketWeightEditor = {
  tareValue: string;
  moistureValue: string;
  physicalNetKg: number | null;
  disabled?: boolean;
  moistureSaving?: boolean;
  tareError?: string;
  tareInputRef?: React.Ref<HTMLInputElement>;
  onTareChange: (value: string) => void;
  onMoistureChange: (value: string) => void;
  onMoistureCommit: () => void;
};

const clean = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text && text !== "-" && text !== "—" ? text : "";
};

const isPotato = (value: unknown) => /картоф|potato/i.test(clean(value));

const first = (...values: unknown[]) => {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
};

const statusLabel = (status: string) => ({
  draft: "Черновик",
  active: "Открыт",
  ready_to_close: "Готов к завершению",
  finalized: "Завершён",
  voided: "Аннулирован",
} as Record<string, string>)[status] || status;

const operationLabel = (operation: string) => ({
  harvest_incoming: "Урожай с поля",
  supplier_receipt: "От контрагента",
  issue_to_field: "Выдача в поле",
  warehouse_transfer: "Перемещение",
  transfer_between_warehouses: "Перемещение",
  shipment_outbound: "Отгрузка",
  disposal: "Списание",
  disposal_writeoff: "Списание",
  weighbridge_impurities: "Примеси",
  impurity_removal: "Примеси",
  drying: "Сушка",
} as Record<string, string>)[operation] || operation || "Операция";

const dateTime = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const unitLabel = (unit: string | null | undefined) => {
  const value = clean(unit).toLowerCase();
  if (value === "kg" || value === "кг") return "кг";
  if (value === "l" || value === "л") return "л";
  if (value === "pcs") return "шт";
  if (value === "pack") return "уп.";
  if (value === "roll") return "бухта";
  return value || "ед.";
};

const quantity = (value: unknown, unit?: string | null) =>
  `${formatWeightNumber(value, "0")} ${unitLabel(unit)}`;

const percent = (value: unknown) => {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "";
  return `${formatWeightNumber(value)} %`;
};

function PaperSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-2 rounded border border-[#b8a788] p-2 text-sm">
      <h3 className="mb-1.5 text-center text-sm font-black tracking-wide">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <span className="text-[#5d4f3d]">{label}:</span>{" "}
      <span className={cn("break-words", strong ? "font-bold" : "font-semibold")}>{value}</span>
    </div>
  );
}

export function WeighbridgeTicketPaper({
  ticket,
  labels = {},
  className,
  headerActions,
  weightEditor,
}: {
  ticket: WeighbridgeTicket;
  labels?: WeighbridgeTicketPaperLabels;
  className?: string;
  headerActions?: React.ReactNode;
  weightEditor?: WeighbridgeTicketWeightEditor;
}) {
  const lines = ticket.lines || [];
  const mainLine = lines[0] || null;
  const isHarvest = ticket.op_type === "harvest_incoming";
  const isSupplier = ticket.op_type === "supplier_receipt";

  const company = first(labels.company, ticket.company_name, "Компания");
  const field = first(labels.field, ticket.field_name_snapshot);
  const warehouseFrom = first(labels.warehouseFrom, ticket.warehouse_from_name_snapshot);
  const warehouseTo = first(labels.warehouseTo, ticket.warehouse_to_name_snapshot);
  const supplier = first(labels.supplier, ticket.supplier_name_snapshot);
  const buyer = first(labels.buyer, ticket.buyer_name_snapshot);
  const vehicle = first(labels.vehicle, ticket.vehicle_name_snapshot);
  const vehiclePlate = first(labels.vehiclePlate, ticket.vehicle_plate_snapshot);
  const vehicleDisplay = transportPickerLabel({ name: vehicle, plate: vehiclePlate });
  const trailer = first(labels.trailer, ticket.trailer_name_snapshot);
  const trailerPlate = first(labels.trailerPlate, ticket.trailer_plate_snapshot);
  const driver = first(labels.driver, ticket.driver_name_snapshot);
  const combineOperator = first(labels.combineOperator, ticket.combine_operator_person_name);
  const operatorFacts = ticketOperatorFacts(ticket);
  const crop = first(mainLine?.product_name, mainLine?.product_name_snapshot, ticket.crop_name_snapshot);
  const variety = first(mainLine?.variety_name, mainLine?.variety_name_snapshot, ticket.variety_name_snapshot);
  const reproduction = first(mainLine?.reproduction_name, mainLine?.reproduction_name_snapshot, ticket.reproduction_name_snapshot);
  const moisture = percent(mainLine?.moisture_percent);
  const dockage = percent(mainLine?.dockage_percent);
  const dirtTare = percent(mainLine?.dirt_tare_percent);
  const openedAt = dateTime(ticket.created_at);
  const finalizedAt = dateTime(ticket.finalized_at);
  const correctionReason = first(
    ticket.correction_reason,
    ticket.correction_audit?.find((item) => clean(item.reason))?.reason
  );
  const hasWeight = [ticket.gross_weight_kg, ticket.tare_weight_kg, ticket.net_weight_kg].some(
    (value) => value != null && Number.isFinite(Number(value))
  ) || Boolean(weightEditor);
  const displayedNetKg = weightEditor
    ? weightEditor.physicalNetKg
    : ticket.physical_net_kg ?? ticket.net_weight_kg;
  const showHarvestMoisture = isHarvest && !isPotato(crop);
  const showMoisture = !isHarvest || showHarvestMoisture;
  const showMoistureEditor = Boolean(weightEditor) && showMoisture;
  const showProductLines = !isHarvest && (isSupplier ? lines.length > 1 : lines.length > 0);
  const displayedLineQuantity = (line: (typeof lines)[number]) => {
    if (lines.length === 1 && weightEditor?.physicalNetKg != null) return weightEditor.physicalNetKg;
    if (lines.length === 1 && ticket.net_weight_kg != null) return ticket.net_weight_kg;
    return line.quantity;
  };

  return (
    <article
      className={cn(
        "weighbridge-print-sheet mx-auto w-full max-w-[680px] rounded-md border border-[#b8a788] bg-[#f7f1e3] p-3 text-[#1f1b16]",
        className
      )}
      style={{ boxShadow: "inset 0 0 40px rgba(80,56,30,0.08)" }}
    >
      <header className="relative mb-2 border-b border-[#b8a788] pb-2 text-center">
        {headerActions ? <div className="absolute right-0 top-0 print:hidden">{headerActions}</div> : null}
        <div className="text-sm font-semibold tracking-wide">{company}</div>
        <div className="mt-0.5 text-2xl font-black">ВЕСОВОЙ ТАЛОН</div>
        <div className="text-base font-bold">№ {ticket.ticket_no}</div>
        <div className="mt-1 grid grid-cols-2 gap-2 text-left text-xs sm:text-sm">
          <Fact label="Статус" value={statusLabel(ticket.status)} strong />
          <Fact label="Тип операции" value={operationLabel(ticket.op_type)} strong />
        </div>
      </header>

      {isHarvest ? (
        <PaperSection title="УРОЖАЙ">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Fact label="Поле" value={field} />
            <Fact label="Место приёмки" value={warehouseTo} />
            <Fact label="Культура" value={crop} />
            <Fact label="Сорт" value={variety} />
            <Fact label="Репродукция" value={reproduction} />
            <Fact label="Комбайнер" value={combineOperator} strong />
          </div>
        </PaperSection>
      ) : (
        <PaperSection title={isSupplier ? "ПОСТАВКА" : "ОПЕРАЦИЯ"}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {isSupplier ? <Fact label="Контрагент" value={supplier || "Не указан"} /> : null}
            {ticket.op_type === "issue_to_field" ? <Fact label="Поле" value={field || "Не указано"} /> : null}
            <Fact label="Склад отправления" value={warehouseFrom} />
            <Fact label="Склад назначения" value={warehouseTo} />
            <Fact label="Покупатель" value={buyer} />
            {isSupplier && lines.length === 1 ? <Fact label="Товар" value={first(mainLine?.product_name, mainLine?.product_name_snapshot)} /> : null}
            {isSupplier && lines.length === 1 ? <Fact label="Количество" value={quantity(mainLine?.quantity, mainLine?.uom)} /> : null}
          </div>
        </PaperSection>
      )}

      {(vehicleDisplay || trailer || driver) ? (
        <PaperSection title="ТРАНСПОРТ">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Fact label="Машина" value={vehicleDisplay} strong />
            <Fact label="Прицеп" value={[trailer, trailerPlate].filter(Boolean).join(" · ")} />
            <Fact label="Водитель" value={driver} strong />
          </div>
        </PaperSection>
      ) : null}

      {hasWeight || (showMoisture && moisture) || dockage || dirtTare ? (
        <PaperSection title="ВЕС И КАЧЕСТВО">
          {hasWeight ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              {ticket.gross_weight_kg != null ? <div><div className="text-xs text-[#5d4f3d]">Брутто</div><div className="text-lg font-bold">{formatWeightKg(ticket.gross_weight_kg)}</div></div> : null}
              {weightEditor ? (
                <label className="block text-left">
                  <span className="block text-center text-xs text-[#5d4f3d]">Тара</span>
                  <input
                    ref={weightEditor.tareInputRef}
                    inputMode="decimal"
                    value={weightEditor.tareValue}
                    onChange={(event) => weightEditor.onTareChange(event.target.value)}
                    disabled={weightEditor.disabled}
                    aria-label="Тара, кг"
                    className="mt-0.5 h-9 w-full rounded border border-[#9e8967] bg-white/70 px-2 text-center text-base font-bold outline-none focus:border-[#8a6b22] focus:ring-2 focus:ring-[#d7ae35]/40"
                  />
                </label>
              ) : ticket.tare_weight_kg != null ? <div><div className="text-xs text-[#5d4f3d]">Тара</div><div className="text-lg font-bold">{formatWeightKg(ticket.tare_weight_kg)}</div></div> : null}
              <div className="rounded border-2 border-[#7b633f] bg-[#eee2ca] px-1 py-1">
                <div className="text-xs font-bold text-[#5d4f3d]">Нетто</div>
                <div className="text-xl font-black">{displayedNetKg == null ? "—" : formatWeightKg(displayedNetKg)}</div>
              </div>
            </div>
          ) : null}
          {weightEditor?.tareError ? <div className="mt-1 text-xs font-semibold text-red-700">{weightEditor.tareError}</div> : null}
          {showMoistureEditor && weightEditor ? (
            <div className="mt-2 border-t border-[#c7b797] pt-2">
              <label className="flex items-center justify-between gap-3 rounded border border-[#9e8967] bg-white/45 px-2 py-1.5">
                <span className="font-semibold text-[#5d4f3d]">Влажность, %</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="99.9"
                  step="0.1"
                  value={weightEditor.moistureValue}
                  onChange={(event) => weightEditor.onMoistureChange(event.target.value)}
                  onBlur={weightEditor.onMoistureCommit}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    weightEditor.onMoistureCommit();
                  }}
                  disabled={weightEditor.disabled || weightEditor.moistureSaving}
                  aria-label="Влажность, %"
                  className="h-9 w-28 rounded border border-[#9e8967] bg-white/80 px-2 text-right text-base font-bold outline-none focus:border-[#8a6b22] focus:ring-2 focus:ring-[#d7ae35]/40"
                />
              </label>
            </div>
          ) : null}
          {(!showMoistureEditor && ((showMoisture && moisture) || dockage || dirtTare)) ? (
            <div className={cn("grid grid-cols-2 gap-2", hasWeight && "mt-2 border-t border-[#c7b797] pt-2")}>
              {showMoisture ? <Fact label="Влажность" value={moisture} /> : null}
              <Fact label="Примеси" value={dockage} />
              <Fact label="Сорная примесь" value={dirtTare} />
            </div>
          ) : null}
        </PaperSection>
      ) : null}

      {showProductLines ? (
        <PaperSection title="ТОВАРЫ В ДОКУМЕНТЕ">
          <div className="space-y-1 text-xs">
            {lines.map((line, index) => (
              <div key={line.id || index} className="grid grid-cols-[22px_1fr_auto] gap-2 border-b border-[#c7b797] pb-1 last:border-0 last:pb-0">
                <div className="font-bold">{index + 1}.</div>
                <div className="font-semibold">{first(line.product_name, line.product_name_snapshot, "Товар")}</div>
                <div className="text-right font-bold">{quantity(displayedLineQuantity(line), line.uom)}</div>
              </div>
            ))}
          </div>
        </PaperSection>
      ) : null}

      <PaperSection title="ДОКУМЕНТ">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Fact label="Открыт" value={openedAt} />
          <Fact label="Завершён" value={finalizedAt} />
            {operatorFacts.map((fact) => <Fact key={fact.label} label={fact.label} value={fact.value} />)}
          <Fact label="Номер документа" value={first(ticket.supplier_document_no)} />
          <Fact label={isHarvest ? "Бумажный документ" : "Внешний документ"} value={first(ticket.external_document_no)} />
          <Fact label="Комментарий" value={first(ticket.notes)} />
          {ticket.status === "voided" ? <Fact label="Причина аннулирования" value={first(ticket.void_reason)} /> : null}
          {ticket.correction_of_ticket ? <Fact label="Исправление талона" value={`№ ${ticket.correction_of_ticket.ticket_no}`} /> : null}
          {ticket.replacement_ticket ? <Fact label="Исправлен талоном" value={`№ ${ticket.replacement_ticket.ticket_no}`} /> : null}
          {(ticket.correction_of_ticket || ticket.replacement_ticket || correctionReason) ? <Fact label="Причина исправления" value={correctionReason} /> : null}
        </div>
      </PaperSection>
    </article>
  );
}
