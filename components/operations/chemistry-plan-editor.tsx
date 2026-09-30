"use client";
import { calculateTankPlan, type ChemistrySource, type ChemistryPlanInput } from "@/lib/materials/tank-mixture";
export type { ChemistryPlanInput } from "@/lib/materials/tank-mixture";
import type { PlanCalculationResult } from "@/lib/materials/operation-plan-calculation";
import { TankPlanDetails } from "./tank-plan-details";
export const emptyChemistryPlan = (): ChemistryPlanInput => ({ version: 1, capacity_l: "", decision_confirmed: false, sources: [] });
export function ChemistryPlanEditor({ value, onChange, result, area, names, disabled }: { value: ChemistryPlanInput; onChange:(v:ChemistryPlanInput)=>void; result:PlanCalculationResult|null; area:number; names:Record<string,string>; disabled:boolean }) {
  let plan = null, error = "";
  if (result) { try { plan=calculateTankPlan(result,area,value.capacity_l); } catch(e) { error=e instanceof Error?e.message:"Проверьте ёмкость"; } }
  return <fieldset disabled={disabled} className="mb-3 space-y-3 rounded-md border p-3 text-sm">
    <legend className="font-semibold">Заправки и основание решения</legend>
    <p className="text-xs">Изменённый план до выдачи потребуется заново принять специалисту и подготовить на складе.</p>
    <label className="block">Полезная ёмкость бака, л готового раствора<input aria-label="Полезная ёмкость бака" type="number" min="0" step="0.0001" className="block w-full rounded border p-2" value={value.capacity_l} onChange={e=>onChange({...value,capacity_l:e.target.value,decision_confirmed:false})}/></label>
    {error?<p role="alert" className="text-amber-800">{error}</p>:null}
    {plan?<TankPlanDetails plan={plan} names={names}/>:null}
    <details><summary className="cursor-pointer">Формуляции и источники по препаратам</summary>
      <p className="my-2 text-xs">Нужны точный состав/концентрация и применимая в Казахстане этикетка или регистрационный источник. Ссылки и проверку указывает агроном; автоматической проверки разрешённости, безопасности культуры и совместимости нет.</p>
      {result?.materials.map(m=>{
        const s=value.sources.find(x=>x.product_id===m.product_id)||{product_id:m.product_id,formulation:"",source_url:"",checked_date:""};
        const update=(patch:Partial<ChemistrySource>)=>onChange({...value,decision_confirmed:false,sources:[...value.sources.filter(x=>x.product_id!==m.product_id),{...s,...patch}]});
        return <div key={m.product_id} className="my-2 space-y-2 rounded border p-2"><strong>{names[m.product_id]||m.product_id}</strong>
          <label className="block">Формуляция и концентрация<input aria-label={`Формуляция ${names[m.product_id]||m.product_id}`} className="block w-full rounded border p-2" value={s.formulation} onChange={e=>update({formulation:e.target.value})}/></label>
          <label className="block">Источник (https)<input type="url" className="block w-full rounded border p-2" value={s.source_url} onChange={e=>update({source_url:e.target.value})}/></label>
          <label className="block">Дата проверки<input type="date" className="block w-full rounded border p-2" value={s.checked_date} onChange={e=>update({checked_date:e.target.value})}/></label>
          {!s.formulation||!s.source_url||!s.checked_date?<p className="text-amber-800">Данных недостаточно для подтверждения решения.</p>:null}
        </div>;
      })}
    </details>
    <label className="flex items-start gap-2"><input type="checkbox" checked={value.decision_confirmed} onChange={e=>onChange({...value,decision_confirmed:e.target.checked})}/>Подтверждаю агрономическое решение по указанным формуляциям и источникам; расчёт объёмов сам по себе не является рекомендацией по применению.</label>
  </fieldset>;
}
