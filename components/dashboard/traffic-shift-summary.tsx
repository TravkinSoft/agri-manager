"use client";

import { useEffect, useState } from "react";
import { Clock3, Route, Tractor } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { subscribeTrafficChanges } from "@/lib/traffic/changes";
import { getLatestClosedTrafficShiftSummary } from "@/lib/services/traffic-shift-summary";
import type { TrafficClosedShiftSummary } from "@/lib/traffic/shift-summary";

function number(value: number | null, suffix = "") {
  return value === null
    ? "Недостаточно данных"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}${suffix}`;
}

function duration(minutes: number) {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pluralTrips(value: number) {
  const tail = Math.abs(value) % 100;
  if (tail >= 11 && tail <= 14) return "рейсов";
  const digit = tail % 10;
  return digit === 1 ? "рейс" : digit >= 2 && digit <= 4 ? "рейса" : "рейсов";
}

function pluralDelays(value: number) {
  const tail = Math.abs(value) % 100;
  if (tail >= 11 && tail <= 14) return "задержек";
  const digit = tail % 10;
  return digit === 1 ? "задержка" : digit >= 2 && digit <= 4 ? "задержки" : "задержек";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/30 px-3 py-2">
      <div className="text-[11px] leading-4 text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}

export function TrafficShiftSummary({ companyId }: { companyId: string }) {
  const [summary, setSummary] = useState<TrafficClosedShiftSummary | null>(null);

  useEffect(() => {
    let disposed = false;
    let running = false;
    let pending = false;
    setSummary(null);

    const refresh = async () => {
      if (disposed) return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      try {
        const next = await getLatestClosedTrafficShiftSummary();
        if (!disposed) setSummary(next);
      } catch (error) {
        const failure = error as Error & { status?: number };
        // A transient failure retains the last good result. Revoked access must
        // immediately remove protected shift information from the screen.
        if (!disposed && (failure.status === 401 || failure.status === 403)) {
          setSummary(null);
        }
        console.error("PTC shift summary refresh failed", error);
      } finally {
        running = false;
        if (!disposed && pending) {
          pending = false;
          void refresh();
        }
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const wake = () => void refresh();
    const unsubscribe = subscribeTrafficChanges(companyId, wake);
    const interval = window.setInterval(visible, 60_000);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", visible);
    void refresh();
    return () => {
      disposed = true;
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [companyId]);

  if (!summary) return null;
  const downtime = summary.probableDowntimeCount
    ? `${summary.probableDowntimeCount} ${pluralDelays(summary.probableDowntimeCount)} · ${summary.probableDowntimeMinutes} мин сверх порога`
    : "Не было";

  return (
    <Card data-testid="agronomist-closed-shift-summary" className="rounded-lg border-amber-500/20">
      <CardContent className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Tractor className="h-4 w-4 text-[#E0B100]" /> Последняя закрытая смена
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {summary.operatorName}{summary.fieldName ? ` · ${summary.fieldName}` : ""}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>{dateTime(summary.openedAt)} — {dateTime(summary.closedAt)}</div>
            <div className="mt-1 flex items-center justify-end gap-1 text-slate-300">
              <Clock3 className="h-3.5 w-3.5" /> {duration(summary.durationMinutes)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Metric label="За эту смену" value={number(summary.hectaresShift, " га")} />
          <Metric label="Итого на поле" value={number(summary.hectaresFieldTotal, " га")} />
          <Metric label="Рейсов за смену" value={String(summary.totalTrips)} />
          <Metric label="Машин участвовало" value={String(summary.participatingVehicles)} />
          <Metric label="В среднем между загрузками" value={number(summary.averageLoadIntervalMinutes, " мин")} />
          <Metric label="Круг одной машины" value={number(summary.averageVehicleCycleMinutes, " мин")} />
          <Metric label="Круг всех машин" value={number(summary.latestFleetRoundMinutes, " мин")} />
          <Metric label="Задержки дольше 15 минут" value={downtime} />
        </div>

        {summary.vehicles.length ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><Route className="h-3.5 w-3.5" /> Рейсы каждой машины</span>
              <span>По отметкам загрузки комбайнёра</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {summary.vehicles.map((vehicle) => (
                <div key={vehicle.vehicleId} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-slate-800 px-3 py-2">
                  <span className="truncate text-sm text-slate-200">
                    {vehicle.brand}{vehicle.plate ? ` · ${vehicle.plate}` : " · Без номера"}
                  </span>
                  <b className="shrink-0 text-sm text-[#E0B100]">
                    {vehicle.trips} {pluralTrips(vehicle.trips)}
                  </b>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
