"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyTrafficCommit, type TrafficCommit, type TrafficSnapshot } from "@/lib/traffic/model";
import { supabase } from "@/lib/supabase/client";
import { subscribeVehicleDriverAssignments } from "@/lib/vehicles/driver-assignment-client";
export interface ManagerData {
  snapshot: TrafficSnapshot;
  fleet: Array<{
    id: string;
    name: string;
    brand: string | null;
    model: string | null;
    license_plate: string | null;
    plate_number: string | null;
  }>;
  people: Array<{ id: string; full_name: string; user_id: string | null }>;
  fields: Array<{ id: string; name: string }>;
  canManageUsers: boolean;
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
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const hasManagerData = useRef(false);
  const loggedOut = useRef(false);
  const authGeneration = useRef(0);
  const authIdentity = useRef<string | null | undefined>(undefined);
  const readEpoch = useRef(0);
  const refresh = useCallback(
    async (fresh = false): Promise<void> => {
      if (!isManager && loggedOut.current && !fresh) return;
      if (fresh) setStale(true);
      if (pending.current) {
        await pending.current;
        if (fresh && mounted.current) return refresh(true);
        return;
      }
      const run = async () => {
        const generation = authGeneration.current;
        const epoch = readEpoch.current;
        if (!navigator.onLine) {
          setStale(true);
          setError("Нет связи. Показаны последние полученные данные");
          setLoading(false);
          return;
        }
        controller.current = new AbortController();
        const timeout = window.setTimeout(
          () => controller.current?.abort(),
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
            controller.current.signal,
          );
          if (!mounted.current || generation !== authGeneration.current || epoch !== readEpoch.current) return;
          setData(isManager ? payload.snapshot : payload);
          if (isManager) {
            if (compact)
              setManagerData((old) =>
                old ? { ...old, snapshot: payload.snapshot } : old,
              );
            else {
              setManagerData(payload);
              hasManagerData.current = true;
            }
          }
          setNeedsLogin(false);
          loggedOut.current = false;
          setStale(false);
          setError("");
        } catch (caught) {
          if (!mounted.current || generation !== authGeneration.current || epoch !== readEpoch.current) return;
          const failure = caught as Error & { status?: number };
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
          if (mounted.current) setLoading(false);
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
    return true;
  }, [generation]);
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
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "hidden") await refresh();
      if (!cancelled) timer = window.setTimeout(poll, 2000);
    };
    const awaken = () => {
      if (document.visibilityState !== "hidden") {
        setStale(true);
        void refresh(true);
      }
    };
    const offline = () => {
      setStale(true);
      setError("Нет связи. Действия недоступны до обновления");
    };
    const visible = () => {
      setStale(true);
      if (document.visibilityState === "visible") awaken();
    };
    void poll();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const identity = session?.user.id ?? null;
      if (event === "INITIAL_SESSION") {
        authIdentity.current = identity;
        return;
      }
      if (identity !== authIdentity.current || event === "SIGNED_OUT") {
        authIdentity.current = identity;
        authGeneration.current++;
        readEpoch.current++;
        controller.current?.abort();
        setData(null);
        setManagerData(null);
        hasManagerData.current = false;
        setStale(true);
        loggedOut.current = event === "SIGNED_OUT";
        if (!isManager) setNeedsLogin(event === "SIGNED_OUT");
      }
      if (event !== "SIGNED_OUT")
        window.setTimeout(() => {
          if (mounted.current) void refresh(true);
        }, 0);
    });
    window.addEventListener("focus", awaken);
    window.addEventListener("online", awaken);
    window.addEventListener("pageshow", awaken);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      subscription.unsubscribe();
      mounted.current = false;
      window.clearTimeout(timer);
      controller.current?.abort();
      window.removeEventListener("focus", awaken);
      window.removeEventListener("online", awaken);
      window.removeEventListener("pageshow", awaken);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, isManager]);
  return { data, managerData, error, stale, needsLogin, loading, refresh, applyCommitted };
}
