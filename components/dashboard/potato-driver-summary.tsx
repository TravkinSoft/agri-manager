"use client";

import { memo, useMemo } from "react";
import { Trophy, Truck } from "lucide-react";
import type { HarvestOverview } from "@/lib/dashboard/harvest-summary";

type PotatoDriverRow = HarvestOverview["potatoDrivers"][number];

function tonnes(valueKg: number): string {
  return `${(Number(valueKg || 0) / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т`;
}

function vehicleText(row: PotatoDriverRow): string {
  return row.vehicles.length ? row.vehicles.map((vehicle) => vehicle.label).join(" · ") : "Машина не указана";
}

type PotatoDriverSummaryProps = {
  rows: PotatoDriverRow[];
  totalWeightKg: number;
  periodLabel: string;
  period: "today" | "previous_shift" | "month" | "all_time";
  onPeriodChange: (period: "today" | "previous_shift" | "month" | "all_time") => void;
  refreshing?: boolean;
  updatedAt?: string;
};

const PERIODS = [
  { key: "today", label: "За сегодня" },
  { key: "previous_shift", label: "За прошлую смену" },
  { key: "month", label: "За месяц" },
  { key: "all_time", label: "За всё время" },
] as const;

export const PotatoDriverSummary = memo(function PotatoDriverSummary({ rows, totalWeightKg, periodLabel, period, onPeriodChange, refreshing = false, updatedAt }: PotatoDriverSummaryProps) {
  const rankedRows = useMemo(
    () => [...rows].sort((left, right) => right.netWeightKg - left.netWeightKg || right.tripCount - left.tripCount || left.driverName.localeCompare(right.driverName, "ru")),
    [rows],
  );
  const tripCount = useMemo(() => rows.reduce((total, row) => total + row.tripCount, 0), [rows]);

  return (
    <section aria-labelledby="potato-driver-champions-title" className="overflow-hidden rounded-xl border border-border bg-card/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
            <Trophy className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="potato-driver-champions-title" className="text-base font-semibold text-foreground">Таблица чемпионов</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Чистый картофель без земли · {periodLabel}</p>
            {updatedAt ? <p className="text-[11px] text-muted-foreground" aria-live="polite">{refreshing ? "Обновляется…" : `Обновлено ${new Date(updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`} · после закрытия талона</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1" role="group" aria-label="Период таблицы чемпионов" aria-busy={refreshing}>
          {PERIODS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onPeriodChange(option.key)}
              aria-pressed={period === option.key}
              className={`h-8 rounded-lg px-2.5 text-xs font-medium transition-colors ${period === option.key ? "bg-[color:var(--manor-paper-raised)] text-foreground shadow-manor-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-3 border-b border-border bg-background/20" aria-label="Итоги периода по чистому картофелю">
        <div className="min-w-0 px-3 py-2.5 sm:px-4"><span className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Чистый картофель</span><strong className="mt-1 block truncate text-base tabular-nums text-foreground">{tonnes(totalWeightKg)}</strong></div>
        <div className="min-w-0 border-l border-border px-3 py-2.5 sm:px-4"><span className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Рейсов</span><strong className="mt-1 block text-base tabular-nums text-foreground">{tripCount}</strong></div>
        <div className="min-w-0 border-l border-border px-3 py-2.5 sm:px-4"><span className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Водителей</span><strong className="mt-1 block text-base tabular-nums text-foreground">{rankedRows.length}</strong></div>
      </div>

      {rankedRows.length ? (
        <div role="table" aria-label="Рейтинг водителей по общему тоннажу">
          <div role="row" className="hidden grid-cols-[40px_minmax(0,1.3fr)_minmax(0,1fr)_72px_96px_96px] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:grid">
            <div role="columnheader">Место</div><div role="columnheader">Водитель</div><div role="columnheader">Машина</div>
            <div role="columnheader" className="text-right">Рейсы</div><div role="columnheader" className="text-right">Всего</div>
            <div role="columnheader" className="text-right">Средний вес</div>
          </div>
          <ol className="divide-y divide-border/70">
            {rankedRows.map((row, index) => (
                <li
                  key={row.key}
                  role="row"
                  data-driver-id={row.driverId || row.key}
                  data-rank={index + 1}
                  className="grid grid-cols-[42px_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3 md:grid-cols-[40px_minmax(0,1.3fr)_minmax(0,1fr)_72px_96px_96px] md:items-center md:px-4"
                >
                  <div role="cell" className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold tabular-nums ${index === 0 ? "bg-amber-500/15 text-amber-600" : index === 1 ? "bg-slate-400/15 text-slate-400" : index === 2 ? "bg-orange-700/15 text-orange-500" : "text-muted-foreground"}`}>
                    {index + 1}
                  </div>
                  <div role="cell" className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{row.driverName}</div>
                  </div>
                  <div role="cell" className="col-start-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground md:col-start-auto">
                    <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{vehicleText(row)}</span>
                  </div>
                  <div className="col-start-2 grid grid-cols-3 gap-2 md:contents">
                    <div role="cell" className="rounded-lg bg-background/55 px-2.5 py-2 text-left md:bg-transparent md:p-0 md:text-right">
                      <span className="block text-[10px] text-muted-foreground md:hidden">Рейсы</span><strong className="tabular-nums text-foreground">{row.tripCount}</strong>
                    </div>
                    <div role="cell" className="rounded-lg bg-background/55 px-2.5 py-2 text-left md:bg-transparent md:p-0 md:text-right">
                      <span className="block text-[10px] text-muted-foreground md:hidden">Всего</span><strong className="tabular-nums text-foreground">{tonnes(row.netWeightKg)}</strong>
                    </div>
                    <div role="cell" className="rounded-lg bg-background/55 px-2.5 py-2 text-left md:bg-transparent md:p-0 md:text-right">
                      <span className="block text-[10px] text-muted-foreground md:hidden">Средний вес</span><span className="tabular-nums text-foreground">{tonnes(row.averageNetWeightKg)}</span>
                    </div>
                  </div>
                </li>
              ))}
          </ol>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">За выбранный период завершённых картофельных рейсов нет.</p>
      )}
    </section>
  );
});
