"use client";
import { useEffect, useState } from "react";
import { useSummaryResource } from "./use-summary-resource";
import { SummaryFieldYield, type SummaryFieldYieldProps } from "./summary-field-yield";
import type { SelectedSummaryShift } from "./summary-section-tabs";
import { impurityPercent, summaryTime, type SummaryStock, type WeighbridgeOperationalSummary } from "@/lib/dashboard/operational-summary";
import { summaryClock, summaryTonnes } from "@/lib/dashboard/summary-presentation";
import { weighbridgePeriodOptions } from "@/lib/dashboard/summary-periods";

const SHIFT_TABLES = ["tickets", "ticket_lines", "ticket_weighings", "weighbridge_shifts", "stock_ledger_entries", "weighbridge_impurity_adjustments", "weighbridge_impurity_adjustment_reversals"];
const STOCK_TABLES = ["tickets", "stock_ledger_entries", "inventory_batches", "warehouses", "harvest_lots", "harvest_lot_batches"];

export function SummaryReadError({ error }: { error: string | null }) {
  return error ? <p role="status" className="border-l-2 border-amber-500 pl-2 text-xs text-amber-700 dark:text-amber-300">{error}</p> : null;
}

export function WeighbridgeOperationalView({ data }: { data: WeighbridgeOperationalSummary }) {
  const [plotId, setPlotId] = useState("");
  const shift = data.selectedShift, report = data.report;
  if (!shift) return <p className="py-2 text-sm text-muted-foreground">Смен весовой пока нет.</p>;
  if (!report) return <p role="status" className="py-2 text-sm text-muted-foreground">Отчёт этой смены недоступен.</p>;
  const plots = report.periodPlots ?? [];
  const plot = plots.find(item => item.cropStructureId === plotId);
  const received = plot ? plot.receivedKg : report.potatoNetKg;
  const removed = plot ? plot.removedKg : report.potatoPeriodImpuritiesKg;
  const clean = plot ? plot.resultKg : report.potatoPeriodResultKg;
  const percent = impurityPercent(received, removed);
  return <section className="space-y-2" aria-label="Результат смены весовой">
    <div>
      <div className="flex min-h-8 items-center justify-between gap-2 border-b border-border text-xs text-muted-foreground">
        <h3>За смену</h3>
        {plots.length > 1 ? <select aria-label="Поле в результате смены" value={plot?.cropStructureId ?? ""} onChange={event => setPlotId(event.target.value)} className="min-h-9 min-w-0 max-w-[75%] bg-transparent text-xs text-foreground">
          <option value="">Все поля</option>{plots.map(item => <option key={item.cropStructureId} value={item.cropStructureId}>{item.fieldName} · {item.areaHa} га</option>)}
        </select> : <span>{plots.length === 1 ? `${plots[0].fieldName} · ${plots[0].areaHa} га` : "Все поля"}</span>}
      </div>
      <dl className="divide-y divide-border text-sm">
        <div className="flex items-baseline justify-between gap-2 py-2"><dt>Всего принято</dt><dd className="shrink-0 font-medium tabular-nums">{summaryTonnes(received)}</dd></div>
        <div className="flex items-baseline justify-between gap-2 py-2"><dt>Примеси</dt><dd className="shrink-0 font-medium tabular-nums">{summaryTonnes(removed)} <span className="ml-1 text-xs font-normal text-muted-foreground">{percent == null ? "" : `${percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</span></dd></div>
        <div className="flex items-baseline justify-between gap-2 py-2 font-semibold"><dt>Чистый картофель</dt><dd className="shrink-0 tabular-nums text-[color:var(--manor-brass-soft)]" data-testid="shift-clean-kg">{summaryTonnes(clean)}</dd></div>
      </dl>
    </div>
    {clean == null ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Итог уточняется: не определён источник части примесей.</p> : null}
    {clean != null && clean < 0 ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Вывоз примесей больше прихода за смену. Нужна сверка.</p> : null}
    {report.openTicketCount > 0 ? <p className="text-xs text-muted-foreground">Ещё взвешиваются: {report.openTicketCount}</p> : null}
    {report.unsyncedTicketCount > 0 ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Итог неполный: не получены талоны ({report.unsyncedTicketCount}).</p> : null}
  </section>;
}

export function PotatoStockView({ data }: { data: SummaryStock }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? data.warehouses : data.warehouses.slice(0, 3);
  return <section className="space-y-1" aria-label="Картофель на складах сейчас">
    <header className="flex min-h-9 items-center justify-between gap-2"><h2 className="text-sm font-semibold">Наличие сейчас</h2>
      {data.warehouses.length > 3 ? <button type="button" aria-expanded={showAll} className="min-h-9 px-1 text-xs text-muted-foreground underline underline-offset-4" onClick={() => setShowAll(value => !value)}>{showAll ? "Свернуть" : `Ещё ${data.warehouses.length - 3}`}</button> : null}</header>
    <table className="w-full table-fixed text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="w-[66%] py-2 text-left font-normal">Склад · партия</th><th className="py-2 text-right font-normal">Остаток, т</th></tr></thead>
    <tbody className="divide-y divide-border">{visible.map((warehouse, index) => <tr key={warehouse.id}>
      <td className="py-2 pr-2 align-top"><h3 className="font-medium">{warehouse.name}</h3>
      {warehouse.parties.length === 1 && warehouse.parties[0].kg === warehouse.totalKg
        ? <p title={`Сезон ${warehouse.parties[0].season}`} className="mt-0.5 text-xs text-muted-foreground">{warehouse.parties[0].label}{index === 0 && warehouse.lastReceiptAt ? <span className="text-[10px]"> · последний приход</span> : null}</p>
        : <details className="mt-0.5 text-xs"><summary className="cursor-pointer text-muted-foreground">По партиям ({warehouse.parties.length})</summary>
          <div className="mt-1 space-y-1">{warehouse.parties.map(party => <div key={party.id} className="flex justify-between gap-2"><span>{party.label} · {party.season}</span><span className={`shrink-0 tabular-nums ${party.kg < 0 ? "text-amber-600" : ""}`}>{summaryTonnes(party.kg)}</span></div>)}</div>
        </details>}
      {warehouse.parties.some(party => party.kg < 0) ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Отрицательный остаток — нужна сверка</p> : null}
      </td><td className={`py-2 text-right align-top font-semibold tabular-nums ${warehouse.totalKg < 0 ? "text-amber-600" : ""}`}>{summaryTonnes(warehouse.totalKg).replace(/ т$/, "")}</td>
    </tr>)}</tbody></table>
    {data.warehouses.length > 1 ? <p className="flex justify-between gap-2 border-t border-border py-2 text-sm"><span>Всего картофеля</span><strong className="tabular-nums" data-testid="stock-total-kg">{summaryTonnes(data.totalKg)}</strong></p> : null}
    {!data.warehouses.length ? <p className="text-xs text-muted-foreground">Остатков картофеля нет.</p> : null}
  </section>;
}

export function WeighbridgeOperationalPanel({ scope, companyId, enabled, yieldProps, onShift }: {
  scope: string; companyId: string; enabled: boolean; yieldProps?: SummaryFieldYieldProps; onShift?: (value: SelectedSummaryShift) => void;
}) {
  const [shiftId, setShiftId] = useState("active_shift");
  const [choices, setChoices] = useState([{ value: "active_shift", label: "Активная смена" }, { value: "previous_day", label: "Вчера" }]);
  const base = `companyId=${encodeURIComponent(companyId)}`;
  const shift = useSummaryResource<WeighbridgeOperationalSummary>(scope, companyId,
    `/api/dashboard/weighbridge-summary?${base}&${shiftId === "active_shift" || shiftId === "previous_day" ? `period=${shiftId}` : `shiftId=${encodeURIComponent(shiftId)}`}`, enabled, SHIFT_TABLES);
  const stock = useSummaryResource<SummaryStock>(scope, companyId, `/api/dashboard/potato-stock?${base}`, enabled, STOCK_TABLES);
  useEffect(() => { if (shift.data) setChoices(weighbridgePeriodOptions(shift.data.shifts, shift.data.serverTime, shift.data.operationalDayStartHour)); }, [shift.data]);
  useEffect(() => { onShift?.({ shift: shift.data?.selectedShift, healthy: !!shift.data && !shift.error }); }, [shift.data, shift.error, onShift]);
  const times = [shift.data?.serverTime, stock.data?.serverTime, yieldProps?.data?.serverTime].filter(Boolean) as string[];
  const updated = times.length ? times.reduce((a, b) => Date.parse(a) < Date.parse(b) ? a : b) : null;
  return <div className="space-y-2">
    <div className="flex items-center gap-2">
      <select aria-label="Смена весовой" title={shift.data?.report?.operatorName || "Выбрать смену"} className="min-h-9 w-full min-w-0 border-0 bg-transparent text-xs text-muted-foreground" value={shiftId} onChange={event => setShiftId(event.target.value)}>
        {choices.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </div>
    {shift.data?.selectedShift ? <p className="text-[11px] text-muted-foreground">{summaryTime(shift.data.selectedShift.openedAt)} — {shift.data.selectedShift.closedAt ? summaryTime(shift.data.selectedShift.closedAt) : "сейчас"}</p> : null}
    {yieldProps ? <SummaryFieldYield {...yieldProps} /> : null}
    <SummaryReadError error={shift.error || stock.error} />
    {!shift.data && !shift.error ? <p role="status" className="py-2 text-sm text-muted-foreground">Загрузка смены…</p> : null}
    {shift.data ? shift.data.selectedShift ? <WeighbridgeOperationalView key={shift.data.selectedShift.id} data={shift.data} /> : <p className="py-2 text-sm text-muted-foreground">{shiftId === "active_shift" ? "Активной смены нет." : "За эту дату смен нет."}</p> : null}
    {stock.data ? <PotatoStockView data={stock.data} /> : !stock.error ? <p className="py-2 text-xs text-muted-foreground">Загрузка складов…</p> : null}
    {updated ? <p className="text-right text-[10px] text-muted-foreground">Обновлено {summaryClock(updated)}</p> : null}
  </div>;
}
