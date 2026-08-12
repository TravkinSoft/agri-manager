"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

export const LIVE_REFRESH_TABLES = {
  operations: [
    "operations",
    "operation_lines",
    "operation_materials",
    "warehouse_issue_requests",
    "warehouse_issue_request_items",
    "stock_ledger_entries",
  ],
  warehouses: [
    "warehouses",
    "warehouse_issue_requests",
    "warehouse_issue_request_items",
    "stock_ledger_entries",
    "inventory_batches",
    "tickets",
    "ticket_lines",
  ],
  weighbridge: [
    "tickets",
    "ticket_lines",
    "ticket_weighings",
    "weighbridge_shifts",
    "inventory_batches",
    "stock_ledger_entries",
    "operations",
    "operation_lines",
  ],
} as const;

type UseLiveRefreshOptions = {
  enabled: boolean;
  onRefresh: (event?: LiveRefreshEvent) => void | Promise<void>;
  companyId?: string | null;
  tables?: readonly string[];
  intervalMs?: number;
  debounceMs?: number;
};

export type LiveRefreshEvent = {
  source: "realtime" | "focus" | "online" | "visibility" | "interval";
  table?: string;
  eventType?: string;
};

export function useLiveRefresh({
  enabled,
  onRefresh,
  companyId,
  tables = [],
  intervalMs = 10_000,
  debounceMs = 250,
}: UseLiveRefreshOptions) {
  const refreshRef = useRef(onRefresh);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  const channelIdRef = useRef(Math.random().toString(36).slice(2));
  const tablesKey = tables.join(",");

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
    let pendingEvent: LiveRefreshEvent | undefined;

    const runRefresh = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      if (runningRef.current) {
        pendingRef.current = true;
        return;
      }

      runningRef.current = true;
      try {
        const event = pendingEvent;
        pendingEvent = undefined;
        await refreshRef.current(event);
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

    const scheduleRefresh = (event?: LiveRefreshEvent) => {
      if (disposed) return;
      pendingEvent = event || pendingEvent;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void runRefresh(), debounceMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh({ source: "visibility" });
    };

    const handleFocus = () => scheduleRefresh({ source: "focus" });
    const handleOnline = () => scheduleRefresh({ source: "online" });
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const interval = intervalMs > 0
      ? window.setInterval(() => scheduleRefresh({ source: "interval" }), intervalMs)
      : null;

    const subscribeToChanges = async () => {
      const tableNames = tablesKey.split(",").filter(Boolean);
      if (!companyId || tableNames.length === 0) return;

      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (disposed || error || !accessToken) return;

      await supabase.realtime.setAuth(accessToken);
      if (disposed) return;

      let channel = supabase.channel(`live-refresh:${channelIdRef.current}:${companyId}`);
      for (const table of tableNames) {
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `company_id=eq.${companyId}`,
          },
          (payload) => scheduleRefresh({
            source: "realtime",
            table,
            eventType: String(payload.eventType || ""),
          })
        );
      }

      realtimeChannel = channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`Live refresh channel ${status.toLowerCase()}; polling remains active.`);
        }
      });
    };

    void subscribeToChanges();

    return () => {
      disposed = true;
      pendingRef.current = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (interval) window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
    };
  }, [companyId, debounceMs, enabled, intervalMs, tablesKey]);
}
