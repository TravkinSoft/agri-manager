"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ChevronDown, Clock3, Loader2, PackageCheck, Truck, Wrench } from "lucide-react";
import { TrafficShiftSummary } from "@/components/dashboard/traffic-shift-summary";
import { WeighbridgeShiftHistory } from "@/components/dashboard/weighbridge-shift-history";
import { PotatoDriverSummary } from "@/components/dashboard/potato-driver-summary";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/contexts/auth-context";
import { isPotatoLabel, type HarvestOverview } from "@/lib/dashboard/harvest-summary";
import { getHarvestSummary, getHarvestChampions } from "@/lib/services/harvest-dashboard";
import { useDashboardResource } from "@/hooks/use-dashboard-resource";
import type { ChampionPeriod, HarvestChampions } from "@/lib/dashboard/harvest-champions";
import { LIVE_REFRESH_TABLES, useLiveRefresh } from "@/hooks/use-live-refresh";
import { getFleetVehicleBrand, type FleetVehicle } from "@/lib/fleet/model";
import { trafficStatusSince, type TrafficSnapshot, type TrafficVehicle } from "@/lib/traffic/model";
import { trafficRequest } from "@/components/traffic/use-traffic";
import { compactReproductionLabel } from "@/lib/agronomy/reproduction-display";

type TrafficPayload = { snapshot: TrafficSnapshot; fleet: FleetVehicle[] };
type TrafficGroup = "empty" | "loaded" | "unloading" | "repair" | "offline";

const GROUPS: Array<{ key: TrafficGroup; desktop: string; mobile: string }> = [
  { key: "empty", desktop: "Пустые", mobile: "Пустые" },
  { key: "loaded", desktop: "В пути на весовую", mobile: "На весовую" },
  { key: "unloading", desktop: "На выгрузке", mobile: "Выгрузка" },
  { key: "repair", desktop: "На ремонте", mobile: "Ремонт" },
  { key: "offline", desktop: "Не на линии", mobile: "Не на линии" },
];

function mass(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const tonnes = value / 1000;
  return `${tonnes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т`;
}

function age(value: string, now: number): string {
  const started = Date.parse(value);
  if (!Number.isFinite(started)) return "—";
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  return `${days} д ${hours} ч ${minutes % 60} мин`;
}
function vehicleGroup(vehicle: TrafficVehicle): TrafficGroup {
  if (vehicle.inRepair) return "repair";
  if (!vehicle.assigned) return "offline";
  return vehicle.state;
}
function mergeTrafficVehicles(snapshot: TrafficSnapshot | null, fleet: FleetVehicle[]): TrafficVehicle[] {
  if (!snapshot) return [];
  const current = new Set(snapshot.vehicles.map((vehicle) => vehicle.vehicle_id));
  return [
    ...snapshot.vehicles,
    ...fleet.filter((vehicle) => !current.has(vehicle.id)).map((vehicle) => ({
      vehicle_id: vehicle.id,
      name: vehicle.name,
      brand: vehicle.brand,
      plate: vehicle.plate,
      driver: vehicle.driver,
      state: vehicle.state || "empty" as const,
      version: 0,
      since: vehicle.lastActivity || snapshot.serverTime,
      cycle: 0,
      assigned: false,
      inRepair: vehicle.inRepair,
      repairVersion: vehicle.repairVersion,
      repairChangedAt: vehicle.repairChangedAt,
    })),
  ];
}

const SUMMARY_QUERY = { period: "current_day" as const, start: null, end: null, filters: {} };
const SUMMARY_LIVE_TABLES = [
  ...LIVE_REFRESH_TABLES.weighbridge.filter((table) => table !== "ptc_events" && table !== "ptc_vehicle_states"),
  "ptc_combine_shifts", "ptc_combine_field_segments", "ptc_field_progress",
];
const loadSummary = (signal: AbortSignal) => getHarvestSummary<HarvestOverview>(SUMMARY_QUERY, { signal });
const loadChampions = (signal: AbortSignal) => getHarvestChampions<HarvestChampions>({ signal });
const loadTraffic = async (signal: AbortSignal) => trafficRequest("/api/traffic", "GET", undefined, true, signal) as Promise<TrafficPayload>;

