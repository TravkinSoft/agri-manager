"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronDown, Clock3, Loader2, Scale, Warehouse } from "lucide-react";
import { TicketPreviewDialog } from "@/components/weighbridge/ticket-preview-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/contexts/auth-context";
import type { HarvestDashboardFilters, HarvestFilterOptions, HarvestOverview, HarvestParty, HarvestPartyTicket, HarvestPeriodPreset } from "@/lib/dashboard/harvest-summary";
import { getHarvestFilters, getHarvestSummary, type HarvestDashboardQuery } from "@/lib/services/harvest-dashboard";
import { LIVE_REFRESH_TABLES, useLiveRefresh } from "@/hooks/use-live-refresh";

type FiltersPayload = { options: HarvestFilterOptions; operationalDayStartHour: number };

const EMPTY_FILTERS: HarvestDashboardFilters = { cropId: null, varietyId: null, reproductionId: null, fieldId: null, warehouseId: null };
const EMPTY_OPTIONS: HarvestFilterOptions = { crops: [], varieties: [], reproductions: [], fields: [], warehouses: [] };
const PERIODS: Array<{ value: HarvestPeriodPreset; label: string }> = [
  { value: "current_day", label: "Текущий операционный день" },
  { value: "previous_day", label: "Предыдущий операционный день" },
  { value: "current_shift", label: "Текущая смена" },
  { value: "last_24_hours", label: "Последние 24 часа" },
  { value: "season", label: "Весь сезон" },
  { value: "custom", label: "Свой период" },
];

function kg(value: number | null): string {
  return value == null ? "—" : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
}

