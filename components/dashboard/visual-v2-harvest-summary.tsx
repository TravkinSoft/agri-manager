"use client";

import { AlertTriangle, CalendarClock, ChevronDown, Clock3, Scale, Warehouse, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { MatteSurface } from "@/components/ui/matte-surface";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VisualSystemScope } from "@/components/ui/visual-system-scope";
import type {
  HarvestDashboardFilters,
  HarvestFilterOptions,
  HarvestOverview,
  HarvestParty,
  HarvestPartyTicket,
  HarvestPeriodPreset,
} from "@/lib/dashboard/harvest-summary";

const PERIODS: Array<{ value: HarvestPeriodPreset; label: string }> = [
  { value: "current_day", label: "Текущий операционный день" },
  { value: "previous_day", label: "Предыдущий операционный день" },
  { value: "current_shift", label: "Текущая смена" },
  { value: "last_24_hours", label: "Последние 24 часа" },
  { value: "season", label: "Весь сезон" },
  { value: "custom", label: "Свой период" },
];

type VisualV2HarvestSummaryProps = {
  period: HarvestPeriodPreset;
  customStart: string;
  customEnd: string;
  filters: HarvestDashboardFilters;
  options: HarvestFilterOptions;
  summary: HarvestOverview | null;
  filtersOpen: boolean;
  expandedParties: Record<string, boolean>;
  error: string;
  customReady: boolean;
  activeFilterCount: number;
  onPeriodChange: (value: HarvestPeriodPreset) => void;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
  onFiltersOpenChange: (open: boolean) => void;
  onFilterChange: (key: keyof HarvestDashboardFilters, value: string | null) => void;
  onResetFilters: () => void;
  onPartyOpenChange: (key: string, open: boolean) => void;
  onTicket: (id: string) => void;
};

function kg(value: number | null): string {
  return value == null ? "—" : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
}

