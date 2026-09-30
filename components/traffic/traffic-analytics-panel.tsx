"use client";

import { Activity, Clock3, Gauge, Route, TimerReset, Truck } from "lucide-react";
import type { TrafficAnalytics } from "@/lib/traffic/model";

function duration(value: number | null) {
  if (value === null) return "Пока нет данных";
  if (value < 60) return `${value} мин`;
  return `${Math.floor(value / 60)} ч ${value % 60} мин`;
}

function delays(value: number) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return `${value} задержек`;
  if (remainder10 === 1) return `${value} задержка`;
  if (remainder10 >= 2 && remainder10 <= 4) return `${value} задержки`;
  return `${value} задержек`;
}

export function TrafficAnalyticsPanel({ analytics }: { analytics: TrafficAnalytics }) {
  const metrics = [
    { icon: Clock3, label: "Между двумя последними загрузками", value: duration(analytics.lastLoadIntervalMinutes) },
    { icon: Gauge, label: "В среднем между загрузками", value: duration(analytics.averageLoadIntervalMinutes) },
    { icon: Route, label: "От загрузки до весовой", value: duration(analytics.averageFieldToWeighbridgeMinutes) },
    { icon: Truck, label: "От весовой до конца выгрузки", value: duration(analytics.averageUnloadingMinutes) },
    { icon: TimerReset, label: "От выгрузки до новой загрузки", value: duration(analytics.averageReturnToLoadMinutes) },
    { icon: TimerReset, label: "Круг одной машины", value: duration(analytics.averageVehicleCycleMinutes) },
    { icon: Activity, label: "Круг всех машин", value: duration(analytics.latestFleetRoundMinutes) },
  ];
  const currentGapMinutes = analytics.currentProbableDowntimeMinutes === null
    ? null
    : analytics.currentProbableDowntimeMinutes + 15;
  const completedDelays = analytics.probableDowntimeCount - Number(currentGapMinutes !== null);
  return (
    <aside data-testid="traffic-analytics" className="min-w-0 rounded-xl border border-border bg-accent/40 p-3 lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Activity aria-hidden size={16} className="text-amber-800" /> Ритм уборки
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">{analytics.windowLabel}</p>
        </div>
        <div className="text-right">
          <strong className="block text-xl tabular-nums text-foreground">{analytics.completedLoads}</strong>
          <span className="text-[10px] text-muted-foreground">загрузок</span>
        </div>
      </div>
      {analytics.completedLoads < 2 ? (
        <p className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/5 px-2.5 py-2 text-xs leading-4 text-foreground">
          {analytics.completedLoads === 0
            ? "Загрузок пока нет. Расчёты появятся после первых отметок машин."
            : "Первая загрузка отмечена. Интервалы появятся после следующей загрузки."}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
        {metrics.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-lg bg-muted/60 p-2">
            <dt className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
              <Icon aria-hidden size={12} /> {label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <div className={`mt-2 rounded-lg border p-2 ${analytics.currentProbableDowntimeMinutes !== null
        ? "border-rose-400/40 bg-rose-500/10"
        : "border-border bg-muted/60"}`}>
        <p className="text-[11px] text-muted-foreground">Вероятный простой комбайна</p>
        <p className={`mt-0.5 text-sm font-semibold leading-5 tabular-nums ${analytics.currentProbableDowntimeMinutes !== null ? "text-rose-800" : "text-foreground"}`}>
          {currentGapMinutes !== null
            ? `Новых загрузок нет ${currentGapMinutes} мин. Возможный простой — ${analytics.currentProbableDowntimeMinutes} мин.${completedDelays > 0 ? ` Ранее: ${delays(completedDelays)}.` : ""}`
            : analytics.probableDowntimeCount
              ? `${delays(analytics.probableDowntimeCount)} дольше 15 минут; всего ${duration(analytics.probableDowntimeMinutes)} сверх порога.`
              : "Задержек дольше 15 минут не выявлено."}
        </p>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        Оценка по подтверждённым движениям машин. Простой отмечается после 15 минут без новой загрузки.
      </p>
    </aside>
  );
}
