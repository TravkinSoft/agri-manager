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
    "weighbridge_active_harvests",
    "crop_structure",
  ],
} as const;

type UseLiveRefreshOptions = {
  enabled: boolean;
  onRefresh: (event?: LiveRefreshEvent) => void | Promise<void>;
  companyId?: string | null;
  tables?: readonly string[];
  intervalMs?: number;
  debounceMs?: number;
  minRefreshIntervalMs?: number;
};

export type LiveRefreshEvent = {
  source: "realtime" | "focus" | "online" | "visibility" | "interval";
  table?: string;
  tables?: string[];
  eventType?: string;
};

export function useLiveRefresh({
  enabled,
  onRefresh,
  companyId,
  tables = [],
  intervalMs = 10_000,
  debounceMs = 250,
  minRefreshIntervalMs = 0,
}: UseLiveRefreshOptions) {
  const refreshRef = useRef(onRefresh);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  const lastRefreshAtRef = useRef(Date.now());
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

    const scheduleRun = (delayMs: number) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void runRefresh(), delayMs);
    };

    const runRefresh = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      if (runningRef.current) {
        pendingRef.current = true;
        return;
      }

      const waitMs = minRefreshIntervalMs - (Date.now() - lastRefreshAtRef.current);
      if (minRefreshIntervalMs > 0 && waitMs > 0) {
        scheduleRun(waitMs);
        return;
      }

      runningRef.current = true;
      try {
        const event = pendingEvent;
        pendingEvent = undefined;
        await refreshRef.current(event);
        lastRefreshAtRef.current = Date.now();
      } catch (error) {
        console.error("Background refresh failed", error);
      } finally {
        runningRef.current = false;
        if (!disposed && pendingRef.current) {
          pendingRef.current = false;
          scheduleRun(Math.max(minRefreshIntervalMs, debounceMs));
        }
      }
    };

    const scheduleRefresh = (event?: LiveRefreshEvent) => {
      if (disposed) return;
      if (event && pendingEvent) {
        const tables = Array.from(new Set([
          ...(pendingEvent.tables || []),
          pendingEvent.table,
          ...(event.tables || []),
          event.table,
        ].filter(Boolean) as string[]));
        pendingEvent = {
          ...event,
          table: tables.length === 1 ? tables[0] : undefined,
          tables,
        };
      } else if (event) {
        pendingEvent = { ...event, tables: event.table ? [event.table] : event.tables };
      }
      scheduleRun(debounceMs);
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
  }, [companyId, debounceMs, enabled, intervalMs, minRefreshIntervalMs, tablesKey]);
}
