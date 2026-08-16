"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, FileCheck2, History, Loader2, Scale } from "lucide-react";
import { TicketPreviewDialog } from "@/components/weighbridge/ticket-preview-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/contexts/auth-context";
import { dateKey, isEffectiveFinalizedHarvestTicket, isOpenHarvestTicket, ticketIdentity } from "@/lib/dashboard/harvest-summary";
import { listTickets } from "@/lib/services/weighbridge";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";
import { LIVE_REFRESH_TABLES, useLiveRefresh } from "@/hooks/use-live-refresh";

type ViewMode = "open" | "today" | "history";

type TicketsByMode = Record<ViewMode, WeighbridgeTicket[] | null>;

const EMPTY_TICKETS_BY_MODE: TicketsByMode = {
  open: null,
  today: null,
  history: null,
};

const ticketsPageCache = new Map<string, TicketsByMode>();

function kg(value: number | null | undefined): string {
  return `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(ticket: WeighbridgeTicket): string {
  if (ticket.is_voided || ticket.status === "voided") return ticket.replacement_ticket_id ? "Исправлен" : "Аннулирован";
  if (isEffectiveFinalizedHarvestTicket(ticket)) return "Завершён";
  if (isOpenHarvestTicket(ticket)) return "Открыт";
  return String(ticket.status || "");
}

export default function TicketsPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id || "";
  const [ticketsByMode, setTicketsByMode] = useState<TicketsByMode>(() =>
    companyId ? ticketsPageCache.get(companyId) || EMPTY_TICKETS_BY_MODE : EMPTY_TICKETS_BY_MODE
  );
  const [mode, setMode] = useState<ViewMode>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ticketId, setTicketId] = useState<string | null>(null);
  const tickets = ticketsByMode[mode] || [];
  const selectedTicket = tickets.find((ticket) => ticket.id === ticketId) || null;

  const load = useCallback(async (fresh = false, signal?: AbortSignal) => {
    if (!profile?.company_id) return;
    try {
      const from = mode === "today"
        ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        : undefined;
      const next = await listTickets(profile.company_id, undefined, {
        view: mode,
        from,
        limit: mode === "history" ? 60 : 100,
        fresh,
        signal,
      });
      setTicketsByMode((current) => {
        const updated = { ...current, [mode]: next };
        ticketsPageCache.set(profile.company_id as string, updated);
        return updated;
      });
      setError("");
    } catch (reason) {
      if (
        signal?.aborted
        || (reason instanceof DOMException && reason.name === "AbortError")
        || (reason instanceof Error && /abort(?:ed)?/i.test(reason.message))
      ) return;
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить талоны");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [mode, profile?.company_id]);

  useEffect(() => {
    const controller = new AbortController();
    const cached = companyId ? ticketsPageCache.get(companyId) : null;
    if (cached) setTicketsByMode(cached);
    setLoading((cached?.[mode] ?? ticketsByMode[mode]) === null);
    void load(false, controller.signal);
    return () => controller.abort();
    // Loading the selected mode is intentionally independent from background cache updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, companyId]);
  useLiveRefresh({
    enabled: Boolean(profile?.company_id) && mode !== "history",
    companyId: profile?.company_id,
    tables: LIVE_REFRESH_TABLES.weighbridge,
    intervalMs: 15_000,
    onRefresh: () => load(true),
  });

  const rows = tickets.filter((ticket) => {
    if (ticket.op_type !== "harvest_incoming") return false;
    if (mode === "open") return isOpenHarvestTicket(ticket);
    if (mode === "today") {
      return isEffectiveFinalizedHarvestTicket(ticket) && dateKey(ticket.finalized_at || ticket.updated_at) === dateKey(new Date());
    }
    return true;
  });

  const modes: Array<{ id: ViewMode; label: string; icon: typeof Scale }> = [
    { id: "open", label: "Открытые", icon: Clock3 },
    { id: "today", label: "Сегодня завершены", icon: FileCheck2 },
    { id: "history", label: "История", icon: History },
  ];

  return (
    <div className="mx-auto w-full max-w-[1350px] space-y-4 overflow-x-hidden">
      <div><h1 className="text-2xl font-semibold text-slate-100 sm:text-3xl">Талоны</h1><p className="mt-1 text-sm text-slate-400">Просмотр документов весовой</p></div>
      <div className="travkin-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40 p-1" role="tablist">
        {modes.map(({ id, label, icon: Icon }) => <Button key={id} type="button" size="sm" variant={mode === id ? "default" : "ghost"} className="h-9 shrink-0" onClick={() => setMode(id)}><Icon className="mr-2 h-4 w-4" />{label}</Button>)}
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div> : null}
      {loading ? <div className="flex min-h-48 items-center justify-center text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Загрузка талонов...</div> : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((ticket) => {
            const identity = ticketIdentity(ticket);
            const finalized = isEffectiveFinalizedHarvestTicket(ticket);
            return (
              <Card key={ticket.id} className="min-w-0 rounded-lg">
                <CardContent className="p-0">
                  <button type="button" onClick={() => setTicketId(ticket.id)} className="block w-full min-w-0 p-3 text-left hover:bg-slate-800/40">
                    <div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-100">{ticket.ticket_no}</span><span className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{statusLabel(ticket)}</span></div>
                    <div className="mt-2 truncate text-sm text-slate-300">{ticket.field_name_snapshot || "Поле не указано"}</div>
                    <div className="truncate text-xs text-slate-500">{identity.label}</div>
                    <div className="mt-3 flex items-end justify-between gap-2"><span className="text-xs text-slate-500">{dateTime(finalized ? ticket.finalized_at : ticket.created_at)}</span><span className="text-base font-semibold text-[#E0B100]">{kg(finalized ? ticket.net_weight_kg : ticket.gross_weight_kg)}</span></div>
                  </button>
                </CardContent>
              </Card>
            );
          })}
          {!rows.length ? <div className="py-16 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">В этом разделе талонов нет</div> : null}
        </div>
      )}
      <TicketPreviewDialog ticketId={ticketId} initialTicket={selectedTicket} open={Boolean(ticketId)} onOpenChange={(open) => !open && setTicketId(null)} />
    </div>
  );
}
