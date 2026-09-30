"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listTicketHistoryPage, listTicketHistoryShifts } from "@/lib/services/weighbridge";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";
import { HISTORY_OPERATIONS, historyDateTime, historyDay, historyPeriod, type TicketHistoryFilters, type TicketHistoryShift } from "@/lib/weighbridge/ticket-history-filters";

const PAGE_SIZE = 50;
const selectClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground";
const dayFilters = (offset: number) => { const day = historyDay(offset); return historyPeriod(day, "00:00", day, "23:59"); };

type Props = { companyId: string; userId: string; enabled: boolean; activeShiftId?: string; renderTicket: (ticket: WeighbridgeTicket) => ReactNode };

export function TicketHistoryPanel({ companyId, userId, enabled, activeShiftId, renderTicket }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState("today");
  const [filters, setFilters] = useState<TicketHistoryFilters>(() => dayFilters(0));
  const [fromDate, setFromDate] = useState(() => historyDay());
  const [toDate, setToDate] = useState(() => historyDay());
  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState("23:59");
  const [validationError, setValidationError] = useState("");
  const [tickets, setTickets] = useState<WeighbridgeTicket[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [changed, setChanged] = useState(false);
  const [shifts, setShifts] = useState<TicketHistoryShift[]>([]);
  const [shiftCursor, setShiftCursor] = useState<string | null>(null);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState("");
  const [shiftReload, setShiftReload] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const moreBusy = useRef(false);
  const shiftMoreBusy = useRef(false);
  const shiftMoreAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !root.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !visible) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const token = ++generation.current;
    moreBusy.current = false;
    setLoading(true); setLoadingMore(false); setError(""); setTickets([]); setNextCursor(null); setChanged(false);
    void listTicketHistoryPage(companyId, userId, { limit: PAGE_SIZE, filters, signal: controller.signal })
      .then(page => { if (!controller.signal.aborted && token === generation.current) { setTickets(page.tickets); setNextCursor(page.nextCursor); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); requestRef.current?.abort(); };
  }, [companyId, userId, enabled, visible, filters, reload]);

  useEffect(() => {
    if (!enabled || !visible) return;
    const controller = new AbortController();
    shiftMoreAbort.current?.abort(); shiftMoreBusy.current = false;
    setShiftsLoading(true); setShiftsError("");
    void listTicketHistoryShifts(companyId, { signal: controller.signal })
      .then(page => { if (!controller.signal.aborted) { setShifts(page.shifts); setShiftCursor(page.nextCursor); } })
      .catch(reason => { if (!controller.signal.aborted) setShiftsError(reason instanceof Error ? reason.message : "Не удалось загрузить смены."); })
      .finally(() => { if (!controller.signal.aborted) setShiftsLoading(false); });
    return () => { controller.abort(); shiftMoreAbort.current?.abort(); };
  }, [companyId, enabled, visible, activeShiftId, shiftReload]);

  useEffect(() => {
    const markChanged = () => setChanged(true);
    window.addEventListener("travkin:weighbridge-data-changed", markChanged);
    return () => window.removeEventListener("travkin:weighbridge-data-changed", markChanged);
  }, []);

  const apply = (next: TicketHistoryFilters, nextMode = mode) => {
    requestRef.current?.abort(); ++generation.current;
    setValidationError(""); setFilters(next); setMode(nextMode);
  };
  const choosePeriod = (offset: number) => {
    const day = historyDay(offset);
    setFromDate(day); setToDate(day); setFromTime("00:00"); setToTime("23:59");
    apply({ operation: filters.operation, status: filters.status, ...dayFilters(offset) }, offset ? "yesterday" : "today");
  };
  const chooseShift = (id: string) => apply({ operation: filters.operation, status: filters.status, ...(id ? { shiftId: id } : {}) }, id ? "shift" : "all");
  const currentShift = shifts.find(shift => shift.id === activeShiftId) || shifts.find(shift => shift.status === "open");
  const previousShift = shifts.find(shift => shift.status === "closed");
  const selectedShift = shifts.find(shift => shift.id === filters.shiftId);

  const loadMore = async () => {
    if (loading || moreBusy.current || !nextCursor) return;
    moreBusy.current = true; setLoadingMore(true); setError("");
    const controller = new AbortController(); requestRef.current = controller;
    const token = generation.current;
    try {
      const page = await listTicketHistoryPage(companyId, userId, { limit: PAGE_SIZE, cursor: nextCursor, filters, signal: controller.signal });
      if (controller.signal.aborted || token !== generation.current) return;
      setTickets(current => Array.from(new Map([...current, ...page.tickets].map(ticket => [ticket.id, ticket])).values()));
      setNextCursor(page.nextCursor);
    } catch (reason) { if (!controller.signal.aborted && token === generation.current) setError(reason instanceof Error ? reason.message : "Не удалось загрузить следующую страницу."); }
    finally { if (!controller.signal.aborted && token === generation.current) { moreBusy.current = false; setLoadingMore(false); } }
  };

  const moreShifts = async () => {
    if (!shiftCursor || shiftMoreBusy.current) return;
    shiftMoreBusy.current = true; setShiftsLoading(true); setShiftsError("");
    const controller = new AbortController(); shiftMoreAbort.current = controller;
    try {
      const page = await listTicketHistoryShifts(companyId, { cursor: shiftCursor, signal: controller.signal });
      if (controller.signal.aborted) return;
      setShifts(current => Array.from(new Map([...current, ...page.shifts].map(shift => [shift.id, shift])).values()));
      setShiftCursor(page.nextCursor);
    } catch (reason) { if (!controller.signal.aborted) setShiftsError(reason instanceof Error ? reason.message : "Не удалось загрузить смены."); }
    finally { if (!controller.signal.aborted) { shiftMoreBusy.current = false; setShiftsLoading(false); } }
  };

  return <Card ref={root} className="rounded-md border-border bg-card shadow-manor-sm">
    <CardHeader className="space-y-3 px-4 pb-3 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><CardTitle className="text-xl">Журнал талонов</CardTitle><p className="mt-1 text-xs text-muted-foreground">Закрытые и аннулированные · просмотр не меняет рабочую смену</p></div>
        <Button type="button" variant="outline" disabled={loading || !enabled} onClick={() => setReload(value => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />{changed ? "Есть изменения — обновить" : "Обновить"}</Button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Быстрый выбор истории">
        <Button type="button" variant={mode === "shift" && filters.shiftId === currentShift?.id ? "default" : "outline"} disabled={!currentShift} onClick={() => currentShift && chooseShift(currentShift.id)}>Текущая смена</Button>
        <Button type="button" variant={mode === "shift" && filters.shiftId === previousShift?.id ? "default" : "outline"} disabled={!previousShift} onClick={() => previousShift && chooseShift(previousShift.id)}>Прошлая смена</Button>
        <Button type="button" variant={mode === "today" ? "default" : "outline"} onClick={() => choosePeriod(0)}>Сегодня</Button>
        <Button type="button" variant={mode === "yesterday" ? "default" : "outline"} onClick={() => choosePeriod(-1)}>Вчера</Button>
        <Button type="button" variant={mode === "range" ? "default" : "outline"} onClick={() => setMode("range")}>Период и время</Button>
        <Button type="button" variant={mode === "all" ? "default" : "outline"} onClick={() => apply({}, "all")}>Вся история</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <label className="min-w-0 space-y-1 text-xs text-muted-foreground"><span>Смена — целиком, даже если закончилась утром</span>
          <select aria-label="Смена истории" className={selectClass} value={filters.shiftId || ""} onChange={event => chooseShift(event.target.value)}>
            <option value="">Без ограничения по смене</option>
            {shifts.map(shift => <option key={shift.id} value={shift.id}>{historyDateTime(shift.opened_at)} — {shift.closed_at ? historyDateTime(shift.closed_at) : "сейчас · открыта"}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground"><span>Операция</span><select aria-label="Операция истории" className={selectClass} value={filters.operation || ""} onChange={event => apply({ ...filters, operation: event.target.value || undefined })}>
          <option value="">Все операции</option>{Object.entries(HISTORY_OPERATIONS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label className="space-y-1 text-xs text-muted-foreground"><span>Статус</span><select aria-label="Статус истории" className={selectClass} value={filters.status || ""} onChange={event => apply({ ...filters, status: (event.target.value || undefined) as TicketHistoryFilters["status"] })}>
          <option value="">Закрытые и аннулированные</option><option value="finalized">Закрытые</option><option value="voided">Аннулированные</option>
        </select></label>
      </div>
      {shiftCursor ? <Button type="button" variant="outline" className="self-start" disabled={shiftsLoading} onClick={() => void moreShifts()}>Загрузить более ранние смены</Button> : null}
      {shiftsError ? <div role="alert" className="text-sm text-destructive">{shiftsError} <Button type="button" variant="outline" onClick={() => setShiftReload(value => value + 1)}>Повторить список смен</Button></div> : null}
      {mode === "range" ? <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault();
        try { apply({ operation: filters.operation, status: filters.status, ...historyPeriod(fromDate, fromTime, toDate, toTime) }, "range"); }
        catch (reason) { setValidationError(reason instanceof Error ? reason.message : "Проверьте период."); }
      }}>
        <label className="min-w-0 space-y-1 text-xs"><span>С даты</span><Input type="date" required aria-label="История с даты" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
        <label className="space-y-1 text-xs"><span>С времени</span><Input type="time" required aria-label="История с времени" value={fromTime} onChange={event => setFromTime(event.target.value)} /></label>
        <label className="min-w-0 space-y-1 text-xs"><span>По дату</span><Input type="date" required aria-label="История по дату" value={toDate} onChange={event => setToDate(event.target.value)} /></label>
        <label className="space-y-1 text-xs"><span>По время включительно</span><Input type="time" required aria-label="История по время" value={toTime} onChange={event => setToTime(event.target.value)} /></label>
        <Button type="submit">Показать период</Button>
      </form> : null}
      {validationError ? <p role="alert" className="text-sm text-destructive">{validationError}</p> : null}
      <p className="text-xs text-muted-foreground">{filters.shiftId ? selectedShift ? `Смена с ${historyDateTime(selectedShift.opened_at)}` : "Выбранная смена" : filters.from && filters.to ? `Открыты с ${historyDateTime(filters.from)} по ${historyDateTime(new Date(Date.parse(filters.to) - 60000).toISOString())}` : "За всё время"} · время Казахстана (UTC+5). Даты фильтруются по открытию талона.</p>
    </CardHeader>
    <CardContent className="space-y-2 px-3 pb-4 sm:px-4" aria-busy={loading || loadingMore}>
      {loading ? <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загружаем историю…</p> : null}
      {error ? <div role="alert" className="rounded-md border border-destructive p-3 text-sm">{error}<Button type="button" className="ml-2" variant="outline" onClick={() => tickets.length && nextCursor ? void loadMore() : setReload(value => value + 1)}>Повторить</Button></div> : null}
      {!loading && !error && visible && tickets.length === 0 ? <div className="border-y border-dashed border-border p-6 text-center text-sm text-muted-foreground">За выбранную смену или период талонов нет. Выберите другую смену, дату или «Вся история».</div> : null}
      {tickets.map(renderTicket)}
      {!loading && tickets.length > 0 ? <p role="status" className="pt-2 text-xs text-muted-foreground">Загружено талонов: {tickets.length}{nextCursor ? " · ниже можно загрузить ещё" : " · все по выбранным фильтрам"}</p> : null}
      {!loading && nextCursor ? <Button type="button" variant="outline" className="w-full" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{loadingMore ? "Загружаем…" : "Ещё 50 талонов"}</Button> : null}
    </CardContent>
  </Card>;
}
