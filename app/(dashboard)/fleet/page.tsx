"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw, Search, Truck, Wrench } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { VehicleDriverAssignment } from "@/components/vehicles/vehicle-driver-assignment";
import { subscribeVehicleDriverAssignments } from "@/lib/vehicles/driver-assignment-client";
import { applyFleetRepair, filterFleet, isFleetRepairReceipt, type FleetSnapshot, type FleetVehicle } from "@/lib/fleet/model";
import { trafficRequest } from "@/components/traffic/use-traffic";
import { publishTrafficChanged, subscribeTrafficChanges } from "@/lib/traffic/changes";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export default function FleetPage() {
  const { user, profile } = useAuth();
  const companyId = profile?.company_id;
  if (!user || !companyId) return <p className="p-4 text-slate-400">Выберите компанию для автопарка.</p>;
  // A company/account change unmounts all requests and assignment dialogs.
  return <FleetCabinet key={`${user.id}:${companyId}:${profile.role}`} companyId={companyId} />;
}

function FleetCabinet({ companyId }: { companyId: string }) {
  const [data, setData] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [repairsOnly, setRepairsOnly] = useState(false);
  const [repairSelection, setRepairSelection] = useState<FleetVehicle | null>(null);
  const [repairPending, setRepairPending] = useState<Record<string, boolean>>({});
  const [repairError, setRepairError] = useState("");
  const repairLocks = useRef(new Set<string>());
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const cancelRead = useCallback(() => {
    epoch.current++;
    request.current?.abort();
    request.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const generation = ++epoch.current;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const headers = await buildClientAuthHeaders("none");
      const response = await fetch(`/api/fleet?companyId=${encodeURIComponent(companyId)}`, {
        headers, credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      const result = await response.json();
      if (generation !== epoch.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setData(null);
        throw new Error(result.error || "Не удалось получить список машин");
      }
      if (result.companyId !== companyId || !Array.isArray(result.vehicles)) {
        throw new Error("Список машин не соответствует выбранной компании");
      }
      setData(result);
      setError("");
    } catch (caught) {
      if (generation === epoch.current) setError(controller.signal.aborted
        ? "Нет связи с сервером. Попробуйте обновить список."
        : caught instanceof Error ? caught.message : "Не удалось получить список машин");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  }, [companyId]);

  useEffect(() => {
    alive.current = true;
    const awaken = () => { if (document.visibilityState !== "hidden") void refresh(); };
    void refresh();
    const timer = setInterval(awaken, 5000);
    window.addEventListener("focus", awaken);
    window.addEventListener("online", awaken);
    document.addEventListener("visibilitychange", awaken);
    const unsubscribe = subscribeVehicleDriverAssignments(result => {
      if (result.companyId !== companyId) return;
      // Never let a GET started before the confirmed assignment restore the old driver.
      cancelRead();
      setData(old => old ? { ...old, vehicles: old.vehicles.map(vehicle => vehicle.id === result.vehicle.id
        ? { ...vehicle, driver: result.vehicle.driverName } : vehicle) } : old);
    });
    const unsubscribeTraffic = subscribeTrafficChanges(changedCompany => {
      if (changedCompany !== companyId) return;
      cancelRead();
      void refresh();
    });
    return () => {
      alive.current = false;
      cancelRead();
      clearInterval(timer);
      window.removeEventListener("focus", awaken);
      window.removeEventListener("online", awaken);
      document.removeEventListener("visibilitychange", awaken);
      unsubscribe();
      unsubscribeTraffic();
    };
  }, [companyId, refresh, cancelRead]);

  async function confirmRepair() {
    const vehicle = repairSelection;
    if (!vehicle || repairLocks.current.has(vehicle.id) || error) return;
    const desired = !vehicle.inRepair;
    repairLocks.current.add(vehicle.id);
    setRepairSelection(null);
    setRepairError("");
    // Display intent immediately; canonical version is changed only by a validated receipt.
    setRepairPending(old => ({ ...old, [vehicle.id]: desired }));
    try {
      const receipt: unknown = await trafficRequest("/api/fleet/repair", "POST", {
        companyId, vehicleId: vehicle.id, inRepair: desired, expectedVersion: vehicle.repairVersion ?? 0,
      });
      if (!isFleetRepairReceipt(receipt) || receipt.companyId !== companyId ||
        receipt.vehicleId !== vehicle.id || receipt.inRepair !== desired || receipt.version < (vehicle.repairVersion ?? 0)) {
        throw new Error("Нет корректного подтверждения ремонта. Обновите карточку.");
      }
      publishTrafficChanged(companyId);
      if (!alive.current) return;
      cancelRead();
      setData(old => old ? applyFleetRepair(old, receipt) : old);
    } catch (caught) {
      if (!alive.current) return;
      setRepairError(caught instanceof Error ? caught.message : "Нет подтверждения сервера. Обновите карточку.");
      cancelRead();
      void refresh();
    } finally {
      repairLocks.current.delete(vehicle.id);
      if (alive.current) setRepairPending(old => {
        const next = { ...old }; delete next[vehicle.id]; return next;
      });
    }
  }

  const vehicles = (data?.vehicles ?? []).map(vehicle => Object.prototype.hasOwnProperty.call(repairPending, vehicle.id)
    ? { ...vehicle, inRepair: repairPending[vehicle.id] } : vehicle);
  const visible = filterFleet(vehicles, search, unassigned).filter(vehicle => !repairsOnly || vehicle.inRepair);
  const withoutDriver = vehicles.filter(vehicle => !vehicle.driver).length;
  const inRepairCount = vehicles.filter(vehicle => vehicle.inRepair).length;
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl touch-pan-y lg:px-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 lg:text-2xl">Автопарк</h1>
          <p className="mt-1 text-sm text-slate-400">Машины и водители</p>
        </div>
        <Link href="/traffic" className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 text-sm text-amber-300 hover:bg-white/5">
          Оборот машин <ArrowRight size={18} aria-hidden />
        </Link>
      </header>
      <div className="sticky top-0 z-10 space-y-3 bg-[#0f1218] pb-3 pt-1">
        <label className="relative block">
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-4 text-slate-400" />
          <input aria-label="Поиск по машине, номеру или водителю" placeholder="Машина, номер или водитель"
            value={search} onChange={event => setSearch(event.target.value)}
            className="h-12 w-full min-w-0 rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={!unassigned && !repairsOnly} onClick={() => { setUnassigned(false); setRepairsOnly(false); }}
            className={`min-h-[44px] rounded-xl px-3 text-sm ${!unassigned && !repairsOnly ? "bg-amber-400 text-slate-950" : "bg-white/5 text-slate-300"}`}>
            Все{data ? ` · ${vehicles.length}` : ""}
          </button>
          <button type="button" aria-pressed={unassigned} onClick={() => { setUnassigned(true); setRepairsOnly(false); }}
            className={`min-h-[44px] rounded-xl px-3 text-sm ${unassigned ? "bg-amber-400 text-slate-950" : "bg-white/5 text-slate-300"}`}>
            Без водителя{data ? ` · ${withoutDriver}` : ""}
          </button>
          <button type="button" aria-pressed={repairsOnly} onClick={() => { setUnassigned(false); setRepairsOnly(true); }}
            className={`min-h-[44px] rounded-xl px-3 text-sm ${repairsOnly ? "bg-rose-400 text-slate-950" : "bg-rose-400/10 text-rose-300"}`}>
            Ремонт{data ? ` · ${inRepairCount}` : ""}
          </button>
          <button type="button" aria-label="Обновить машины" onClick={() => void refresh()}
            className="ml-auto flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:bg-white/5">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      {error ? <p role="alert" className="mb-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">{error}</p> : null}
      {repairError ? <p role="alert" className="mb-3 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">{repairError}</p> : null}
      {!data && !error ? <div role="status" aria-label="Загрузка автопарка" className="grid gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map(id => <div key={id} className="h-28 rounded-xl bg-white/5 motion-safe:animate-pulse" />)}
      </div> : null}
      {data ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(vehicle => <article key={vehicle.id}
          className={`min-w-0 rounded-xl border px-3 pt-3 ${vehicle.inRepair ? "border-rose-500/60 bg-rose-950/50" : "border-white/10 bg-gradient-to-br from-[#192230] to-[#111820]"}`}>
          <div className="flex min-w-0 items-start gap-2 text-slate-300">
            <Truck aria-hidden size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <p className="min-w-0 break-words text-sm leading-5">{vehicle.name}</p>
          </div>
          <p className="mt-1 break-words text-xl font-semibold tracking-wide text-slate-50">{vehicle.plate || "Без номера"}</p>
          {vehicle.inRepair ? <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-rose-300"><Wrench size={12} aria-hidden /> На ремонте</p> : null}
          {Object.prototype.hasOwnProperty.call(repairPending, vehicle.id) ? <p role="status" className="mt-1 text-xs text-slate-400">Подтверждаем изменение…</p> : null}
          <div className="flex min-w-0 items-center gap-2">
          <VehicleDriverAssignment vehicleId={vehicle.id} companyId={companyId} driverName={vehicle.driver}
            vehicleLabel={`${vehicle.name} · ${vehicle.plate || "Без номера"}`} disabled={!!error}
            className="mt-1 min-w-0 flex-1 justify-start border-0 bg-transparent px-0 text-sm text-slate-400 hover:bg-transparent hover:text-amber-300" />
          <button type="button" onClick={() => setRepairSelection(vehicle)}
            disabled={!!error || Object.prototype.hasOwnProperty.call(repairPending, vehicle.id)}
            aria-label={`${vehicle.inRepair ? "Вернуть в работу" : "В ремонт"}: ${vehicle.name} · ${vehicle.plate || "Без номера"}`}
            className="min-h-[48px] max-w-[128px] shrink-0 px-1 text-xs font-medium text-rose-300 hover:text-rose-200 disabled:opacity-40">
            {vehicle.inRepair ? "Вернуть в работу" : "В ремонт"}
          </button>
          </div>
        </article>)}
      </div> : null}
      {data && visible.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">
        {vehicles.length === 0 ? "В компании пока нет активных машин." : "По этому выбору машин нет."}
      </p> : null}
      <AlertDialog open={!!repairSelection} onOpenChange={open => { if (!open) setRepairSelection(null); }}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl p-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{repairSelection?.inRepair ? "Вернуть машину в работу?" : "Поставить машину на ремонт?"}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block font-semibold text-slate-100">{repairSelection?.name} · {repairSelection?.plate || "Без номера"}</span>
              <span className="mt-2 block">{repairSelection?.inRepair
                ? "Снимется только отметка ремонта. Статус рейса не изменится."
                : "Новая загрузка станет недоступна. Текущий рейс и его история сохранятся."}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[48px]">Отмена</AlertDialogCancel>
            <Button className="min-h-[48px] bg-rose-500 text-white hover:bg-rose-400" onClick={() => void confirmRepair()} disabled={!!error}>Подтвердить</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
