import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const glassBase =
  "border border-white/10 bg-[#111827]/72 shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl";

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
  return <div className={cn("rounded-lg border border-white/10 bg-white/[0.035] backdrop-blur-md", className)} {...props} />;
}

const statusToneClasses = {
  neutral: "border-white/10 bg-white/8 text-[#D7DEEA]",
  success: "border-emerald-300/20 bg-emerald-400/12 text-emerald-200",
  warning: "border-amber-300/25 bg-amber-400/12 text-amber-100",
  danger: "border-red-300/25 bg-red-400/12 text-red-200",
  accent: "border-[#E0B100]/35 bg-[#E0B100]/14 text-[#FDE68A]",
  muted: "border-slate-400/15 bg-slate-400/10 text-slate-300",
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
    <div className={cn("rounded-lg bg-white/[0.045] px-3 py-2", className)}>
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase text-[#93A4B8]">
        {Icon ? <Icon className="h-3.5 w-3.5 text-[#E0B100]" /> : null}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[#F8FAFC]">{value}</div>
    </div>
  );
}

function EntityListItem({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "w-full rounded-lg border border-white/8 bg-white/[0.035] px-3 py-3 text-left transition hover:border-white/18 hover:bg-white/[0.055]",
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
        "rounded-lg border border-dashed border-white/12 bg-white/[0.025] px-4 py-6 text-sm text-[#93A4B8]",
        className
      )}
      {...props}
    />
  );
}

export { CompactStat, EmptyState, EntityListItem, GlassCard, GlassPanel, GlassSidebar, GlassToolbar, StatusPill };
