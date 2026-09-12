"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Scale, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import type {
  FieldHarvestAllocationProjection,
  FieldHarvestProjection,
  FieldHarvestReconciliationStatus,
} from "@/lib/fields/field-harvest";

type FieldHarvestLiveProps = {
  companyId: string;
  seasonId: string;
  fieldId: string;
  allocationId?: string | null;
  allocationLabel?: string | null;
};

type LoadPhase = "idle" | "loading" | "refreshing" | "ready" | "stale" | "error";
type LoadState = {
  phase: LoadPhase;
  data: FieldHarvestProjection | null;
  error: string | null;
};

const FIELD_HARVEST_REFRESH_MS = 30_000;
const FIELD_HARVEST_TIMEOUT_MS = 12_000;
const projectionCache = new Map<string, FieldHarvestProjection>();

const scopeKey = (companyId: string, seasonId: string, fieldId: string) =>
  `${companyId}:${seasonId}:${fieldId}`;

function formatMass(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
  }
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} кг`;
}

function formatYield(value: number | null): string {
  return value == null
    ? "—"
    : `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} т/га`;
}

function reconciliationCopy(status: FieldHarvestReconciliationStatus): {
  label: string;
  className: string;
  detail: string;
} {
  if (status === "reconciled") {
    return {
      label: "Ledger сверено",
      className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-800",
      detail: "Принятая масса совпадает с входящими проводками.",
    };
  }
  if (status === "mismatch") {
    return {
      label: "Нужна сверка",
      className: "border-amber-400/40 bg-amber-400/10 text-amber-800",
      detail: "Факт показан по талонам; сумма проводок отличается.",
    };
  }
  if (status === "ticket_only") {
    return {
      label: "Только талоны",
      className: "border-amber-400/40 bg-amber-400/10 text-amber-800",
      detail: "Завершённые талоны есть, входящая проводка не найдена.",
    };
  }
  if (status === "unavailable") {
    return {
      label: "Ledger недоступен",
      className: "border-border bg-muted text-foreground",
      detail: "Факт показан по талонам; проверка проводок временно недоступна.",
    };
  }
  return {
    label: "Рейсов пока нет",
    className: "border-border bg-background text-muted-foreground",
    detail: "В этом сезоне нет завершённых неаннулированных талонов.",
  };
}

function selectedAllocation(
  data: FieldHarvestProjection,
  allocationId?: string | null
): FieldHarvestAllocationProjection | null {
  if (!allocationId) return null;
  return data.byAllocation.find((row) => row.allocationId === allocationId) || null;
}

export function FieldHarvestLive({
  companyId,
  seasonId,
  fieldId,
  allocationId,
  allocationLabel,
}: FieldHarvestLiveProps) {
  const key = scopeKey(companyId, seasonId, fieldId);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<LoadState>(() => ({
    phase: "idle",
    data: projectionCache.get(key) || null,
    error: null,
  }));

  useEffect(() => {
    const cached = projectionCache.get(key) || null;
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FIELD_HARVEST_TIMEOUT_MS);

    setState({
      phase: cached ? "refreshing" : "loading",
      data: cached,
      error: null,
    });

    void (async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (sessionError || !token) throw new Error("Сессия истекла. Обновите страницу.");

        const params = new URLSearchParams({ companyId, seasonId, fieldId });
        const response = await fetch(`/api/crop-structure/field-harvest-summary?${params.toString()}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<FieldHarvestProjection> & {
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Не удалось обновить факт уборки");
        if (
          payload.companyId !== companyId ||
          payload.seasonId !== seasonId ||
          payload.fieldId !== fieldId
        ) {
          throw new Error("Контекст поля изменился во время загрузки");
        }
        if (!active) return;
        const next = payload as FieldHarvestProjection;
        projectionCache.set(key, next);
        setState({ phase: "ready", data: next, error: null });
      } catch (error) {
        if (!active) return;
        if (error instanceof DOMException && error.name === "AbortError" && !timedOut) return;
        const message = timedOut
          ? "Факт уборки не обновился за 12 секунд"
          : error instanceof Error
            ? error.message
            : "Не удалось обновить факт уборки";
        const retained = projectionCache.get(key) || cached;
        setState({
          phase: retained ? "stale" : "error",
          data: retained,
          error: message,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [companyId, fieldId, key, revision, seasonId]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const intervalId = window.setInterval(refresh, FIELD_HARVEST_REFRESH_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [key]);

  const data = state.data &&
    state.data.companyId === companyId &&
    state.data.seasonId === seasonId &&
    state.data.fieldId === fieldId
    ? state.data
    : null;
  const allocation = data ? selectedAllocation(data, allocationId) : null;

  if (!data && (state.phase === "loading" || state.data !== null)) {
    return (
      <section
        className="min-h-[88px] rounded-lg border border-border bg-background p-2.5"
        aria-busy="true"
        aria-label="Загрузка факта уборки"
      >
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="h-12 animate-pulse rounded-md bg-muted/70" />
          <div className="h-12 animate-pulse rounded-md bg-muted/70" />
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section
        className="flex min-h-[88px] items-center justify-between gap-4 rounded-lg border border-rose-400/30 bg-rose-400/5 p-3"
        role="status"
      >
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-800" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-foreground">Факт уборки пока недоступен</div>
            <div className="mt-1 text-xs text-muted-foreground">{state.error}</div>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
          Повторить
        </Button>
      </section>
    );
  }

  const reconciliation = reconciliationCopy(data.reconciliationStatus);
  const refreshing = state.phase === "refreshing";
  const stale = state.phase === "stale";
  const areaBasis = data.yieldBasis === "season_structure_area"
    ? "по площади структуры сезона"
    : data.yieldBasis === "field_area"
      ? "по площади поля"
      : "площадь не задана";

  return (
    <section
      className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.035] px-3 py-2.5"
      aria-live="polite"
      aria-busy={refreshing}
      data-testid="field-harvest-live"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-xs font-semibold text-foreground">Live-факт уборки</div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${reconciliation.className}`}>
            {reconciliation.label}
          </span>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setRevision((value) => value + 1)}
            aria-label="Обновить факт уборки"
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 divide-x divide-border border-y border-border">
        <div className="flex min-w-0 items-center gap-2 py-2 pr-2">
          <Scale className="h-3.5 w-3.5 shrink-0 text-emerald-800" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Принято по полю</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{formatMass(data.acceptedMassKg)}</div>
            <div className="text-[11px] text-muted-foreground">{data.finalizedTicketCount} завершённых рейсов</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2 py-2 pl-3">
          <Sprout className="h-3.5 w-3.5 shrink-0 text-amber-800" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Урожайность</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{formatYield(data.yieldTPerHa)}</div>
            <div className="text-[11px] text-muted-foreground">{areaBasis} · {data.yieldAreaHa.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га</div>
          </div>
        </div>
      </div>

      {allocation ? (
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{allocationLabel || "Выбранный участок"}:</span>{" "}
          {formatMass(allocation.acceptedMassKg)} · {formatYield(allocation.yieldTPerHa)} · {allocation.finalizedTicketCount} рейсов
        </div>
      ) : null}
      <div className={`mt-2 text-[11px] ${stale ? "text-amber-800" : "text-muted-foreground"}`}>
        {stale ? `${state.error}. Показаны последние подтверждённые данные.` : reconciliation.detail}
        {data.unassignedAcceptedMassKg > 0
          ? ` ${formatMass(data.unassignedAcceptedMassKg)} не привязано к участку структуры.`
          : ""}
      </div>
    </section>
  );
}
