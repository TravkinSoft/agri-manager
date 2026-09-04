"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrafficSnapshot } from "@/lib/traffic/model";
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
  people: Array<{ id: string; full_name: string }>;
  fields: Array<{ id: string; name: string }>;
  access: Array<{
    id: string;
    person_id: string;
    role: "harvester" | "receiver";
    login: string;
    created_at: string;
    revoked_at: string | null;
  }>;
}
export async function trafficRequest(
  path: string,
  method = "GET",
  body?: unknown,
  manager = false,
  signal?: AbortSignal,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (manager)
    Object.assign(
      headers,
      await (
        await import("@/lib/supabase/client-auth")
      ).buildClientAuthHeaders(),
    );
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
  const refresh = useCallback(
    async (fresh = false): Promise<void> => {
      if (fresh) setStale(true);
      if (pending.current) {
        await pending.current;
        if (fresh && mounted.current) return refresh(true);
        return;
      }
      const run = async () => {
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
          if (!mounted.current) return;
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
          setStale(false);
          setError("");
        } catch (caught) {
          if (!mounted.current) return;
          const failure = caught as Error & { status?: number };
          if (failure.status === 401 && !isManager) {
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
  useEffect(() => {
    mounted.current = true;
    let timer: number;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "hidden") await refresh();
      if (!cancelled) timer = window.setTimeout(poll, 8000);
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
    window.addEventListener("focus", awaken);
    window.addEventListener("online", awaken);
    window.addEventListener("pageshow", awaken);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      mounted.current = false;
      window.clearTimeout(timer);
      controller.current?.abort();
      window.removeEventListener("focus", awaken);
      window.removeEventListener("online", awaken);
      window.removeEventListener("pageshow", awaken);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  return { data, managerData, error, stale, needsLogin, loading, refresh };
}
