"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyTrafficCommit, type TrafficCommit, type TrafficSnapshot } from "@/lib/traffic/model";
import { supabase } from "@/lib/supabase/client";
import type { FleetVehicle } from "@/lib/fleet/model";
import { subscribeVehicleDriverAssignments } from "@/lib/vehicles/driver-assignment-client";
import { publishTrafficChanged, subscribeTrafficChanges } from "@/lib/traffic/changes";

function sameSnapshotContent(left: TrafficSnapshot, right: TrafficSnapshot) {
  if (
    left.companyId !== right.companyId ||
    left.role !== right.role ||
    left.personName !== right.personName ||
    left.enabled !== right.enabled ||
    left.fieldId !== right.fieldId ||
    left.flowRevision !== right.flowRevision ||
    left.fieldName !== right.fieldName
  ) return false;
  return JSON.stringify(left.vehicles) === JSON.stringify(right.vehicles) &&
    JSON.stringify(left.events) === JSON.stringify(right.events);
}
export interface ManagerData {
  snapshot: TrafficSnapshot;
  fleet: FleetVehicle[];
  canManageRepairs?: boolean;
  people: Array<{ id: string; full_name: string; user_id: string | null }>;
  fields: Array<{ id: string; name: string }>;
  canManageUsers: boolean;
  canCreateFleetEntities: boolean;
  accounts: Array<{
    id: string;
    full_name: string;
    role: "mechanic_operator" | "vegetable_brigadier";
    status: string;
  }>;
}
export async function trafficRequest(
  path: string,
  method = "GET",
  body?: unknown,
  _manager = false,
  signal?: AbortSignal,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    Object.assign(
      headers,
      await (
        await import("@/lib/supabase/client-auth")
      ).buildClientAuthHeaders(),
    );
  } catch (caught) {
    if ((caught as Error).message.startsWith("Missing authorization token"))
      throw Object.assign(
        new Error("Войдите с Вашей почтой и паролем TravkinFlow"),
        { status: 401 },
      );
    throw caught;
  }
  const ownedController = signal ? null : new AbortController();
  const timeout = ownedController
    ? window.setTimeout(() => ownedController.abort(), 15000)
    : null;
  try {
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? ownedController?.signal,
    });
    const payload = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(payload.error || "Не удалось связаться с сервером"),
        { status: response.status },
      );
    return payload;
  } catch (caught) {
    if ((caught as Error).name === "AbortError")
      throw new Error(
        "Нет подтверждения сервера. Обновите статусы перед повторным действием",
      );
    throw caught;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}
