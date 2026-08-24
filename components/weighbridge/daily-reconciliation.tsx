"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getReconciliationControls, saveReconciliationControl } from "@/lib/services/weighbridge";

export type ReconciliationAggregate = {
  netKg: number;
  trips: number;
  averageTripKg: number;
  averageMoisture: number | null;
  measuredMoistureTrips?: number;
  firstTripAt?: string | null;
  lastTripAt?: string | null;
  ticketIds?: string[];
};

type ReconciliationRow = {
  day: string;
  fieldId: string | null;
  fieldName: string;
  aggregate: ReconciliationAggregate;
};

type Control = {
  id?: string;
  reconciliation_date: string;
  field_id: string | null;
  paper_total_kg: number | null;
  note?: string | null;
};

const rowKey = (day: string, fieldId: string | null) => `${day}::${fieldId || "all"}`;
const kg = (value: number) => `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
const time = (value: string | null | undefined) => value
  ? new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  : "—";

export function DailyReconciliation({
  companyId,
  daily,
  fieldRows,
  fieldNames,
  onOpenTicket,
}: {
  companyId?: string | null;
  daily: Record<string, ReconciliationAggregate>;
  fieldRows: Array<{ day: string; fieldId: string | null; aggregate: ReconciliationAggregate }>;
  fieldNames: Record<string, string>;
  onOpenTicket: (ticketId: string) => void;
}) {
  const [controls, setControls] = useState<Record<string, Control>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const rows = useMemo<ReconciliationRow[]>(() => {
    const result: ReconciliationRow[] = [];
    Object.entries(daily || {})
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, 31)
      .forEach(([day, aggregate]) => {
        result.push({ day, fieldId: null, fieldName: "Все поля", aggregate });
        fieldRows
          .filter((row) => row.day === day && row.fieldId)
          .sort((left, right) => (fieldNames[left.fieldId || ""] || "").localeCompare(fieldNames[right.fieldId || ""] || "", "ru"))
          .forEach((row) => result.push({
            ...row,
            fieldName: fieldNames[row.fieldId || ""] || "Поле не найдено",
          }));
      });
    return result;
  }, [daily, fieldNames, fieldRows]);

  const loadControls = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await getReconciliationControls(companyId || undefined);
      const next = Object.fromEntries((payload.controls || []).map((control: Control) => [
        rowKey(control.reconciliation_date, control.field_id),
        control,
      ]));
      setControls(next);
      setDrafts(Object.fromEntries(Object.entries(next).map(([key, control]) => [
        key,
        control.paper_total_kg == null ? "" : String(control.paper_total_kg),
      ])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить контрольные итоги.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void loadControls(); }, [loadControls]);

  const save = async (row: ReconciliationRow) => {
    const key = rowKey(row.day, row.fieldId);
    setSaving(key);
    setError("");
    try {
      const raw = String(drafts[key] || "").trim().replace(",", ".");
      const payload = await saveReconciliationControl({
        companyId: companyId || undefined,
        reconciliationDate: row.day,
        fieldId: row.fieldId,
        paperTotalKg: raw ? Number(raw) : null,
      });
      setControls((current) => ({ ...current, [key]: payload.control }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить контрольный итог.");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="flex items-center gap-2 py-3 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загрузка сверки…</div>;

  return (
    <section aria-label="Сверка бумажного журнала" className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase text-slate-500">Сверка бумажного журнала</div>
          <p className="mt-1 text-xs text-slate-500">Контрольный итог не создаёт талон, партию, остаток или проводку.</p>
        </div>
        {error ? <Button type="button" variant="ghost" size="sm" onClick={() => void loadControls()}>Повторить</Button> : null}
      </div>
      {error ? <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div> : null}
      <div className="overflow-x-auto rounded-md border border-slate-800">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="bg-slate-950/60 text-slate-500">
            <tr>
              <th className="px-3 py-2">Дата / поле</th><th className="px-3 py-2">Рейсов</th><th className="px-3 py-2">System</th>
              <th className="px-3 py-2">Средний</th><th className="px-3 py-2">Влажность</th><th className="px-3 py-2">Первый / последний</th>
              <th className="px-3 py-2">Paper total</th><th className="px-3 py-2">Разница</th><th className="w-11 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {rows.map((row) => {
              const key = rowKey(row.day, row.fieldId);
              const paper = controls[key]?.paper_total_kg;
              const differenceKg = paper == null ? null : row.aggregate.netKg - Number(paper);
              const expanded = Boolean(openRows[key]);
              return [
                <tr key={key} className={row.fieldId ? "bg-slate-950/20" : "bg-slate-900/45 font-semibold"}>
                  <td className="px-3 py-2"><span className={row.fieldId ? "pl-4" : ""}>{row.day.split("-").reverse().join(".")} · {row.fieldName}</span></td>
                  <td className="px-3 py-2">{row.aggregate.trips}</td>
                  <td className="px-3 py-2">{kg(row.aggregate.netKg)}</td>
                  <td className="px-3 py-2">{kg(row.aggregate.averageTripKg)}</td>
                  <td className="px-3 py-2">{row.aggregate.averageMoisture == null ? "—" : `${row.aggregate.averageMoisture.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}% · ${row.aggregate.measuredMoistureTrips || 0}/${row.aggregate.trips}`}</td>
                  <td className="px-3 py-2">{time(row.aggregate.firstTripAt)} / {time(row.aggregate.lastTripAt)}</td>
                  <td className="px-3 py-2"><Input aria-label={`Бумажный итог ${row.fieldName} ${row.day}`} inputMode="decimal" value={drafts[key] ?? (paper == null ? "" : String(paper))} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} className="h-8 w-32 border-slate-700 bg-slate-950" placeholder="кг" /></td>
                  <td className={`px-3 py-2 ${differenceKg == null ? "text-slate-500" : Math.abs(differenceKg) < 0.001 ? "text-emerald-300" : "text-amber-300"}`}>{differenceKg == null ? "Не задан" : differenceKg === 0 ? "Сходится" : kg(differenceKg)}</td>
                  <td className="px-2 py-2"><div className="flex gap-1"><button type="button" title="Сохранить контрольный итог" aria-label="Сохранить контрольный итог" onClick={() => void save(row)} disabled={saving === key} className="grid h-8 w-8 place-items-center rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-50">{saving === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}</button>{row.aggregate.ticketIds?.length ? <button type="button" title="Показать рейсы" aria-label="Показать рейсы" onClick={() => setOpenRows((current) => ({ ...current, [key]: !expanded }))} className="grid h-8 w-8 place-items-center rounded-md border border-slate-700 hover:bg-slate-800"><ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} /></button> : null}</div></td>
                </tr>,
                expanded ? <tr key={`${key}:tickets`}><td colSpan={9} className="bg-slate-950/50 px-4 py-2"><div className="flex flex-wrap gap-2">{(row.aggregate.ticketIds || []).map((ticketId, index) => <button key={ticketId} type="button" onClick={() => onOpenTicket(ticketId)} className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-yellow-500/60 hover:text-white">Рейс {index + 1}<ExternalLink className="h-3 w-3" /></button>)}</div></td></tr> : null,
              ];
            })}
            {rows.length === 0 ? <tr><td className="px-3 py-4 text-slate-500" colSpan={9}>Завершённых рейсов пока нет.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
