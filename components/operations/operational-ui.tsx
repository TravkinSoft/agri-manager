import type { ReactNode } from "react";
import {
  ArrowRight,
  Boxes,
  Factory,
  Gauge,
  MapPinned,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeStoragePlaceType, type StoragePlaceType } from "@/lib/warehouse/warehouse-scope";

export function OperationalSection({
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3 border-t border-slate-800/70 pt-4 first:border-t-0 first:pt-0", className)}>
      {title || eyebrow || action ? (
        <div className="flex min-w-0 items-end justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? <div className="text-[10px] font-semibold uppercase text-slate-500">{eyebrow}</div> : null}
            {title ? <h3 className="mt-0.5 truncate text-sm font-semibold text-slate-100">{title}</h3> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function CompactField({
  label,
  required = false,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="text-sm font-medium text-slate-200">
        {label}{required ? <span className="text-amber-300"> *</span> : null}
      </div>
      {children}
      {error ? <div className="text-xs text-rose-300" role="alert">{error}</div> : null}
    </div>
  );
}

export function PrimaryActionBar({
  children,
  hint,
  sticky = false,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(
      "border-t border-slate-800/80 bg-[#101724]/95 pt-3",
      sticky && "sticky bottom-0 z-10 -mx-4 px-4 backdrop-blur",
      className
    )}>
      {children}
      {hint ? <div className="mt-1 text-xs text-amber-300">{hint}</div> : null}
    </div>
  );
}

export function RouteSelector({
  source,
  destination,
  sourceLabel = "Откуда",
  destinationLabel = "Куда",
  className,
}: {
  source: ReactNode;
  destination: ReactNode;
  sourceLabel?: string;
  destinationLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("grid items-end gap-2 md:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)]", className)}>
      <div className="min-w-0 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase text-slate-500">{sourceLabel}</div>
        {source}
      </div>
      <div className="hidden h-9 items-center justify-center text-yellow-400 md:flex" aria-hidden="true">
        <ArrowRight className="h-4 w-4" />
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase text-slate-500">{destinationLabel}</div>
        {destination}
      </div>
    </div>
  );
}

const placeVisual = (type: StoragePlaceType) => {
  if (type === "DRYER") return { Icon: Gauge, accent: "text-orange-300", surface: "bg-orange-400/10", line: "border-orange-400/20" };
  if (type === "CLEANER") return { Icon: Factory, accent: "text-sky-300", surface: "bg-sky-400/10", line: "border-sky-400/20" };
  if (type === "YARD") return { Icon: MapPinned, accent: "text-emerald-300", surface: "bg-emerald-400/10", line: "border-emerald-400/20" };
  return { Icon: WarehouseIcon, accent: "text-yellow-300", surface: "bg-yellow-400/10", line: "border-yellow-400/20" };
};

export function ObjectVisual({ placeType, className }: { placeType: unknown; className?: string }) {
  const normalized = normalizeStoragePlaceType(placeType);
  const { Icon, accent, surface, line } = placeVisual(normalized);
  return (
    <div
      className={cn("relative flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border", surface, line, className)}
      aria-hidden="true"
    >
      <Icon className={cn("relative z-10 h-7 w-7", accent)} strokeWidth={1.6} />
      <div className="absolute inset-x-2 bottom-2 h-px bg-current opacity-20" />
    </div>
  );
}

export function MetricStrip({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode; emphasis?: "default" | "success" | "warning" }>;
  className?: string;
}) {
  return (
    <dl className={cn("grid divide-x divide-slate-800/80 overflow-hidden rounded-md bg-slate-950/45", className)} style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-3 py-2">
          <dt className="truncate text-[10px] uppercase text-slate-500" title={item.label}>{item.label}</dt>
          <dd className={cn(
            "mt-0.5 truncate text-sm font-semibold text-slate-100",
            item.emphasis === "success" && "text-emerald-300",
            item.emphasis === "warning" && "text-amber-300"
          )}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusBadge({ status, children }: { status: "active" | "empty" | "warning" | "closed"; children: ReactNode }) {
  return (
    <span className={cn(
      "inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-semibold",
      status === "active" && "border-sky-500/30 bg-sky-500/10 text-sky-200",
      status === "empty" && "border-slate-700 bg-slate-900 text-slate-300",
      status === "warning" && "border-amber-500/35 bg-amber-500/10 text-amber-200",
      status === "closed" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    )}>{children}</span>
  );
}

export function EmptyState({ title = "Сейчас пусто", detail }: { title?: string; detail?: string }) {
  return (
    <div className="flex min-h-20 items-center gap-3 py-3 text-left">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-slate-500"><Boxes className="h-4 w-4" /></div>
      <div>
        <div className="text-sm font-medium text-slate-200">{title}</div>
        {detail ? <div className="mt-0.5 text-xs text-slate-500">{detail}</div> : null}
      </div>
    </div>
  );
}

export function BalanceSummary({
  inputKg,
  outputKg,
  lossesKg,
  differenceKg,
}: {
  inputKg: number;
  outputKg: number;
  lossesKg: number;
  differenceKg: number;
}) {
  const format = (value: number) => `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
  const balanced = Math.abs(differenceKg) < 0.001;
  return (
    <div className="space-y-2 rounded-md bg-slate-950/55 p-3">
      <MetricStrip items={[
        { label: "Вход", value: format(inputKg) },
        { label: "Выход", value: format(outputKg) },
        { label: "Потери", value: format(lossesKg) },
      ]} />
      <div className={cn("flex items-center justify-between border-t pt-2 text-sm font-semibold", balanced ? "border-emerald-500/20 text-emerald-300" : "border-amber-500/20 text-amber-300")}>
        <span>{balanced ? "Баланс сходится" : "Осталось распределить"}</span>
        <span>{format(differenceKg)}</span>
      </div>
    </div>
  );
}