export function useTraffic(isManager: boolean) {
  const [data, setData] = useState<TrafficSnapshot | null>(null);
  const [managerData, setManagerData] = useState<ManagerData | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const pending = useRef<Promise<void> | null>(null);
  const queued = useRef<Promise<void> | null>(null);
  const queuedFull = useRef(false);
  const activeRead = useRef({ generation: 0, epoch: 0 });
  const lastWake = useRef(-Infinity);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const hasManagerData = useRef(false);
  const loggedOut = useRef(false);
  const authGeneration = useRef(0);
  const authRevision = useRef(0);
  const authIdentity = useRef<string | null | undefined>(undefined);
  const readEpoch = useRef(0);
  const refresh = useCallback(
    async (fresh = false): Promise<void> => {
      if (loggedOut.current && !fresh) return;
      if (pending.current) {
        // Lifecycle events join the current read. Explicit metadata refreshes and
        // reads invalidated by a commit/account change share ONE successor.
        if (fresh || activeRead.current.generation !== authGeneration.current ||
          activeRead.current.epoch !== readEpoch.current) {
          queuedFull.current ||= fresh;
          if (!queued.current) {
            queued.current = pending.current.then(() => {
              const full = queuedFull.current;
              queued.current = null;
              queuedFull.current = false;
              if (mounted.current && (!loggedOut.current ||
                (full && typeof authIdentity.current === "string"))) return refresh(full);
            });
          }
          return queued.current;
        }
        await pending.current;
        return;
      }
      const run = async () => {
        const generation = authGeneration.current;
        const sessionRevision = authRevision.current;
        const epoch = readEpoch.current;
        activeRead.current = { generation, epoch };
        if (!navigator.onLine) {
          setStale(true);
          setError("Нет связи. Показаны последние полученные данные");
          setLoading(false);
          return;
        }
        const requestController = new AbortController();
        controller.current = requestController;
        const timeout = window.setTimeout(
          () => requestController.abort(),
          12000,
        );
        try {
          const compact = isManager && hasManagerData.current && !fresh;
          const payload = await trafficRequest(
            isManager
              ? `/api/traffic${compact ? "?snapshot=1" : ""}`
              : "/api/traffic/operator",
            "GET",
            undefined,
            isManager,
            requestController.signal,
          );
          if (!mounted.current || generation !== authGeneration.current || epoch !== readEpoch.current) return;
          const received = (isManager ? payload.snapshot : payload) as TrafficSnapshot;
          setData((old) => {
            const next = compact && old
              ? { ...received, events: old.events }
              : received;
            return old && sameSnapshotContent(old, next) ? old : next;
          });
          if (isManager) {
            if (compact)
              setManagerData((old) => {
                if (!old) return old;
                const next = { ...received, events: old.snapshot.events };
                return sameSnapshotContent(old.snapshot, next)
                  ? old
                  : { ...old, snapshot: next };
              });
            else {
              setManagerData(payload);
              hasManagerData.current = true;
            }
          }
          setNeedsLogin(false);
          loggedOut.current = false;
          setStale(!navigator.onLine);
          setError(navigator.onLine ? "" : "Нет связи. Показаны последние полученные данные");
        } catch (caught) {
          if (!mounted.current || generation !== authGeneration.current || epoch !== readEpoch.current) return;
          const failure = caught as Error & { status?: number };
          if (failure.status === 401 && sessionRevision !== authRevision.current && !loggedOut.current) {
            // Auth may renew while this request is using the previous token.
            // Recheck once with the newer session, not a premature login screen.
            setStale(true);
            void refresh(true);
            return;
          }
          if (failure.status === 401 && !isManager) {
            loggedOut.current = true;
            setNeedsLogin(true);
            setData(null);
            setError("");
          } else
            setError(
              failure.name === "AbortError"
                ? "Сервер не ответил. Данные могут быть устаревшими"
                : failure.message,
            );
          setStale(true);
        } finally {
          window.clearTimeout(timeout);
          // An account/session change can invalidate this read and queue a new
          // authorized one. Keep the cold-start shell loading until THAT read
          // settles, otherwise the UI briefly renders the empty error branch.
          if (mounted.current && generation === authGeneration.current &&
            epoch === readEpoch.current && !queued.current) setLoading(false);
        }
      };
      pending.current = run();
      try {
        await pending.current;
      } finally {
        pending.current = null;
      }
    },
    [isManager],
  );
  const generation = authGeneration.current;
  const applyCommitted = useCallback((receipt: TrafficCommit, vehicleId: string, expectedVersion: number) => {
    const row = receipt?.vehicle;
    if (!mounted.current || generation !== authGeneration.current || !row ||
      typeof receipt.eventId !== "string" || !Number.isFinite(Date.parse(receipt.serverTime)) ||
      row.vehicle_id !== vehicleId || !["empty", "loaded", "unloading"].includes(row.state) ||
      !Number.isInteger(row.version) || row.version <= expectedVersion ||
      !Number.isInteger(row.cycle) || row.cycle < 0 || typeof row.assigned !== "boolean" ||
      !Number.isFinite(Date.parse(row.since))) return false;
    // A GET begun before the committed POST must never roll the card back.
    readEpoch.current++;
    controller.current?.abort();
    setData((old) => old ? applyTrafficCommit(old, receipt) : old);
    setManagerData((old) => old ? { ...old, snapshot: applyTrafficCommit(old.snapshot, receipt) } : old);
    publishTrafficChanged(data?.companyId);
    return true;
  }, [generation, data?.companyId]);
  useEffect(() => subscribeTrafficChanges((companyId) => {
    if (!mounted.current || generation !== authGeneration.current || companyId !== data?.companyId) return;
    readEpoch.current++;
    controller.current?.abort();
    // Epoch invalidation guarantees one quiet successor to the aborted read.
    void refresh();
  }), [data?.companyId, generation, refresh]);
  useEffect(() => subscribeVehicleDriverAssignments((result) => {
    if (!mounted.current || generation !== authGeneration.current ||
      !data?.companyId || result.companyId !== data.companyId) return;
    // Assignment changes affect only the current label, never a trip or its status.
    readEpoch.current++;
    controller.current?.abort();
    const update = (old: TrafficSnapshot | null) => old && old.companyId === result.companyId
      ? { ...old, vehicles: old.vehicles.map((v) => v.vehicle_id === result.vehicle.id
        ? { ...v, driver: result.vehicle.driverName } : v) }
      : old;
    setData(update);
    setManagerData((old) => old ? { ...old, snapshot: update(old.snapshot)! } : old);
    void refresh();
  }), [data?.companyId, generation, refresh]);
  useEffect(() => {
    mounted.current = true;
    let timer: number;
    const authTimers = new Set<number>();
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "hidden") await refresh();
      if (!cancelled) timer = window.setTimeout(poll, 1000);
    };
    const awaken = () => {
      if (document.visibilityState === "hidden" || loggedOut.current) return;
      // Browsers emit visibilitychange, focus, pageshow and same-user SIGNED_IN
      // for one resume. Coalesce even when the first GET completes very quickly.
      const now = Date.now();
      if (now - lastWake.current < 750) return;
      lastWake.current = now;
      void refresh();
    };
    const online = () => {
      lastWake.current = -Infinity;
      awaken();
    };
    const offline = () => {
      setStale(true);
      setError("Нет связи. Действия недоступны до обновления");
    };
    const visible = () => {
      if (document.visibilityState === "hidden") lastWake.current = -Infinity;
      else awaken();
    };
    void poll();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const identity = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && authIdentity.current === undefined) {
        authIdentity.current = identity;
        return;
      }
      const identityChanged = identity !== authIdentity.current || event === "SIGNED_OUT";
      const recoveringSession = !!session && loggedOut.current;
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) authRevision.current++;
      if (identityChanged) {
        authIdentity.current = identity;
        authGeneration.current++;
        readEpoch.current++;
        controller.current?.abort();
        setData(null);
        setManagerData(null);
        hasManagerData.current = false;
        setStale(true);
        loggedOut.current = event === "SIGNED_OUT";
        if (event === "SIGNED_OUT") setLoading(false);
        else setLoading(true);
        if (!isManager) setNeedsLogin(event === "SIGNED_OUT");
      }
      if (recoveringSession) loggedOut.current = false;
      if (event !== "SIGNED_OUT") {
        const scheduledGeneration = authGeneration.current;
        const authTimer = window.setTimeout(() => {
          authTimers.delete(authTimer);
          if (!mounted.current || scheduledGeneration !== authGeneration.current || loggedOut.current) return;
          if (identityChanged || recoveringSession) void refresh(true);
          else awaken();
        }, 0);
        authTimers.add(authTimer);
      }
    });
    window.addEventListener("focus", awaken);
    window.addEventListener("online", online);
    window.addEventListener("pageshow", awaken);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      subscription.unsubscribe();
      mounted.current = false;
      window.clearTimeout(timer);
      authTimers.forEach((authTimer) => window.clearTimeout(authTimer));
      controller.current?.abort();
      window.removeEventListener("focus", awaken);
      window.removeEventListener("online", online);
      window.removeEventListener("pageshow", awaken);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, isManager]);
  const scopeKey = `${generation}:${data?.companyId ?? ""}:${data?.role ?? ""}:${data?.personName ?? ""}`;
  return { data, managerData, error, stale, needsLogin, loading, refresh, applyCommitted, scopeKey };
}
