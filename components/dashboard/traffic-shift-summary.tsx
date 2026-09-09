"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, ChevronDown, ChevronRight, CircleCheck, Clock3, History, Loader2, Route, Tractor } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { subscribeTrafficChanges } from "@/lib/traffic/changes";
import {
  getClosedTrafficShiftHistoryPage,
  getClosedTrafficShiftSummaryById,
  getLatestClosedTrafficShiftSummary,
} from "@/lib/services/traffic-shift-summary";
import type {
  TrafficClosedShiftHistoryItem,
  TrafficClosedShiftSummary,
} from "@/lib/traffic/shift-summary";

const HISTORY_PAGE_SIZE = 10;
const TRAFFIC_SHIFT_HISTORY_ENABLED = process.env.NEXT_PUBLIC_DASHBOARD_DATA_V2 === "1";

function number(value: number | null, suffix = "") {
  return value === null ? "—" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}${suffix}`;
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

function pluralVehicles(value: number) {
  const tail = Math.abs(value) % 100;
  if (tail >= 11 && tail <= 14) return "машин";
  const digit = tail % 10;
  return digit === 1 ? "машина" : digit >= 2 && digit <= 4 ? "машины" : "машин";
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-3">
      <div className="text-xs leading-4 text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-semibold leading-6 text-foreground [overflow-wrap:anywhere] sm:text-xl">{value}</div>
      {note ? <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function TimingMetric({ label, value, sample }: { label: string; value: number | null; sample?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="text-xs leading-4 text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold text-foreground">{number(value, " мин")}</div>
      {sample ? <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{sample}</div> : null}
    </div>
  );
}

function SummaryShell({ children }: { children: React.ReactNode }) {
  return (
    <Card data-testid="agronomist-closed-shift-summary" className="rounded-xl border-amber-500/25 bg-gradient-to-br from-amber-500/[0.045] via-transparent to-transparent">
      <CardContent className="p-3 sm:p-4">{children}</CardContent>
    </Card>
  );
}

function HistoryShiftDetails({ summary }: { summary: TrafficClosedShiftSummary }) {
  return (
    <div className="space-y-3 rounded-b-lg border-x border-b border-border bg-background p-3" data-testid="ptc-shift-history-details">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Рейсов" value={String(summary.totalTrips)} />
        <Metric label="Машин" value={String(summary.participatingVehicles)} />
        <Metric label="Средний интервал загрузок" value={number(summary.averageLoadIntervalMinutes, " мин")} />
        <Metric label="Возможные простои" value={String(summary.probableDowntimeCount)} note={summary.probableDowntimeMinutes + " мин сверх порога"} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <TimingMetric label="От поля до весовой в среднем" value={summary.averageFieldToWeighbridgeMinutes} sample={"Данных по рейсам: " + summary.fieldToWeighbridgeTrips + " из " + summary.totalTrips} />
        <TimingMetric label="Разгрузка в среднем" value={summary.averageUnloadingMinutes} sample={"Данных по рейсам: " + summary.unloadingTrips + " из " + summary.totalTrips} />
        <TimingMetric label="Полный круг машины в среднем" value={summary.averageVehicleCycleMinutes} sample={"Повторных кругов: " + summary.vehicleCycleSamples} />
      </div>
      {summary.vehicles.length ? (
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Рейсы по машинам</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {summary.vehicles.map((vehicle) => (
              <div key={vehicle.vehicleId} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <span className="truncate text-xs text-foreground">
                  {vehicle.brand}{vehicle.plate ? " · " + vehicle.plate : " · Без номера"}
                </span>
                <b className="shrink-0 text-xs text-primary">{vehicle.trips}</b>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HistoryRowSummary({ item }: { item: TrafficClosedShiftHistoryItem }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{item.operatorName}</span>
        <span className="text-xs text-muted-foreground">{item.fieldName || "Поле не указано"}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{dateTime(item.openedAt)} — {dateTime(item.closedAt)}</span>
        <span>{duration(item.durationMinutes)}</span>
        <span>{number(item.hectaresShift, " га за смену")}</span>
      </div>
    </div>
  );
}

function TrafficShiftHistory({
  latestSummary,
  onAccessRevoked,
}: {
  latestSummary: TrafficClosedShiftSummary;
  onAccessRevoked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TrafficClosedShiftHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<{ shiftId: string; message: string } | null>(null);
  const [details, setDetails] = useState<Record<string, TrafficClosedShiftSummary | null>>({
    [latestSummary.shiftId]: latestSummary,
  });
  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const listGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);

  useEffect(() => () => {
    listAbortRef.current?.abort();
    detailAbortRef.current?.abort();
  }, []);

  async function loadPage(cursor: string | null, append: boolean) {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    const generation = ++listGenerationRef.current;
    setLoading(true);
    setListError("");
    try {
      const page = await getClosedTrafficShiftHistoryPage(
        { cursor, limit: HISTORY_PAGE_SIZE },
        controller.signal,
      );
      if (controller.signal.aborted || generation !== listGenerationRef.current) return;
      setItems((current) => {
        if (!append) return page.items;
        const byId = new Map(current.map((item) => [item.shiftId, item]));
        for (const item of page.items) byId.set(item.shiftId, item);
        return Array.from(byId.values());
      });
      setNextCursor(page.nextCursor);
      setLoaded(true);
    } catch (error) {
      if (controller.signal.aborted || generation !== listGenerationRef.current) return;
      const failure = error as Error & { status?: number };
      if (failure.status === 401 || failure.status === 403) {
        setItems([]);
        setDetails({});
        setLoaded(false);
        setOpen(false);
        onAccessRevoked();
      } else {
        setListError("Не удалось загрузить историю смен");
        setLoaded(true);
      }
    } finally {
      if (generation === listGenerationRef.current) setLoading(false);
    }
  }

  async function loadDetails(shiftId: string) {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    const generation = ++detailGenerationRef.current;
    setDetailLoadingId(shiftId);
    setDetailError(null);
    try {
      const summary = await getClosedTrafficShiftSummaryById(shiftId, controller.signal);
      if (controller.signal.aborted || generation !== detailGenerationRef.current) return;
      setDetails((current) => ({ ...current, [shiftId]: summary }));
    } catch (error) {
      if (controller.signal.aborted || generation !== detailGenerationRef.current) return;
      const failure = error as Error & { status?: number };
      if (failure.status === 401 || failure.status === 403) {
        setItems([]);
        setDetails({});
        setOpen(false);
        onAccessRevoked();
      } else {
        setDetailError({
          shiftId,
          message: failure.status === 422
            ? failure.message
            : "Не удалось загрузить детали смены",
        });
      }
    } finally {
      if (generation === detailGenerationRef.current) setDetailLoadingId(null);
    }
  }

  function toggleDetails(shiftId: string) {
    if (expandedShiftId === shiftId) {
      setExpandedShiftId(null);
      detailAbortRef.current?.abort();
      return;
    }
    setExpandedShiftId(shiftId);
    if (!Object.prototype.hasOwnProperty.call(details, shiftId)) void loadDetails(shiftId);
  }

  return (
    <Card data-testid="ptc-closed-shift-history" className="rounded-xl border-border bg-background">
      <CardContent className="p-0">
        <Collapsible
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (nextOpen && !loaded && !loading) void loadPage(null, false);
          }}
        >
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <History className="h-4 w-4 text-primary" /> История закрытых смен
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">Архив сохранённых смен, по {HISTORY_PAGE_SIZE} записей</p>
            </div>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:border-border hover:bg-background"
                aria-label={open ? "Скрыть историю закрытых смен" : "Показать историю закрытых смен"}
              >
                {open ? "Скрыть" : "Показать"}
                <ChevronDown className={"h-4 w-4 transition-transform " + (open ? "rotate-180" : "")} />
              </button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="border-t border-border px-3 pb-3 sm:px-4 sm:pb-4">
            {!loaded && loading ? (
              <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> Загружается история смен
              </div>
            ) : null}
            {loaded && !items.length && !listError ? (
              <p className="py-6 text-sm text-muted-foreground">Сохранённых закрытых смен пока нет.</p>
            ) : null}
            {items.length ? (
              <ol className="divide-y divide-border" data-testid="ptc-shift-history-list">
                {items.map((item) => {
                  const expanded = expandedShiftId === item.shiftId;
                  const hasDetails = Object.prototype.hasOwnProperty.call(details, item.shiftId);
                  const detail = details[item.shiftId];
                  return (
                    <li key={item.shiftId} className="py-2">
                      <button
                        type="button"
                        className={
                          "flex min-h-16 w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors " +
                          (expanded
                            ? "border-amber-500/25 bg-amber-500/[0.045]"
                            : "border-transparent hover:border-border hover:bg-background")
                        }
                        aria-expanded={expanded}
                        aria-controls={"ptc-shift-history-" + item.shiftId}
                        onClick={() => toggleDetails(item.shiftId)}
                      >
                        <HistoryRowSummary item={item} />
                        <ChevronRight className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (expanded ? "rotate-90" : "")} />
                      </button>
                      {expanded ? (
                        <div id={"ptc-shift-history-" + item.shiftId}>
                          {detailLoadingId === item.shiftId ? (
                            <div className="flex min-h-20 items-center justify-center gap-2 rounded-b-lg border-x border-b border-border text-xs text-muted-foreground" role="status">
                              <Loader2 className="h-4 w-4 animate-spin" /> Считаем рейсы и интервалы
                            </div>
                          ) : hasDetails && detail ? (
                            <HistoryShiftDetails summary={detail} />
                          ) : hasDetails ? (
                            <div className="rounded-b-lg border-x border-b border-border p-3 text-xs text-muted-foreground">Смена больше недоступна.</div>
                          ) : detailError?.shiftId === item.shiftId ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-b-lg border-x border-b border-amber-500/20 p-3 text-xs text-amber-800">
                              <span>{detailError.message}.</span>
                              <button type="button" onClick={() => void loadDetails(item.shiftId)} className="min-h-9 rounded-md border border-amber-500/25 px-2.5 font-medium">
                                Повторить
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {listError ? (
              <div className="flex flex-wrap items-center gap-2 py-3 text-xs text-amber-800">
                <span>{listError}{items.length ? "; ранее загруженные смены сохранены." : "."}</span>
                <button
                  type="button"
                  onClick={() => void loadPage(items.length ? nextCursor : null, Boolean(items.length))}
                  className="min-h-9 rounded-md border border-amber-500/25 px-2.5 font-medium"
                >
                  Повторить
                </button>
              </div>
            ) : null}
            {nextCursor ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadPage(nextCursor, true)}
                className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-background disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? "Загружается" : "Показать ещё"}
              </button>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function TrafficShiftSummary({ companyId }: { companyId: string }) {
  const [summary, setSummary] = useState<TrafficClosedShiftSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [timingOpen, setTimingOpen] = useState(false);
  const [showAllVehicles, setShowAllVehicles] = useState(false);
  const retryRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let running = false;
    let pending = false;
    setSummary(null);
    setLoaded(false);
    setRefreshError("");
    setTimingOpen(false);
    setShowAllVehicles(false);

    const refresh = async () => {
      if (disposed) return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      try {
        const next = await getLatestClosedTrafficShiftSummary();
        if (!disposed) {
          setSummary(next);
          setLoaded(true);
          setRefreshError("");
        }
      } catch (error) {
        const failure = error as Error & { status?: number };
        // A transient failure retains the last good result. Revoked access must
        // immediately remove protected shift information from the screen.
        if (!disposed && (
          failure.status === 401 ||
          failure.status === 403 ||
          failure.status === 422
        )) {
          setSummary(null);
          setRefreshError(failure.status === 422 ? failure.message : "");
        } else if (!disposed) {
          setRefreshError("Не удалось обновить сводку");
        }
        if (!disposed) setLoaded(true);
        console.error("PTC shift summary refresh failed", error);
      } finally {
        running = false;
        if (!disposed && pending) {
          pending = false;
          void refresh();
        }
      }
    };
    retryRef.current = () => void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const wake = () => void refresh();
    const unsubscribe = subscribeTrafficChanges(companyId, wake);
    // Broadcast normally refreshes other devices immediately. Fifteen-second
    // visible polling is the bounded fallback if the operator closes the PWA
    // before its invalidation message is delivered.
    const interval = window.setInterval(visible, 15_000);
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
      retryRef.current = () => undefined;
    };
  }, [companyId]);

  if (!loaded && !summary) {
    return (
      <SummaryShell>
        <div aria-label="Загружается итог смены PTC" className="animate-pulse space-y-3">
          <div className="h-5 w-56 rounded bg-muted" />
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 rounded-lg bg-muted" />)}
          </div>
        </div>
      </SummaryShell>
    );
  }

  if (!summary) {
    return (
      <SummaryShell>
        <div className="flex min-h-28 flex-col justify-center">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Tractor className="h-4 w-4 text-primary" /> PTC · Итоги последней смены
          </h2>
          {refreshError ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-amber-800">
              <span>{refreshError}.</span>
              <button type="button" onClick={() => retryRef.current()} className="min-h-10 rounded-lg border border-amber-500/30 px-3 font-medium hover:bg-amber-500/10">
                Повторить
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm font-medium text-foreground">Закрытых смен пока нет</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">После закрытия смены комбайнёром гектары, рейсы и ритм работы появятся здесь автоматически.</p>
            </div>
          )}
        </div>
      </SummaryShell>
    );
  }
  const downtimeStatus = summary.loadIntervalSamples === 0
    ? "unknown"
    : summary.probableDowntimeCount > 0
      ? "warning"
      : "clear";
  const downtime = downtimeStatus === "unknown"
    ? "Недостаточно загрузок для оценки"
    : downtimeStatus === "warning"
      ? `${summary.probableDowntimeCount} ${pluralDelays(summary.probableDowntimeCount)} дольше 15 минут · ${summary.probableDowntimeMinutes} мин сверх порога`
      : "Задержек дольше 15 минут не было";
  const timingMetrics = (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <TimingMetric label="Комбайн загружал машину в среднем каждые" value={summary.averageLoadIntervalMinutes} sample={`Интервалов: ${summary.loadIntervalSamples}`} />
      <TimingMetric label="От поля до весовой в среднем" value={summary.averageFieldToWeighbridgeMinutes} sample={`Данных по рейсам: ${summary.fieldToWeighbridgeTrips} из ${summary.totalTrips}`} />
      <TimingMetric label="От весовой до окончания выгрузки в среднем" value={summary.averageUnloadingMinutes} sample={`Данных по рейсам: ${summary.unloadingTrips} из ${summary.totalTrips}`} />
      <TimingMetric label="От выгрузки до следующей загрузки в среднем" value={summary.averageReturnToLoadMinutes} sample={`Повторных рейсов: ${summary.returnToLoadTrips}`} />
      <TimingMetric label="Полный круг одной машины в среднем" value={summary.averageVehicleCycleMinutes} sample={`Повторных кругов: ${summary.vehicleCycleSamples}`} />
      <TimingMetric label="Разброс последних загрузок машин" value={summary.latestDistinctVehicleLoadSpanMinutes} sample="Между самой ранней и самой поздней из последних загрузок машин этой смены" />
    </div>
  );

  return (
    <>
      <SummaryShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Tractor className="h-4 w-4 text-primary" /> PTC · Итоги последней смены
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.operatorName} · {summary.fieldName || "Поле не указано"}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-800">
              <CircleCheck className="h-3.5 w-3.5" /> Смена закрыта
            </span>
            <div className="text-xs text-muted-foreground">{dateTime(summary.openedAt)} — {dateTime(summary.closedAt)}</div>
            <div className="flex items-center gap-1 text-xs text-foreground">
              <Clock3 className="h-3.5 w-3.5" /> {duration(summary.durationMinutes)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Metric label="Гектаров за смену" value={number(summary.hectaresShift, " га")} />
          <Metric label="Всего на поле" value={number(summary.hectaresFieldTotal, " га")} />
          <Metric label="Отправлено с поля" value={`${summary.totalTrips} ${pluralTrips(summary.totalTrips)}`} note="По отметкам загрузки комбайнёра" />
          <Metric label="Работало в смене" value={`${summary.participatingVehicles} ${pluralVehicles(summary.participatingVehicles)}`} />
        </div>

        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5 ${downtimeStatus === "warning" ? "border-amber-500/25 bg-amber-500/[0.07] text-amber-800" : downtimeStatus === "clear" ? "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-800" : "border-border bg-background text-foreground"}`}>
          {downtimeStatus === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Activity className="mt-0.5 h-4 w-4 shrink-0" />}
          <span><b>Возможные простои комбайна:</b> {downtime}.</span>
        </div>

        <div className="hidden md:block">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Время движения и разгрузки</h3>
          {timingMetrics}
        </div>
        <Collapsible open={timingOpen} onOpenChange={setTimingOpen} className="md:hidden">
          <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between rounded-lg border border-border px-3 text-left text-sm font-medium text-foreground">
            Время движения и разгрузки
            <ChevronDown className={`h-4 w-4 transition-transform ${timingOpen ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">{timingMetrics}</CollapsibleContent>
        </Collapsible>

        {summary.vehicles.length ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-muted-foreground"><Route className="h-3.5 w-3.5" /> Рейсы по машинам</span>
              <span>Всего: {summary.totalTrips}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {summary.vehicles.map((vehicle, index) => (
                <div key={vehicle.vehicleId} className={`${!showAllVehicles && index >= 4 ? "hidden sm:flex" : "flex"} min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5`}>
                  <span className="truncate text-sm text-foreground">
                    {vehicle.brand}{vehicle.plate ? ` · ${vehicle.plate}` : " · Без номера"}
                  </span>
                  <b className="shrink-0 text-sm text-primary">
                    {vehicle.trips} {pluralTrips(vehicle.trips)}
                  </b>
                </div>
              ))}
            </div>
            {summary.vehicles.length > 4 ? (
              <button type="button" onClick={() => setShowAllVehicles((value) => !value)} className="mt-2 min-h-11 w-full rounded-lg border border-border text-sm font-medium text-foreground sm:hidden">
                {showAllVehicles ? "Скрыть часть машин" : `Показать все (${summary.vehicles.length})`}
              </button>
            ) : null}
          </div>
        ) : null}
        {refreshError ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
            <span>{refreshError}; показаны последние полученные данные.</span>
            <button type="button" onClick={() => retryRef.current()} className="min-h-9 rounded-md border border-amber-500/25 px-2.5 font-medium">Повторить</button>
          </div>
        ) : null}
        </div>
      </SummaryShell>
      {TRAFFIC_SHIFT_HISTORY_ENABLED ? (
        <TrafficShiftHistory
          key={`${companyId}:${summary.shiftId}`}
          latestSummary={summary}
          onAccessRevoked={() => {
            setSummary(null);
            setRefreshError("");
          }}
        />
      ) : null}
    </>
  );
}