function percent(value: number): string {
  return `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function time(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function pluralRu(value: number, one: string, few: string, many: string): string {
  const normalized = Math.abs(Math.trunc(value));
  if (normalized % 100 >= 11 && normalized % 100 <= 14) return many;
  if (normalized % 10 === 1) return one;
  if (normalized % 10 >= 2 && normalized % 10 <= 4) return few;
  return many;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value?: string | null; options: Array<{ id: string; label: string }>; onChange: (value: string | null) => void }) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs font-medium text-[color:var(--tf-text-secondary)]">{label}</label>
      <Select value={value || "all"} onValueChange={(next) => onChange(next === "all" ? null : next)}>
        <SelectTrigger className="tf-input-surface tf-focus-ring h-12 min-w-0 text-base text-[color:var(--tf-text-primary)] sm:h-10 sm:text-sm"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Все</SelectItem>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function TicketRow({ ticket, kind, onOpen }: { ticket: HarvestPartyTicket; kind: "open" | "completed"; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(ticket.ticketId)} className="tf-focus-ring tf-motion grid min-h-12 w-full min-w-0 gap-2 rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] px-3 py-2.5 text-left hover:border-[color:var(--tf-border-strong)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <span className="min-w-0"><span className="block break-words text-sm font-semibold text-[color:var(--tf-text-primary)]">{time(ticket.occurredAt)} · {ticket.fieldName} · {ticket.vehicleLabel}</span><span className="mt-0.5 block break-words text-xs text-[color:var(--tf-text-muted)]">{ticket.driverName} · {ticket.destinationName}</span></span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:justify-end"><b className="tf-tabular whitespace-nowrap text-sm text-[color:var(--tf-text-primary)]">{kind === "open" ? `Брутто ${kg(ticket.grossWeightKg)}` : `Нетто ${kg(ticket.netWeightKg)}`}</b><span className={kind === "open" ? "text-[color:var(--tf-status-warning)]" : "text-[color:var(--tf-status-success)]"}>{kind === "open" ? `Ждёт тару ${ticket.waitingTareMinutes} мин.` : ticket.statusLabel}</span>{ticket.moisturePercent != null ? <span className="text-[color:var(--tf-text-muted)]">Влажность {percent(ticket.moisturePercent)}</span> : null}</span>
    </button>
  );
}

function PartyCard({ party, open, onOpenChange, onTicket }: { party: HarvestParty; open: boolean; onOpenChange: (open: boolean) => void; onTicket: (id: string) => void }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <MatteSurface surface="work" className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button type="button" className="tf-focus-ring tf-motion grid min-h-12 w-full min-w-0 grid-cols-2 gap-3 p-4 text-left hover:bg-[var(--tf-surface-work-raised)] lg:grid-cols-[minmax(210px,1.15fr)_repeat(4,minmax(110px,0.65fr))_auto] lg:items-center">
            <span className="col-span-2 min-w-0 lg:col-span-1"><span className="block break-words text-base font-semibold text-[color:var(--tf-text-primary)]">{party.cropName}</span><span className="block break-words text-sm text-[color:var(--tf-text-secondary)]">{party.complete ? [party.varietyName, party.reproductionName].filter(Boolean).join(" · ") : "Требуется уточнение"}</span></span>
            <span><span className="block text-xs text-[color:var(--tf-text-muted)]">На складах сейчас</span><b className="tf-tabular block whitespace-nowrap text-base text-[color:var(--tf-text-primary)]">{kg(party.currentStockKg)}</b></span>
            <span><span className="block text-xs text-[color:var(--tf-text-muted)]">Принято за период</span><b className="tf-tabular block whitespace-nowrap text-base text-[color:var(--tf-accent-primary)]">{kg(party.receivedKg)}</b></span>
            <span><span className="block text-xs text-[color:var(--tf-text-muted)]">Открыто машин</span><b className="tf-tabular block text-base text-[color:var(--tf-text-primary)]">{party.openTicketCount}</b></span>
            <span><span className="block text-xs text-[color:var(--tf-text-muted)]">Завершено рейсов</span><b className="tf-tabular block text-base text-[color:var(--tf-text-primary)]">{party.completedTicketCount}</b></span>
            <span className="col-span-2 flex items-center justify-between gap-2 text-xs text-[color:var(--tf-text-muted)] lg:col-span-1 lg:justify-end">{party.lastTrip ? `Последний ${time(party.lastTrip.occurredAt)}` : "Рейсов нет"}<ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} /></span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-5 border-t border-[color:var(--tf-border-hairline)] p-4">
            {party.openTickets.length ? <section aria-labelledby={`party-${party.key}-open`}><h3 id={`party-${party.key}-open`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--tf-text-primary)]"><Clock3 aria-hidden="true" className="h-4 w-4 text-[color:var(--tf-status-warning)]" />Открытые талоны</h3><div className="space-y-2">{party.openTickets.map((ticket) => <TicketRow key={ticket.ticketId} ticket={ticket} kind="open" onOpen={onTicket} />)}</div></section> : null}
            <section aria-labelledby={`party-${party.key}-completed`}><h3 id={`party-${party.key}-completed`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--tf-text-primary)]"><Scale aria-hidden="true" className="h-4 w-4 text-[color:var(--tf-accent-primary)]" />Завершённые талоны за период</h3>{party.completedTickets.length ? <div className="space-y-2">{party.completedTickets.map((ticket) => <TicketRow key={ticket.ticketId} ticket={ticket} kind="completed" onOpen={onTicket} />)}</div> : <p className="text-sm text-[color:var(--tf-text-muted)]">За выбранный период завершённых рейсов нет.</p>}</section>
            <div className="grid gap-4 lg:grid-cols-2">
              <section><h3 className="mb-2 text-sm font-semibold text-[color:var(--tf-text-primary)]">Поступление с полей</h3>{party.fields.length ? <div className="space-y-2">{party.fields.map((field) => <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] p-3"><span className="min-w-0"><b className="block break-words text-sm text-[color:var(--tf-text-primary)]">{field.fieldName}</b><span className="block text-xs text-[color:var(--tf-text-muted)]">{field.trips} {pluralRu(field.trips, "завершённый рейс", "завершённых рейса", "завершённых рейсов")}</span><span className="block text-xs text-[color:var(--tf-text-muted)]">Последний: {kg(field.lastTripKg)} · {time(field.lastTripAt)}</span></span><b className="tf-tabular whitespace-nowrap text-sm text-[color:var(--tf-accent-primary)]">{kg(field.receivedKg)}</b></div>)}</div> : <p className="text-sm text-[color:var(--tf-text-muted)]">Поступления с полей за период нет.</p>}</section>
              <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--tf-text-primary)]"><Warehouse aria-hidden="true" className="h-4 w-4 text-[color:var(--tf-accent-primary)]" />Размещение на складах</h3>{party.warehouses.length ? <div className="space-y-2">{party.warehouses.map((warehouse) => <div key={`${warehouse.warehouseId}:${warehouse.warehouseName}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] p-3"><span className="break-words text-sm text-[color:var(--tf-text-secondary)]">{warehouse.warehouseName}</span><b className="tf-tabular whitespace-nowrap text-sm text-[color:var(--tf-text-primary)]">{kg(warehouse.currentKg)}</b></div>)}</div> : <p className="text-sm text-[color:var(--tf-text-muted)]">Фактического остатка на складах нет.</p>}</section>
            </div>
          </div>
        </CollapsibleContent>
      </MatteSurface>
    </Collapsible>
  );
}

