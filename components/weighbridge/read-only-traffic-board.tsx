"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Truck, Wrench } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { subscribeTrafficChanges } from "@/lib/traffic/changes";
import { trafficRequest } from "@/components/traffic/use-traffic";
import { TRAFFIC_BOARD_GROUPS, TRAFFIC_BOARD_ROLES, type TrafficBoardSnapshot } from "@/lib/traffic/read-only-board";

const TABLES = ["ptc_vehicle_states", "fleet_vehicle_repairs", "reference_vehicles", "reference_specialists", "company_people"];
const COLORS = {
  empty: "bg-card", loaded: "bg-emerald-500/10", unloading: "bg-amber-500/10",
  repair: "bg-rose-500/10", offline: "bg-muted/40",
};
function elapsed(since: string | null, now: number) {
  if (!since) return "—";
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} ч ${minutes % 60} мин`
    : `${Math.floor(hours / 24)} д ${hours % 24} ч ${minutes % 60} мин`;
}

export function ReadOnlyTrafficBoardView({ snapshot, error, now }: {
  snapshot: TrafficBoardSnapshot | null; error: string | null; now: number;
}) {
  return (
    <section aria-label="ПТС весовой — только просмотр" className="min-w-0 space-y-3 rounded-xl border border-border p-3 sm:p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Оборот машин</h2>
        <span className="text-xs text-muted-foreground">ПТС · Только просмотр</span>
      </header>
      {error ? <p role="status" className="text-xs text-amber-700">{snapshot ? "Показан последний полученный снимок. " : ""}{error}</p> : null}
      {!snapshot && !error ? <p role="status" className="text-sm text-muted-foreground">Загрузка движения машин…</p> : null}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {TRAFFIC_BOARD_GROUPS.map(group => {
          const vehicles = snapshot?.vehicles.filter(vehicle => vehicle.group === group.key) ?? [];
          return (
            <section key={group.key} aria-label={group.label} className="min-w-0">
              <h3 className="mb-2 flex min-h-9 items-center justify-between gap-2 border-b border-border pb-2 text-xs font-medium">
                {group.label}<span className="text-base font-semibold tabular-nums">{snapshot ? vehicles.length : "—"}</span>
              </h3>
              <div className="space-y-2">
                {vehicles.map(vehicle => (
                  <article key={vehicle.id} className={`min-w-0 rounded-lg p-3 ${COLORS[group.key]}`}>
                    <div className="flex items-start gap-2">
                      {group.key === "repair" ? <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" /> : <Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                      <div className="min-w-0 space-y-1">
                        <p className="break-words text-sm font-semibold">{vehicle.driver || "Водитель не назначен"}</p>
                        <p className="break-words text-xs text-muted-foreground" title={vehicle.name}>{vehicle.brand}</p>
                        <p className="break-words text-sm font-medium">{vehicle.plate || "Госномер не указан"}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
                      <span>{group.label}</span>
                      <span className="inline-flex items-center gap-1 tabular-nums" title="Время в текущем статусе"><Clock3 className="h-3 w-3" aria-hidden="true" />{elapsed(vehicle.since, now)}</span>
                    </div>
                  </article>
                ))}
                {snapshot && !vehicles.length ? <p className="py-2 text-xs text-muted-foreground">Нет машин</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function ReadOnlyTrafficBoard({ enabled = true }: { enabled?: boolean }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const allowed = Boolean(enabled && companyId && profile?.role && TRAFFIC_BOARD_ROLES.some(role => role === profile.role));
  const scope = allowed ? `${profile?.id}:${profile?.role}:${companyId}` : "";
  const [result, setResult] = useState<{ scope: string; snapshot: TrafficBoardSnapshot | null; error: string | null; offset: number } | null>(null);
  const [now, setNow] = useState(Date.now);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const queued = useRef(false);
  const load = useCallback(async () => {
    if (!scope || !companyId) return;
    if (request.current) { queued.current = true; return; }
    const currentGeneration = generation.current;
    do {
      queued.current = false;
      const controller = new AbortController();
      request.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const payload = await trafficRequest(`/api/traffic/board?companyId=${encodeURIComponent(companyId)}`, "GET", undefined, false, controller.signal) as TrafficBoardSnapshot;
        if (currentGeneration !== generation.current) return;
        if (payload.companyId !== companyId || payload.readOnly !== true || !Array.isArray(payload.vehicles)) throw new Error("Неверный контекст ПТС");
        const serverNow = Date.parse(payload.serverTime);
        setResult({ scope, snapshot: payload, error: null, offset: Number.isFinite(serverNow) ? serverNow - Date.now() : 0 });
      } catch (error) {
        if (currentGeneration !== generation.current) return;
        const status = (error as { status?: number }).status;
        setResult(previous => ({ scope,
          snapshot: status === 401 || status === 403 || previous?.scope !== scope ? null : previous.snapshot,
          offset: previous?.scope === scope ? previous.offset : 0,
          error: status === 401 || status === 403 ? "Нет доступа к ПТС. Проверьте вход и выбранную компанию." : "Не удалось обновить ПТС. Повторим автоматически.",
        }));
      } finally {
        window.clearTimeout(timeout);
        if (request.current === controller) request.current = null;
      }
    } while (queued.current && currentGeneration === generation.current);
  }, [companyId, scope]);
  useEffect(() => {
    const effectGeneration = generation.current + 1;
    generation.current = effectGeneration;
    request.current?.abort();
    request.current = null;
    queued.current = false;
    setResult(null);
    void load();
    return () => { generation.current = effectGeneration + 1; request.current?.abort(); request.current = null; queued.current = false; };
  }, [load]);
  useEffect(() => {
    if (!allowed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [allowed]);
  useLiveRefresh({ enabled: allowed, companyId, tables: TABLES, intervalMs: 5_000, minRefreshIntervalMs: 500, onRefresh: load });
  useEffect(() => {
    if (allowed) return subscribeTrafficChanges(companyId ?? undefined, () => { void load(); });
  }, [allowed, companyId, load]);
  if (!allowed) return null;
  // Do not render even one frame of the previous tenant's snapshot on switch.
  const visible = result?.scope === scope ? result : null;
  return <ReadOnlyTrafficBoardView snapshot={visible?.snapshot ?? null} error={visible?.error ?? null} now={now + (visible?.offset ?? 0)} />;
}
