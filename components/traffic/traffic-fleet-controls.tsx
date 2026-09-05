"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Check, ChevronUp, UserRound, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VehicleDriverAssignment } from "@/components/vehicles/vehicle-driver-assignment";
import { filterFleet, isFleetRepairReceipt, type FleetVehicle } from "@/lib/fleet/model";
import { STATE_LABEL, type TrafficSnapshot, type TrafficVehicle } from "@/lib/traffic/model";
import { publishTrafficChanged } from "@/lib/traffic/changes";
import { trafficRequest, type ManagerData } from "./use-traffic";

type Panel = "offline" | "actions" | "driver" | "repair" | "remove" | null;
export function TrafficFleetControls({ managed, snapshot, selected, onSelected, drawerOpen, onDrawerOpen,
  stale, refresh }: {
  managed: ManagerData; snapshot: TrafficSnapshot; selected: TrafficVehicle | null;
  onSelected: (vehicle: TrafficVehicle | null) => void; drawerOpen: boolean;
  onDrawerOpen: (value: boolean) => void; stale: boolean; refresh: (fresh?: boolean) => Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [car, setCar] = useState<FleetVehicle | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const fleet = useMemo(() => {
    const rows = new Map(managed.fleet.map(row => [row.id, { ...row, assigned: false }]));
    for (const vehicle of snapshot.vehicles) rows.set(vehicle.vehicle_id, {
      ...rows.get(vehicle.vehicle_id), id: vehicle.vehicle_id, name: vehicle.name, plate: vehicle.plate,
      driver: vehicle.driver, assigned: true, state: vehicle.state, lastActivity: vehicle.since,
      inRepair: vehicle.inRepair, repairVersion: vehicle.repairVersion,
    });
    return Array.from(rows.values());
  }, [managed.fleet, snapshot.vehicles]);
  const offline = fleet.filter(vehicle => !vehicle.assigned || vehicle.inRepair)
    .sort((a, b) => (b.lastActivity ? Date.parse(b.lastActivity) : 0) - (a.lastActivity ? Date.parse(a.lastActivity) : 0) || a.name.localeCompare(b.name, "ru"));
  const readyIds = new Set(offline.filter(vehicle => !vehicle.inRepair && !vehicle.assigned).map(vehicle => vehicle.id));
  const chosen = checked.filter(id => readyIds.has(id));
  const current = car ? fleet.find(vehicle => vehicle.id === car.id) ?? car : null;

  useEffect(() => {
    if (!selected) return;
    setCar({ id: selected.vehicle_id, name: selected.name, plate: selected.plate, driver: selected.driver,
      assigned: true, state: selected.state, inRepair: selected.inRepair, repairVersion: selected.repairVersion });
    setError(""); setPanel("actions"); onSelected(null);
  }, [selected, onSelected]);
  useEffect(() => {
    if (!drawerOpen) return;
    setChecked([]); setSearch(""); setError(""); setPanel("offline"); onDrawerOpen(false);
    void refresh(true);
  }, [drawerOpen, onDrawerOpen, refresh]);

  function close() { setPanel(null); }
  function manage(vehicle: FleetVehicle) { setCar(vehicle); setError(""); setPanel("actions"); }
  async function mutate(kind: "line" | "repair", vehicle: FleetVehicle | null, ids: string[] = [], assigned = false) {
    if (lock.current || stale || !snapshot.companyId) return;
    lock.current = true;
    const captured = vehicle ? { ...vehicle } : null;
    // Remove the complete modal before starting transport (including its scroll/pointer lock).
    flushSync(() => { setPanel(null); setPending(true); setError(""); });
    try {
      if (kind === "repair" && captured) {
        const receipt = await trafficRequest("/api/fleet/repair", "POST", {
          companyId: snapshot.companyId, vehicleId: captured.id, inRepair: !captured.inRepair,
          expectedVersion: captured.repairVersion ?? 0,
        }, true);
        if (!isFleetRepairReceipt(receipt) || receipt.companyId !== snapshot.companyId ||
          receipt.vehicleId !== captured.id || receipt.inRepair !== !captured.inRepair) throw new Error("Не удалось подтвердить изменение. Обновите список.");
      } else {
        await trafficRequest("/api/traffic/line", "POST", { companyId: snapshot.companyId,
          vehicleIds: ids, assigned, expectedRevision: snapshot.flowRevision ?? null }, true);
      }
      if (!alive.current) return;
      publishTrafficChanged(snapshot.companyId);
    } catch (caught) {
      if (alive.current) setError((caught as Error).message);
    } finally {
      if (alive.current) { await refresh(true); setPending(false); lock.current = false; }
    }
  }
  const single = chosen.length === 1 ? fleet.find(vehicle => vehicle.id === chosen[0]) : undefined;
  const isOffline = panel === "offline";
  return <>
    <button type="button" onClick={() => onDrawerOpen(true)} disabled={pending}
      className="mt-3 flex min-h-[48px] w-full items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-slate-200">
      <span>Не на линии · {offline.filter(vehicle => !vehicle.assigned).length}
        {offline.some(vehicle => vehicle.inRepair) ? ` · в ремонте ${offline.filter(vehicle => vehicle.inRepair).length}` : ""}</span>
      <ChevronUp size={18} aria-hidden />
    </button>
    {pending ? <p role="status" className="mt-2 text-xs text-slate-400">Изменение отправлено…</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-amber-200">{error}</p> : null}
    {panel === "driver" && current ? <VehicleDriverAssignment key={current.id} autoOpen
      vehicleId={current.id} companyId={snapshot.companyId} driverName={current.driver}
      vehicleLabel={`${current.name} · ${current.plate || "без номера"}`}
      onClosed={close} onAssigned={() => void refresh(true)} /> : null}
    {panel && panel !== "driver" ? <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent hideCloseButton data-testid={isOffline ? "offline-sheet" : "vehicle-actions"}
        className={isOffline
          ? "bottom-0 left-0 top-auto flex max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-3 overflow-hidden rounded-t-3xl border-slate-700 bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-slate-100 sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2"
          : "flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md flex-col overflow-y-auto rounded-2xl border-slate-700 bg-slate-950 p-4 text-slate-100"}>
        {isOffline ? <div aria-hidden className="mx-auto h-1 w-10 shrink-0 rounded-full bg-white/25" /> : null}
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle>{isOffline ? "Не на линии" : panel === "repair" ? current?.inRepair ? "Вернуть из ремонта?" : "Отправить на ремонт?" : panel === "remove" ? "Убрать с линии?" : current?.driver || "Водитель не назначен"}</DialogTitle>
          <DialogDescription className="break-words text-slate-400">
            {isOffline ? "Выберите машины для работы" : `${current?.name} · ${current?.plate || "без номера"}`}
          </DialogDescription>
        </DialogHeader>
        <Button type="button" variant="ghost" aria-label="Закрыть" onClick={close} className="absolute right-1 top-2 h-12 w-12 p-0"><X size={20} /></Button>
        {isOffline ? <>
          <Input aria-label="Найти машину или водителя" placeholder="Машина или водитель" value={search}
            onChange={event => setSearch(event.target.value)} className="min-h-[48px] shrink-0 text-base" />
          <div data-testid="offline-scroll-list" className="min-h-0 flex-1 touch-pan-y space-y-2 overflow-y-auto overscroll-contain">
            {filterFleet(offline, search, false).map(vehicle => (
              <button key={vehicle.id} type="button" aria-pressed={!vehicle.inRepair && chosen.includes(vehicle.id)}
                onClick={() => vehicle.inRepair ? manage(vehicle) : setChecked(previous => previous.includes(vehicle.id) ? previous.filter(id => id !== vehicle.id) : [...previous, vehicle.id])}
                className={`flex min-h-[64px] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left ${vehicle.inRepair ? "border-rose-400/50 bg-rose-100 text-rose-950" : chosen.includes(vehicle.id) ? "border-amber-300 bg-amber-300/10" : "border-white/15 bg-white/5"}`}>
                <span className="min-w-0">
                  <span className="block break-words font-semibold">{vehicle.driver || "Водитель не назначен"}</span>
                  <span className="block break-words text-xs opacity-80">{vehicle.name} · {vehicle.plate || "Номер не указан"}</span>
                  {vehicle.inRepair ? <span className="mt-1 block text-xs font-medium">Ремонт · {STATE_LABEL[vehicle.state ?? "empty"]}{vehicle.assigned ? " · на линии" : ""}</span> : null}
                </span>
                {chosen.includes(vehicle.id) && !vehicle.inRepair ? <Check className="shrink-0 text-amber-300" size={21} /> : null}
              </button>
            ))}
            {!filterFleet(offline, search, false).length ? <p className="py-6 text-sm text-slate-400">Машин не найдено</p> : null}
          </div>
          <div className="shrink-0 space-y-2 border-t border-white/10 pt-3">
            {single ? <Button variant="outline" className="min-h-[48px] w-full" onClick={() => manage(single)}>Водитель{managed.canManageRepairs ? " и ремонт" : ""}</Button> : null}
            <Button className="min-h-[48px] w-full" disabled={!chosen.length || stale || pending}
              onClick={() => void mutate("line", null, chosen, true)}>Вывести на линию{chosen.length ? ` · ${chosen.length}` : ""}</Button>
          </div>
        </> : panel === "actions" && current ? <div className="space-y-2">
          <Button variant="outline" className="min-h-[48px] w-full justify-start gap-2" onClick={() => setPanel("driver")}><UserRound size={18} />{current.driver ? "Сменить водителя" : "Назначить водителя"}</Button>
          {managed.canManageRepairs ? <Button variant="outline" disabled={stale || pending} className="min-h-[48px] w-full justify-start gap-2" onClick={() => setPanel("repair")}><Wrench size={18} />{current.inRepair ? "Вернуть из ремонта" : "Отправить на ремонт"}</Button> : null}
          {current.assigned ? <Button variant="outline" disabled={stale || pending || current.state !== "empty"} className="min-h-[48px] w-full justify-start" onClick={() => setPanel("remove")}>Убрать с линии</Button> : !current.inRepair ? <Button disabled={stale || pending} className="min-h-[48px] w-full" onClick={() => void mutate("line", current, [current.id], true)}>Вывести на линию</Button> : null}
          {current.assigned && current.state !== "empty" ? <p className="text-xs text-slate-400">Снять с линии можно после разгрузки. Отметка ремонта сохраняет груз.</p> : null}
        </div> : current ? <>
          {panel === "repair" ? <p className="text-sm text-slate-400">{STATE_LABEL[current.state ?? "empty"]} — груз не изменится.</p> : null}
          <Button className="min-h-[48px] w-full" disabled={stale || pending} onClick={() => void mutate(panel === "repair" ? "repair" : "line", current, [current.id], false)}>Подтвердить</Button>
          <Button variant="outline" className="min-h-[48px] w-full" onClick={close}>Отмена</Button>
        </> : null}
      </DialogContent>
    </Dialog> : null}
  </>;
}
