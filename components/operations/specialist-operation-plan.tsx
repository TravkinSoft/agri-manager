"use client";

import { MessageSquareText, Tractor } from "lucide-react";
import type { OperationPresentation } from "@/lib/operations/operation-presentation";

export type SpecialistWarehouseMaterial = {
  productId: string;
  preparedQuantity: number;
  issuedQuantity: number;
  expectedReturnQuantity: number;
  statusLabel: string;
};

type SpecialistOperationPlanProps = {
  presentation: OperationPresentation;
  warehouseMaterials?: SpecialistWarehouseMaterial[];
};

function numberText(value: number, maximumFractionDigits = 3): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits });
}

function identityText(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" / ");
}

function DetailValue({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[13px] text-slate-500">{label}</div>
      <div
        className={
          emphasis
            ? "mt-1 text-lg font-bold text-yellow-300"
            : "mt-1 text-sm font-semibold text-slate-100"
        }
      >
        {value}
      </div>
    </div>
  );
}

export function SpecialistOperationPlan({
  presentation,
  warehouseMaterials = [],
}: SpecialistOperationPlanProps) {
  const warehouseByProduct = new Map(
    warehouseMaterials.map((item) => [item.productId, item])
  );
  const detailByKey = new Map(
    presentation.details.map((detail) => [detail.key, detail])
  );
  const mixtureKeys = new Set([
    "solution_rate",
    "liquid_materials",
    "water",
    "concentration",
    "solution_total",
  ]);
  const hasMixture = detailByKey.has("solution_total");
  const hasAssets = Boolean(
    presentation.machineName ||
      presentation.equipmentName ||
      presentation.transportName
  );
  const generalDetails = presentation.details.filter(
    (detail) => !mixtureKeys.has(detail.key)
  );

  return (
    <div className="space-y-6" data-testid="specialist-operation-plan">
      <section
        className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Сводка плана"
      >
        <DetailValue
          label="Плановая площадь"
          value={`${numberText(presentation.plannedAreaHa)} га`}
        />
        <DetailValue
          label="Текущий прогресс"
          value={`${numberText(presentation.completedAreaHa)} / ${numberText(
            presentation.plannedAreaHa
          )} га`}
        />
        <DetailValue
          label={presentation.isOverPlan ? "Перевыполнение" : "Осталось"}
          value={`${presentation.isOverPlan ? "+" : ""}${numberText(
            presentation.isOverPlan
              ? presentation.deviationAreaHa
              : presentation.remainingAreaHa
          )} га`}
        />
        {presentation.responsibleName ? (
          <DetailValue
            label="Ответственный"
            value={presentation.responsibleName}
          />
        ) : null}
      </section>

      {presentation.planLines.length > 1 ? (
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-slate-100">
            Участки обработки
          </h3>
          <div className="space-y-3">
            {presentation.planLines.map((line, index) => (
              <div
                key={line.id}
                className="grid gap-1 text-sm sm:grid-cols-[32px_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
              >
                <span className="hidden text-slate-500 sm:block">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-slate-100">
                    {line.fieldName || presentation.fieldName}
                  </div>
                  {identityText([
                    line.cropName,
                    line.varietyName,
                    line.reproductionName,
                  ]) ? (
                    <div className="mt-0.5 text-[13px] text-slate-400">
                      {identityText([
                        line.cropName,
                        line.varietyName,
                        line.reproductionName,
                      ])}
                    </div>
                  ) : null}
                </div>
                <div className="font-semibold text-slate-100">
                  {numberText(line.plannedAreaHa)} га
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 pt-1 text-sm font-semibold text-slate-100">
              <span>Итого</span>
              <span>{numberText(presentation.plannedAreaHa)} га</span>
            </div>
          </div>
        </section>
      ) : null}

      {generalDetails.length > 0 ? (
        <section className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {generalDetails.map((detail) => (
            <DetailValue key={detail.key} label={detail.label} value={detail.value} />
          ))}
        </section>
      ) : null}

      {hasMixture ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-100">
              Баковая смесь (расчёт)
            </h3>
            {detailByKey.get("solution_rate") ? (
              <DetailValue
                label={detailByKey.get("solution_rate")!.label}
                value={detailByKey.get("solution_rate")!.value}
              />
            ) : null}
          </div>

          {presentation.materialRows.length > 0 ? (
            <div className="space-y-4">
              {presentation.materialRows.map((material) => {
                const rawMaterial = presentation.materials.find(
                  (item) => item.id === material.id
                );
                const warehouse = rawMaterial?.product_id
                  ? warehouseByProduct.get(rawMaterial.product_id)
                  : null;
                return (
                  <div
                    key={material.id}
                    className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)_auto] sm:items-center sm:gap-4"
                  >
                    <div>
                      <div className="font-medium text-slate-100">
                        {material.name}
                      </div>
                      {warehouse ? (
                        <div className="mt-1 text-[13px] text-slate-400">
                          {warehouse.statusLabel}
                          {` · ожидаемый возврат ${numberText(
                            warehouse.expectedReturnQuantity
                          )} ${material.unit}`}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-slate-300">
                      {material.formula || material.rateLabel || null}
                    </div>
                    <div className="font-semibold text-slate-100">
                      {numberText(material.plannedQuantity)} {material.unit}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {["liquid_materials", "water", "concentration"].map((key) => {
              const detail = detailByKey.get(key);
              return detail ? (
                <DetailValue
                  key={detail.key}
                  label={detail.label}
                  value={detail.value}
                />
              ) : null;
            })}
            {detailByKey.get("solution_total") ? (
              <div className="sm:col-span-2">
                <DetailValue
                  label={detailByKey.get("solution_total")!.label.toUpperCase()}
                  value={detailByKey.get("solution_total")!.value}
                  emphasis
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : presentation.materialRows.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-slate-100">Материалы</h3>
          <div className="space-y-4">
            {presentation.materialRows.map((material) => {
              const rawMaterial = presentation.materials.find(
                (item) => item.id === material.id
              );
              const warehouse = rawMaterial?.product_id
                ? warehouseByProduct.get(rawMaterial.product_id)
                : null;
              return (
                <div key={material.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-100">
                        {material.name}
                      </div>
                      {material.rateLabel ? (
                        <div className="mt-1 text-[13px] text-slate-400">
                          Норма: {material.rateLabel}
                        </div>
                      ) : null}
                      {material.formula ? (
                        <div className="mt-1 text-sm text-slate-300">
                          {material.formula}
                        </div>
                      ) : null}
                    </div>
                    <div className="font-semibold text-slate-100">
                      {numberText(material.plannedQuantity)} {material.unit}
                    </div>
                  </div>
                  {material.isSeed ? (
                    <div className="mt-2 text-[13px] text-slate-500">
                      Фактическая выдача семян поступает из весовой.
                    </div>
                  ) : warehouse ? (
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-400">
                      <span>
                        Подготовлено: {numberText(warehouse.preparedQuantity)}{" "}
                        {material.unit}
                      </span>
                      <span>
                        Выдано: {numberText(warehouse.issuedQuantity)}{" "}
                        {material.unit}
                      </span>
                      <span>
                        Ожидаемый возврат:{" "}
                        {numberText(warehouse.expectedReturnQuantity)}{" "}
                        {material.unit}
                      </span>
                      <span>{warehouse.statusLabel}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {hasAssets ? (
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-slate-100">
            Техника и оборудование
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {presentation.machineName ? (
              <div className="flex items-center gap-3">
                <Tractor className="h-7 w-7 shrink-0 text-slate-500" />
                <DetailValue label="Машина" value={presentation.machineName} />
              </div>
            ) : null}
            {presentation.equipmentName ? (
              <DetailValue
                label="Оборудование"
                value={presentation.equipmentName}
              />
            ) : null}
            {presentation.transportName ? (
              <DetailValue label="Транспорт" value={presentation.transportName} />
            ) : null}
          </div>
        </section>
      ) : null}

      {presentation.agronomistComment ? (
        <section className="flex gap-3">
          <MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Комментарий агронома
            </h3>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {presentation.agronomistComment}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
