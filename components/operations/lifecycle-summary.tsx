"use client";
import { summarizeLifecycle, type LifecycleSummaryRow } from "@/lib/operations/lifecycle-summary";
export function LifecycleSummary({ rows }: { rows: LifecycleSummaryRow[] }) {
  const summary = summarizeLifecycle(rows);
  const ordered = [...summary.rows].sort((a,b) => Number(a.closed)-Number(b.closed) || Number(b.issues.length > 0)-Number(a.issues.length > 0) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return <details className="min-w-0 border-y py-3" aria-label="Сводка жизненного цикла">
    <summary className="cursor-pointer font-medium">Следующие действия · активных {summary.active} · с расхождениями {summary.discrepancies}</summary>
    <p className="my-2 text-xs text-muted-foreground">По загруженным задачам с текущим доступом. Каждая задача учтена один раз; площади повторных обработок и разные материалы не суммируются.</p>
    <ul className="divide-y">{ordered.slice(0,12).map(row => <li key={row.id} className="min-w-0 py-3 text-sm [overflow-wrap:anywhere]">
      <a href={row.href} className="font-medium underline">{row.title}</a>
      <p>{row.status} · {row.next}</p>
      {row.plannedHa !== undefined ? <p>План {row.plannedHa.toLocaleString("ru-RU")} га · накопленный факт {row.completedHa?.toLocaleString("ru-RU")} га</p> : null}
      {row.timing ? <p className="text-muted-foreground">{row.timing}</p> : null}
      {row.issues.map((issue,i) => <p key={i} className="text-amber-800">{issue}</p>)}
    </li>)}</ul>
    {ordered.length>12?<p className="text-xs text-muted-foreground">Первые 12 из {ordered.length}; остальные — в списке задач.</p>:null}
    {!ordered.length?<p className="mt-2 text-sm">Доступных задач нет.</p>:null}
  </details>;
}
