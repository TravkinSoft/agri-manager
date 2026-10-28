"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Clock3, Loader2, PackageCheck, Truck, Wrench } from "lucide-react";
import { useSummaryResource } from "@/components/dashboard/use-summary-resource";
import { subscribeTrafficChanges } from "@/lib/traffic/changes";
import type { TrafficBoardSnapshot, TrafficBoardVehicle, TrafficBoardGroup as TrafficGroup } from "@/lib/traffic/read-only-board";
import { summaryClock } from "@/lib/dashboard/summary-presentation";
import { summaryTime } from "@/lib/dashboard/operational-summary";
const TABLES = ["ptc_vehicle_states", "fleet_vehicle_repairs", "reference_vehicles", "reference_specialists", "company_people", "tickets", "weighbridge_shifts"];
const GROUPS: Array<{key: TrafficGroup; desktop: string; mobile: string}> = [
  {key:"empty", desktop:"Пустые", mobile:"Пустые"},
  {key:"loaded", desktop:"В пути на весовую", mobile:"На весовую"},
  {key:"unloading", desktop:"На выгрузке", mobile:"Выгрузка"},
  {key:"repair", desktop:"На ремонте", mobile:"Ремонт"},
  {key:"offline", desktop:"Не на линии", mobile:"Не на линии"},
];
function age(value: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  return `${Math.floor(minutes / 1440)} д ${Math.floor(minutes % 1440 / 60)} ч ${minutes % 60} мин`;
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

function VehicleCard({ vehicle, now, group }: { vehicle: TrafficBoardVehicle; now: number; group: TrafficGroup }) {
  const brand = vehicle.brand;
  const timer = vehicle.since ? age(vehicle.since, now) : "—";
  return (
    <article data-traffic-vehicle-card={group} className={`grid min-h-[92px] grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-[10px] px-3 py-3 ${VEHICLE_CARD_SURFACES[group]}`}>
      <span className={`relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${VEHICLE_STATUS_ICON_STYLE[group]}`} title={VEHICLE_STATUS_LABEL[group]} aria-label={VEHICLE_STATUS_LABEL[group]}>
        {group === "repair" ? <Wrench className="h-5 w-5" aria-hidden="true" /> : <Truck className="h-5 w-5" aria-hidden="true" />}
        {group === "loaded" ? <PackageCheck className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[color:var(--manor-paper-raised)] p-0.5" aria-hidden="true" /> : null}
        {group === "unloading" ? <ArrowDownToLine className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[color:var(--manor-paper-raised)] p-0.5" aria-hidden="true" /> : null}
      </span>
      <div className="min-w-0">
        <div className="flex items-start gap-2 text-base font-semibold tracking-[0.01em] text-foreground">
          <span className="min-w-0 flex-1 truncate">{vehicle.driver?.trim() || "Водитель не назначен"}</span>
          {vehicle.shiftTrips !== undefined ? <span data-trip-count="" title={vehicle.shiftTrips == null ? "Количество рейсов недоступно" : "Завершённые приёмки водителя за текущую / последнюю смену весовой"}
            aria-label={vehicle.shiftTrips == null ? "Количество рейсов недоступно" : `Завершённых рейсов за смену: ${vehicle.shiftTrips}`}
            className="inline-flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded border border-border px-1 text-xs font-medium tabular-nums text-[color:var(--manor-brass-soft)]">{vehicle.shiftTrips ?? "—"}</span> : null}
        </div>
        <div className="mt-1.5 truncate text-xs text-muted-foreground">{brand}</div>
        <div className="mt-0.5 text-xs font-medium tracking-[0.04em] text-[color:var(--manor-brass-soft)]">{vehicle.plate?.trim() || "Без номера"}</div>
      </div>
      {timer ? <div className="col-start-2 flex flex-wrap items-center gap-1 text-xs tabular-nums text-[color:var(--manor-brass-soft)]">
        <Clock3 className="h-3 w-3" aria-hidden="true" />
        {vehicle.since ? <><time dateTime={vehicle.since} title={summaryTime(vehicle.since)}>{summaryClock(vehicle.since)}</time><span aria-hidden="true">·</span></> : null}{timer}
      </div> : null}
    </article>
  );
}


export function DashboardTrafficPanel({scope, companyId, enabled}: {scope: string; companyId: string; enabled: boolean}) {
  const {data: traffic, error, refresh} = useSummaryResource<TrafficBoardSnapshot>(scope, companyId,
    `/api/traffic/board?companyId=${encodeURIComponent(companyId)}&includeShiftTrips=true`, enabled, TABLES, 5_000);
  const [group, setGroup] = useState<TrafficGroup>("loaded");
  const selectedOnce = useRef(false);
  const [now, setNow] = useState(Date.now);
  const receivedAt = useRef(0);
  useEffect(() => { receivedAt.current = Date.now(); setNow(Date.now()); }, [traffic]);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const unsubscribe = subscribeTrafficChanges(companyId, () => void refresh());
    return () => { window.clearInterval(timer); unsubscribe(); };
  }, [enabled, companyId, refresh]);
  useEffect(() => {
    if (!traffic || selectedOnce.current) return;
    selectedOnce.current = true;
    setGroup((["loaded", "unloading", "empty", "repair", "offline"] as TrafficGroup[])
      .find(key => traffic.vehicles.some(vehicle => vehicle.group === key)) ?? "loaded");
  }, [traffic]);
  const serverNow = traffic && Number.isFinite(Date.parse(traffic.serverTime))
    ? Date.parse(traffic.serverTime) + Math.max(0, now - receivedAt.current) : now;
  return <DashboardTrafficView traffic={traffic} error={error} group={group} onGroup={setGroup} now={serverNow} />;
}
export function DashboardTrafficView({traffic, error, group, onGroup, now}: {
  traffic: TrafficBoardSnapshot | null; error: string | null; group: TrafficGroup; onGroup: (group: TrafficGroup) => void; now: number;
}) {
  return <section aria-label="Статусы машин PTC" className="space-y-3">
    <header className="flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-sm font-semibold">Оборот машин · {traffic ? traffic.vehicles.filter(vehicle => vehicle.group !== "offline" && vehicle.group !== "repair").length : "—"} на линии</h2>
      <span className="text-xs text-muted-foreground">ПТС · Только просмотр</span>
    </header>
    {error ? <p role="status" className="border-l-2 border-amber-400 px-3 py-2 text-sm">{traffic ? "Показан последний полученный снимок. " : ""}{error}</p> : null}
    <div aria-label="Статусы машин" className="grid grid-cols-5 gap-1 border-y border-border py-1 lg:hidden">
      {GROUPS.map(item => <button type="button" key={item.key} aria-pressed={group === item.key} onClick={() => onGroup(item.key)}
        className={`min-h-[55px] min-w-0 rounded-lg px-1 py-2 text-center ${group === item.key ? "bg-[color:var(--manor-paper-raised)] text-foreground" : "text-muted-foreground"}`}>
        <span className="block text-[9px] leading-3">{item.mobile}</span><strong className="mt-1 block text-lg tabular-nums">{traffic ? traffic.vehicles.filter(vehicle => vehicle.group === item.key).length : "—"}</strong>
      </button>)}
    </div>
    {!traffic && !error ? <div role="status" className="flex min-h-28 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загрузка ПТС…</div> : null}
    {traffic ? <>
      <div className="space-y-2 lg:hidden">{traffic.vehicles.filter(vehicle => vehicle.group === group).map(vehicle => <VehicleCard key={vehicle.id} vehicle={vehicle} now={now} group={group} />)}
        {!traffic.vehicles.some(vehicle => vehicle.group === group) ? <p className="py-4 text-sm text-muted-foreground">Машин в этом статусе нет.</p> : null}
      </div>
      <div className="hidden grid-cols-5 gap-5 lg:grid">{GROUPS.map(item => <section key={item.key} className="min-w-0">
        <header className="flex items-center justify-between gap-2 border-b border-border pb-2"><h3 className="text-xs font-medium text-muted-foreground">{item.desktop}</h3><strong className="text-lg tabular-nums">{traffic.vehicles.filter(vehicle => vehicle.group === item.key).length}</strong></header>
        <div className="space-y-2 pt-2">{traffic.vehicles.filter(vehicle => vehicle.group === item.key).map(vehicle => <VehicleCard key={vehicle.id} vehicle={vehicle} now={now} group={item.key} />)}</div>
      </section>)}</div>
    </> : null}
  </section>;
}
