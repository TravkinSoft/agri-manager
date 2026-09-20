"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dashboardSnapshots, type DashboardSnapshot } from "@/lib/dashboard/client-snapshot";
import { supabase } from "@/lib/supabase/client";

/** Keep the last successful frame visible; coalesce live events without abort starvation. */
export function useDashboardResource<T>(scope: string, name: string, load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const key = `${scope}:${name}`;
  const [snapshot, setSnapshot] = useState<DashboardSnapshot<T> | null>(() => dashboardSnapshots.read<T>(key, scope));
  const [state, setState] = useState({ key, refreshing: true, verified: false, error: "" });
  const requestRef = useRef<{ key: string; pending: boolean; promise: Promise<void>; controller: AbortController } | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    const running = requestRef.current;
    if (running?.key === key && !running.controller.signal.aborted) {
      running.pending = true;
      return running.promise;
    }
    running?.controller.abort();
    const controller = new AbortController();
    const request = { key, pending: false, promise: Promise.resolve(), controller };
    requestRef.current = request;
    setState((previous) => ({ key, refreshing: true, verified: previous.key === key && previous.verified, error: "" }));
    request.promise = (async () => {
      try {
        do {
          request.pending = false;
          const attempt = new AbortController();
          const cancel = () => attempt.abort();
          controller.signal.addEventListener("abort", cancel, { once: true });
          const timeout = window.setTimeout(cancel, 30_000);
          let data: T;
          try {
            data = await load(attempt.signal);
          } finally {
            window.clearTimeout(timeout);
            controller.signal.removeEventListener("abort", cancel);
          }
          if (controller.signal.aborted) return;
          const next = { scope, data, savedAt: Date.now() };
          dashboardSnapshots.write(key, next);
          setSnapshot(next);
          setState({ key, refreshing: request.pending, verified: true, error: "" });
        } while (request.pending);
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, refreshing: false, verified: false, error: error instanceof Error ? error.message : "Не удалось обновить данные" });
      } finally {
        if (requestRef.current === request) requestRef.current = null;
      }
    })();
    return request.promise;
  }, [enabled, key, load, scope]);

  useEffect(() => {
    setSnapshot(enabled ? dashboardSnapshots.read<T>(key, scope) : null);
    setState({ key, refreshing: enabled, verified: false, error: "" });
    void refresh();
    return () => requestRef.current?.controller.abort();
  }, [enabled, key, refresh, scope]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        requestRef.current?.controller.abort();
        dashboardSnapshots.clear();
        setSnapshot(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Check scope during render, not just in an effect (no one-frame tenant leak).
  const visible = enabled ? (snapshot?.scope === scope ? snapshot : dashboardSnapshots.read<T>(key, scope)) : null;
  const status = state.key === key ? state : { refreshing: enabled, verified: false, error: "" };
  return {
    data: visible?.data ?? null, savedAt: visible?.savedAt, refresh,
    refreshing: status.refreshing,
    stale: Boolean(visible && !status.verified), error: status.error,
  };
}