export function HarvestDashboardSkeleton() {
  return <section className="space-y-3 py-2" role="status" aria-label="Загрузка показателей сводки" aria-busy="true">
    <div className="h-8 w-full animate-pulse rounded bg-muted/40 motion-reduce:animate-none" />
    <div className="h-14 w-60 animate-pulse rounded-lg border border-border bg-muted/30 motion-reduce:animate-none" />
    <div className="grid grid-cols-2 border-y border-border sm:grid-cols-4">
      {["Итог дня · картофель", "С выбранного участка · всего", "На складе", "Живая урожайность"].map((label) => <div key={label} className="min-w-0 border-border p-3 first:pl-0 sm:border-r sm:last:border-r-0">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 h-5 w-24 animate-pulse rounded bg-muted/50 motion-reduce:animate-none" />
      </div>)}
    </div>
    <span className="sr-only">Получаем актуальные данные. Значения ещё не загружены.</span>
  </section>;
}

const VEHICLE_CARD_SURFACES: Record<TrafficGroup, string> = {
  empty: "bg-[rgba(238,232,215,0.035)]",
  loaded: "bg-[rgba(143,183,126,0.12)]",
  unloading: "bg-[rgba(208,171,101,0.12)]",
  repair: "bg-[rgba(207,116,104,0.10)]",
  offline: "bg-[rgba(238,232,215,0.025)]",
};

const VEHICLE_STATUS_ICON_STYLE: Record<TrafficGroup, string> = {
  empty: "bg-slate-100/10 text-slate-200",
  loaded: "bg-emerald-500/15 text-emerald-300",
  unloading: "bg-amber-500/15 text-amber-300",
  repair: "bg-rose-500/15 text-rose-300",
  offline: "bg-slate-100/5 text-muted-foreground",
};

const VEHICLE_STATUS_LABEL: Record<TrafficGroup, string> = {
  empty: "Пустая машина",
  loaded: "Загруженная машина",
  unloading: "Машина разгружается",
  repair: "Машина на ремонте",
  offline: "Машина не на линии",
};

