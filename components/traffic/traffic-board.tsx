"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  Truck,
  Clock3,
  WifiOff,
  Wrench,
  EllipsisVertical,
} from "lucide-react";
import {
  ACTION_LABEL,
  nextState,
  STATE_LABEL,
  stateAge,
  trafficRepairPhase,
  trafficStatusSince,
  trafficEventSummary,
  type TrafficSnapshot,
  type TrafficState,
  type TrafficCommit,
  type TrafficVehicle,
} from "@/lib/traffic/model";
import { getFleetVehicleCardIdentity, type FleetVehicle } from "@/lib/fleet/model";
import { trafficRequest } from "./use-traffic";
import { isTrafficAcknowledgement, optimisticTrafficVehicles, trafficCommandObserved, type PendingTrafficCommand, type TrafficCommand } from "@/lib/traffic/optimistic";
const PTC_BOARD_V2 = process.env.NEXT_PUBLIC_PTC_BOARD_V2 === "1";
const legacyTones: Record<TrafficState, string> = {
  empty: "border-slate-300 bg-[#ffffff] text-slate-950",
  loaded: "border-emerald-300 bg-emerald-100 text-emerald-950",
  unloading: "border-amber-300 bg-amber-100 text-amber-950",
};
const v2Tones: Record<TrafficState, string> = {
  empty: "border-slate-500/55 bg-slate-800/95 text-slate-100",
  loaded: "border-emerald-400/50 bg-emerald-950/80 text-emerald-100",
  unloading: "border-amber-300/55 bg-amber-950/75 text-amber-100",
};
const tones = PTC_BOARD_V2 ? v2Tones : legacyTones;
type ManagerTrafficGroup = TrafficState | "repair" | "offline";
const managerGroupOrder: readonly ManagerTrafficGroup[] = [
  "empty",
  "loaded",
  "unloading",
  "repair",
  "offline",
];
const groupLabels: Record<ManagerTrafficGroup, string> = {
  empty: "Пустые",
  loaded: "В пути на весовую",
  unloading: "На выгрузке",
  repair: "На ремонте",
  offline: "Не на линии",
};
const mobileGroupLabels: Record<ManagerTrafficGroup, string> = {
  empty: "Пустые",
  loaded: "На весовую",
  unloading: "Выгрузка",
  repair: "Ремонт",
  offline: "Не на линии",
};
const groupDots: Record<ManagerTrafficGroup, string> = {
  empty: "bg-[#ffffff]",
  loaded: "bg-emerald-400",
  unloading: "bg-amber-300",
  repair: "bg-rose-400",
  offline: "bg-sky-400",
};
const HARVESTER_SWIPE_SLOP_PX = 12;
const HARVESTER_SWIPE_DIRECTION_RATIO = 1.4;
const HARVESTER_SWIPE_MIN_PX = 104;
const HARVESTER_SWIPE_MAX_PX = 160;
const HARVESTER_SWIPE_WIDTH_RATIO = 0.4;
type HarvesterSwipeGesture = {
  pointerId: number;
  vehicle: TrafficVehicle;
  target: TrafficState;
  startX: number;
  startY: number;
  threshold: number;
  distance: number;
  axis: "pending" | "horizontal" | "blocked";
};
type HarvesterSwipeVisual = {
  vehicleId: string;
  distance: number;
  threshold: number;
  dragging: boolean;
};
function harvesterSwipeThreshold(cardWidth: number): number {
  if (!PTC_BOARD_V2) return Math.min(132, Math.max(84, cardWidth * 0.3));
  return Math.min(
    HARVESTER_SWIPE_MAX_PX,
    Math.max(HARVESTER_SWIPE_MIN_PX, cardWidth * HARVESTER_SWIPE_WIDTH_RATIO),
  );
}
function managerGroupForVehicle(vehicle: TrafficVehicle): ManagerTrafficGroup {
  if (vehicle.inRepair) return "repair";
  if (!vehicle.assigned) return "offline";
  return vehicle.state;
}
export function TrafficBoard({
  snapshot,
  stale,
  error,
  refresh,
  onCommitted,
  onAuxiliaryCommitted,
  mobileActions,
  onManageVehicle,
  fleet,
  compactAgronomistMobile = false,
}: {
  snapshot: TrafficSnapshot;
  stale: boolean;
  error: string;
  refresh: (fresh?: boolean) => Promise<void>;
  onCommitted?: (receipt: TrafficCommit, vehicleId: string, expectedVersion: number) => boolean;
  onAuxiliaryCommitted?: () => Promise<void>;
  mobileActions?: ReactNode;
  onManageVehicle?: (vehicle: TrafficVehicle) => void;
  fleet?: FleetVehicle[];
  compactAgronomistMobile?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [actionError, setActionError] = useState("");
  const [pendingCommands, setPendingCommands] = useState<PendingTrafficCommand[]>([]);
  const [lastVehicleBusy, setLastVehicleBusy] = useState<string | null>(null);
  const [mobileState, setMobileState] = useState<ManagerTrafficGroup>("empty");
  const mobileListRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<PendingTrafficCommand[]>([]);
  const harvesterSwipeRef = useRef<HarvesterSwipeGesture | null>(null);
  const previousManagerGroupsRef = useRef<Map<string, ManagerTrafficGroup> | null>(null);
  const [harvesterSwipe, setHarvesterSwipe] = useState<HarvesterSwipeVisual | null>(null);
  const mounted = useRef(true);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  function updatePending(update: (commands: PendingTrafficCommand[]) => PendingTrafficCommand[]) {
    pendingRef.current = update(pendingRef.current);
    setPendingCommands(pendingRef.current);
  }
  useEffect(() => {
    mounted.current = true;
    const tick = window.setInterval(() => setNow(Date.now()), 15000);
    return () => {
      mounted.current = false;
      harvesterSwipeRef.current = null;
      window.clearInterval(tick);
    };
  }, []);
  useEffect(() => {
    const abortSwipe = () => {
      if (!harvesterSwipeRef.current) return;
      harvesterSwipeRef.current = null;
      setHarvesterSwipe(null);
    };
    const abortOnSecondPointer = (event: PointerEvent) => {
      const active = harvesterSwipeRef.current;
      if (active && event.pointerId !== active.pointerId) abortSwipe();
    };
    const abortWhenHidden = () => {
      if (document.visibilityState === "hidden") abortSwipe();
    };
    window.addEventListener("pointerdown", abortOnSecondPointer, true);
    window.addEventListener("blur", abortSwipe);
    document.addEventListener("visibilitychange", abortWhenHidden);
    return () => {
      window.removeEventListener("pointerdown", abortOnSecondPointer, true);
      window.removeEventListener("blur", abortSwipe);
      document.removeEventListener("visibilitychange", abortWhenHidden);
    };
  }, []);
  useEffect(() => {
    const resolved = pendingRef.current.filter(command => command.phase !== "sending" && trafficCommandObserved(snapshot, command));
    if (resolved.length) updatePending(commands => commands.filter(command => !resolved.includes(command)));
  }, [snapshot]);
  const offset = useMemo(
    () => Date.parse(snapshot.serverTime) - Date.now(),
    [snapshot.serverTime],
  );
  async function confirm(command: TrafficCommand, retry = false) {
    if (stale || !snapshot.enabled) return;
    const vehicleId = command.vehicle.vehicle_id;
    const existing = pendingRef.current.find(item => item.vehicle.vehicle_id === vehicleId);
    if (existing && (!retry || existing.phase !== "uncertain" || existing.key !== command.key)) return;
    const current = snapshotRef.current.vehicles.find(vehicle => vehicle.vehicle_id === vehicleId);
    if (!retry && (!current || current.version !== command.vehicle.version || current.state !== command.vehicle.state ||
      nextState(snapshot.role, current.state, current.inRepair) !== command.target)) {
      setActionError("Статус машины уже изменился. Проверьте актуальную карточку.");
      return;
    }
    // Commit the optimistic card before entering auth/transport. This is only
    // a user-event boundary, never a render/effect or polling path.
    flushSync(() => {
      updatePending(commands => [...commands.filter(item => item.vehicle.vehicle_id !== vehicleId), {
        ...command, phase: "sending", since: new Date(Date.now() + offset).toISOString(),
      }]);
      setActionError("");
    });
    try {
      const receipt = await trafficRequest("/api/traffic/operator", "POST", {
        vehicleId: command.vehicle.vehicle_id,
        version: command.vehicle.version,
        target: command.target,
        key: command.key,
      });
      if (!mounted.current) return;
      if (!isTrafficAcknowledgement(receipt)) throw new Error("Нет корректного подтверждения сервера. Проверьте статусы перед повторной отправкой.");
      if (onCommitted?.(receipt, vehicleId, command.vehicle.version)) {
        updatePending(commands => commands.filter(item => item.key !== command.key));
        // The confirmed row is visible now; full reconciliation is not a UI gate.
        void refresh();
      } else {
        updatePending(commands => commands.map(item => item.key === command.key ? { ...item, phase: "reconciling" } : item));
        await refresh(true);
      }
    } catch (caught) {
      if (!mounted.current) return;
      const failure = caught as Error & { status?: number };
      const uncertain = !failure.status || failure.status >= 500;
      if (uncertain) {
        // A lost response is not proof of a rejected write. Retry this exact key,
        // or wait for a newer canonical snapshot; never create another command.
        updatePending(commands => commands.map(item => item.key === command.key
          ? { ...item, phase: "uncertain", error: failure.message } : item));
      } else {
        updatePending(commands => commands.filter(item => item.key !== command.key));
        setActionError(`${command.vehicle.plate || command.vehicle.name}: ${failure.message}`);
      }
      void refresh(true);
    }
  }
  function submitTransition(vehicle: TrafficVehicle, target: TrafficState) {
    if (pendingRef.current.some(command => command.vehicle.vehicle_id === vehicle.vehicle_id)) return;
    void confirm({ vehicle, target, key: crypto.randomUUID() });
  }
  function beginHarvesterSwipe(
    event: ReactPointerEvent<HTMLButtonElement>,
    vehicle: TrafficVehicle,
    target: TrafficState,
  ) {
    if (stale || !snapshot.enabled || pendingRef.current.some(command => command.vehicle.vehicle_id === vehicle.vehicle_id)) return;
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
      if (harvesterSwipeRef.current) {
        harvesterSwipeRef.current = null;
        setHarvesterSwipe(null);
      }
      return;
    }
    if (harvesterSwipeRef.current) {
      harvesterSwipeRef.current = null;
      setHarvesterSwipe(null);
      return;
    }
    const threshold = harvesterSwipeThreshold(event.currentTarget.getBoundingClientRect().width);
    harvesterSwipeRef.current = {
      pointerId: event.pointerId,
      vehicle,
      target,
      startX: event.clientX,
      startY: event.clientY,
      threshold,
      distance: 0,
      axis: "pending",
    };
    setHarvesterSwipe({ vehicleId: vehicle.vehicle_id, distance: 0, threshold, dragging: true });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Touch pointers are implicitly captured. Synthetic QA events may not be.
    }
  }
  function moveHarvesterSwipe(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = harvesterSwipeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (active.axis === "pending" && Math.max(absX, absY) >= HARVESTER_SWIPE_SLOP_PX) {
      if (dx >= HARVESTER_SWIPE_SLOP_PX && absX >= absY * HARVESTER_SWIPE_DIRECTION_RATIO) {
        active.axis = "horizontal";
      } else if (dx <= -HARVESTER_SWIPE_SLOP_PX || absY > absX) {
        active.axis = "blocked";
      }
    }
    if (active.axis !== "horizontal") {
      if (active.distance !== 0) {
        active.distance = 0;
        setHarvesterSwipe({ vehicleId: active.vehicle.vehicle_id, distance: 0, threshold: active.threshold, dragging: false });
      }
      return;
    }
    event.preventDefault();
    const positiveDistance = Math.max(0, dx);
    active.distance = PTC_BOARD_V2
      ? positiveDistance <= active.threshold
        ? positiveDistance
        : Math.min(active.threshold + 24, active.threshold + (positiveDistance - active.threshold) * 0.24)
      : Math.min(active.threshold + 32, positiveDistance);
    setHarvesterSwipe({
      vehicleId: active.vehicle.vehicle_id,
      distance: active.distance,
      threshold: active.threshold,
      dragging: true,
    });
  }
  function finishHarvesterSwipe(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = harvesterSwipeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = Math.abs(event.clientY - active.startY);
    const shouldCommit = active.axis === "horizontal" &&
      dx >= active.threshold && dx >= dy * HARVESTER_SWIPE_DIRECTION_RATIO;
    harvesterSwipeRef.current = null;
    setHarvesterSwipe(null);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may already have released capture on pointerup.
    }
    if (shouldCommit) submitTransition(active.vehicle, active.target);
  }
  function cancelHarvesterSwipe(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = harvesterSwipeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    harvesterSwipeRef.current = null;
    setHarvesterSwipe(null);
  }
  function handleHarvesterSwipeKey(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    vehicle: TrafficVehicle,
    target: TrafficState,
  ) {
    if (event.key !== "ArrowRight" || event.repeat) return;
    event.preventDefault();
    submitTransition(vehicle, target);
  }
  async function changeLastVehicle(vehicle: TrafficVehicle, action: "mark" | "clear") {
    if (stale || !snapshot.enabled || lastVehicleBusy) return;
    const current = snapshot.lastVehicle;
    const prompt = action === "clear"
      ? `Убрать метку «Последняя» с машины ${vehicle.driver || vehicle.name} · ${vehicle.plate || "Без номера"}?`
      : `${current && current.vehicleId !== vehicle.vehicle_id ? "Перенести" : "Поставить"} метку «Последняя» на машину ${vehicle.driver || vehicle.name} · ${vehicle.plate || "Без номера"}?`;
    if (window.confirm(prompt) !== true) return;
    setLastVehicleBusy(vehicle.vehicle_id);
    setActionError("");
    try {
      const result = await trafficRequest("/api/traffic/operator/last-vehicle", "POST", {
        action,
        vehicleId: vehicle.vehicle_id,
        key: crypto.randomUUID(),
      });
      if (result?.ok !== true) throw new Error("Сервер не подтвердил метку");
      if (onAuxiliaryCommitted) await onAuxiliaryCommitted();
      else await refresh(true);
    } catch (caught) {
      setActionError((caught as Error).message);
      void refresh(true);
    } finally {
      if (mounted.current) setLastVehicleBusy(null);
    }
  }
  const isManager = snapshot.role === "manager";
  const displayVehicles = optimisticTrafficVehicles(snapshot, pendingCommands);
  const managerVehicles = useMemo(() => {
    if (!isManager) return displayVehicles;
    const assignedIds = new Set(displayVehicles.map((vehicle) => vehicle.vehicle_id));
    const supplemental = (fleet ?? [])
      .filter((vehicle) => !assignedIds.has(vehicle.id))
      .map((vehicle): TrafficVehicle => ({
        vehicle_id: vehicle.id,
        name: vehicle.name,
        brand: vehicle.brand,
        plate: vehicle.plate,
        driver: vehicle.driver,
        state: vehicle.state ?? "empty",
        version: 0,
        since: vehicle.lastActivity ?? snapshot.serverTime,
        cycle: 0,
        // The compact PTC snapshot contains every assigned vehicle. A fleet row
        // absent from it is reserve, even if an earlier full response is stale.
        assigned: false,
        inRepair: vehicle.inRepair,
        repairVersion: vehicle.repairVersion,
        repairChangedAt: vehicle.repairChangedAt,
      }));
    return [...displayVehicles, ...supplemental];
  }, [displayVehicles, fleet, isManager, snapshot.serverTime]);
  const groups = isManager
    ? managerGroupOrder.map((state) => ({
        state,
        vehicles: managerVehicles.filter((vehicle) => managerGroupForVehicle(vehicle) === state),
      }))
    : [{ state: null, vehicles: displayVehicles }];
  const managerGroupsByVehicle = useMemo(() => {
    const value = new Map<string, ManagerTrafficGroup>();
    if (PTC_BOARD_V2 && isManager) {
      for (const vehicle of managerVehicles) {
        value.set(vehicle.vehicle_id, managerGroupForVehicle(vehicle));
      }
    }
    return value;
  }, [isManager, managerVehicles]);
  const movedManagerVehicleIds = new Set<string>();
  const previousManagerGroups = previousManagerGroupsRef.current;
  if (PTC_BOARD_V2 && previousManagerGroups) {
    managerGroupsByVehicle.forEach((group, vehicleId) => {
      const previousGroup = previousManagerGroups.get(vehicleId);
      if (previousGroup && previousGroup !== group) movedManagerVehicleIds.add(vehicleId);
    });
  }
  useEffect(() => {
    previousManagerGroupsRef.current = managerGroupsByVehicle;
  }, [managerGroupsByVehicle]);
  const lineVehicleCount = isManager
    ? managerVehicles.filter((vehicle) => vehicle.assigned && !vehicle.inRepair).length
    : 0;
  const lineVehicleWord = lineVehicleCount % 10 === 1 && lineVehicleCount % 100 !== 11
    ? "машина"
    : lineVehicleCount % 10 >= 2 && lineVehicleCount % 10 <= 4 &&
        (lineVehicleCount % 100 < 12 || lineVehicleCount % 100 > 14)
      ? "машины"
      : "машин";
  const activeRepairStageMessage = !isManager && displayVehicles.some((vehicle) => vehicle.inRepair)
    ? snapshot.role === "receiver"
      ? "Ремонт отмечен. Завершите фактическую выгрузку — машина останется в ремонте."
      : snapshot.role === "weighman"
        ? "Ремонт отмечен. Отметьте прибытие на выгрузку — машина останется в ремонте."
        : null
    : null;
  const combineBreakdowns = snapshot.combineBreakdowns ?? [];
  return (
    <>
      {combineBreakdowns.length > 0 ? (
        <section
          data-testid="traffic-combine-breakdown-banner"
          role="status"
          aria-live="polite"
          className="mb-3 flex min-w-0 items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-rose-100"
        >
          <Wrench aria-hidden size={18} className="mt-0.5 shrink-0 text-rose-300" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-rose-200">
              {combineBreakdowns.length === 1
                ? "Поломка комбайна"
                : `Поломка комбайнов · ${combineBreakdowns.length}`}
            </p>
            <ul className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
              {combineBreakdowns.map((status) => (
                <li key={status.operatorUserId} className="min-w-0 break-words">
                  <span className="font-medium text-white">{status.operatorName}</span>
                  <span className="text-rose-200"> · {stateAge(status.changedAt, now + offset)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
      {snapshot.role === "receiver" && snapshot.lastVehicle ? (
        <p data-testid="traffic-last-vehicle-banner" className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-slate-100">
          <span className="font-semibold text-rose-300">Последняя:</span>{" "}
          {[snapshot.lastVehicle.driver || "Водитель не назначен", snapshot.lastVehicle.brand, snapshot.lastVehicle.plate || "Без номера"].join(" · ")}
        </p>
      ) : null}
      {actionError ? <p role="alert" className="mb-3 text-sm text-rose-300">{actionError}</p> : null}
      {activeRepairStageMessage ? (
        <p data-testid="traffic-repair-stage-note" role="status" className="mb-3 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {activeRepairStageMessage}
        </p>
      ) : null}
      {pendingCommands.filter(command => command.phase === "uncertain").map(command => (
        <div key={command.key} role="alert" className="mb-3 text-sm text-rose-300">
          <p>{command.vehicle.plate || command.vehicle.name}: {command.error || "Нет подтверждения сервера."}</p>
          <button type="button" disabled={stale || !snapshot.enabled} className="min-h-[48px] underline disabled:opacity-50"
            onClick={() => void confirm(command, true)}>Повторить отправку</button>
        </div>
      ))}
      {error ? <div className="mb-3 flex min-w-0 items-center justify-between gap-2 text-xs text-amber-200" role="status">
        <span className="min-w-0 break-words">{error}</span>
        <button
          type="button"
          onClick={() => void refresh(true)}
          className="flex min-h-[48px] shrink-0 items-center gap-2 px-2"
          aria-label="Обновить статусы"
        >
          <WifiOff size={16} /> Обновить
        </button>
      </div> : null}
      {!snapshot.enabled ? (
        <p className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100">
          {snapshot.role === "manager"
            ? "Выберите и сохраните машины, чтобы начать работу."
            : "Агроном ещё не подтвердил список машин для работы."}
        </p>
      ) : null}
      <div
        data-testid={isManager ? "traffic-manager-board" : undefined}
        className={isManager
          ? compactAgronomistMobile
            ? PTC_BOARD_V2
              ? "min-w-0 lg:block lg:min-h-0"
              : "min-w-0 lg:block lg:max-h-none"
            : PTC_BOARD_V2
              ? "flex max-h-[max(12rem,calc(100dvh-14rem))] min-w-0 flex-col lg:block lg:max-h-none lg:min-h-0"
              : "flex max-h-[max(12rem,calc(100dvh-14rem))] min-w-0 flex-col lg:max-h-none lg:block"
          : ""}
      >
        {isManager ? (
          <p
            data-testid="traffic-line-total"
            className="mb-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm text-slate-300"
          >
            <span>На линии:</span>
            <strong className="text-lg font-semibold tabular-nums text-white">{lineVehicleCount}</strong>
            <span>{lineVehicleWord}</span>
            <span className="text-xs text-slate-500">· без машин в ремонте</span>
          </p>
        ) : null}
        {isManager ? (
          <div data-testid="traffic-mobile-toolbar" className="sticky top-0 z-20 mb-3 flex min-w-0 shrink-0 items-stretch gap-1 rounded-xl bg-[#0f172a] py-1 lg:hidden">
            <div role="group" aria-label="Показать машины по статусу" className="grid min-w-0 flex-1 grid-cols-5 gap-1">
              {groups.map(({ state, vehicles }) => state ? (
                <button
                  key={state}
                  type="button"
                  data-testid={`traffic-filter-${state}`}
                  aria-pressed={mobileState === state}
                  aria-controls={`traffic-list-${state}`}
                  onClick={() => {
                    setMobileState(state);
                    if (compactAgronomistMobile) {
                      window.requestAnimationFrame(() =>
                        mobileListRef.current?.scrollIntoView({ block: "start", behavior: "auto" }));
                    } else {
                      mobileListRef.current?.scrollTo({ top: 0 });
                    }
                  }}
                  className={`grid min-h-[60px] min-w-0 grid-rows-[2rem_1.25rem] content-center items-center justify-items-center rounded-lg border px-0.5 py-1 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${mobileState === state ? "border-slate-400 bg-slate-700 text-white" : "border-transparent text-slate-300"}`}
                >
                  <span className="flex h-8 w-full items-center justify-center text-[9px] font-medium leading-3 min-[390px]:text-[10px]">{mobileGroupLabels[state]}</span>
                  <span className="flex items-center gap-1.5 text-lg font-semibold leading-5 tabular-nums">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${groupDots[state]}`} />
                    {vehicles.length}
                  </span>
                </button>
              ) : null)}
            </div>
            {mobileActions ? <div className="flex w-12 shrink-0 items-center justify-center">{mobileActions}</div> : null}
          </div>
        ) : null}
      <div ref={mobileListRef} data-testid={isManager ? "traffic-manager-lists" : undefined}
        className={isManager
            ? compactAgronomistMobile
              ? PTC_BOARD_V2
                ? "tf2-traffic-lanes travkin-scrollbar grid min-h-0 scroll-mt-16 items-start gap-3 lg:max-h-[min(46rem,calc(100dvh-13rem))] lg:grid-cols-5 lg:items-stretch lg:gap-3 lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
                : "grid min-h-0 scroll-mt-16 items-start gap-3 lg:grid-cols-5 lg:gap-3"
              : PTC_BOARD_V2
                ? "tf2-traffic-lanes travkin-scrollbar grid min-h-0 items-start gap-4 overflow-y-auto overscroll-contain lg:max-h-[min(46rem,calc(100dvh-13rem))] lg:grid-cols-5 lg:items-stretch lg:gap-3 lg:pr-1"
                : "grid min-h-0 items-start gap-4 overflow-y-auto overscroll-contain lg:grid-cols-5 lg:overflow-visible lg:overscroll-auto"
          : ""}>
        {groups.map((group) => (
          <section
            key={group.state ?? "operator"}
            id={group.state ? `traffic-list-${group.state}` : undefined}
            data-testid={group.state ? `traffic-group-${group.state}` : "traffic-operator-list"}
            aria-label={group.state ? groupLabels[group.state] : "Машины"}
            className={`${PTC_BOARD_V2 ? "min-w-0 lg:self-stretch lg:rounded-2xl lg:bg-white/[0.018] lg:p-2" : "min-w-0"} ${group.state && group.state !== mobileState ? "hidden lg:block" : ""}`}
          >
            {group.state ? (
              <h2 className={PTC_BOARD_V2
                ? "mb-3 hidden items-center gap-2 border-b border-white/[0.08] bg-[#0c1118]/95 py-2 text-sm font-medium text-slate-200 backdrop-blur-md lg:sticky lg:top-0 lg:z-10 lg:flex"
                : "mb-3 hidden items-center gap-2 text-sm font-medium text-slate-200 lg:flex"}>
                <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${groupDots[group.state]}`} />
                {groupLabels[group.state]}
                <span aria-live={PTC_BOARD_V2 ? "polite" : undefined} aria-atomic={PTC_BOARD_V2 ? "true" : undefined} className="ml-auto text-xl font-semibold tabular-nums text-white">
                  {group.vehicles.length}
                </span>
              </h2>
            ) : null}
            <div className={isManager
              ? compactAgronomistMobile ? "grid gap-1.5 lg:gap-2" : "grid gap-2"
              : "grid gap-2 sm:grid-cols-2 xl:grid-cols-3"}>
        {group.vehicles.map((vehicle) => {
          const target = nextState(snapshot.role, vehicle.state, vehicle.inRepair);
          const repairPhase = trafficRepairPhase(vehicle);
          const statusSince = trafficStatusSince(vehicle, snapshot.role);
          const usesHarvesterSwipe = snapshot.role === "harvester" && target === "loaded";
          const pendingCommand = PTC_BOARD_V2
            ? pendingCommands.find(command => command.vehicle.vehicle_id === vehicle.vehicle_id)
            : undefined;
          const pendingVehicle = PTC_BOARD_V2
            ? !!pendingCommand
            : pendingCommands.some(command => command.vehicle.vehicle_id === vehicle.vehicle_id);
          const identity = getFleetVehicleCardIdentity(vehicle);
          const isLastVehicle = snapshot.lastVehicle?.vehicleId === vehicle.vehicle_id;
          const canChangeLastVehicle = snapshot.role === "harvester" && !vehicle.inRepair &&
            (isLastVehicle || vehicle.state === "empty");
          const cardClass = `${PTC_BOARD_V2 ? "tf2-traffic-card " : ""}${compactAgronomistMobile
            ? "h-[4.875rem] p-1.5 lg:h-24 lg:p-2.5"
              : "h-24 p-2.5"} min-w-0 overflow-hidden rounded-xl border text-left ${PTC_BOARD_V2 ? "shadow-[0_8px_22px_rgba(2,6,12,0.24)]" : "shadow-sm"} ${isManager && repairPhase === "active"
              ? PTC_BOARD_V2
                ? "border-rose-400/55 bg-rose-950/80 text-rose-100"
                : "border-rose-400 bg-rose-100 text-rose-950"
              : !vehicle.assigned
                ? PTC_BOARD_V2
                  ? "border-sky-400/45 bg-sky-950/75 text-sky-100"
                  : "border-sky-300 bg-sky-100 text-sky-950"
                : tones[vehicle.state]}`;
          const content = (
            <>
              <span className={`${compactAgronomistMobile
                ? "line-clamp-2 min-h-8 text-base leading-4 lg:min-h-10 lg:text-lg lg:leading-5"
                : "line-clamp-2 min-h-10 text-lg leading-5"} block break-words font-bold ${canChangeLastVehicle ? "pr-10" : ""}`}>
                {identity.primary}
              </span>
              {identity.secondary ? <span className={`flex min-w-0 items-center gap-1.5 ${compactAgronomistMobile ? "h-4 lg:h-5" : "h-5"}`}>
                <Truck aria-hidden size={15} className="shrink-0 opacity-60" />
                <span className={`truncate font-bold opacity-90 ${compactAgronomistMobile ? "text-xs lg:text-sm" : "text-sm"}`} title={identity.secondary}>
                  {identity.secondary}
                </span>
              </span> : <span aria-hidden className={`block ${compactAgronomistMobile ? "h-4 lg:h-5" : "h-5"}`} />}
              <span className={`flex min-w-0 items-center gap-1 truncate opacity-70 ${compactAgronomistMobile ? "h-3 text-[10px] leading-3 lg:h-4 lg:text-[11px] lg:leading-4" : "h-4 text-[11px] leading-4"}`}>
                {isLastVehicle ? <span className={`shrink-0 font-extrabold ${PTC_BOARD_V2 ? "text-rose-300" : "text-rose-700"}`}>ПОСЛЕДНЯЯ ·</span> : null}
                {!identity.hasDriver ? <span className="shrink-0 font-medium">Без водителя ·</span> : null}
                {isManager && repairPhase === "active" ? <>
                  <span className="flex shrink-0 items-center gap-1 font-semibold">
                    <Wrench size={11} aria-hidden /> Ремонт {stateAge(statusSince, now + offset)} ·
                  </span>
                  <span className="truncate">{STATE_LABEL[vehicle.state]}</span>
                </> : !isManager && vehicle.inRepair ? <>
                  <span className={`flex shrink-0 items-center gap-1 font-semibold ${PTC_BOARD_V2 ? "text-rose-300" : "text-rose-700"}`}>
                    <Wrench size={11} aria-hidden /> Ремонт отмечен · {STATE_LABEL[vehicle.state]} ·
                  </span>
                  <Clock3 aria-hidden size={11} />
                  <span className="truncate">{stateAge(statusSince, now + offset)}</span>
                </> : <>
                  {!vehicle.assigned ? <span className="shrink-0 font-semibold">Не на линии ·</span>
                    : usesHarvesterSwipe ? <span className={`shrink-0 font-semibold ${PTC_BOARD_V2 ? "text-emerald-300" : "text-emerald-800"}`}>Свайп вправо → ·</span>
                      : !isManager ? <span className="shrink-0">{STATE_LABEL[vehicle.state]} ·</span> : null}
                  <Clock3 aria-hidden size={11} />
                  <span className="truncate">{stateAge(statusSince, now + offset)}</span>
                </>}
              </span>
            </>
          );
          const swipeVisual = usesHarvesterSwipe && harvesterSwipe?.vehicleId === vehicle.vehicle_id
            ? harvesterSwipe
            : null;
          const swipeDistance = swipeVisual?.distance ?? 0;
          const swipeReady = !!swipeVisual && swipeVisual.distance >= swipeVisual.threshold;
          const card = target ? (
            <button
              type="button"
              data-testid={`traffic-vehicle-${vehicle.vehicle_id}`}
              data-swipe-action={usesHarvesterSwipe ? "loaded" : undefined}
              data-swipe-ready={usesHarvesterSwipe ? String(swipeReady) : undefined}
              data-command-phase={PTC_BOARD_V2 ? pendingCommand?.phase : undefined}
              data-repair-stage-action={!isManager && vehicle.inRepair ? "true" : undefined}
              aria-label={usesHarvesterSwipe
                ? `Смахните вправо, чтобы отметить загруженной: ${vehicle.name}, ${vehicle.plate || "без номера"}. С клавиатуры или программой экранного доступа активируйте карточку.`
                : `${ACTION_LABEL[target]}: ${vehicle.name}, ${vehicle.plate || "без номера"}${vehicle.inRepair
                  ? ". Машина отмечена в ремонте; завершите текущий этап."
                  : ""}`}
              aria-keyshortcuts={PTC_BOARD_V2 && usesHarvesterSwipe ? "ArrowRight Enter Space" : undefined}
              aria-busy={PTC_BOARD_V2 ? pendingVehicle || undefined : undefined}
              disabled={pendingVehicle || stale || !snapshot.enabled}
              onClick={usesHarvesterSwipe ? event => {
                // A physical tap has detail > 0 and is intentionally inert.
                // Keyboard and assistive technology synthesize detail === 0.
                if (event.detail === 0) submitTransition(vehicle, target);
              } : () => {
                const approved = window.confirm(
                  `${ACTION_LABEL[target]}\n\n${vehicle.name} · ${vehicle.plate || "Без номера"}\n\n${vehicle.inRepair
                    ? snapshot.role === "receiver"
                      ? "Выгрузка фактически завершена? Машина останется в ремонте."
                      : "Машина фактически прибыла на выгрузку? Она останется в ремонте."
                    : "Подтвердите только фактически выполненное действие."}`,
                );
                if (approved === true) submitTransition(vehicle, target);
              }}
              onPointerDown={usesHarvesterSwipe ? event => beginHarvesterSwipe(event, vehicle, target) : undefined}
              onPointerMove={usesHarvesterSwipe ? moveHarvesterSwipe : undefined}
              onPointerUp={usesHarvesterSwipe ? finishHarvesterSwipe : undefined}
              onPointerCancel={usesHarvesterSwipe ? cancelHarvesterSwipe : undefined}
              onLostPointerCapture={usesHarvesterSwipe ? cancelHarvesterSwipe : undefined}
              onKeyDown={usesHarvesterSwipe ? event => handleHarvesterSwipeKey(event, vehicle, target) : undefined}
              onDragStart={usesHarvesterSwipe ? event => event.preventDefault() : undefined}
              style={usesHarvesterSwipe ? {
                transform: `translate3d(${swipeDistance}px, 0, 0)`,
                transitionDuration: swipeVisual?.dragging ? "0ms" : undefined,
              } : undefined}
              className={`${cardClass} min-h-[48px] w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed ${usesHarvesterSwipe
                ? `relative z-10 touch-pan-y select-none cursor-grab transition-transform ${PTC_BOARD_V2 ? "duration-150 motion-reduce:transition-none" : "duration-200"} ease-out ${swipeVisual?.dragging ? "cursor-grabbing" : ""}`
                : PTC_BOARD_V2
                  ? "cursor-pointer motion-safe:transition motion-safe:duration-150 motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.98] motion-reduce:transform-none"
                  : "cursor-pointer active:scale-[0.98]"} ${stale || !snapshot.enabled ? "opacity-50" : ""}`}
            >
              {content}
            </button>
          ) : isManager && onManageVehicle ? (
            <button type="button"
              data-testid={`traffic-vehicle-${vehicle.vehicle_id}`}
              aria-label={`Управление машиной: ${vehicle.driver || vehicle.name}, ${vehicle.plate || "без номера"}`}
              onClick={() => onManageVehicle(vehicle)}
              className={`${cardClass} w-full cursor-pointer ${PTC_BOARD_V2 ? "motion-safe:transition motion-safe:duration-150 motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.98] motion-reduce:transform-none" : "active:scale-[0.98]"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300`}>
              {content}
            </button>
          ) : (
            <article
              data-testid={`traffic-vehicle-${vehicle.vehicle_id}`}
              className={`${cardClass} w-full`}
            >
              {content}
            </article>
          );
          return (
            <div
              key={vehicle.vehicle_id}
              data-traffic-card-id={PTC_BOARD_V2 ? vehicle.vehicle_id : undefined}
              data-traffic-card-group={PTC_BOARD_V2 ? group.state ?? undefined : undefined}
              data-transitioning={PTC_BOARD_V2 && movedManagerVehicleIds.has(vehicle.vehicle_id) ? "true" : undefined}
              className={`${PTC_BOARD_V2 ? "tf2-traffic-card-slot " : ""}relative min-w-0 ${usesHarvesterSwipe ? `overflow-hidden rounded-xl ${PTC_BOARD_V2 ? "bg-emerald-700" : "bg-emerald-600"}` : ""}`}
            >
              {usesHarvesterSwipe ? (
                <div
                  aria-hidden
                  data-testid={`traffic-swipe-track-${vehicle.vehicle_id}`}
                  className={`pointer-events-none absolute inset-0 flex items-center px-4 text-sm font-extrabold text-white transition-colors ${PTC_BOARD_V2 ? "duration-150 motion-reduce:transition-none " : ""}${swipeReady ? "bg-emerald-500" : "bg-emerald-700"}`}
                >
                  {swipeReady ? "✓ Отпустите — загружена" : "→ Проведите вправо"}
                </div>
              ) : null}
              {card}
              {canChangeLastVehicle ? (
                <button
                  type="button"
                  aria-label={isLastVehicle ? "Убрать метку последней машины" : "Отметить машину последней"}
                  disabled={stale || !snapshot.enabled || lastVehicleBusy !== null}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void changeLastVehicle(vehicle, isLastVehicle ? "clear" : "mark");
                  }}
                  className={`absolute right-0 top-0 z-20 flex min-h-[48px] min-w-[48px] items-center justify-center rounded-tr-xl ${PTC_BOARD_V2 ? "text-slate-300 hover:text-white" : "text-slate-700"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-amber-500 disabled:opacity-40`}
                >
                  <EllipsisVertical aria-hidden size={20} />
                </button>
              ) : null}
            </div>
          );
        })}
            </div>
            {group.state && !group.vehicles.length ? (
              <p className={`${PTC_BOARD_V2 ? "px-1 " : ""}py-3 text-xs text-slate-500`}>Нет машин</p>
            ) : null}
          </section>
        ))}
      </div>
      </div>
      {!(isManager ? managerVehicles : displayVehicles).length ? (
        <div className="py-16 text-center">
          <Truck size={38} className="mx-auto mb-4 text-slate-600" />
          <h2 className="font-medium text-slate-200">
            {snapshot.role === "weighman"
              ? "Пока нет загруженных машин"
              : snapshot.role === "receiver"
                ? "Пока нет машин на выгрузке"
                : "Машины ещё не назначены"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
            {snapshot.role === "weighman"
              ? "Машина появится здесь сразу после подтверждения комбайнёра."
              : snapshot.role === "receiver"
                ? "Машина появится здесь сразу после подтверждения весовщика."
                : "В парке пока нет машин, доступных для оборота."}
          </p>
        </div>
      ) : null}
      {snapshot.role === "manager" && snapshot.events.length ? (
        <details data-testid="traffic-manager-history-inline" className="mt-8 hidden border-t border-white/10 pt-4 lg:block">
          <summary className="min-h-[48px] cursor-pointer py-3 text-sm text-slate-400">
            Последние 50 изменений
          </summary>
          <div className="mt-3 divide-y divide-white/5">
            {snapshot.events.map((event) => (
              <div key={event.id} className="break-words py-3 text-sm">
                <p className="text-slate-300">
                  {trafficEventSummary(event)}
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
    </>
  );
}
