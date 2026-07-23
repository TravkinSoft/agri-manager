"use client";

import type { OperationPresentation } from "@/lib/operations/operation-presentation";

type WarehouseMaterialSnapshot = {
  productId: string;
  preparedQuantity: number;
  issuedQuantity: number;
  statusLabel: string;
};

type OperationPlanDetailsProps = {
  presentation: OperationPresentation;
  warehouseMaterials?: WarehouseMaterialSnapshot[];
  showExecutionFacts?: boolean;
};

function numberText(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
}

function identityText(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" / ");
}

export function OperationPlanDetails({
  presentation,
  warehouseMaterials = [],
  showExecutionFacts = false,
}: OperationPlanDetailsProps) {
  const warehouseByProduct = new Map(
    warehouseMaterials.map((item) => [item.productId, item])
  );
  const firstDetail = presentation.details.filter((detail) => detail.key === "solution_rate");
  const remainingDetails = presentation.details.filter((detail) => detail.key !== "solution_rate");
  const hasIdentity = Boolean(
    presentation.cropName || presentation.varietyName || presentation.reproductionName
  );

  return (
    <div className="space-y-4" data-testid="operation-plan-details">
      <section className="grid gap-3 border-b border-slate-800 pb-4 text-sm md:grid-cols-2">
        <div>
          <div className="text-xs text-slate-500">Поле</div>
          <div className="font-semibold text-slate-100">{presentation.fieldName}</div>
        </div>
        {hasIdentity ? (
          <div>
            <div className="text-xs text-slate-500">Культура</div>
            <div className="font-semibold text-slate-100">
              {identityText([
                presentation.cropName,
                presentation.varietyName,
                presentation.reproductionName,
              ])}
            </div>
          </div>
        ) : null}
        <div>
          <div className="text-xs text-slate-500">Плановая площадь</div>
          <div className="font-semibold text-slate-100">
            {numberText(presentation.plannedAreaHa)} га
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Дата</div>
          <div className="font-semibold text-slate-100">
            {new Date(presentation.date).toLocaleDateString("ru-RU")}
          </div>
        </div>
        {presentation.responsibleName ? (
          <div>
            <div className="text-xs text-slate-500">Ответственный</div>
            <div className="font-semibold text-slate-100">{presentation.responsibleName}</div>
          </div>
        ) : null}
        {presentation.machineName ? (
          <div>
            <div className="text-xs text-slate-500">Машина</div>
            <div className="font-semibold text-slate-100">{presentation.machineName}</div>
          </div>
        ) : null}
        {presentation.equipmentName ? (
          <div>
            <div className="text-xs text-slate-500">Оборудование</div>
            <div className="font-semibold text-slate-100">{presentation.equipmentName}</div>
          </div>
        ) : null}
        {presentation.transportName ? (
          <div>
            <div className="text-xs text-slate-500">Транспорт</div>
            <div className="font-semibold text-slate-100">{presentation.transportName}</div>
          </div>
        ) : null}
      </section>

      {presentation.planLines.length > 1 ? (
        <section className="space-y-2 border-b border-slate-800 pb-4">
          <h3 className="text-sm font-semibold text-slate-100">Участки обработки</h3>
          {presentation.planLines.map((line) => (
            <div
              key={line.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300"
            >
              <span>
                {identityText([
                  line.fieldName || presentation.fieldName,
                  line.cropName,
                  line.varietyName,
                  line.reproductionName,
                ])}
              </span>
              <span className="font-medium text-slate-100">
                {numberText(line.plannedAreaHa)} га
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {firstDetail.length > 0 ? (
        <section className="grid gap-3 border-b border-slate-800 pb-4 text-sm md:grid-cols-2">
          {firstDetail.map((detail) => (
            <div key={detail.key}>
              <div className="text-xs text-slate-500">{detail.label}</div>
              <div className="font-semibold text-slate-100">{detail.value}</div>
            </div>
          ))}
        </section>
      ) : null}

      {presentation.materialRows.length > 0 ? (
        <section className="space-y-2 border-b border-slate-800 pb-4">
          <h3 className="text-sm font-semibold text-slate-100">Материалы</h3>
          {presentation.materialRows.map((material) => {
            const rawMaterial = presentation.materials.find((item) => item.id === material.id);
            const warehouse = rawMaterial?.product_id
              ? warehouseByProduct.get(rawMaterial.product_id)
              : null;
            return (
              <div key={material.id} className="border-b border-slate-800/70 py-2 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-100">{material.name}</div>
                    {material.rateLabel ? (
                      <div className="text-xs text-slate-400">Норма: {material.rateLabel}</div>
                    ) : null}
                    {material.formula ? (
                      <div className="mt-1 text-sm text-slate-300">{material.formula}</div>
                    ) : null}
                  </div>
                  <div className="text-sm font-semibold text-slate-100">
                    {numberText(material.plannedQuantity)} {material.unit}
                  </div>
                </div>
                {material.isSeed ? (
                  <div className="mt-1 text-xs text-slate-500">
                    Фактическая выдача семян поступает из весовой.
                  </div>
                ) : warehouse ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>Подготовлено: {numberText(warehouse.preparedQuantity)} {material.unit}</span>
                    <span>Выдано: {numberText(warehouse.issuedQuantity)} {material.unit}</span>
                    <span>{warehouse.statusLabel}</span>
                  </div>
                ) : null}
                {showExecutionFacts && !material.isSeed ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>Выдано: {numberText(material.issuedQuantity)} {material.unit}</span>
                    {material.consumedQuantity != null ? (
                      <span>Использовано: {numberText(material.consumedQuantity)} {material.unit}</span>
                    ) : null}
                    {material.returnedQuantity != null ? (
                      <span>Возврат: {numberText(material.returnedQuantity)} {material.unit}</span>
                    ) : null}
                    {material.lossQuantity != null ? (
                      <span>Потери: {numberText(material.lossQuantity)} {material.unit}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {remainingDetails.length > 0 ? (
        <section className="grid gap-3 border-b border-slate-800 pb-4 text-sm md:grid-cols-2">
          {remainingDetails.map((detail) => (
            <div
              key={detail.key}
              className={detail.key === "solution_total" ? "md:col-span-2" : undefined}
            >
              <div className="text-xs text-slate-500">{detail.label}</div>
              <div
                className={
                  detail.key === "solution_total"
                    ? "text-base font-bold text-emerald-300"
                    : "font-semibold text-slate-100"
                }
              >
                {detail.value}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {presentation.agronomistComment ? (
        <section className="text-sm">
          <div className="text-xs text-slate-500">Комментарий агронома</div>
          <div className="mt-1 whitespace-pre-wrap text-slate-200">
            {presentation.agronomistComment}
          </div>
        </section>
      ) : null}
    </div>
  );
}