function VehicleCard({ vehicle, now, group, shiftIsOpen }: { vehicle: TrafficVehicle; now: number; group: TrafficGroup; shiftIsOpen: boolean }) {
  const brand = getFleetVehicleBrand(vehicle);
  const timer = group === "offline" ? null : group === "empty" && !shiftIsOpen ? "0 мин" : age(trafficStatusSince(vehicle, "manager"), now);
  return (
    <article data-traffic-vehicle-card={group} className={`grid min-h-[92px] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[10px] px-3 py-3.5 ${VEHICLE_CARD_SURFACES[group]}`}>
      <span className={`relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${VEHICLE_STATUS_ICON_STYLE[group]}`} title={VEHICLE_STATUS_LABEL[group]} aria-label={VEHICLE_STATUS_LABEL[group]}>
        {group === "repair" ? <Wrench className="h-5 w-5" aria-hidden="true" /> : <Truck className="h-5 w-5" aria-hidden="true" />}
        {group === "loaded" ? <PackageCheck className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[color:var(--manor-paper-raised)] p-0.5" aria-hidden="true" /> : null}
        {group === "unloading" ? <ArrowDownToLine className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[color:var(--manor-paper-raised)] p-0.5" aria-hidden="true" /> : null}
      </span>
      <div className="min-w-0">
        <div className="truncate text-base font-semibold tracking-[0.01em] text-foreground">{vehicle.driver?.trim() || "Водитель не назначен"}</div>
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{brand}</div>
        <div className="mt-0.5 text-xs font-medium tracking-[0.04em] text-[color:var(--manor-brass-soft)]">{vehicle.plate?.trim() || "Без номера"}</div>
      </div>
      {timer ? <div className="flex items-start gap-1 pt-0.5 text-xs font-medium tabular-nums text-[color:var(--manor-brass-soft)]">
        <Clock3 className="mt-0.5 h-3 w-3" />{timer}
      </div> : null}
    </article>
  );
}

export function HarvestDashboard() {
  const { profile, user } = useAuth();
  const companyId = profile?.company_id || null;
  const championScope = [user?.id, user?.last_sign_in_at, profile?.id, profile?.role, companyId, profile?.is_impersonating, profile?.impersonated_profile_id, profile?.impersonated_by_auth_user_id].join(":");
  const canReadTraffic = Boolean(profile && ["agronomist", "company_admin", "global_admin", "fleet_manager"].includes(profile.role));
  const summaryResource = useDashboardResource(championScope, "summary", loadSummary, Boolean(companyId));
  const championResource = useDashboardResource(championScope, "champions", loadChampions, Boolean(companyId));
  const trafficResource = useDashboardResource(championScope, "traffic", loadTraffic, Boolean(companyId) && canReadTraffic);
  const { data: summary, error, refresh: loadDashboard } = summaryResource;
  const { data: champions, error: driverError, refreshing: driverLoading, refresh: refreshDrivers } = championResource;
  const { data: traffic, error: trafficError } = trafficResource;
  const [championPeriod, setChampionPeriod] = useState<ChampionPeriod>("all_time");
  const [selectedGroup, setSelectedGroup] = useState<TrafficGroup>("loaded");
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [shiftReportOpen, setShiftReportOpen] = useState(false);
  const [harvestedHectares, setHarvestedHectares] = useState("");
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const initialTrafficGroupSelectedRef = useRef(false);
  const previousActivePlotRef = useRef<string | null>(null);

  const driverSummary = champions?.periods[championPeriod] || null;

  useEffect(() => {
    previousActivePlotRef.current = null;
    setSelectedPlotId(null);
    initialTrafficGroupSelectedRef.current = false;
  }, [championScope]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useLiveRefresh({ enabled: Boolean(companyId), companyId, tables: SUMMARY_LIVE_TABLES, intervalMs: 15_000, onRefresh: loadDashboard });
  // Closed receipts, impurity removals and voids update the ranking after the
  // committed ticket event. Polling is a fallback when Realtime is unavailable.
  useLiveRefresh({ enabled: Boolean(companyId), companyId, tables: ["tickets", "ticket_lines", "weighbridge_shifts"], intervalMs: 15_000, onRefresh: refreshDrivers });
  useLiveRefresh({ enabled: Boolean(companyId) && canReadTraffic, companyId, tables: ["ptc_vehicle_states", "ptc_events", "ptc_combine_shifts"], intervalMs: 5_000, onRefresh: trafficResource.refresh });
  useEffect(() => { setHarvestedHectares(""); }, [selectedPlotId]);

  useEffect(() => {
    const plots = summary?.harvestPlots || [];
    const activePlotId = plots.find((plot) => plot.isCurrent)?.cropStructureAllocationId || null;
    const previousActivePlotId = previousActivePlotRef.current;
    setSelectedPlotId((current) => {
      if (!plots.length) return null;
      const stillAvailable = current && plots.some((plot) => plot.cropStructureAllocationId === current);
      if (!stillAvailable || !current || (previousActivePlotId && current === previousActivePlotId && activePlotId !== previousActivePlotId)) {
        return activePlotId || plots[0].cropStructureAllocationId;
      }
      return current;
    });
    previousActivePlotRef.current = activePlotId;
  }, [summary?.harvestPlots]);

  const potatoParties = useMemo(() => (summary?.parties || []).filter((party) => isPotatoLabel(party.cropName)), [summary]);
  const periodMovement = summary?.potatoPeriodMovement;
  const selectedPlot = summary?.harvestPlots.find((plot) => plot.cropStructureAllocationId === selectedPlotId)
    || summary?.harvestPlots.find((plot) => plot.isCurrent)
    || summary?.harvestPlots[0]
    || null;
  const selectedPlotTotalAcceptedKg = selectedPlot?.totalAcceptedKg ?? summary?.currentPlotTotalAcceptedKg ?? 0;
  const stockKg = potatoParties.reduce((total, party) => total + party.currentStockKg, 0);
  const liveSelection = summary?.activeWeighbridgeSelection || null;
  const activeSelection = selectedPlot
    ? {
        ticketId: "",
        occurredAt: selectedPlot.lastChangedAt,
        fieldId: selectedPlot.fieldId,
        fieldName: selectedPlot.fieldName,
        cropStructureAllocationId: selectedPlot.cropStructureAllocationId,
        harvestLotId: null,
        seasonId: selectedPlot.seasonId,
        cropId: selectedPlot.cropId,
        cropName: selectedPlot.cropName,
        varietyId: selectedPlot.varietyId,
        varietyName: selectedPlot.varietyName,
        reproductionId: selectedPlot.reproductionId,
        reproductionName: selectedPlot.reproductionName,
        areaHa: selectedPlot.areaHa,
      }
    : liveSelection;
  const activeCrop = activeSelection?.cropName || "Уборка";
  const activeField = activeSelection?.fieldName || "Поле не выбрано";
  const activeFieldLabel = activeField.replace(/^поле\s*/iu, "") || activeField;
  const activeShift = traffic?.snapshot.combineShift || null;
  const fieldHectares = activeSelection?.areaHa ?? null;
  const reproduction = compactReproductionLabel(activeSelection?.reproductionName);
  const reproductionDetail = reproduction === "—" ? null : /^\d+$/u.test(reproduction) ? `${reproduction} р.` : reproduction;
  const currentPlotIdentity = activeSelection
    ? [
        /^поле\b/iu.test(activeField) ? activeField : `Поле ${activeField}`,
        activeSelection.varietyName,
        reproductionDetail,
        fieldHectares === null ? null : `участок ${fieldHectares.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} га`,
      ].filter(Boolean).join(" · ")
    : "Точный участок не выбран";
  const shiftIsOpen = activeShift?.status === "open";
  const weighbridgeOnline = Boolean(summary?.weighbridgeShifts?.some((shift) => shift.status === "open"));
  const combineOnline = Boolean(selectedPlot?.combineShiftOpen || shiftIsOpen);
  const enteredHectares = Number(harvestedHectares.replace(",", "."));
  const hectares = harvestedHectares.trim()
    ? (Number.isFinite(enteredHectares) && enteredHectares > 0 ? enteredHectares : null)
    : selectedPlot?.areaPending ? null : selectedPlot?.harvestedAreaHa;
  const manualYieldTonnes = hectares && hectares > 0 ? selectedPlotTotalAcceptedKg / 1000 / hectares : null;
  const liveYieldTonnes = selectedPlot?.yieldTPerHa ?? (!selectedPlot ? summary?.currentPlotYieldTPerHa ?? null : null);
  const liveYieldNote = selectedPlot?.harvestedAreaHa
    ? `Всего подтверждено: ${selectedPlot.harvestedAreaHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га${selectedPlot.areaPending ? " · гектары текущей смены ещё не указаны" : ""}`
    : summary?.currentPlotHarvestedAreaStatus === "verified"
      ? `Убрано за рабочий день: ${summary.currentPlotHarvestedAreaHa?.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га`
      : summary?.currentPlotHarvestedAreaStatus === "field_has_multiple_plots"
      ? "Гектары смены связаны с полем, а не с точным участком"
      : summary?.currentPlotHarvestedAreaStatus === "no_closed_shift"
        ? "Нет закрытого отчёта смены с фактическими гектарами"
        : "Точный участок не выбран";
  const trafficVehicles = useMemo(() => mergeTrafficVehicles(traffic?.snapshot || null, traffic?.fleet || []), [traffic]);
  const grouped = useMemo(() => Object.fromEntries(GROUPS.map((group) => [group.key, trafficVehicles.filter((vehicle) => vehicleGroup(vehicle) === group.key)])) as Record<TrafficGroup, TrafficVehicle[]>, [trafficVehicles]);

  useEffect(() => {
    if (!traffic || initialTrafficGroupSelectedRef.current) return;
    initialTrafficGroupSelectedRef.current = true;
    const initialGroup = (["loaded", "unloading", "empty", "repair", "offline"] as TrafficGroup[]).find((group) => grouped[group].length > 0);
    if (initialGroup) setSelectedGroup(initialGroup);
  }, [grouped, traffic]);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-3 overflow-x-hidden">
      {error ? <div className="border-l-2 border-rose-400 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {!summary ? <HarvestDashboardSkeleton /> : null}
      {summaryResource.stale ? <div role="status" className="text-xs text-muted-foreground">Сохранённая сводка · {summaryResource.savedAt ? new Date(summaryResource.savedAt).toLocaleTimeString("ru-RU") : ""} · {error ? "не удалось обновить" : "обновляется…"}</div> : null}

      {summary ? (
        <>
          <section className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-y border-border py-1.5 text-[11px]" aria-label="Текущая работа">
            <span className={`flex items-center gap-1.5 font-semibold ${weighbridgeOnline ? "text-emerald-700" : "text-muted-foreground"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${weighbridgeOnline ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              Весовая {weighbridgeOnline ? "Online" : "Offline"}
            </span>
            <span className={`flex items-center gap-1.5 font-semibold ${combineOnline ? "text-emerald-700" : "text-muted-foreground"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${combineOnline ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              Комбайн {combineOnline ? "Online" : "Offline"}
            </span>
            <span className="text-muted-foreground">Культура <strong className="text-foreground">{activeCrop}</strong></span>
            <span className="text-muted-foreground">Поле <strong className="text-foreground">{activeFieldLabel}</strong></span>
            <span className="text-muted-foreground">Участок <strong className="tabular-nums text-foreground">{fieldHectares == null ? "—" : `${fieldHectares.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} га`}</strong></span>
          </section>

          {summary.harvestPlots.length ? (
            <section className="border-b border-border py-1.5" aria-label="Поля сегодняшней уборки">
              <div role="tablist" aria-label="Активное и предыдущие поля" className="travkin-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
                {summary.harvestPlots.map((plot) => {
                  const selected = plot.cropStructureAllocationId === selectedPlot?.cropStructureAllocationId;
                  const completed = plot.status === "completed";
                  const identity = [plot.varietyName, compactReproductionLabel(plot.reproductionName)].filter((value) => value && value !== "—").join(" · ");
                  return (
                    <button
                      key={plot.cropStructureAllocationId}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setSelectedPlotId(plot.cropStructureAllocationId)}
                      className={`min-w-[210px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-[color:var(--manor-brass-soft)] bg-[color:var(--manor-paper-raised)]" : "border-border bg-transparent hover:bg-card"}`}
                      title={`${plot.fieldName} · ${identity || plot.cropName}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{plot.fieldName}</span>
                        {plot.isCurrent ? <span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-emerald-700">Текущее</span> : null}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                        <span className={`flex shrink-0 items-center gap-1 font-medium ${completed ? "text-muted-foreground" : "text-emerald-700"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${completed ? "bg-muted-foreground" : "bg-emerald-500"}`} />
                          {completed ? "Завершено" : plot.status === "paused" ? "Приостановлено" : "В работе"}
                        </span>
                        <span className="truncate text-muted-foreground">{identity || plot.cropName}</span>
                        <span className="shrink-0 tabular-nums text-[color:var(--manor-brass-soft)]" title="Всего принято с участка">{mass(plot.totalAcceptedKg)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {summary.weighbridgeShifts?.length ? <WeighbridgeShiftHistory shifts={summary.weighbridgeShifts} /> : null}

          <section className="grid grid-cols-2 border-b border-border sm:grid-cols-4" aria-label="Главные показатели уборки">
            <div className="min-w-0 py-2 pr-2 sm:py-1 sm:pr-3">
              <div className="text-[9px] uppercase leading-none tracking-[0.11em] text-muted-foreground sm:text-[10px]">Итог дня · картофель</div>
              <div className="mt-1 whitespace-nowrap text-base font-semibold leading-none tabular-nums text-[color:var(--manor-brass-soft)] sm:text-lg">{periodMovement?.netAfterRemovalsKg != null ? mass(periodMovement.netAfterRemovalsKg) : "Нет данных"}</div>
              <div className="mt-1 text-[10px] text-muted-foreground" title={summary.period.label}>Все поля · с {summary.period.operationalDayStartHour}:00 · приход − вывоз примесей</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{periodMovement?.removedImpuritiesKg != null
                ? `Приход ${mass(periodMovement.receivedNetKg)} − примеси ${mass(periodMovement.removedImpuritiesKg)}`
                : "Не удалось определить культуру или источник примесей"}</div>
            </div>
            <div className="min-w-0 border-l border-border px-2 py-2 sm:px-3 sm:py-1">
              <div className="text-[9px] uppercase leading-none tracking-[0.08em] text-muted-foreground sm:text-[10px]">С выбранного участка · всего</div>
              <div className="mt-1 whitespace-nowrap text-base font-semibold leading-none tabular-nums text-foreground sm:text-lg">{activeSelection ? mass(selectedPlotTotalAcceptedKg) : "—"}</div>
              <div className="mt-1 truncate text-[10px] text-muted-foreground" title={currentPlotIdentity}>{activeSelection ? currentPlotIdentity : "Комбайнёр должен выбрать участок"}</div>
            </div>
            <div className="min-w-0 border-t border-border py-2 pr-2 sm:border-l sm:border-t-0 sm:px-3 sm:py-1">
              <div className="text-[9px] uppercase leading-none tracking-[0.11em] text-muted-foreground sm:text-[10px]">На складе</div>
              <div className="mt-1 whitespace-nowrap text-base font-semibold leading-none tabular-nums text-foreground sm:text-lg">{mass(stockKg)}</div>
              <div className="mt-1 truncate text-[10px] text-muted-foreground">Чистый остаток картофеля</div>
            </div>
            <button type="button" onClick={() => setCalculatorOpen((value) => !value)} className="min-h-9 min-w-0 border-l border-t border-border px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:border-t-0 sm:px-3 sm:py-1">
              <div className="text-[9px] uppercase leading-none tracking-[0.08em] text-muted-foreground sm:text-[10px]">Живая урожайность</div>
              <div className={`mt-1 leading-none tabular-nums text-foreground ${liveYieldTonnes == null ? "text-xs font-medium sm:text-sm" : "whitespace-nowrap text-sm font-semibold sm:text-lg"}`}>{liveYieldTonnes == null ? "Нет подтверждённых гектаров" : `${liveYieldTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т/га`}</div>
              <div className="mt-1 text-[10px] text-muted-foreground" title={liveYieldNote}>{liveYieldNote}</div>
              {selectedPlot?.latestShiftAreaHa != null ? <div className="mt-1 text-[10px] text-muted-foreground">Последняя смена на участке: {selectedPlot.latestShiftAreaHa.toLocaleString("ru-RU")} га</div> : null}
            </button>
          </section>

          {calculatorOpen ? (
            <section className="grid max-w-md grid-cols-[minmax(0,1fr)_minmax(112px,.8fr)] items-end gap-3 rounded-lg bg-card px-3 py-2.5 shadow-manor-sm" aria-label="Калькулятор урожайности">
              <h3 className="col-span-2 text-xs font-semibold text-foreground">Калькулятор урожайности</h3>
              <label className="text-[11px] text-muted-foreground">Убрано, га
                <Input inputMode="decimal" value={harvestedHectares} onChange={(event) => setHarvestedHectares(event.target.value)} placeholder={selectedPlot?.harvestedAreaHa ? `Подтверждено: ${selectedPlot.harvestedAreaHa.toLocaleString("ru-RU")}` : "Например, 2,4"} className="mt-1 h-9" />
              </label>
               <div className="min-w-0"><div className="text-[11px] text-muted-foreground">Урожайность</div><div className="mt-1 truncate text-lg font-semibold tabular-nums text-[color:var(--manor-brass-soft)]">{manualYieldTonnes == null ? "—" : `${manualYieldTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т/га`}</div></div>
            </section>
          ) : null}

        </>
      ) : null}

      {canReadTraffic ? (
        <section aria-label="Статусы машин PTC">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="text-sm font-semibold">Оборот машин{traffic ? ` · ${trafficVehicles.filter((vehicle) => vehicle.assigned).length} на линии` : ""}</h2>
            <div className="text-xs text-muted-foreground">{trafficResource.stale ? "PTC · сохранённые данные" : traffic ? "PTC · Live" : "PTC · загрузка"}</div>
          </div>
          {trafficError ? <div className="mb-3 border-l-2 border-amber-400 px-3 py-2 text-sm text-amber-700">{trafficError}</div> : null}
          <div role="tablist" aria-label="Статусы машин" className="grid grid-cols-5 gap-1 border-y border-border py-1 lg:hidden">
            {GROUPS.map((group) => <button key={group.key} role="tab" aria-selected={selectedGroup === group.key} onClick={() => setSelectedGroup(group.key)} className={`min-h-[55px] min-w-0 rounded-lg px-1 py-2 text-center transition-colors duration-200 ${selectedGroup === group.key ? "bg-[color:var(--manor-paper-raised)] text-foreground" : "text-muted-foreground"}`}><span className="block text-[9px] leading-3">{group.mobile}</span><strong className="mt-1 block text-lg tabular-nums">{grouped[group.key]?.length || 0}</strong></button>)}
          </div>
          {!traffic ? <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загрузка PTC...</div> : (
            <>
              <div className="h-[56dvh] space-y-2 overflow-y-auto overscroll-contain py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden" tabIndex={0} aria-label={`Машины: ${GROUPS.find((group) => group.key === selectedGroup)?.desktop || selectedGroup}`}>{grouped[selectedGroup].map((vehicle) => <VehicleCard key={vehicle.vehicle_id} vehicle={vehicle} now={now} group={selectedGroup} shiftIsOpen={shiftIsOpen} />)}{!grouped[selectedGroup].length ? <div className="py-4 text-sm text-muted-foreground">Машин в этом статусе нет.</div> : null}</div>
              <div className="hidden grid-cols-5 gap-5 lg:grid">
                {GROUPS.map((group) => <section key={group.key} className="min-w-0"><header className="flex items-center justify-between gap-2 border-b border-border pb-2"><h3 className="text-xs font-medium text-muted-foreground">{group.desktop}</h3><strong className="text-lg tabular-nums">{grouped[group.key].length}</strong></header><div className="h-[460px] space-y-2 overflow-y-auto overscroll-contain pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" tabIndex={0} aria-label={`Машины: ${group.desktop}`}>{grouped[group.key].map((vehicle) => <VehicleCard key={vehicle.vehicle_id} vehicle={vehicle} now={now} group={group.key} shiftIsOpen={shiftIsOpen} />)}</div></section>)}
              </div>
            </>
          )}
        </section>
      ) : null}

      {driverError ? <div className="border-l-2 border-rose-400 px-3 py-2 text-sm text-rose-700">{driverError}</div> : null}
      {championResource.stale ? <div role="status" className="text-xs text-muted-foreground">Сохранённая таблица чемпионов · {driverError ? "не удалось обновить" : "обновляется…"}</div> : null}
      {driverSummary ? <PotatoDriverSummary rows={driverSummary.potatoDrivers} totalWeightKg={driverSummary.potatoDrivers.reduce((sum, row) => sum + row.netWeightKg, 0)} periodLabel={driverSummary.period.label} period={championPeriod} onPeriodChange={setChampionPeriod} refreshing={driverLoading} updatedAt={champions?.updatedAt} /> : driverLoading ? <section className="flex min-h-32 items-center justify-center rounded-xl border border-border bg-card/40 text-sm text-muted-foreground" aria-label="Загрузка таблицы чемпионов"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загрузка таблицы чемпионов...</section> : null}

      {profile && ["agronomist", "director"].includes(profile.role) && profile.company_id ? (
        <details className="group border-y border-border" onToggle={(event) => setShiftReportOpen(event.currentTarget.open)}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-medium marker:hidden">
            <span>Отчёт PTC по закрытой смене</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          {shiftReportOpen ? <div className="pb-4"><TrafficShiftSummary key={profile.company_id} companyId={profile.company_id} /></div> : null}
        </details>
      ) : null}

    </div>
  );
}