export function VisualV2HarvestSummary(props: VisualV2HarvestSummaryProps) {
  const totalReceivedKg = props.summary?.cropTotals.reduce((total, crop) => total + crop.receivedKg, 0) || 0;
  const totalStockKg = props.summary?.parties.reduce((total, party) => total + party.currentStockKg, 0) || 0;

  return (
    <VisualSystemScope scope="dashboard">
      <div className="mx-auto w-full max-w-[1500px] space-y-4 overflow-x-hidden text-[color:var(--tf-text-primary)] sm:space-y-5">
        <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--tf-accent-primary)]">Оперативный центр</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Сводка хозяйства</h1><p className="mt-1 text-sm text-[color:var(--tf-text-secondary)]">Уборка, отклонения и фактические остатки в одном рабочем контексте</p></div>
          <span className="inline-flex min-h-10 items-center rounded-[var(--tf-radius-pill)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] px-3 text-xs font-medium text-[color:var(--tf-status-success)]"><span aria-hidden="true" className="mr-2 h-2 w-2 rounded-full bg-[var(--tf-status-success)]" />Данные обновляются</span>
        </header>

        <MatteSurface as="section" surface="chrome" aria-labelledby="dashboard-attention-title" className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium text-[color:var(--tf-text-muted)]">Сначала важное</p><h2 id="dashboard-attention-title" className="mt-0.5 text-lg font-semibold">Требует внимания</h2></div>{props.summary ? <span className="tf-tabular rounded-[var(--tf-radius-pill)] bg-[var(--tf-accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--tf-accent-bright)]">{props.summary.issues.length} сигналов</span> : null}</div>
          {!props.summary ? <div aria-label="Загрузка блока внимания" className="mt-4 h-16 animate-pulse rounded-[var(--tf-radius-control)] bg-[var(--tf-surface-work)]" /> : props.summary.issues.length ? <div className="mt-4 grid gap-2 lg:grid-cols-2">{props.summary.issues.slice(0, 4).map((issue) => issue.ticketId ? <button key={issue.key} type="button" onClick={() => props.onTicket(issue.ticketId!)} className="tf-focus-ring tf-motion flex min-h-12 items-start gap-3 rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] p-3 text-left hover:border-[color:var(--tf-border-strong)]"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--tf-status-warning)]" /><span><b className="block text-sm">{issue.title}</b><span className="mt-0.5 block text-xs text-[color:var(--tf-text-secondary)]">{issue.detail}</span></span></button> : <div key={issue.key} className="flex min-h-12 items-start gap-3 rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] p-3"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--tf-status-warning)]" /><span><b className="block text-sm">{issue.title}</b><span className="mt-0.5 block text-xs text-[color:var(--tf-text-secondary)]">{issue.detail}</span></span></div>)}</div> : <p className="mt-4 flex min-h-12 items-center rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] px-3 text-sm text-[color:var(--tf-status-success)]">Критичных отклонений нет</p>}
        </MatteSurface>

        <section aria-label="Ключевые показатели" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            ["Принято за период", props.summary ? kg(totalReceivedKg) : "—"],
            ["На складах сейчас", props.summary ? kg(totalStockKg) : "—"],
            ["Открыто машин", props.summary ? String(props.summary.openTicketCount) : "—"],
            ["Завершено рейсов", props.summary ? String(props.summary.completedTripCount) : "—"],
          ].map(([label, value]) => <MatteSurface key={label} className="min-w-0 p-3 sm:p-4"><span className="block text-xs text-[color:var(--tf-text-muted)]">{label}</span><b className="tf-tabular mt-1 block break-words text-lg leading-tight sm:text-xl">{value}</b></MatteSurface>)}
        </section>

        <MatteSurface as="section" surface="chrome" aria-label="Период и фильтры" className="p-3 sm:p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_auto] lg:items-end"><div><label className="mb-1.5 block text-xs font-medium text-[color:var(--tf-text-secondary)]">Период</label><Select value={props.period} onValueChange={(value) => props.onPeriodChange(value as HarvestPeriodPreset)}><SelectTrigger className="tf-input-surface tf-focus-ring h-12 text-base text-[color:var(--tf-text-primary)] sm:h-10 sm:text-sm"><SelectValue /></SelectTrigger><SelectContent>{PERIODS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><Button type="button" variant="outline" className="tf-focus-ring h-12 justify-between gap-2 border-[color:var(--tf-border-control)] bg-[var(--tf-surface-input)] text-[color:var(--tf-text-primary)] hover:bg-[var(--tf-surface-work-raised)] sm:h-10" onClick={() => props.onFiltersOpenChange(!props.filtersOpen)} aria-expanded={props.filtersOpen} aria-controls="dashboard-v2-filters">Фильтры{props.activeFilterCount ? ` · ${props.activeFilterCount}` : ""}<ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${props.filtersOpen ? "rotate-180" : ""}`} /></Button></div>
          {props.period === "custom" ? <div className="mt-3 grid gap-2 sm:grid-cols-2"><Input aria-label="Начало периода" type="datetime-local" value={props.customStart} onChange={(event) => props.onCustomStartChange(event.target.value)} className="tf-input-surface tf-focus-ring min-h-12 text-base sm:min-h-10 sm:text-sm" /><Input aria-label="Конец периода" type="datetime-local" value={props.customEnd} onChange={(event) => props.onCustomEndChange(event.target.value)} className="tf-input-surface tf-focus-ring min-h-12 text-base sm:min-h-10 sm:text-sm" /></div> : null}
          {props.summary ? <div className="mt-3 flex items-center gap-2 text-sm text-[color:var(--tf-text-secondary)]"><CalendarClock aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--tf-accent-primary)]" /><span>{props.summary.period.label}</span></div> : null}
          {props.filtersOpen ? <div id="dashboard-v2-filters" className="mt-3 border-t border-[color:var(--tf-border-hairline)] pt-3"><div className="mb-3 flex items-center justify-between sm:hidden"><h2 className="font-semibold">Фильтры сводки</h2><Button type="button" size="icon" variant="ghost" onClick={() => props.onFiltersOpenChange(false)} aria-label="Закрыть фильтры"><X aria-hidden="true" className="h-5 w-5" /></Button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><FilterSelect label="Культура" value={props.filters.cropId} options={props.options.crops} onChange={(value) => props.onFilterChange("cropId", value)} /><FilterSelect label="Сорт" value={props.filters.varietyId} options={props.options.varieties} onChange={(value) => props.onFilterChange("varietyId", value)} /><FilterSelect label="Репродукция" value={props.filters.reproductionId} options={props.options.reproductions} onChange={(value) => props.onFilterChange("reproductionId", value)} /><FilterSelect label="Поле" value={props.filters.fieldId} options={props.options.fields} onChange={(value) => props.onFilterChange("fieldId", value)} /><FilterSelect label="Склад" value={props.filters.warehouseId} options={props.options.warehouses} onChange={(value) => props.onFilterChange("warehouseId", value)} /></div>{props.activeFilterCount ? <Button type="button" variant="ghost" className="tf-focus-ring mt-3 min-h-12 w-full text-[color:var(--tf-accent-bright)] sm:min-h-10" onClick={props.onResetFilters}>Сбросить фильтры</Button> : null}</div> : null}
        </MatteSurface>

        {props.error ? <div role="alert" className="rounded-[var(--tf-radius-control)] border border-[color:var(--tf-status-danger)] bg-[var(--tf-surface-work)] px-3 py-2 text-sm text-[color:var(--tf-status-danger)]">{props.error}</div> : null}
        {!props.customReady ? <div role="status" className="rounded-[var(--tf-radius-control)] border border-[color:var(--tf-status-warning)] bg-[var(--tf-surface-work)] px-3 py-2 text-sm text-[color:var(--tf-status-warning)]">Укажите начало и конец периода.</div> : null}

        <section aria-labelledby="dashboard-harvest-title" className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-medium text-[color:var(--tf-text-muted)]">Текущая уборка</p><h2 id="dashboard-harvest-title" className="mt-0.5 text-lg font-semibold">Партии урожая</h2></div>{props.summary ? <div className="flex gap-3 text-xs text-[color:var(--tf-text-secondary)]"><span>В работе: <b className="tf-tabular text-[color:var(--tf-text-primary)]">{props.summary.parties.length}</b></span><span>Открыто машин: <b className="tf-tabular text-[color:var(--tf-text-primary)]">{props.summary.openTicketCount}</b></span></div> : null}</div>{!props.summary ? <MatteSurface aria-label="Загрузка партий" className="h-32 animate-pulse" /> : props.summary.parties.length ? props.summary.parties.map((party) => <PartyCard key={party.key} party={party} open={Boolean(props.expandedParties[party.key])} onOpenChange={(open) => props.onPartyOpenChange(party.key, open)} onTicket={props.onTicket} />) : <MatteSurface className="py-12 text-center text-sm text-[color:var(--tf-text-muted)]">По выбранным условиям партий нет.</MatteSurface>}</section>
      </div>
    </VisualSystemScope>
  );
}
