import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const glassBase =
  "tf-manor-panel border-border bg-card/90 shadow-manor-sm backdrop-blur-sm";

function GlassPanel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(glassBase, "rounded-lg", className)} {...props} />;
}

function GlassToolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(glassBase, "rounded-lg px-3 py-3", className)} {...props} />;
}

function GlassSidebar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <aside className={cn(glassBase, "rounded-lg p-3", className)} {...props} />;
}

function GlassCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-card/80 shadow-manor-sm", className)} {...props} />;
}

const statusToneClasses = {
  neutral: "border-border bg-muted text-foreground",
  success: "border-emerald-700/25 bg-emerald-50 text-emerald-900",
  warning: "border-amber-700/25 bg-amber-50 text-amber-900",
  danger: "border-red-700/25 bg-red-50 text-red-900",
  accent: "border-border bg-accent/65 text-foreground",
  muted: "border-border bg-secondary text-muted-foreground",
} as const;

type StatusTone = keyof typeof statusToneClasses;

function StatusPill({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
        statusToneClasses[tone],
        className
      )}
      {...props}
    />
  );
}

function CompactStat({
  label,
  value,
  Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  Icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border/70 bg-muted/65 px-3 py-2", className)}>
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5 text-primary" /> : null}
        {label}
      </div>
      <div className="tf-manor-data mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function EntityListItem({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "tf-manor-control w-full rounded-lg border border-border bg-card px-3 py-3 text-left text-foreground shadow-manor-sm hover:border-input hover:bg-accent/45",
        className
      )}
      {...props}
    />
  );
}

function EmptyState({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-muted/45 px-4 py-6 text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export { CompactStat, EmptyState, EntityListItem, GlassCard, GlassPanel, GlassSidebar, GlassToolbar, StatusPill };
