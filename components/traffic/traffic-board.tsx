"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Truck,
  Clock3,
  Loader2,
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
  type TrafficCommit,
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
  empty: "border-slate-300 bg-[#ffffff] text-slate-950",
  loaded: "border-emerald-300 bg-emerald-100 text-emerald-950",
  unloading: "border-amber-300 bg-amber-100 text-amber-950",
};
const groupLabels: Record<TrafficState, string> = {
  empty: "Пустые",
  loaded: "Загруженные",
  unloading: "На выгрузке",
};
const groupDots: Record<TrafficState, string> = {
  empty: "bg-[#ffffff]",
  loaded: "bg-emerald-400",
  unloading: "bg-amber-300",
};
export function TrafficBoard({
  snapshot,
  stale,
  error,
  refresh,
  onCommitted,
}: {
  snapshot: TrafficSnapshot;
  stale: boolean;
  error: string;
  refresh: (fresh?: boolean) => Promise<void>;
  onCommitted?: (receipt: TrafficCommit, vehicleId: string, expectedVersion: number) => boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<{
    vehicle: TrafficVehicle;
    target: TrafficState;
    key: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pendingVehicle, setPendingVehicle] = useState<string | null>(null);
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
    const command = selected;
    setBusy(true);
    setPendingVehicle(command.vehicle.vehicle_id);
    setSelected(null);
    setActionError("");
    try {
      const receipt = await trafficRequest("/api/traffic/operator", "POST", {
        vehicleId: command.vehicle.vehicle_id,
        version: command.vehicle.version,
        target: command.target,
        key: command.key,
      });
      if (onCommitted?.(receipt, command.vehicle.vehicle_id, command.vehicle.version)) {
        // The confirmed row is visible now; full reconciliation is not a UI gate.
        void refresh();
      } else {
        await refresh(true);
      }
    } catch (caught) {
      setSelected(command);
      setActionError((caught as Error).message);
      void refresh(true);
    } finally {
      submitting.current = false;
      setBusy(false);
      setPendingVehicle(null);
    }
  }
  const isManager = snapshot.role === "manager";
  const groups = isManager
    ? (["empty", "loaded", "unloading"] as const).map((state) => ({
        state,
        vehicles: snapshot.vehicles.filter((vehicle) => vehicle.state === state),
      }))
    : [{ state: null, vehicles: snapshot.vehicles }];
  return (
    <>
      {stale || error ? <div className="mb-3 flex items-center justify-between gap-2 text-xs text-amber-200" role="status">
        <span>{error || "Проверяем актуальность статусов…"}</span>
        <button
          type="button"
          onClick={() => void refresh(true)}
          className="flex min-h-[48px] shrink-0 items-center gap-2 px-2"
          aria-label="Обновить статусы"
        >
          {error ? <WifiOff size={16} /> : <RefreshCw size={15} />}{" "} Обновить
        </button>
      </div> : null}
      {!snapshot.enabled ? (
        <p className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100">
          {snapshot.role === "manager"
            ? "Выберите и сохраните машины, чтобы начать работу."
            : "Агроном ещё не подтвердил список машин для работы."}
        </p>
      ) : null}
      <div className={isManager ? "grid items-start gap-5 lg:grid-cols-3" : ""}>
        {groups.map((group) => (
          <section
            key={group.state ?? "operator"}
            data-testid={group.state ? `traffic-group-${group.state}` : "traffic-operator-list"}
            aria-label={group.state ? groupLabels[group.state] : "Машины"}
            className="min-w-0"
          >
            {group.state ? (
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200">
                <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${groupDots[group.state]}`} />
                {groupLabels[group.state]}
                <span className="ml-auto text-xl font-semibold tabular-nums text-white">
                  {group.vehicles.length}
                </span>
              </h2>
            ) : null}
            <div className={isManager ? "grid gap-2" : "grid gap-2 sm:grid-cols-2 xl:grid-cols-3"}>
        {group.vehicles.map((vehicle) => {
          const target = nextState(snapshot.role, vehicle.state);
          const muted = snapshot.role === "harvester" && !target;
          const cardClass = `min-w-0 rounded-xl border p-2.5 text-left shadow-sm ${tones[vehicle.state]} ${muted ? "grayscale" : ""}`;
          const content = (
            <>
              <span className="flex min-w-0 items-center gap-1.5">
                <Truck aria-hidden size={15} className="shrink-0 opacity-60" />
                <span className="truncate text-xs font-medium opacity-80" title={vehicle.name}>
                  {vehicle.name}
                </span>
              </span>
              <span className="mt-0.5 block break-words text-xl font-bold leading-6 tracking-wide">
                {vehicle.plate || "Номер не указан"}
              </span>
              {vehicle.driver ? (
                <span
                  className="mt-0.5 block truncate text-xs opacity-70"
                  title={vehicle.driver}
                >
                  {vehicle.driver}
                </span>
              ) : null}
              <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] leading-4 opacity-70">
                {pendingVehicle === vehicle.vehicle_id ? <span className="inline-flex items-center gap-1" role="status"><Loader2 size={12} className="animate-spin" /> Сохраняем… ·</span> : !isManager ? <span>{STATE_LABEL[vehicle.state]} ·</span> : null}
                <Clock3 aria-hidden size={11} />
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
              aria-busy={pendingVehicle === vehicle.vehicle_id}
              onClick={() => {
                setActionError("");
                setSelected({ vehicle, target, key: crypto.randomUUID() });
              }}
              className={`${cardClass} min-h-[48px] w-full cursor-pointer active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed ${stale || !snapshot.enabled ? "opacity-50" : ""}`}
            >
              {content}
            </button>
          ) : (
            <article
              key={vehicle.vehicle_id}
              data-testid={`traffic-vehicle-${vehicle.vehicle_id}`}
              className={cardClass}
            >
              {content}
            </article>
          );
        })}
            </div>
            {group.state && !group.vehicles.length ? (
              <p className="py-3 text-xs text-slate-500">Нет машин</p>
            ) : null}
          </section>
        ))}
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
              : "Агроном добавляет машины через «Выбрать машины»."}
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
