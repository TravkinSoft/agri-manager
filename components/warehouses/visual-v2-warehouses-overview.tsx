"use client";

import { Boxes, Loader2, Search, Warehouse as WarehouseIcon } from "lucide-react";
import { MatteSurface } from "@/components/ui/matte-surface";
import { cn } from "@/lib/utils";

export type VisualV2WarehouseRow = {
  id: string;
  name: string;
  typeLabel: string;
  statusLabel: string;
  statusTone: "active" | "empty" | "working";
  summaryLoaded: boolean;
  totalMass: string | null;
  harvestMass: string | null;
  seedMass: string | null;
  otherMaterialMass: string | null;
  positionCount: number;
  lastMovement: string;
  capacity: {
    label: string;
    percent: number;
    exceeded: boolean;
  } | null;
};

type VisualV2WarehousesOverviewProps = {
  rows: VisualV2WarehouseRow[];
  loading: boolean;
  error: string | null;
  search: string;
  searchLoading: boolean;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenWarehouse: (warehouseId: string) => void;
};

const STATUS_CLASS: Record<VisualV2WarehouseRow["statusTone"], string> = {
  active: "text-[color:var(--tf-accent-primary)]",
  empty: "text-[color:var(--tf-text-muted)]",
  working: "text-[color:var(--tf-status-success)]",
};

type MetricProps = {
  label: string;
  value: string | number;
  emphasis?: boolean;
};

function Metric({ label, value, emphasis = false }: MetricProps) {
  return (
    <span className="min-w-0">
      <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--tf-text-muted)]">{label}</span>
      <span className={cn("tf-tabular mt-1 block truncate text-sm font-semibold text-[color:var(--tf-text-secondary)]", emphasis ? "text-[color:var(--tf-status-success)]" : null)}>{value}</span>
    </span>
  );
}

