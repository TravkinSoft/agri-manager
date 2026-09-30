"use client";
import { calculateMixture, type MixtureInput, type MixtureResult } from "@/lib/materials/tank-mixture";
export const emptyMixtureInput = (): MixtureInput => ({ prepared_l:"", applied_l:"", remaining_l:"", loss_l:"", application_method:"measured", loading_method:"measured", homogeneous_confirmed:false, measurement_note:"", remainder_location:"", remainder_custodian:"" });
export function MixtureReportEditor({ value, onChange, disabled }: { value:MixtureInput; onChange:(v:MixtureInput)=>void; disabled?:boolean }) {
  let result:MixtureResult|null=null, error="";
  try { result=calculateMixture(value); } catch(e) { error=e instanceof Error?e.message:"Проверьте баланс"; }
  return <fieldset disabled={disabled} className="space-y-3 rounded-md border p-3 text-sm"><legend className="font-semibold">Факт по готовой смеси</legend>
    <p>Один однородный состав на всю работу. Если заправки имели разные концентрации, оформите отдельные операции.</p>
    <div className="grid gap-2 sm:grid-cols-2">{([['prepared_l','Приготовлено раствора, л'],['remaining_l','Остаток готовой смеси, л'],['loss_l','Потери готовой смеси, л']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="0" step="0.0001" className="block w-full rounded border p-2" value={String(value[key]??"")} onChange={e=>onChange({...value,[key]:e.target.value})}/></label>)}</div>
    <label className="block">Расход раствора<select aria-label="Способ определения расхода раствора" className="block w-full rounded border p-2" value={value.application_method} onChange={e=>onChange({...value,application_method:e.target.value as MixtureInput['application_method'],applied_l:""})}><option value="measured">Измерен</option><option value="residual">Рассчитан по остатку и потерям</option></select></label>
    {value.application_method==='measured'?<label className="block">Нанесено раствора, л<input aria-label="Нанесено раствора, л" type="number" min="0" step="0.0001" className="block w-full rounded border p-2" value={String(value.applied_l??"")} onChange={e=>onChange({...value,applied_l:e.target.value})}/></label>:null}
    <label className="block">Загрузка чистого препарата<select aria-label="Способ определения загрузки препарата" className="block w-full rounded border p-2" value={value.loading_method} onChange={e=>onChange({...value,loading_method:e.target.value as MixtureInput['loading_method']})}><option value="measured">Измерена при загрузке</option><option value="stock_balance">Выдано − чистый возврат − чистые потери</option></select></label>
    <label className="block">Основание измерений и замечания<input aria-label="Основание измерений" className="block w-full rounded border p-2" value={value.measurement_note} onChange={e=>onChange({...value,measurement_note:e.target.value})}/></label>
    {Number(value.remaining_l)>0?<><label className="block">Место остатка смеси<input aria-label="Место остатка смеси" className="block w-full rounded border p-2" value={value.remainder_location} onChange={e=>onChange({...value,remainder_location:e.target.value})}/></label><label className="block">Ответственный за остаток<input aria-label="Ответственный за остаток" className="block w-full rounded border p-2" value={value.remainder_custodian} onChange={e=>onChange({...value,remainder_custodian:e.target.value})}/></label><p>Остаток учитывается отдельно. Он не возвращается на склад как исходный препарат; повторное применение или списание требует отдельного решения.</p></>:null}
    <label className="flex items-start gap-2"><input type="checkbox" checked={value.homogeneous_confirmed} onChange={e=>onChange({...value,homogeneous_confirmed:e.target.checked})}/>Подтверждаю одинаковый однородный состав подготовленной, нанесённой и оставшейся смеси.</label>
    {result?<p>Баланс: {result.equation}. Нанесено {result.applied_l} л — {result.application_method==='measured'?'измерено и проверено балансом':'рассчитано по остатку'}.</p>:<p className="text-amber-800">{error}</p>}
  </fieldset>;
}
export function MixtureReportSummary({ mixture, materials = [], names = {} }: { mixture:MixtureResult; materials?:Array<Record<string,unknown>>; names?:Record<string,string> }) {
  return <section aria-label="Сохранённый баланс смеси" className="space-y-2 rounded border p-3 text-sm">
    <p><strong>Раствор:</strong> приготовлено {mixture.prepared_l} л; нанесено {mixture.applied_l} л; остаток {mixture.remaining_l} л; потери {mixture.loss_l} л.</p>
    <p>Расход {mixture.application_method==='measured'?'измерен':'рассчитан по остатку'}. {mixture.equation}</p>
    <p>Основание: {mixture.measurement_note}</p>
    {mixture.remaining_l>0?<p>Остаток готовой смеси отдельно от складских препаратов: {mixture.remainder_location}; ответственный: {mixture.remainder_custodian}. Дальнейшее использование или списание ещё не оформлено.</p>:null}
    <details><summary className="cursor-pointer">Препараты: загружено, нанесено, осталось</summary>{materials.map((m,i)=>{
      const c=m.chemistry as {loaded_quantity:number;applied_quantity:number;remaining_quantity:number;mixture_loss_quantity:number;unit:string}|undefined;
      return c?<p key={String(m.material_id||i)}>{names[String(m.product_id)]||String(m.product_id)}: загружено {c.loaded_quantity}; нанесено {c.applied_quantity}; в остатке {c.remaining_quantity}; потери в смеси {c.mixture_loss_quantity} {c.unit==='l'?'л':'кг'}. Чистый возврат {String(m.returned_quantity)}; чистые потери {String(m.loss_quantity)}.</p>:null;
    })}<p>Нанесённое количество препарата рассчитано по однородному составу фактической смеси; это не отдельное измерение препарата на поле.</p></details>
  </section>;
}
