"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { Award, Gauge, Scale, Trophy, Truck } from "lucide-react";
import type { HarvestOverview } from "@/lib/dashboard/harvest-summary";

type PotatoDriverRow = HarvestOverview["potatoDrivers"][number];

function tonnes(valueKg: number): string {
  return `${(Number(valueKg || 0) / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} т`;
}

function minutes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return rounded < 60 ? `${rounded} мин` : `${Math.floor(rounded / 60)} ч ${rounded % 60} мин`;
}

function vehicleText(row: PotatoDriverRow): string {
  return row.vehicles.length ? row.vehicles.map((vehicle) => vehicle.label).join(" · ") : "Машина не указана";
}

export function PotatoDriverSummary({ rows, periodLabel }: { rows: PotatoDriverRow[]; periodLabel: string }) {
  const rowElements = useRef(new Map<string, HTMLElement>());
  const previousPositions = useRef(new Map<string, number>());
  const previousRanks = useRef(new Map<string, number>());
  const maxWeight = useMemo(() => Math.max(0, ...rows.map((row) => row.netWeightKg)), [rows]);
  const fastestMinutes = useMemo(() => {
    const values = rows.map((row) => row.averageTripMinutes).filter((value): value is number => value != null && Number.isFinite(value));
    return values.length ? Math.min(...values) : null;
  }, [rows]);

  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextPositions = new Map<string, number>();
    const nextRanks = new Map<string, number>();
    rows.forEach((row, index) => {
      const element = rowElements.current.get(row.key);
      if (!element) return;
      const top = element.getBoundingClientRect().top;
      nextPositions.set(row.key, top);
      nextRanks.set(row.key, index + 1);
      if (reduceMotion) return;
      const previousTop = previousPositions.current.get(row.key);
      const previousRank = previousRanks.current.get(row.key);
      const offset = previousTop == null ? 0 : previousTop - top;
      if (Math.abs(offset) > 1) {
        element.animate(
          [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
          { duration: 400, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      }
      if (previousRank != null && previousRank > index + 1) {
        element.animate(
          [{ backgroundColor: "rgba(143, 183, 126, 0.2)" }, { backgroundColor: "rgba(143, 183, 126, 0)" }],
          { duration: 900, easing: "ease-out" },
        );
      }
    });
    previousPositions.current = nextPositions;
    previousRanks.current = nextRanks;
  }, [rows]);

  return (
    <section aria-labelledby="potato-driver-champions-title" className="overflow-hidden rounded-xl border border-border bg-card/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
            <Trophy className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="potato-driver-champions-title" className="text-base font-semibold text-foreground">Таблица чемпионов</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{periodLabel} · только завершённые действующие рейсы картофеля</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
        </span>
      </header>

      {rows.length ? (
        <div role="table" aria-label="Рейтинг водителей по завершённым рейсам">
          <div role="row" className="hidden grid-cols-[48px_minmax(180px,1.3fr)_minmax(150px,1fr)_90px_110px_110px_120px] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:grid">
            <div role="columnheader">Место</div><div role="columnheader">Водитель</div><div role="columnheader">Машина</div>
            <div role="columnheader" className="text-right">Рейсы</div><div role="columnheader" className="text-right">Всего</div>
            <div role="columnheader" className="text-right">Средний вес</div><div role="columnheader" className="text-right">Среднее время</div>
          </div>
          <ol className="divide-y divide-border/70">
            {rows.map((row, index) => {
              const isWeightLeader = row.netWeightKg === maxWeight;
              const isFastest = fastestMinutes != null && row.averageTripMinutes === fastestMinutes;
              return (
                <li
                  key={row.key}
                  ref={(element) => {
                    if (element) rowElements.current.set(row.key, element);
                    else rowElements.current.delete(row.key);
                  }}
                  role="row"
                  data-driver-id={row.driverId || row.key}
                  data-rank={index + 1}
                  className="grid grid-cols-[42px_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3 will-change-transform md:grid-cols-[48px_minmax(180px,1.3fr)_minmax(150px,1fr)_90px_110px_110px_120px] md:items-center md:px-4"
                >
                  <div role="cell" className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold tabular-nums ${index === 0 ? "bg-amber-500/15 text-amber-600" : index === 1 ? "bg-slate-400/15 text-slate-400" : index === 2 ? "bg-orange-700/15 text-orange-500" : "text-muted-foreground"}`}>
                    {index + 1}
                  </div>
                  <div role="cell" className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{row.driverName}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {index === 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"><Award className="h-3 w-3" /> Лидер</span> : null}
                      {isWeightLeader ? <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600"><Scale className="h-3 w-3" /> Больше всего тонн</span> : null}
                      {isFastest ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600"><Gauge className="h-3 w-3" /> Самый быстрый</span> : null}
                    </div>
                  </div>
                  <div role="cell" className="col-start-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground md:col-start-auto">
                    <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{vehicleText(row)}</span>
                  </div>
                  <div className="col-start-2 grid grid-cols-2 gap-2 sm:grid-cols-4 md:contents">
                    <div role="cell" className="rounded-lg bg-background/55 px-2.5 py-2 text-left md:bg-transparent md:p-0 md:text-right">
                      <span className="block text-[10px] text-muted-foreground md:hidden">Рейсы</span><strong className="tabular-nums text-foreground">{row.tripCount}</strong>
                    </div>
                    <div role="cell" className="rounded-lg bg-background/55 px-2.5 py-2 text-left md:bg-transparent md:p-0 md:text-right">
                      <span className="block text-[10px] text-muted-foreground md:hidden">Всего</span><strong className="tabular-nums text-foreground">{tonnes(row.netWeightKg)}</strong>
                    </div>
                    <div role="cell" className="rounded-lg bg-background/55 px-2.5 py-2 text-left md:bg-transparent md:p-0 md:text-right">
                      <span className="block text-[10px] text-muted-foreground md:hidden">Средний вес</span><span className="tabular-nums text-foreground">{tonnes(row.averageNetWeightKg)}</span>
                    </div>
                    <div role="cell" className="rounded-lg bg-background/55 px-2.5 py-2 text-left md:bg-transparent md:p-0 md:text-right">
                      <span className="block text-[10px] text-muted-foreground md:hidden">Среднее время</span><span className="tabular-nums text-muted-foreground">{minutes(row.averageTripMinutes)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {fastestMinutes == null ? <p className="border-t border-border px-3 py-2 text-[11px] leading-5 text-muted-foreground sm:px-4">Среднее время появится, когда талон будет напрямую связан с завершённым циклом PTC.</p> : null}
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">В текущем рабочем дне завершённых картофельных рейсов пока нет.</p>
      )}
    </section>
  );
}