function percent(value: number): string {
  return `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function SectionLoading() {
  return <div className="flex min-h-28 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загрузка...</div>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value?: string | null; options: Array<{ id: string; label: string }>; onChange: (value: string | null) => void }) {
  return <div className="min-w-0"><label className="mb-1 block text-[11px] uppercase text-slate-500">{label}</label><Select value={value || "all"} onValueChange={(next) => onChange(next === "all" ? null : next)}><SelectTrigger className="h-9 min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все</SelectItem>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></div>;
}

function TicketRow({ ticket, kind, onOpen }: { ticket: HarvestPartyTicket; kind: "open" | "completed"; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(ticket.ticketId)} className="grid w-full min-w-0 gap-1 rounded-md border border-slate-800 px-3 py-2 text-left hover:border-slate-700 sm:grid-cols-[1fr_auto] sm:gap-3">
      <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-100">{time(ticket.occurredAt)} · {ticket.fieldName} · {ticket.vehicleLabel}</span><span className="block truncate text-xs text-slate-500">{ticket.driverName} · {ticket.destinationName}</span></span>
      <span className="flex flex-wrap items-center gap-x-3 text-xs sm:justify-end"><b className="text-sm text-slate-100">{kind === "open" ? `Брутто ${kg(ticket.grossWeightKg)}` : `Нетто ${kg(ticket.netWeightKg)}`}</b>{kind === "open" ? <span className="text-amber-300">Ждёт тару {ticket.waitingTareMinutes} мин.</span> : <span className="text-emerald-300">{ticket.statusLabel}</span>}{ticket.moisturePercent != null ? <span className="text-slate-400">Влажность {percent(ticket.moisturePercent)}</span> : null}</span>
    </button>
  );
}

function PartyCard({ party, open, onOpenChange, onTicket }: { party: HarvestParty; open: boolean; onOpenChange: (open: boolean) => void; onTicket: (id: string) => void }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="overflow-hidden rounded-lg border-slate-800">
        <CollapsibleTrigger asChild>
          <button type="button" className="grid w-full min-w-0 grid-cols-2 gap-3 p-4 text-left hover:bg-slate-900/40 lg:grid-cols-[minmax(210px,1.15fr)_repeat(4,minmax(110px,0.65fr))_auto] lg:items-center">
            <span className="col-span-2 min-w-0 lg:col-span-1"><span className="block truncate text-base font-semibold text-slate-100">{party.cropName}</span><span className="block truncate text-sm text-slate-400">{party.complete ? [party.varietyName, party.reproductionName].filter(Boolean).join(" · ") : "Требуется уточнение"}</span></span>
            <span><span className="block text-[11px] uppercase text-slate-500">На складах сейчас</span><b className="text-base text-slate-100">{kg(party.currentStockKg)}</b></span>
            <span><span className="block text-[11px] uppercase text-slate-500">Принято за период</span><b className="text-base text-[#E0B100]">{kg(party.receivedKg)}</b></span>
            <span><span className="block text-[11px] uppercase text-slate-500">Открыто машин</span><b className="text-base text-slate-100">{party.openTicketCount}</b></span>
            <span><span className="block text-[11px] uppercase text-slate-500">Завершено рейсов</span><b className="text-base text-slate-100">{party.completedTicketCount}</b></span>
            <span className="col-span-2 flex items-center justify-between gap-2 text-xs text-slate-500 lg:col-span-1 lg:justify-end">{party.lastTrip ? `Последний ${time(party.lastTrip.occurredAt)}` : "Рейсов нет"}<ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} /></span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 border-t border-slate-800 p-4">
            {party.openTickets.length ? <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100"><Clock3 className="h-4 w-4 text-amber-400" />Открытые талоны</h3><div className="space-y-2">{party.openTickets.map((ticket) => <TicketRow key={ticket.ticketId} ticket={ticket} kind="open" onOpen={onTicket} />)}</div></section> : null}
            <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100"><Scale className="h-4 w-4 text-[#E0B100]" />Завершённые талоны за период</h3>{party.completedTickets.length ? <div className="space-y-2">{party.completedTickets.map((ticket) => <TicketRow key={ticket.ticketId} ticket={ticket} kind="completed" onOpen={onTicket} />)}</div> : <p className="text-sm text-slate-500">За выбранный период завершённых рейсов нет.</p>}</section>
            <div className="grid gap-4 lg:grid-cols-2">
              <section><h3 className="mb-2 text-sm font-semibold text-slate-100">Поступление с полей за период</h3>{party.fields.length ? <div className="space-y-2">{party.fields.map((field) => <div key={field.key} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-slate-800 p-3"><span className="min-w-0"><b className="block truncate text-sm text-slate-100">{field.fieldName}</b><span className="block text-xs text-slate-500">{field.trips} {pluralRu(field.trips, "завершённый рейс", "завершённых рейса", "завершённых рейсов")}</span><span className="block text-xs text-slate-500">Последний: {kg(field.lastTripKg)} · {time(field.lastTripAt)}</span></span><b className="whitespace-nowrap text-sm text-[#E0B100]">{kg(field.receivedKg)}</b></div>)}</div> : <p className="text-sm text-slate-500">Поступления с полей за период нет.</p>}</section>
              <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100"><Warehouse className="h-4 w-4 text-[#E0B100]" />Размещение на складах сейчас</h3>{party.warehouses.length ? <div className="space-y-2">{party.warehouses.map((warehouse) => <div key={`${warehouse.warehouseId}:${warehouse.warehouseName}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-slate-800 p-3"><span className="truncate text-sm text-slate-200">{warehouse.warehouseName}</span><b className="whitespace-nowrap text-sm text-slate-100">{kg(warehouse.currentKg)}</b></div>)}</div> : <p className="text-sm text-slate-500">Фактического остатка на складах нет.</p>}</section>
            </div>
            {party.moisture ? <section><h3 className="mb-2 text-sm font-semibold text-slate-100">Влажность</h3><div className="grid grid-cols-2 gap-2 rounded-md border border-slate-800 p-3 text-xs text-slate-500 sm:grid-cols-4"><span>Последний рейс<br /><b className="text-sm text-slate-200">{percent(party.moisture.latestPercent)}</b></span><span>Средняя за период<br /><b className="text-sm text-slate-200">{percent(party.moisture.averagePercent)}</b></span><span>Диапазон<br /><b className="text-sm text-slate-200">{percent(party.moisture.minimumPercent)}–{percent(party.moisture.maximumPercent)}</b></span><span>Измерено<br /><b className="text-sm text-slate-200">{party.moisture.measuredTrips} из {party.moisture.totalTrips}</b></span></div></section> : null}
            {party.issues.length ? <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-200"><AlertTriangle className="h-4 w-4" />Требует внимания</h3><div className="space-y-2">{party.issues.map((issue) => <button key={issue.key} type="button" disabled={!issue.ticketId} onClick={() => issue.ticketId && onTicket(issue.ticketId)} className="block w-full rounded-md border border-amber-800/40 bg-amber-950/15 px-3 py-2 text-left disabled:cursor-default"><span className="block text-sm text-slate-200">{issue.title}</span><span className="block text-xs text-slate-500">{issue.detail}</span></button>)}</div></section> : null}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function HarvestDashboard() {
  const { profile } = useAuth();
  const [period, setPeriod] = useState<HarvestPeriodPreset>("current_day");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [filters, setFilters] = useState<HarvestDashboardFilters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<HarvestFilterOptions>(EMPTY_OPTIONS);
  const [summary, setSummary] = useState<HarvestOverview | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedParties, setExpandedParties] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [ticketId, setTicketId] = useState<string | null>(null);

  const query = useMemo<HarvestDashboardQuery>(() => ({ period, start: period === "custom" ? localInputToIso(customStart) : null, end: period === "custom" ? localInputToIso(customEnd) : null, filters }), [customEnd, customStart, filters, period]);
  const customReady = period !== "custom" || Boolean(query.start && query.end);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const loadSummary = useCallback(async () => {
    if (!customReady) return;
    try { setSummary(await getHarvestSummary<HarvestOverview>(query)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить сводку"); }
  }, [customReady, query]);

  useEffect(() => { if (profile?.company_id) void getHarvestFilters<FiltersPayload>().then((payload) => setOptions(payload.options)); }, [profile?.company_id]);
  useEffect(() => { if (profile?.company_id && customReady) void loadSummary(); }, [customReady, loadSummary, profile?.company_id]);
  useLiveRefresh({ enabled: Boolean(profile?.company_id), companyId: profile?.company_id, tables: LIVE_REFRESH_TABLES.weighbridge, intervalMs: 15_000, onRefresh: loadSummary });

  const setFilter = (key: keyof HarvestDashboardFilters, value: string | null) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 overflow-x-hidden">
      <div className="flex min-w-0 items-end justify-between gap-3"><div className="min-w-0"><h1 className="truncate text-2xl font-semibold text-slate-100 sm:text-3xl">Сводка уборки</h1><p className="mt-1 text-sm text-slate-400">Партии урожая, фактические остатки и рейсы</p></div><div className="hidden rounded-md border border-emerald-700/40 bg-emerald-950/30 px-2.5 py-1 text-xs text-emerald-300 sm:block">Live</div></div>
      <Card className="rounded-lg"><CardContent className="space-y-3 p-3 sm:p-4"><div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_auto] lg:items-end"><div><label className="mb-1 block text-[11px] uppercase text-slate-500">Период</label><Select value={period} onValueChange={(value) => setPeriod(value as HarvestPeriodPreset)}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent>{PERIODS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><Button type="button" variant="outline" className="h-10 justify-between gap-2" onClick={() => setFiltersOpen((value) => !value)}>Фильтры{activeFilterCount ? ` · ${activeFilterCount}` : ""}<ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} /></Button></div>{period === "custom" ? <div className="grid gap-2 sm:grid-cols-2"><Input type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /><Input type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></div> : null}{summary ? <div className="flex items-center gap-2 text-sm text-slate-300"><CalendarClock className="h-4 w-4 shrink-0 text-[#E0B100]" /><span>{summary.period.label}</span></div> : null}{filtersOpen ? <div className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2 xl:grid-cols-5"><FilterSelect label="Культура" value={filters.cropId} options={options.crops} onChange={(value) => setFilter("cropId", value)} /><FilterSelect label="Сорт" value={filters.varietyId} options={options.varieties} onChange={(value) => setFilter("varietyId", value)} /><FilterSelect label="Репродукция" value={filters.reproductionId} options={options.reproductions} onChange={(value) => setFilter("reproductionId", value)} /><FilterSelect label="Поле" value={filters.fieldId} options={options.fields} onChange={(value) => setFilter("fieldId", value)} /><FilterSelect label="Склад" value={filters.warehouseId} options={options.warehouses} onChange={(value) => setFilter("warehouseId", value)} />{activeFilterCount ? <Button variant="ghost" className="sm:col-span-2 xl:col-span-5" onClick={() => setFilters(EMPTY_FILTERS)}>Сбросить фильтры</Button> : null}</div> : null}</CardContent></Card>
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div> : null}
      {!customReady ? <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">Укажите начало и конец периода.</div> : null}
      <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-semibold text-slate-100">Партии в уборке</h2><p className="text-xs text-slate-500">Одна партия: сезон, культура, сорт и репродукция</p></div>{summary ? <div className="flex gap-3 text-xs text-slate-400"><span>В работе: <b className="text-slate-100">{summary.parties.length}</b></span><span>Открыто машин: <b className="text-slate-100">{summary.openTicketCount}</b></span></div> : null}</div>{!summary ? <Card><SectionLoading /></Card> : summary.parties.length ? summary.parties.map((party) => <PartyCard key={party.key} party={party} open={Boolean(expandedParties[party.key])} onOpenChange={(open) => setExpandedParties((current) => ({ ...current, [party.key]: open }))} onTicket={setTicketId} />) : <Card><CardContent className="py-12 text-center text-sm text-slate-500">По выбранным условиям партий нет.</CardContent></Card>}</section>
      <TicketPreviewDialog ticketId={ticketId} open={Boolean(ticketId)} onOpenChange={(open) => !open && setTicketId(null)} />
    </div>
  );
}
