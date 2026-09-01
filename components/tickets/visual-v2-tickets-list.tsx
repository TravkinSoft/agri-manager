"use client";

import { Clock3, FileCheck2, History, Loader2, Scale } from "lucide-react";
import { MatteSurface } from "@/components/ui/matte-surface";
import { cn } from "@/lib/utils";

export type VisualTicketsMode = "open" | "today" | "history";

export type VisualV2TicketRow = {
  id: string;
  fieldName: string;
  status: string;
  statusTone: "danger" | "success" | "warning";
  crop: string;
  variety: string;
  reproduction: string;
  moisture: string | null;
  paperNo: string | null;
  tareWeight: string | null;
  ticketNo: string;
  dateLabel: string;
  weight: string;
};

type VisualV2TicketsListProps = {
  mode: VisualTicketsMode;
  rows: VisualV2TicketRow[];
  loading: boolean;
  error: string;
  onModeChange: (mode: VisualTicketsMode) => void;
  onOpenTicket: (ticketId: string) => void;
};

const TABS: Array<{ id: VisualTicketsMode; label: string; shortLabel: string; icon: typeof Scale }> = [
  { id: "open", label: "Открытые талоны", shortLabel: "Открытые", icon: Clock3 },
  { id: "today", label: "Сегодня завершены", shortLabel: "Сегодня", icon: FileCheck2 },
  { id: "history", label: "История талонов", shortLabel: "История", icon: History },
];

const STATUS_CLASS: Record<VisualV2TicketRow["statusTone"], string> = {
  danger: "text-[color:var(--tf-status-danger)]",
  success: "text-[color:var(--tf-status-success)]",
  warning: "text-[color:var(--tf-status-warning)]",
};

export function VisualV2TicketsList({ mode, rows, loading, error, onModeChange, onOpenTicket }: VisualV2TicketsListProps) {
  const activeTab = TABS.find((tab) => tab.id === mode) || TABS[0];

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-4 overflow-x-hidden">
      <header className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--tf-accent-primary)]">Документы уборочной</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--tf-text-primary)] sm:text-3xl">Талоны</h1>
        <p className="mt-1 text-sm text-[color:var(--tf-text-secondary)]">Быстрый просмотр открытых, завершённых и исторических документов</p>
      </header>

      <MatteSurface as="section" surface="work-raised" aria-label="Разделы талонов" className="p-1.5">
        <div className="grid grid-cols-3 gap-1" role="tablist" aria-label="Состояние талонов">
          {TABS.map(({ id, label, shortLabel, icon: Icon }) => {
            const active = id === mode;
            return (
              <button
                key={id}
                id={`tickets-v2-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="tickets-v2-panel"
                onClick={() => onModeChange(id)}
                className={cn(
                  "tf-focus-ring tf-motion flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-[var(--tf-radius-control)] px-2 py-2 text-xs font-semibold sm:text-sm",
                  active ? "bg-[var(--tf-accent-soft)] text-[color:var(--tf-accent-primary)]" : "text-[color:var(--tf-text-muted)] hover:bg-[var(--tf-surface-work)] hover:text-[color:var(--tf-text-primary)]"
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="truncate sm:hidden">{shortLabel}</span>
                <span className="hidden truncate sm:inline">{label}</span>
              </button>
            );
          })}
        </div>
      </MatteSurface>

      {error ? <div role="alert" className="rounded-[var(--tf-radius-control)] border border-[color:var(--tf-status-danger)] bg-[var(--tf-surface-work)] px-3 py-2 text-sm text-[color:var(--tf-status-danger)]">{error}</div> : null}

      <section id="tickets-v2-panel" role="tabpanel" aria-labelledby={`tickets-v2-tab-${activeTab.id}`} aria-busy={loading}>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-[color:var(--tf-text-muted)]"><Loader2 aria-hidden="true" className="mr-2 h-5 w-5 animate-spin" />Загрузка талонов...</div>
        ) : (
          <ul className="space-y-2" aria-label={activeTab.label}>
            {rows.map((ticket) => (
              <li key={ticket.id} className="tf-work-surface overflow-hidden">
                <button type="button" onClick={() => onOpenTicket(ticket.id)} className="tf-focus-ring tf-motion grid min-h-12 w-full min-w-0 gap-3 p-3 text-left hover:bg-[var(--tf-surface-work-raised)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4">
                  <span className="min-w-0">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words text-base font-semibold text-[color:var(--tf-text-primary)]">{ticket.fieldName}</span>
                      <span className={cn("text-xs font-semibold", STATUS_CLASS[ticket.statusTone])}>{ticket.status}</span>
                    </span>
                    <span className="mt-1 block break-words text-sm font-medium text-[color:var(--tf-text-secondary)]">{ticket.crop}</span>
                    <span className="mt-0.5 block break-words text-xs text-[color:var(--tf-text-muted)]">Сорт: {ticket.variety} · Репродукция: {ticket.reproduction}</span>
                    <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--tf-text-muted)]">
                      <span>№ {ticket.ticketNo}</span>
                      <span>{ticket.dateLabel}</span>
                      {ticket.moisture ? <span>Влажность: {ticket.moisture}</span> : null}
                      {ticket.paperNo ? <span>Бумажный № {ticket.paperNo}</span> : null}
                      {ticket.tareWeight ? <span>Тара: {ticket.tareWeight}</span> : null}
                    </span>
                  </span>
                  <span className="tf-tabular whitespace-nowrap text-lg font-semibold text-[color:var(--tf-accent-primary)] sm:text-right">{ticket.weight}</span>
                </button>
              </li>
            ))}
            {rows.length === 0 ? <li className="tf-work-surface py-16 text-center text-sm text-[color:var(--tf-text-muted)]">В этом разделе талонов нет</li> : null}
          </ul>
        )}
      </section>
    </div>
  );
}
