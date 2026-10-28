"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { trafficRequest } from "@/components/traffic/use-traffic";

/** Keep a tenant-scoped last good snapshot while hidden. No background reads from
 * inactive tabs, no competing requests, no stale response after a scope change. */
export function useSummaryResource<T extends { companyId: string; readOnly: true; serverTime: string }>(
  scope: string, companyId: string, path: string, enabled: boolean, tables: readonly string[], intervalMs = 15_000,
) {
  const key = `${scope}:${path}`;
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const queued = useRef(false);
  const load = useCallback(async () => {
    if (!enabled || !scope || !companyId) return;
    if (request.current) { queued.current = true; return; }
    const started = generation.current;
    do {
      queued.current = false;
      const controller = new AbortController();
      request.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      try {
        const data = await trafficRequest(path, "GET", undefined, false, controller.signal) as T;
        if (started !== generation.current) return;
        if (data.companyId !== companyId || data.readOnly !== true) throw new Error("Неверный контекст сводки");
        setResult({ key, data, error: null });
      } catch (error) {
        if (started !== generation.current) return;
        const status = (error as { status?: number }).status;
        const revoked = status === 401 || status === 403;
        setResult(previous => ({ key, data: revoked || previous?.key !== key ? null : previous.data,
          error: revoked ? "Нет доступа. Проверьте вход и выбранную компанию." : "Не удалось обновить данные. Повторим автоматически." }));
      } finally {
        window.clearTimeout(timeout);
        if (request.current === controller) request.current = null;
      }
    } while (queued.current && started === generation.current);
  }, [companyId, enabled, key, path, scope]);
  useEffect(() => {
    generation.current++;
    void load();
    return () => { generation.current++; request.current?.abort(); request.current = null; queued.current = false; };
  }, [load]);
  useLiveRefresh({ enabled: enabled && Boolean(scope), companyId, tables, intervalMs, onRefresh: load });
  return { data: result?.key === key ? result.data : null, error: result?.key === key ? result.error : null, refresh: load };
}
