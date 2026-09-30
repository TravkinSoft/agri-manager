"use client";
import type { SummaryYield } from "@/lib/dashboard/summary-presentation";

export type SummaryFieldYieldProps = {
  data: SummaryYield | null; error: string | null; fieldId: string; onFieldChange: (id: string) => void;
};
export function SummaryFieldYield({ data, error, fieldId, onFieldChange, passport = false }: SummaryFieldYieldProps & { passport?: boolean }) {
  const field = data?.fields.find(item => item.id === fieldId) ?? data?.fields[0];
  const value = field?.yieldTPerHa;
  const reason = error ? "Не удалось обновить" : !data ? "Загрузка…" : !field ? "Нет данных по полям"
    : field.issue ? "Нужна сверка гектаров" : "Гектары ещё не указаны";
  const area = field?.areaHa, done = field?.harvestedHa;
  const validProgress = !field?.issue && area != null && area > 0 && done != null && done >= 0 && done <= area;
  const ha = (number: number | null | undefined) => number == null ? "—" : `${number.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га`;
  return <section aria-label={passport ? "Паспорт поля" : "Урожайность поля"} data-summary-design={passport ? "K2" : "B2"}
    className={passport ? "rounded-xl border border-border bg-[color:var(--manor-paper-raised)] p-3" : "border-b border-border py-3"}>
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1"><h2 className="text-xs text-muted-foreground">Урожайность поля</h2>
        {data?.fields.length ? <select aria-label="Поле для урожайности" value={field?.id ?? ""} onChange={event => onFieldChange(event.target.value)}
          className="min-h-9 w-full min-w-0 border-0 bg-transparent text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {data.fields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select> : null}
        {field?.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
      </div>
      <strong className="shrink-0 text-lg tabular-nums" data-testid="field-yield">{value != null ? `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} т/га` : "—"}</strong>
    </div>
    {value == null || error ? <p role={error ? "status" : undefined} className="mt-1 text-xs text-muted-foreground">{reason}{error && value != null ? " · показан предыдущий расчёт" : ""}</p> : null}
    {value != null && field?.pending ? <p className="mt-1 text-xs text-muted-foreground" title={`Чистая масса с поля / подтверждённые ${ha(done)}. Гектары открытой смены ещё не учтены.`}>Предварительно · по подтверждённым га</p> : null}
    {passport && field ? <div className="mt-3 border-t border-border pt-3">
      {validProgress && !field.completed ? <div role="progressbar" aria-label="Убрано по полю" aria-valuemin={0} aria-valuemax={area} aria-valuenow={done}
        className="h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-[color:var(--manor-brass-soft)]" style={{ width: `${done / area * 100}%` }} /></div> : null}
      <dl className="mt-2 flex justify-between gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">{field.pending ? "Подтверждено" : "Убрано всего"}</dt><dd className="mt-1 font-semibold tabular-nums">{field.issue ? "Нужна сверка" : ha(done)}</dd></div>
        <div className="text-right"><dt className="text-xs text-muted-foreground">{field.completed ? "Уборка завершена" : field.pending ? "Осталось уточнить" : "Осталось"}</dt><dd className="mt-1 font-semibold tabular-nums">{field.completed && !field.issue ? ha(0) : validProgress ? ha(area - done) : "—"}</dd></div></dl>
    </div> : null}
  </section>;
}
