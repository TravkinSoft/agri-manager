"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { cn } from "@/lib/utils";

type HealthPayload = {
  status: "healthy" | "attention";
  warningCount: number;
  checks: Array<{ key: string; label: string; status: "pass" | "warning" | "unavailable"; value: number | string | null; detail?: string }>;
  readiness: Array<{ key: string; label: string; status: "ready" | "missing" | "needs_review"; count: number; blocker: boolean }>;
  readinessSummary: { ready: number; missing: number; needsReview: number; blockers: string[] };
};

export function SystemHealthBadge({ collapsed }: { collapsed: boolean }) {
  const [payload, setPayload] = useState<HealthPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const headers = await buildClientAuthHeaders("none");
      const response = await fetch("/api/operations-health", { cache: "no-store", credentials: "include", headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Health check failed");
      setPayload(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Health check failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 1800);
    return () => window.clearTimeout(timer);
  }, []);

  const healthy = payload?.status === "healthy";
  const Icon = loading ? Loader2 : error || !healthy ? AlertTriangle : CheckCircle2;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" title="Состояние системы" className={cn("mx-3 mb-2 flex h-9 items-center rounded-md border px-2 text-xs", collapsed ? "justify-center" : "gap-2", error || payload?.warningCount ? "border-amber-500/35 bg-amber-500/10 text-amber-200" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200")}>
          <Icon className={cn("h-4 w-4 shrink-0", loading && "animate-spin")} />
          {!collapsed ? <span className="truncate">{loading ? "Проверка системы" : error ? "Health недоступен" : healthy ? "Система · всё работает" : `Требует внимания: ${payload?.warningCount || 0}`}</span> : null}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto border-slate-700 bg-[#111827] text-slate-100">
        <DialogHeader><DialogTitle>Состояние и готовность</DialogTitle><DialogDescription>Read-only диагностика. Автоматическое исправление отключено.</DialogDescription></DialogHeader>
        {error ? <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"><p>{error}</p><button type="button" className="mt-2 underline" onClick={() => void load()}>Повторить</button></div> : null}
        {payload ? <>
          <section><h3 className="mb-2 text-sm font-semibold">Система</h3><div className="grid gap-2 sm:grid-cols-2">{payload.checks.map((check) => <div key={check.key} className="flex items-start justify-between gap-3 border-b border-slate-800 py-2 text-sm"><span><b className="block font-medium">{check.label}</b>{check.detail ? <span className="block text-xs text-slate-500">{check.detail}</span> : null}</span><span className={check.status === "pass" ? "text-emerald-300" : check.status === "warning" ? "text-amber-300" : "text-slate-500"}>{check.value ?? "N/A"}</span></div>)}</div></section>
          <section><h3 className="mb-2 mt-4 text-sm font-semibold">Готовность Астык-STEM</h3><div className="grid gap-2 sm:grid-cols-2">{payload.readiness.map((item) => <div key={item.key} className="flex items-center justify-between border-b border-slate-800 py-2 text-sm"><span>{item.label}</span><span className={item.status === "ready" ? "text-emerald-300" : item.status === "missing" ? "text-red-300" : "text-amber-300"}>{item.status === "ready" ? "READY" : item.status === "missing" ? "MISSING" : "NEEDS REVIEW"} · {item.count}</span></div>)}</div>{payload.readinessSummary.blockers.length ? <p className="mt-3 text-sm text-red-300">Блокеры: {payload.readinessSummary.blockers.join(", ")}</p> : null}</section>
        </> : null}
      </DialogContent>
    </Dialog>
  );
}
