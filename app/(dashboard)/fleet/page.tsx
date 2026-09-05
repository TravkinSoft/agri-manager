"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw, Search, Truck } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { VehicleDriverAssignment } from "@/components/vehicles/vehicle-driver-assignment";
import { subscribeVehicleDriverAssignments } from "@/lib/vehicles/driver-assignment-client";
import { filterFleet, type FleetSnapshot } from "@/lib/fleet/model";

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
  const request = useRef<AbortController | null>(null);
  const epoch = useRef(0);

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
    const cancelRead = () => {
      epoch.current++;
      request.current?.abort();
      request.current = null;
    };
    const awaken = () => { if (document.visibilityState !== "hidden") void refresh(); };
    void refresh();
    const timer = setInterval(awaken, 30000);
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
    return () => {
      cancelRead();
      clearInterval(timer);
      window.removeEventListener("focus", awaken);
      window.removeEventListener("online", awaken);
      document.removeEventListener("visibilitychange", awaken);
      unsubscribe();
    };
  }, [companyId, refresh]);

  const vehicles = data?.vehicles ?? [];
  const visible = filterFleet(vehicles, search, unassigned);
  const withoutDriver = vehicles.filter(vehicle => !vehicle.driver).length;
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
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={!unassigned} onClick={() => setUnassigned(false)}
            className={`min-h-[44px] rounded-xl px-3 text-sm ${!unassigned ? "bg-amber-400 text-slate-950" : "bg-white/5 text-slate-300"}`}>
            Все{data ? ` · ${vehicles.length}` : ""}
          </button>
          <button type="button" aria-pressed={unassigned} onClick={() => setUnassigned(true)}
            className={`min-h-[44px] rounded-xl px-3 text-sm ${unassigned ? "bg-amber-400 text-slate-950" : "bg-white/5 text-slate-300"}`}>
            Без водителя{data ? ` · ${withoutDriver}` : ""}
          </button>
          <button type="button" aria-label="Обновить машины" onClick={() => void refresh()}
            className="ml-auto flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:bg-white/5">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      {error ? <p role="alert" className="mb-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">{error}</p> : null}
      {!data && !error ? <div role="status" aria-label="Загрузка автопарка" className="grid gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map(id => <div key={id} className="h-28 rounded-xl bg-white/5 motion-safe:animate-pulse" />)}
      </div> : null}
      {data ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(vehicle => <article key={vehicle.id}
          className="min-w-0 rounded-xl border border-white/10 bg-gradient-to-br from-[#192230] to-[#111820] px-3 pt-3">
          <div className="flex min-w-0 items-start gap-2 text-slate-300">
            <Truck aria-hidden size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <p className="min-w-0 break-words text-sm leading-5">{vehicle.name}</p>
          </div>
          <p className="mt-1 break-words text-xl font-semibold tracking-wide text-slate-50">{vehicle.plate || "Без номера"}</p>
          <VehicleDriverAssignment vehicleId={vehicle.id} companyId={companyId} driverName={vehicle.driver}
            vehicleLabel={`${vehicle.name} · ${vehicle.plate || "Без номера"}`} disabled={!!error}
            className="mt-1 w-full min-w-0 justify-start border-0 bg-transparent px-0 text-sm text-slate-400 hover:bg-transparent hover:text-amber-300" />
        </article>)}
      </div> : null}
      {data && visible.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">
        {vehicles.length === 0 ? "В компании пока нет активных машин." : "По этому выбору машин нет."}
      </p> : null}
    </div>
  );
}
