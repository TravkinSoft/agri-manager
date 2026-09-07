"use client";

import { Activity, Clock3, Gauge, Route, TimerReset, Truck } from "lucide-react";
import type { TrafficAnalytics } from "@/lib/traffic/model";

function duration(value: number | null) {
  if (value === null) return "—";
  if (value < 60) return `${value} мин`;
  return `${Math.floor(value / 60)} ч ${value % 60} мин`;
}

export function TrafficAnalyticsPanel({ analytics }: { analytics: TrafficAnalytics }) {
  const metrics = [
    { icon: Clock3, label: "Последний интервал", value: duration(analytics.lastLoadIntervalMinutes) },
    { icon: Gauge, label: "Средний интервал", value: duration(analytics.averageLoadIntervalMinutes) },
    { icon: Route, label: "Поле → весовая", value: duration(analytics.averageFieldToWeighbridgeMinutes) },
    { icon: Truck, label: "Выгрузка", value: duration(analytics.averageUnloadingMinutes) },
    { icon: TimerReset, label: "Обратно до загрузки", value: duration(analytics.averageReturnToLoadMinutes) },
    { icon: TimerReset, label: "Круг одной машины", value: duration(analytics.averageVehicleCycleMinutes) },
    { icon: Activity, label: "Круг всех машин", value: duration(analytics.latestFleetRoundMinutes) },
  ];
  return (
    <aside data-testid="traffic-analytics" className="min-w-0 rounded-xl border border-white/10 bg-white/[0.035] p-3 lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Activity aria-hidden size={16} className="text-amber-300" /> Ритм уборки
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">{analytics.windowLabel}</p>
        </div>
        <div className="text-right">
          <strong className="block text-xl tabular-nums text-white">{analytics.completedLoads}</strong>
          <span className="text-[10px] text-slate-500">загрузок</span>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
        {metrics.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-lg bg-black/15 p-2">
            <dt className="flex items-center gap-1.5 text-[11px] leading-4 text-slate-400">
              <Icon aria-hidden size={12} /> {label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>
      <div className={`mt-2 rounded-lg border p-2 ${analytics.currentProbableDowntimeMinutes !== null
        ? "border-rose-400/40 bg-rose-500/10"
        : "border-white/5 bg-black/15"}`}>
        <p className="text-[11px] text-slate-400">Вероятный простой</p>
        <p className={`mt-0.5 text-sm font-semibold tabular-nums ${analytics.currentProbableDowntimeMinutes !== null ? "text-rose-300" : "text-slate-100"}`}>
          {analytics.currentProbableDowntimeMinutes !== null
            ? `${analytics.currentProbableDowntimeMinutes} мин сверх нормы`
            : analytics.probableDowntimeCount
              ? `${analytics.probableDowntimeCount} эп. · ${duration(analytics.probableDowntimeMinutes)}`
              : "Не выявлен"}
        </p>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-slate-500">
        Оценка по движениям машин. Порог вероятного простоя — 15 минут без новой загрузки.
      </p>
    </aside>
  );
}
