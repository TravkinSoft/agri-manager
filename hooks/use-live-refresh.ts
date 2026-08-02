"use client";

import { useEffect, useRef } from "react";

type UseLiveRefreshOptions = {
  enabled: boolean;
  onRefresh: () => void | Promise<void>;
  intervalMs?: number;
  debounceMs?: number;
};

export function useLiveRefresh({
  enabled,
  onRefresh,
  intervalMs = 10_000,
  debounceMs = 250,
}: UseLiveRefreshOptions) {
  const refreshRef = useRef(onRefresh);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const runRefresh = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      if (runningRef.current) {
        pendingRef.current = true;
        return;
      }

      runningRef.current = true;
      try {
        await refreshRef.current();
      } catch (error) {
        console.error("Background refresh failed", error);
      } finally {
        runningRef.current = false;
        if (!disposed && pendingRef.current) {
          pendingRef.current = false;
          void runRefresh();
        }
      }
    };

    const scheduleRefresh = () => {
      if (disposed) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void runRefresh(), debounceMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    window.addEventListener("focus", scheduleRefresh);
    window.addEventListener("online", scheduleRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const interval = window.setInterval(scheduleRefresh, intervalMs);

    return () => {
      disposed = true;
      pendingRef.current = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", scheduleRefresh);
      window.removeEventListener("online", scheduleRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [debounceMs, enabled, intervalMs]);
}
