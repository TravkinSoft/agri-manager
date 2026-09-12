"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Clock3, Loader2, Warehouse } from "lucide-react";
import { TicketPreviewDialog } from "@/components/weighbridge/ticket-preview-dialog";
import { PotatoDriverSummary } from "@/components/dashboard/potato-driver-summary";
import { TrafficShiftSummary } from "@/components/dashboard/traffic-shift-summary";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/contexts/auth-context";
import { isPotatoLabel, type HarvestFilterOptions, type HarvestOverview } from "@/lib/dashboard/harvest-summary";
import { getHarvestBootstrap, getHarvestSummary } from "@/lib/services/harvest-dashboard";
import { LIVE_REFRESH_TABLES, useLiveRefresh } from "@/hooks/use-live-refresh";
import { getFleetVehicleBrand, type FleetVehicle } from "@/lib/fleet/model";
import type { TrafficSnapshot, TrafficVehicle } from "@/lib/traffic/model";
import { trafficRequest } from "@/components/traffic/use-traffic";
import { compactReproductionLabel } from "@/lib/agronomy/reproduction-display";

type BootstrapPayload = {
  summary: HarvestOverview;
  options: HarvestFilterOptions;
  operationalDayStartHour: number;
};
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
  return `${tonnes.toLocaleString("ru-RU", { maximumFractionDigits: tonnes >= 100 ? 1 : 2 })} т`;
}
function clock(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function age(value: string, now: number): string {
  const started = Date.parse(value);
  if (!Number.isFinite(started)) return "—";
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
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

function useDashboardTraffic(enabled: boolean) {
  const [payload, setPayload] = useState<TrafficPayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) {
      setPayload(null);
      setError("");
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await trafficRequest("/api/traffic", "GET", undefined, true) as TrafficPayload;
        if (!cancelled) {
          setPayload(next);
          setError("");
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "PTC временно недоступен");
      } finally {
        if (!cancelled) timer = window.setTimeout(load, 5_000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled]);
  return { payload, error };
}

const VEHICLE_CARD_SURFACES: Record<TrafficGroup, string> = {
  empty: "bg-[rgba(238,232,215,0.035)]",
  loaded: "bg-[rgba(143,183,126,0.12)]",
  unloading: "bg-[rgba(208,171,101,0.12)]",
  repair: "bg-[rgba(207,116,104,0.10)]",
  offline: "bg-[rgba(238,232,215,0.025)]",
};

function VehicleCard({ vehicle, now, group }: { vehicle: TrafficVehicle; now: number; group: TrafficGroup }) {
  const brand = getFleetVehicleBrand(vehicle);
  return (
    <article data-traffic-vehicle-card={group} className={`grid min-h-[92px] grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-[10px] px-3 py-3.5 animate-in fade-in slide-in-from-bottom-1 duration-200 ${VEHICLE_CARD_SURFACES[group]}`}>
      <div className="min-w-0">
        <div className="truncate text-base font-semibold tracking-[0.01em] text-foreground">{vehicle.driver?.trim() || "Водитель не назначен"}</div>
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{brand}</div>
        <div className="mt-0.5 text-xs font-medium tracking-[0.04em] text-[color:var(--manor-brass-soft)]">{vehicle.plate?.trim() || "Без номера"}</div>
      </div>
      <div className="flex items-start gap-1 pt-0.5 text-xs font-medium tabular-nums text-[color:var(--manor-brass-soft)]">
        <Clock3 className="mt-0.5 h-3 w-3" />{age(vehicle.inRepair ? vehicle.repairChangedAt || vehicle.since : vehicle.since, now)}
      </div>
    </article>
  );
}

export function HarvestDashboard() {
  const { profile } = useAuth();
  const companyId = profile?.company_id || null;
  const canReadTraffic = Boolean(profile && ["agronomist", "company_admin", "global_admin", "fleet_manager"].includes(profile.role));
  const { payload: traffic, error: trafficError } = useDashboardTraffic(canReadTraffic);
  const [summary, setSummary] = useState<HarvestOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<TrafficGroup>("loaded");
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [shiftReportOpen, setShiftReportOpen] = useState(false);
  const [harvestedHectares, setHarvestedHectares] = useState("");
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const summaryRef = useRef<HarvestOverview | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initialTrafficGroupSelectedRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(!summaryRef.current);
    setRefreshing(Boolean(summaryRef.current));
    setError("");
    const query = { period: "current_day" as const, start: null, end: null, filters: {} };
    try {
      const next = summaryRef.current
        ? await getHarvestSummary<HarvestOverview>(query, { signal: controller.signal })
        : (await getHarvestBootstrap<BootstrapPayload>(query, { signal: controller.signal })).summary;
      if (controller.signal.aborted) return;
      summaryRef.current = next;
      setSummary(next);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить сводку");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [companyId]);

  useEffect(() => {
    summaryRef.current = null;
    initialTrafficGroupSelectedRef.current = false;
    setSummary(null);
    void loadDashboard();
    return () => abortRef.current?.abort();
  }, [companyId, loadDashboard]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useLiveRefresh({ enabled: Boolean(companyId), companyId, tables: LIVE_REFRESH_TABLES.weighbridge, intervalMs: 15_000, onRefresh: loadDashboard });

  const potatoParties = useMemo(() => (summary?.parties || []).filter((party) => isPotatoLabel(party.cropName)), [summary]);
  const receivedKg = potatoParties.reduce((total, party) => total + party.receivedKg, 0);
  const stockKg = potatoParties.reduce((total, party) => total + party.currentStockKg, 0);
  const waitingTare = potatoParties.flatMap((party) => party.openTickets).filter((ticket) => (ticket.waitingTareMinutes || 0) > 0);
  const recentEvents = (summary?.completedEvents || []).filter((event) => isPotatoLabel(event.identityLabel)).slice(0, 5);
  const activeSelection = summary?.activeWeighbridgeSelection || null;
  const activeField = activeSelection?.fieldName || "Поле не выбрано";
  const activeIdentity = activeSelection
    ? [activeSelection.varietyName, compactReproductionLabel(activeSelection.reproductionName)].filter((value) => value && value !== "—").join(" · ")
    : "Картофель";
  const activeShift = traffic?.snapshot.combineShift || null;
  const fieldHectares = activeSelection?.areaHa ?? null;
  const fieldDetail = [activeIdentity, fieldHectares === null ? null : `участок ${fieldHectares.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га`].filter(Boolean).join(" · ");
  const shiftIsOpen = activeShift?.status === "open";
  const hectares = Number(harvestedHectares.replace(",", "."));
  const yieldTonnes = hectares > 0 ? receivedKg / 1000 / hectares : null;
  const trafficVehicles = useMemo(() => mergeTrafficVehicles(traffic?.snapshot || null, traffic?.fleet || []), [traffic]);
  const grouped = useMemo(() => Object.fromEntries(GROUPS.map((group) => [group.key, trafficVehicles.filter((vehicle) => vehicleGroup(vehicle) === group.key)])) as Record<TrafficGroup, TrafficVehicle[]>, [trafficVehicles]);

  useEffect(() => {
    if (!traffic || initialTrafficGroupSelectedRef.current) return;
    initialTrafficGroupSelectedRef.current = true;
    const initialGroup = (["loaded", "unloading", "empty", "repair", "offline"] as TrafficGroup[]).find((group) => grouped[group].length > 0);
    if (initialGroup) setSelectedGroup(initialGroup);
  }, [grouped, traffic]);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 overflow-x-hidden">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="tf-manor-heading text-3xl sm:text-4xl">Картофель</h1>
          <div className="mt-1 text-xs text-muted-foreground">Обновлено в {clock(traffic?.snapshot.serverTime || new Date(now).toISOString())}</div>
        </div>
        <div className="flex items-center gap-2 pb-0.5 text-xs uppercase tracking-[0.12em] text-emerald-700">
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
          Live
        </div>
      </header>
      {error ? <div className="border-l-2 border-rose-400 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading && !summary ? <div className="flex min-h-[18rem] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загрузка...</div> : null}

      {summary ? (
        <>
          <section className="flex items-center justify-between gap-4 border-y border-border py-3" aria-label="Текущее поле">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-foreground">{activeField}</h2>
              <div className="mt-1 truncate text-xs text-muted-foreground">{fieldDetail || "Картофель"}</div>
            </div>
            {canReadTraffic ? <div className="shrink-0 text-right">
              <div className="text-sm font-medium text-[color:var(--manor-brass-soft)]">{traffic ? (shiftIsOpen ? "Смена открыта" : "Смена не открыта") : "PTC загружается"}</div>
              <div className="mt-1 text-xs text-muted-foreground">{traffic?.snapshot.enabled ? "PTC работает" : "ожидание данных"}</div>
            </div> : null}
          </section>

          <section className="grid grid-cols-3 border-b border-border" aria-label="Главные показатели картофеля">
            <div className="min-w-0 py-4 pr-2 sm:pr-3">
              <div className="text-[9px] uppercase tracking-[0.11em] text-muted-foreground sm:text-[10px]">Принято</div>
              <div className="mt-1 whitespace-nowrap text-lg font-semibold tabular-nums text-[color:var(--manor-brass-soft)] sm:text-2xl">{mass(receivedKg)}</div>
            </div>
            <div className="min-w-0 border-x border-border px-2 py-4 sm:px-3">
              <div className="text-[9px] uppercase tracking-[0.11em] text-muted-foreground sm:text-[10px]">На складе</div>
              <div className="mt-1 whitespace-nowrap text-lg font-semibold tabular-nums text-foreground sm:text-2xl">{mass(stockKg)}</div>
            </div>
            <button type="button" onClick={() => setCalculatorOpen((value) => !value)} className="min-w-0 px-2 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3">
              <div className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground sm:text-[10px]">Урожайность</div>
              <div className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums text-foreground sm:text-2xl">{yieldTonnes == null ? "Рассчитать" : `${yieldTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т/га`}</div>
            </button>
          </section>

          {calculatorOpen ? (
            <section className="grid gap-3 border-b border-border pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(180px,.5fr)_minmax(160px,.5fr)] sm:items-end" aria-label="Калькулятор урожайности">
              <div><div className="text-xs text-muted-foreground">Принятый вес</div><div className="mt-1 text-lg font-semibold tabular-nums">{mass(receivedKg)}</div></div>
              <label className="text-xs text-muted-foreground">Убрано, га
                <Input inputMode="decimal" value={harvestedHectares} onChange={(event) => setHarvestedHectares(event.target.value)} placeholder="Например, 2,4" className="mt-1 h-10" />
              </label>
              <div><div className="text-xs text-muted-foreground">Урожайность</div><div className="mt-1 text-lg font-semibold tabular-nums text-[color:var(--manor-brass-soft)]">{yieldTonnes == null ? "—" : `${yieldTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т/га`}</div></div>
            </section>
          ) : null}

          {waitingTare.length ? <div className="flex items-start gap-2 border-l-2 border-amber-400 px-3 py-2 text-sm text-amber-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{waitingTare.length} {waitingTare.length === 1 ? "машина ждёт" : "машины ждут"} тары на весовой</div> : null}
        </>
      ) : null}

      {canReadTraffic ? (
        <section aria-label="Статусы машин PTC">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="text-sm font-semibold">Оборот машин</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="text-emerald-700">PTC · Live</span><span>{trafficVehicles.filter((vehicle) => vehicle.assigned).length} на линии</span></div>
          </div>
          {trafficError ? <div className="mb-3 border-l-2 border-amber-400 px-3 py-2 text-sm text-amber-700">{trafficError}</div> : null}
          <div role="tablist" aria-label="Статусы машин" className="grid grid-cols-5 gap-1 border-y border-border py-1 lg:hidden">
            {GROUPS.map((group) => <button key={group.key} role="tab" aria-selected={selectedGroup === group.key} onClick={() => setSelectedGroup(group.key)} className={`min-h-[55px] min-w-0 rounded-lg px-1 py-2 text-center transition-colors duration-200 ${selectedGroup === group.key ? "bg-[color:var(--manor-paper-raised)] text-foreground" : "text-muted-foreground"}`}><span className="block text-[9px] leading-3">{group.mobile}</span><strong className="mt-1 block text-lg tabular-nums">{grouped[group.key]?.length || 0}</strong></button>)}
          </div>
          {!traffic ? <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загрузка PTC...</div> : (
            <>
              <div className="space-y-2 py-2 lg:hidden">{grouped[selectedGroup].map((vehicle) => <VehicleCard key={vehicle.vehicle_id} vehicle={vehicle} now={now} group={selectedGroup} />)}{!grouped[selectedGroup].length ? <div className="py-4 text-sm text-muted-foreground">Машин в этом статусе нет.</div> : null}</div>
              <div className="hidden grid-cols-5 gap-5 lg:grid">
                {GROUPS.map((group) => <section key={group.key} className="min-w-0"><header className="flex items-center justify-between gap-2 border-b border-border pb-2"><h3 className="text-xs font-medium text-muted-foreground">{group.desktop}</h3><strong className="text-lg tabular-nums">{grouped[group.key].length}</strong></header><div className="space-y-2 pt-2">{grouped[group.key].map((vehicle) => <VehicleCard key={vehicle.vehicle_id} vehicle={vehicle} now={now} group={group.key} />)}</div></section>)}
              </div>
            </>
          )}
        </section>
      ) : null}

      {summary ? (
        <>
          <section>
            <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Последние рейсы</h2><span className="text-xs text-muted-foreground">Нетто</span></div>
            <div className="border-y border-border">
              {recentEvents.map((event) => (
                <button key={event.ticketId} type="button" onClick={() => setTicketId(event.ticketId)} className="grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 text-left last:border-0 hover:text-[color:var(--manor-brass-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="text-xs tabular-nums text-muted-foreground">{clock(event.occurredAt)}</span>
                  <span className="min-w-0 truncate text-sm font-medium">{event.fieldName}</span>
                  <strong className="whitespace-nowrap text-sm tabular-nums">{mass(event.netWeightKg)}</strong>
                </button>
              ))}
              {!recentEvents.length ? <div className="py-6 text-sm text-muted-foreground">Рейсов сегодня нет.</div> : null}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2"><Warehouse className="h-4 w-4 text-muted-foreground" /><h2 className="text-sm font-semibold">Размещение</h2></div>
            <div className="border-y border-border">
              {potatoParties.flatMap((party) => party.warehouses.map((warehouse) => ({ ...warehouse, party }))).map((warehouse) => (
                <div key={`${warehouse.party.key}:${warehouse.warehouseId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 last:border-0">
                  <div className="min-w-0"><div className="truncate text-sm font-medium">{warehouse.warehouseName}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{warehouse.party.varietyName || "Сорт не указан"} · {compactReproductionLabel(warehouse.party.reproductionName)}</div></div>
                  <div className="whitespace-nowrap text-sm font-semibold tabular-nums">{mass(warehouse.currentKg)}</div>
                </div>
              ))}
              {!potatoParties.some((party) => party.warehouses.length) ? <div className="py-6 text-sm text-muted-foreground">Размещения пока нет.</div> : null}
            </div>
          </section>
        </>
      ) : null}

      {summary ? <PotatoDriverSummary rows={summary.potatoDrivers} /> : null}

      {profile && ["agronomist", "director"].includes(profile.role) && profile.company_id ? (
        <details className="group border-y border-border" onToggle={(event) => setShiftReportOpen(event.currentTarget.open)}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-medium marker:hidden">
            <span>Отчёт PTC по закрытой смене</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          {shiftReportOpen ? <div className="pb-4"><TrafficShiftSummary key={profile.company_id} companyId={profile.company_id} /></div> : null}
        </details>
      ) : null}

      <TicketPreviewDialog ticketId={ticketId} open={Boolean(ticketId)} onOpenChange={(open) => !open && setTicketId(null)} />
    </div>
  );
}
