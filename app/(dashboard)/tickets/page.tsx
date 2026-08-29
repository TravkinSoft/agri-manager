"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

function paperDocumentNo(ticket: WeighbridgeTicket): string {
  return String(ticket.external_document_no || "").trim();
}

function ticketDayAt(ticket: WeighbridgeTicket): string | null | undefined {
  return paperDocumentNo(ticket) ? ticket.created_at : (ticket.finalized_at || ticket.updated_at);
}

export default function TicketsPage() {
  const { profile } = useAuth();
  const [tickets, setTickets] = useState<WeighbridgeTicket[]>([]);
  const [mode, setMode] = useState<ViewMode>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ticketId, setTicketId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.company_id) return;
    try {
      setTickets(await listTickets(profile.company_id));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить талоны");
    } finally {
      setLoading(false);
    }
  }, [profile?.company_id]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({ enabled: Boolean(profile?.company_id), companyId: profile?.company_id, tables: LIVE_REFRESH_TABLES.weighbridge, intervalMs: 15_000, onRefresh: load });

  const rows = useMemo(() => {
    const harvest = tickets.filter((ticket) => ticket.op_type === "harvest_incoming");
    if (mode === "open") return harvest.filter(isOpenHarvestTicket);
    if (mode === "today") {
      const today = dateKey(new Date());
      return harvest.filter((ticket) => {
        const eventAt = ticketDayAt(ticket);
        return isEffectiveFinalizedHarvestTicket(ticket) && eventAt != null && dateKey(eventAt) === today;
      });
    }
    return harvest;
  }, [mode, tickets]);

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
            const moisturePercent = ticket.lines?.[0]?.moisture_percent;
            const paperNo = paperDocumentNo(ticket);
            return (
              <Card key={ticket.id} className="min-w-0 rounded-lg">
                <CardContent className="p-0">
                  <button type="button" onClick={() => setTicketId(ticket.id)} className="block w-full min-w-0 p-3 text-left hover:bg-slate-800/40">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-base font-semibold text-slate-100">{ticket.field_name_snapshot || "Поле не указано"}</span>
                      <span className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{statusLabel(ticket)}</span>
                    </div>
                    <div className="mt-2 min-w-0 text-sm text-slate-300">
                      <div className="truncate font-medium">{identity.crop}</div>
                      <div className="truncate text-xs text-slate-500">
                        Сорт: {identity.variety || "не указан"} · Репродукция: {identity.reproduction || "не указана"}
                      </div>
                    </div>
                    {moisturePercent != null && Number.isFinite(Number(moisturePercent)) ? (
                      <div className="mt-2 text-xs text-sky-200">
                        Влажность: <span className="font-semibold">{Number(moisturePercent).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%</span>
                      </div>
                    ) : null}
                    {paperNo ? (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-amber-200">
                        <span>Бумажный № <span className="font-semibold">{paperNo}</span></span>
                        <span>Тара: <span className="font-semibold">{kg(ticket.tare_weight_kg)}</span></span>
                      </div>
                    ) : null}
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[10px] text-slate-600">№ {ticket.ticket_no}</div>
                        <div className="text-xs text-slate-500">
                          {paperNo ? "Дата рейса: " : ""}{dateTime(paperNo ? ticket.created_at : (finalized ? ticket.finalized_at : ticket.created_at))}
                        </div>
                      </div>
                      <span className="text-base font-semibold text-[#E0B100]">{kg(finalized ? ticket.net_weight_kg : ticket.gross_weight_kg)}</span>
                    </div>
                  </button>
                </CardContent>
              </Card>
            );
          })}
          {!rows.length ? <div className="py-16 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">В этом разделе талонов нет</div> : null}
        </div>
      )}
      <TicketPreviewDialog ticketId={ticketId} open={Boolean(ticketId)} onOpenChange={(open) => !open && setTicketId(null)} />
    </div>
  );
}
