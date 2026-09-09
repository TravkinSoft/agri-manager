"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { UserRound, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { VehicleDriverAssignment } from "@/components/vehicles/vehicle-driver-assignment";
import { getFleetVehicleCardIdentity, isFleetRepairReceipt, type FleetVehicle } from "@/lib/fleet/model";
import { STATE_LABEL, type TrafficSnapshot, type TrafficVehicle } from "@/lib/traffic/model";
import { publishTrafficChanged } from "@/lib/traffic/changes";
import { trafficRequest, type ManagerData } from "./use-traffic";

type Panel = "actions" | "driver" | "repair" | "remove" | null;
export function TrafficFleetControls({ managed, snapshot, selected, onSelected, stale, refresh }: {
  managed: ManagerData; snapshot: TrafficSnapshot; selected: TrafficVehicle | null;
  onSelected: (vehicle: TrafficVehicle | null) => void;
  stale: boolean; refresh: (fresh?: boolean) => Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [car, setCar] = useState<FleetVehicle | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const fleet = useMemo(() => {
    const rows = new Map(managed.fleet.map(row => [row.id, { ...row, assigned: false }]));
    for (const vehicle of snapshot.vehicles) rows.set(vehicle.vehicle_id, {
      ...rows.get(vehicle.vehicle_id), id: vehicle.vehicle_id, name: vehicle.name, plate: vehicle.plate,
      brand: vehicle.brand, driver: vehicle.driver, assigned: true, state: vehicle.state, lastActivity: vehicle.since,
      inRepair: vehicle.inRepair, repairVersion: vehicle.repairVersion,
      repairChangedAt: vehicle.repairChangedAt,
    });
    return Array.from(rows.values());
  }, [managed.fleet, snapshot.vehicles]);
  const current = car ? fleet.find(vehicle => vehicle.id === car.id) ?? car : null;

  useEffect(() => {
    if (!selected) return;
    const currentFleetVehicle = fleet.find(vehicle => vehicle.id === selected.vehicle_id);
    setCar({
      ...currentFleetVehicle,
      id: selected.vehicle_id,
      name: selected.name,
      brand: selected.brand,
      plate: selected.plate,
      driver: selected.driver,
      assigned: selected.assigned,
      state: selected.state,
      lastActivity: selected.since,
      inRepair: selected.inRepair,
      repairVersion: selected.repairVersion,
      repairChangedAt: selected.repairChangedAt,
    });
    setError(""); setPanel("actions"); onSelected(null);
  }, [fleet, selected, onSelected]);

  function close() { setPanel(null); }
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
      publishTrafficChanged(snapshot.companyId, "fleet");
      if (!alive.current) return;
    } catch (caught) {
      if (alive.current) setError((caught as Error).message);
    } finally {
      if (alive.current) { await refresh(true); setPending(false); lock.current = false; }
    }
  }
  const currentIdentity = current ? getFleetVehicleCardIdentity(current) : null;
  return <>
    {pending ? <p role="status" className="mt-2 text-xs text-slate-400">Изменение отправлено…</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-amber-200">{error}</p> : null}
    {panel === "driver" && current ? <VehicleDriverAssignment key={current.id} autoOpen
      vehicleId={current.id} companyId={snapshot.companyId} driverName={current.driver}
      vehicleLabel={`${current.name} · ${current.plate || "без номера"}`}
      onClosed={close} onAssigned={() => { publishTrafficChanged(snapshot.companyId, "fleet"); void refresh(true); }} /> : null}
    {panel && panel !== "driver" ? <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent hideCloseButton data-testid="vehicle-actions"
        className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md flex-col overflow-y-auto rounded-2xl border-slate-700 bg-slate-950 p-4 text-slate-100">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle>{panel === "repair" ? current?.inRepair ? "Вернуть из ремонта?" : "Отправить на ремонт?" : panel === "remove" ? "Убрать с линии?" : currentIdentity?.primary || "Машина"}</DialogTitle>
          <DialogDescription className="break-words text-slate-400">
            {currentIdentity?.secondary || "Номер не указан"}
          </DialogDescription>
        </DialogHeader>
        <Button type="button" variant="ghost" aria-label="Закрыть" onClick={close} className="absolute right-1 top-2 h-12 w-12 p-0"><X size={20} /></Button>
        {panel === "actions" && current ? <div className="space-y-2">
          <Button variant="outline" className="min-h-[48px] w-full justify-start gap-2" onClick={() => setPanel("driver")}><UserRound size={18} />{current.driver ? "Сменить водителя" : "Назначить водителя"}</Button>
          {managed.canManageRepairs ? <Button variant="outline" disabled={stale || pending} className="min-h-[48px] w-full justify-start gap-2" onClick={() => setPanel("repair")}><Wrench size={18} />{current.inRepair ? "Вернуть из ремонта" : "Отправить на ремонт"}</Button> : null}
          {current.assigned ? <Button variant="outline" disabled={stale || pending || current.state !== "empty"} className="min-h-[48px] w-full justify-start" onClick={() => setPanel("remove")}>Убрать с линии</Button> : !current.inRepair ? <Button disabled={stale || pending} className="min-h-[48px] w-full" onClick={() => void mutate("line", current, [current.id], true)}>Вывести на линию</Button> : null}
          {current.assigned && current.state !== "empty" ? <p className="text-xs text-slate-400">Снять с линии можно после разгрузки. Отметка ремонта сохраняет груз.</p> : null}
        </div> : current ? <>
          {panel === "repair" ? <p className="text-sm text-slate-400">
            {current.inRepair
              ? "После возврата таймер текущего статуса начнётся заново; пустая машина встанет в конец очереди."
              : current.state === "loaded"
                ? "Таймер ремонта начнётся сразу. Машина останется у весовщика до завершения этапа; новая загрузка будет заблокирована."
                : current.state === "unloading"
                  ? "Таймер ремонта начнётся сразу. Машина останется у приёмки до отметки выгрузки; новая загрузка будет заблокирована."
                  : `${STATE_LABEL[current.state ?? "empty"]} — начнётся новый таймер ремонта.`}
          </p> : null}
          <Button className="min-h-[48px] w-full" disabled={stale || pending} onClick={() => void mutate(panel === "repair" ? "repair" : "line", current, [current.id], false)}>Подтвердить</Button>
          <Button variant="outline" className="min-h-[48px] w-full" onClick={close}>Отмена</Button>
        </> : null}
      </DialogContent>
    </Dialog> : null}
  </>;
}
