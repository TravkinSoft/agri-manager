"use client";
import { useState } from "react";
import type { TankPlan } from "@/lib/materials/tank-mixture";

const n = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
export function TankPlanDetails({ plan, names = {} }: { plan: TankPlan; names?: Record<string,string> }) {
  const [index, setIndex] = useState(0);
  const tank = plan.tanks[Math.min(index, plan.tanks.length - 1)];
  if (!tank) return null;
  return <section aria-label="План заправок" className="space-y-2 rounded-md border p-3 text-sm">
    <p><strong>Полные баки: {plan.full_tanks} × {n(plan.capacity_l)} л</strong>{plan.last_tank_l > 0 ? ` + последний ${n(plan.last_tank_l)} л` : "; неполного бака нет"}.</p>
    <p>Всего готового раствора: {n(plan.total_solution_l)} л. Ёмкость относится к готовому раствору.</p>
    <details><summary className="cursor-pointer">Дозы и вода по бакам</summary>
      <label className="mt-2 block">Бак <select aria-label="Номер бака" className="rounded border p-1" value={Math.min(index, plan.tanks.length - 1)} onChange={e=>setIndex(Number(e.target.value))}>
        {plan.tanks.map((t,i)=><option key={t.number} value={i}>{t.number} · {n(t.solution_l)} л</option>)}
      </select></label>
      <p>Площадь: {n(tank.area_ha)} га · готовый раствор: {n(tank.solution_l)} л · вода ≈ {n(tank.water_l)} л.</p>
      <ul className="list-disc pl-5">{tank.materials.map(m=><li key={m.product_id}>{names[m.product_id] || m.product_id}: {n(m.quantity)} {m.unit === "l" ? "л" : "кг"} ({n(m.quantity * 1000)} {m.unit === "l" ? "мл" : "г"}); {m.unit === "l" ? `${n(m.quantity / tank.solution_l * 100)}% об./об.` : `${n(m.quantity * 1000 / tank.solution_l)} г/л раствора`}</li>)}</ul>
      <p className="text-xs text-muted-foreground">Округление распределено между баками; сумма доз равна плану операции. Вода — приближение по сумме жидких объёмов; сухая масса не считается объёмом. Приготовление — до итогового объёма. Порядок смешивания и совместимость этим расчётом не установлены.</p>
    </details>
  </section>;
}
