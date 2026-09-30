"use client";
import { useEffect, useState } from "react";
import type { CombineWorkday } from "@/lib/dashboard/combine-workday";
import { summaryTime } from "@/lib/dashboard/operational-summary";
import { summaryClock } from "@/lib/dashboard/summary-presentation";
import { previousSummaryDay, summaryDateLabel } from "@/lib/dashboard/summary-periods";
import { useSummaryResource } from "./use-summary-resource";
import { SummaryFieldYield, type SummaryFieldYieldProps } from "./summary-field-yield";
import { SummaryReadError } from "./weighbridge-operational-panel";
import type { SelectedSummaryShift } from "./summary-section-tabs";

const TABLES = ["ptc_combine_shifts", "ptc_combine_field_segments", "ptc_field_progress", "crop_structure"];
const hectares = (value: number | null) => value == null ? "—" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га`;

export function CombineWorkdayView({ data, error, passportPlotIds = [], activeOnly = false }: { data: CombineWorkday | null; error: string | null; passportPlotIds?: string[]; activeOnly?: boolean }) {
  const multiple = (data?.shifts.length ?? 0) > 1;
  return <section aria-label="Работа комбайнёра" className="space-y-3">
    <SummaryReadError error={error} />
    {!data && !error ? <p role="status" className="py-2 text-sm text-muted-foreground">Загрузка смены…</p> : null}
    {data ? <>
      {!data.shifts.length ? <p className="py-2 text-sm text-muted-foreground">{activeOnly ? "Активной смены нет." : "За эту дату смен нет."}</p> : <>
        <div className="space-y-3" aria-label="Смены комбайнёра">{data.shifts.map(shift => <article key={shift.id} className="space-y-2">
          <header><h2 className="text-sm font-semibold">{shift.operatorName}</h2>
            <p className="mt-1 text-[11px] text-muted-foreground" aria-label={`Открытие ${summaryTime(shift.openedAt)}, закрытие ${shift.closedAt ? summaryTime(shift.closedAt) : "ещё не закрыта"}`}>Смена · {summaryTime(shift.openedAt)} — {shift.closedAt ? summaryTime(shift.closedAt) : "сейчас"}</p></header>
          <div className="border-y border-border py-1">
            <div className="flex items-baseline justify-between gap-2 py-2 text-sm"><h3 className="font-medium">Убрано за смену</h3><strong className="tabular-nums">{shift.issue ? "Нужна сверка" : hectares(shift.hectares)}</strong></div>
            {shift.pending ? <p className="pb-2 text-xs text-muted-foreground">Гектары указываются при закрытии смены.</p> : null}
            {(shift.fields?.length ?? 0) > 1 ? <div className="divide-y divide-border border-t border-border">{shift.fields!.map(field => <div key={field.id} className="flex items-baseline justify-between gap-2 py-2 text-xs"><span>{field.label}{field.id === shift.currentPlotId ? " · текущее" : ""}</span><strong className="shrink-0 tabular-nums">{hectares(field.hectares)}</strong></div>)}</div>
              : passportPlotIds.includes(shift.fields?.[0]?.id || shift.currentPlotId || "") ? null
              : <p className="border-t border-border py-2 text-xs text-muted-foreground">{shift.fields?.[0]?.label || data.plots.find(plot => plot.id === shift.currentPlotId)?.label || "Поле не указано"}</p>}
          </div>
        </article>)}</div>
        {multiple ? <p className="flex items-baseline justify-between gap-2 text-sm"><span>{activeOnly ? "Всего за активные смены" : "Всего за день"}</span><strong className="tabular-nums">{data.issue ? "Нужна сверка" : data.pending ? "Ожидаем гектары" : hectares(data.totalHa)}</strong></p> : null}
        {data.issue ? <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">Гектары смены и полей не совпадают. Нужна сверка.</p> : null}
      </>}
    </> : null}
  </section>;
}

export function CombineWorkdayPanel({ scope, companyId, enabled, yieldProps, onShift }: {
  scope: string; companyId: string; enabled: boolean; yieldProps?: SummaryFieldYieldProps; onShift?: (value: SelectedSummaryShift) => void;
}) {
  const [period, setPeriod] = useState("active_shift");
  const [calendar, setCalendar] = useState<{ dates: string[]; serverTime: string; startHour: number; hasActiveShift?: boolean } | null>(null);
  const { data, error } = useSummaryResource<CombineWorkday>(scope, companyId,
    `/api/dashboard/combine-summary?companyId=${encodeURIComponent(companyId)}&${period === "active_shift" || period === "previous_day" ? `period=${period}` : `period=date&date=${encodeURIComponent(period)}`}`, enabled, TABLES);
  useEffect(() => { if (data) setCalendar({ dates: data.availableDates ?? [], serverTime: data.serverTime, startHour: data.operationalDayStartHour ?? 7, hasActiveShift: data.hasActiveShift }); }, [data]);
  const yesterday = calendar ? previousSummaryDay(calendar.serverTime, calendar.startHour) : null;
  useEffect(() => {
    const shift = data?.shifts.find(item => !item.closedAt) ?? data?.shifts[data.shifts.length - 1];
    onShift?.({ healthy: !!data && !error, shift: shift ? { ...shift, status: shift.closedAt ? "closed" : "open" } : data ? null : undefined });
  }, [data, error, onShift]);
  return <div className="space-y-3">
    {yieldProps ? <SummaryFieldYield {...yieldProps} passport /> : null}
    <div className="flex items-center justify-between gap-2">
      <select aria-label="Период комбайнёра" value={period} onChange={event => setPeriod(event.target.value)} className="min-h-9 min-w-0 border-0 bg-transparent text-xs text-muted-foreground">
        <option value="active_shift">{calendar?.hasActiveShift === false && calendar.dates.length ? "Последняя закрытая смена" : "Активная смена"}</option><option value="previous_day">Вчера</option>
        {(calendar?.dates ?? []).filter(day => day !== yesterday || day === period).map(day => <option key={day} value={day}>{summaryDateLabel(day)}</option>)}
      </select>
    </div>
    <CombineWorkdayView data={data} error={error} activeOnly={period === "active_shift"} passportPlotIds={(yieldProps?.data?.fields.find(field => field.id === yieldProps.fieldId) ?? yieldProps?.data?.fields[0])?.plotIds} />
    {data ? <p className="text-right text-[10px] text-muted-foreground">Обновлено {summaryClock(data.serverTime)}</p> : null}
  </div>;
}
