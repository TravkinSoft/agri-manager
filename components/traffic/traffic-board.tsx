"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Truck,
  Clock3,
  ArrowRight,
  Check,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import {
  ACTION_LABEL,
  nextState,
  STATE_LABEL,
  stateAge,
  type TrafficSnapshot,
  type TrafficVehicle,
  type TrafficState,
} from "@/lib/traffic/model";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { trafficRequest } from "./use-traffic";
const tones: Record<TrafficState, string> = {
  empty:
    "border-emerald-400/20 bg-gradient-to-br from-emerald-950/60 to-[#131a20] text-emerald-300",
  loaded:
    "border-rose-400/20 bg-gradient-to-br from-rose-950/50 to-[#19191e] text-rose-300",
  unloading:
    "border-amber-400/25 bg-gradient-to-br from-amber-950/50 to-[#191a1e] text-amber-300",
};
export function TrafficBoard({
  snapshot,
  stale,
  error,
  refresh,
}: {
  snapshot: TrafficSnapshot;
  stale: boolean;
  error: string;
  refresh: (fresh?: boolean) => Promise<void>;
}) {
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<{
    vehicle: TrafficVehicle;
    target: TrafficState;
    key: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(tick);
  }, []);
  const offset = useMemo(
    () => Date.parse(snapshot.serverTime) - Date.now(),
    [snapshot.serverTime],
  );
  async function confirm() {
    if (!selected || submitting.current || stale || !snapshot.enabled) return;
    submitting.current = true;
    setBusy(true);
    setActionError("");
    try {
      await trafficRequest("/api/traffic/operator", "POST", {
        vehicleId: selected.vehicle.vehicle_id,
        version: selected.vehicle.version,
        target: selected.target,
        key: selected.key,
      });
      setSelected(null);
      await refresh(true);
    } catch (caught) {
      setActionError((caught as Error).message);
      await refresh(true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const counts = { empty: 0, loaded: 0, unloading: 0 };
  snapshot.vehicles.forEach((v) => counts[v.state]++);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-slate-400">
          {snapshot.fieldName
            ? `Поле: ${snapshot.fieldName}`
            : "Поле не назначено"}
        </p>
        <button
          type="button"
          onClick={() => void refresh(true)}
          className={`flex min-h-[48px] items-center gap-2 rounded-xl px-3 ${stale ? "bg-amber-500/10 text-amber-200" : "text-slate-400 hover:bg-white/5"}`}
          aria-label="Обновить статусы"
        >
          {stale ? <WifiOff size={16} /> : <RefreshCw size={15} />}{" "}
          {stale ? "Нет свежих данных" : "Обновляется автоматически"}
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200"
        >
          {error}. Последнее обновление:{" "}
          {new Date(snapshot.serverTime).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      ) : null}
      {!snapshot.enabled ? (
        <p className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100">
          Поток приостановлен. Статусы и история сохранены.
        </p>
      ) : null}
      {snapshot.role === "manager" ? (
        <div className="mb-6 grid grid-cols-3 gap-3">
          {(["empty", "loaded", "unloading"] as const).map((state) => (
            <div key={state} className="min-w-0">
              <p className="text-3xl font-semibold tabular-nums text-white">
                {counts[state]}
              </p>
              <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                {STATE_LABEL[state]}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {snapshot.vehicles.map((vehicle) => {
          const target = nextState(snapshot.role, vehicle.state);
          const muted = snapshot.role === "harvester" && !target;
          const cardClass = `min-w-0 rounded-2xl border p-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.14)] ${tones[vehicle.state]} ${muted ? "opacity-50" : ""}`;
          const content = (
            <>
              <span className="flex items-start justify-between gap-2">
                <Truck aria-hidden size={23} />
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {STATE_LABEL[vehicle.state]}
                </span>
              </span>
              <span
                className="mt-3 block truncate text-lg font-semibold text-slate-100"
                title={vehicle.name}
              >
                {vehicle.name}
              </span>
              <span className="mt-1 block break-words text-2xl font-bold tracking-wide text-white sm:text-[26px]">
                {vehicle.plate || "Номер не указан"}
              </span>
              {vehicle.driver ? (
                <span
                  className="mt-1 block truncate text-sm text-slate-400"
                  title={vehicle.driver}
                >
                  {vehicle.driver}
                </span>
              ) : null}
              <span className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                <Clock3 size={13} /> В этом статусе{" "}
                {stateAge(vehicle.since, now + offset)}
              </span>
            </>
          );
          return target ? (
            <button
              key={vehicle.vehicle_id}
              type="button"
              data-testid={`traffic-vehicle-${vehicle.vehicle_id}`}
              aria-label={`${ACTION_LABEL[target]}: ${vehicle.name}, ${vehicle.plate || "без номера"}`}
              disabled={busy || stale || !snapshot.enabled}
              onClick={() => {
                setActionError("");
                setSelected({ vehicle, target, key: crypto.randomUUID() });
              }}
              className={`${cardClass} w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {content}
              <span className="mt-4 flex min-h-[48px] w-full items-center justify-between rounded-xl bg-white/10 px-4 text-sm font-semibold text-white">
                {ACTION_LABEL[target]}
                {target === "empty" ? (
                  <Check size={18} />
                ) : (
                  <ArrowRight size={18} />
                )}
              </span>
            </button>
          ) : (
            <article
              key={vehicle.vehicle_id}
              data-testid={`traffic-vehicle-${vehicle.vehicle_id}`}
              className={cardClass}
            >
              {content}
              {snapshot.role === "harvester" ? (
                <p className="mt-4 flex min-h-[48px] items-center text-sm text-slate-500">
                  Ожидаем разгрузку
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
      {!snapshot.vehicles.length ? (
        <div className="py-16 text-center">
          <Truck size={38} className="mx-auto mb-4 text-slate-600" />
          <h2 className="font-medium text-slate-200">
            {snapshot.role === "receiver"
              ? "Пока нет загруженных машин"
              : "Машины ещё не назначены"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
            {snapshot.role === "receiver"
              ? "Машина появится здесь, когда комбайнёр подтвердит загрузку."
              : "Агроном выбирает рабочий набор машин в настройках потока."}
          </p>
        </div>
      ) : null}
      <p className="mt-5 text-xs leading-relaxed text-slate-500">
        «Пустая» — машина без груза; она может быть в пути. Это не отметка о
        прибытии на поле.
      </p>
      {snapshot.role === "manager" && snapshot.events.length ? (
        <details className="mt-8 border-t border-white/10 pt-4">
          <summary className="min-h-[48px] cursor-pointer py-3 text-sm text-slate-400">
            Последние 50 изменений
          </summary>
          <div className="mt-3 divide-y divide-white/5">
            {snapshot.events.map((event) => (
              <div key={event.id} className="break-words py-3 text-sm">
                <p className="text-slate-300">
                  {event.vehicle_plate || event.vehicle_name} ·{" "}
                  {STATE_LABEL[event.from_state]} →{" "}
                  {STATE_LABEL[event.to_state]}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {event.actor_name} ·{" "}
                  {new Date(event.created_at).toLocaleString("ru-RU")}
                  {event.field_name ? ` · ${event.field_name}` : ""}
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <AlertDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selected ? ACTION_LABEL[selected.target] : "Подтверждение"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block break-words text-base font-semibold text-slate-100">
                {selected?.vehicle.name} ·{" "}
                {selected?.vehicle.plate || "Без номера"}
              </span>
              <span className="mt-2 block">
                Подтвердите только фактически выполненное действие.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? (
            <p role="alert" className="text-sm text-rose-300">
              {actionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[48px]" disabled={busy}>
              Отмена
            </AlertDialogCancel>
            <Button
              className="min-h-[48px]"
              onClick={() => void confirm()}
              disabled={busy || stale || !snapshot.enabled}
            >
              {busy ? "Сохраняем…" : "Подтвердить"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
