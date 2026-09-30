"use client";
import type { OperationPresentation } from "@/lib/operations/operation-presentation";
import { TankPlanDetails } from "./tank-plan-details";
import { MixtureReportSummary } from "./mixture-report";
export function ChemistryOperationDetails({ presentation }: { presentation:OperationPresentation }) {
  const c=presentation.chemistryPlan, report=presentation.latestMixtureReport;
  if (!c) return null;
  const names=Object.fromEntries(presentation.materials.map(m=>[m.product_id,m.product_name||'Препарат']));
  return <div className="space-y-3">
    {c.schedule?<TankPlanDetails plan={c.schedule} names={names}/>:null}
    <details className="text-sm"><summary className="cursor-pointer">Основание решения агронома</summary>
      <p>Сведения заявил агроном. Автоматической проверки регистрации, совместимости и безопасности применения нет.</p>
      {c.sources.map(s=><p key={s.product_id}>{names[s.product_id]||'Препарат'} · {s.formulation} · <a href={/^https:\/\//.test(s.source_url)?s.source_url:undefined} target="_blank" rel="noreferrer" className="underline">Источник</a> · {s.checked_date}</p>)}
    </details>
    {report?.mixture_facts?<><p className="text-sm">Баланс отчёта: {report.status==='approved'?'принят агрономом':report.status==='rejected'?'возвращён на уточнение':'ожидает сверки и приёмки'}.</p><MixtureReportSummary mixture={report.mixture_facts} materials={report.material_facts} names={names}/></>:null}
  </div>;
}