export function VisualV2WarehousesOverview({
  rows,
  loading,
  error,
  search,
  searchLoading,
  onSearchChange,
  onSearchSubmit,
  onOpenWarehouse,
}: VisualV2WarehousesOverviewProps) {
  const hasQuery = search.trim().length > 0;

  return (
    <div data-visual-pilot="warehouses-overview" data-role-scope="agronomist" className="mx-auto w-full max-w-[1120px] space-y-4 overflow-x-hidden">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--tf-accent-primary)]">Складские остатки</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--tf-text-primary)] sm:text-3xl">Склады</h1>
          <p className="mt-1 text-sm text-[color:var(--tf-text-secondary)]">Объекты хранения, текущие остатки и последнее движение</p>
        </div>
        <span className="rounded-full border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] px-3 py-1 text-xs font-semibold text-[color:var(--tf-text-secondary)]">Только просмотр</span>
      </header>

      <form
        role="search"
        aria-label="Поиск по складам и остаткам"
        className="max-w-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <MatteSurface surface="input" className="flex min-h-11 items-center gap-2 px-3">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--tf-text-muted)]" />
          <input
            aria-label="Найти склад, материал, культуру, поле или партию"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Найти склад, материал, культуру, поле или партию"
            className="tf-focus-ring min-w-0 flex-1 bg-transparent py-2 text-sm text-[color:var(--tf-text-primary)] outline-none placeholder:text-[color:var(--tf-text-muted)]"
          />
          {searchLoading ? <Loader2 aria-label="Идёт поиск" className="h-4 w-4 shrink-0 animate-spin text-[color:var(--tf-accent-primary)]" /> : null}
        </MatteSurface>
      </form>

      {searchLoading ? <p className="text-xs text-[color:var(--tf-text-muted)]" role="status">Ищем по остаткам и партиям...</p> : null}
      {error ? <div role="alert" className="rounded-[var(--tf-radius-control)] border border-[color:var(--tf-status-danger)] bg-[var(--tf-surface-work)] px-3 py-2 text-sm text-[color:var(--tf-status-danger)]">{error}</div> : null}

      <section aria-label="Активные склады" aria-busy={loading}>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-[color:var(--tf-text-muted)]"><Loader2 aria-hidden="true" className="mr-2 h-5 w-5 animate-spin" />Загрузка складов...</div>
        ) : rows.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((warehouse) => (
              <li key={warehouse.id} className="min-w-0">
                <button
                  type="button"
                  aria-label={`Открыть склад ${warehouse.name}`}
                  onClick={() => onOpenWarehouse(warehouse.id)}
                  className="tf-work-surface tf-focus-ring tf-motion h-full w-full min-w-0 p-4 text-left hover:bg-[var(--tf-surface-work-raised)]"
                >
                  <span className="flex min-w-0 items-start gap-3">
                    <span className="flex h-11 w-12 shrink-0 items-center justify-center rounded-[var(--tf-radius-control)] bg-[var(--tf-accent-soft)] text-[color:var(--tf-accent-primary)]">
                      <WarehouseIcon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-base font-semibold text-[color:var(--tf-text-primary)]">{warehouse.name}</span>
                          <span className="mt-0.5 block truncate text-xs text-[color:var(--tf-text-muted)]">{warehouse.typeLabel}</span>
                        </span>
                        <span className={cn("shrink-0 text-xs font-semibold", STATUS_CLASS[warehouse.statusTone])}>{warehouse.statusLabel}</span>
                      </span>
                    </span>
                  </span>

                  {!warehouse.summaryLoaded ? (
                    <span className="mt-4 block h-20 animate-pulse rounded-[var(--tf-radius-control)] bg-[var(--tf-surface-work-raised)]" />
                  ) : warehouse.totalMass ? (
                    <span className="mt-4 block space-y-3">
                      <span className="grid grid-cols-2 gap-3">
                        <Metric label="Всего" value={warehouse.totalMass} emphasis />
                        <Metric label="Групп остатков" value={warehouse.positionCount} />
                        {warehouse.harvestMass ? <Metric label="Урожай" value={warehouse.harvestMass} emphasis /> : null}
                        {warehouse.seedMass ? <Metric label="Семена" value={warehouse.seedMass} /> : null}
                        {warehouse.otherMaterialMass ? <Metric label="Другие материалы" value={warehouse.otherMaterialMass} /> : null}
                        <Metric label="Движение" value={warehouse.lastMovement} />
                      </span>
                      {warehouse.capacity ? (
                        <span className="block">
                          <span className="flex items-center justify-between gap-2 text-[11px] text-[color:var(--tf-text-muted)]">
                            <span className="truncate">{warehouse.capacity.label}</span>
                            <span className={warehouse.capacity.exceeded ? "font-semibold text-[color:var(--tf-status-danger)]" : "font-semibold text-[color:var(--tf-text-secondary)]"}>{warehouse.capacity.percent}%</span>
                          </span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--tf-surface-input)]" role="progressbar" aria-label="Заполнение склада" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, warehouse.capacity.percent)}>
                            <span className={cn("block h-full rounded-full", warehouse.capacity.exceeded ? "bg-[var(--tf-status-danger)]" : "bg-[var(--tf-accent-primary)]")} style={{ width: `${Math.min(100, warehouse.capacity.percent)}%` }} />
                          </span>
                          {warehouse.capacity.exceeded ? <span className="mt-1 block text-[11px] font-medium text-[color:var(--tf-status-danger)]">Остаток превышает указанную вместимость</span> : null}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="mt-4 flex min-h-20 items-center justify-center gap-2 rounded-[var(--tf-radius-control)] bg-[var(--tf-surface-work-raised)] px-3 text-sm text-[color:var(--tf-text-muted)]">
                      <Boxes aria-hidden="true" className="h-4 w-4" />Склад свободен · {warehouse.lastMovement}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="tf-work-surface py-16 text-center text-sm text-[color:var(--tf-text-muted)]">
            {hasQuery ? "По вашему запросу склады и остатки не найдены" : "Активные склады не найдены"}
          </div>
        )}
      </section>
    </div>
  );
}
