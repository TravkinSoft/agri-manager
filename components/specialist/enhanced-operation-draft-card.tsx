"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/lib/contexts/language-context";
import { calculateDraftValues } from "@/lib/utils/draft-calculations";
import type { OperationDraft } from "@/lib/types/operation-draft";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheckBig,
  FileText,
  Pencil,
  X,
} from "lucide-react";

interface EnhancedOperationDraftCardProps {
  draft: OperationDraft;
  fieldArea?: number;
  status?: "draft" | "confirming" | "confirmed" | "cancelled";
  confirmedAt?: string;
  operationId?: string;
  onEdit: (draft: OperationDraft) => void;
  onConfirm: (draft: OperationDraft) => void;
  onCancel: () => void;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return format(d, "dd.MM.yyyy HH:mm");
}

function valueRow(label: string, value?: string | number | null) {
  const shown =
    value !== null && value !== undefined && String(value).trim().length > 0
      ? String(value)
      : "-";

  return (
    <div className="grid grid-cols-[190px_1fr] gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium whitespace-pre-wrap">{shown}</span>
    </div>
  );
}

export function EnhancedOperationDraftCard({
  draft,
  fieldArea,
  status = "draft",
  confirmedAt,
  operationId,
  onEdit,
  onConfirm,
  onCancel,
}: EnhancedOperationDraftCardProps) {
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

  const [isConfirmingLocal, setIsConfirmingLocal] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const metadata = draft.metadata || {};
  const calc = useMemo(() => calculateDraftValues(draft, fieldArea), [draft, fieldArea]);

  const isConfirmed = status === "confirmed";
  const isCancelled = status === "cancelled";
  const isConfirming = status === "confirming" || isConfirmingLocal;

  const cardClass = isConfirmed
    ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200"
    : isCancelled
      ? "border-slate-300 bg-slate-50"
      : "border-green-200 bg-green-50/40";

  const handleConfirm = async () => {
    if (isConfirmed || isCancelled || isConfirming) return;
    setIsConfirmingLocal(true);
    try {
      await onConfirm(draft);
    } finally {
      setIsConfirmingLocal(false);
    }
  };

  return (
    <Card className={cardClass}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            {isConfirmed ? (
              <CircleCheckBig className="h-4 w-4 text-emerald-700" />
            ) : (
              <FileText className="h-4 w-4 text-green-700" />
            )}
            {isConfirmed
              ? t("Операция создана", "Операция құрылды", "Operation created")
              : t("Черновик операции", "Операция жобасы", "Operation draft")}
          </CardTitle>

          <Badge
            variant="outline"
            className={
              isConfirmed
                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                : isCancelled
                  ? "bg-slate-100 text-slate-700 border-slate-300"
                  : "bg-white"
            }
          >
            {isConfirmed
              ? t("Подтверждено", "Расталды", "Confirmed")
              : isCancelled
                ? t("Отменено", "Болдырылмады", "Cancelled")
                : isConfirming
                  ? t("Подтверждение...", "Расталуда...", "Confirming...")
                  : t("Готов к подтверждению", "Растауға дайын", "Ready to confirm")}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isConfirmed && (
          <div className="rounded-md border border-emerald-300 bg-emerald-100/70 p-3 text-sm text-emerald-950">
            <div className="font-semibold">
              {t(
                "Операция добавлена в систему",
                "Операция жүйеге қосылды",
                "Operation has been added to the system"
              )}
            </div>
            <div className="mt-1 text-emerald-900/90">
              {confirmedAt
                ? `${t("Подтверждено", "Расталды", "Confirmed")}: ${formatDate(confirmedAt)}`
                : ""}
              {confirmedAt && operationId ? " · " : ""}
              {operationId ? `ID: ${operationId}` : ""}
            </div>
          </div>
        )}

        <div className="rounded-md bg-white p-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {t("Кратко", "Қысқаша", "Summary")}
          </div>
          {valueRow(
            t("Тип операции", "Операция түрі", "Operation type"),
            draft.operation_type
          )}
          {valueRow(t("Поле", "Алаң", "Field"), draft.field_name || draft.field_id)}
          {valueRow(t("Культура", "Дақыл", "Crop"), draft.crop_name || metadata.crop)}
          {valueRow(t("Цель", "Мақсат", "Target"), metadata.target)}
          {valueRow(
            t("Основной препарат", "Негізгі препарат", "Main chemical"),
            metadata.product
          )}
          {valueRow(
            t("Дата/время", "Күні/уақыты", "Date/time"),
            formatDate(draft.operation_datetime || draft.date)
          )}
        </div>

        {(isConfirmed || isCancelled) && (
          <Button variant="outline" size="sm" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? (
              <ChevronUp className="h-4 w-4 mr-1" />
            ) : (
              <ChevronDown className="h-4 w-4 mr-1" />
            )}
            {showDetails
              ? t("Скрыть детали", "Детальдарды жасыру", "Hide details")
              : t("Показать детали", "Детальдарды көрсету", "Show details")}
          </Button>
        )}

        {(!isConfirmed && !isCancelled) || showDetails ? (
          <>
            <div className="rounded-md bg-white p-3 space-y-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {t("Препараты и смесь", "Препараттар мен қоспа", "Chemicals and mixture")}
              </div>
              {valueRow(
                t("Норма основного препарата (л/га)", "Негізгі препарат нормасы (л/га)", "Main rate (l/ha)"),
                metadata.rate_per_ha || metadata.rate
              )}
              {valueRow(
                t("Доп. препараты", "Қосымша препараттар", "Additional chemicals"),
                metadata.additional_products
              )}
              {valueRow(
                t("Норма вылива (л/га)", "Шығын нормасы (л/га)", "Spray volume (l/ha)"),
                metadata.spray_volume_per_ha || metadata.water_rate
              )}
              {valueRow(t("Итого смесь (л)", "Жалпы қоспа (л)", "Total mixture (l)"), calc.finishedMixtureTotal.toFixed(2))}
              {valueRow(t("Итого вода (л)", "Жалпы су (л)", "Total water (l)"), calc.waterTotal.toFixed(2))}
              {valueRow(t("Итого препараты (л)", "Жалпы препараттар (л)", "Total chemicals (l)"), calc.productsTotal.toFixed(2))}
            </div>

            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm space-y-1">
              <div className="font-semibold text-emerald-900">
                {t("Разбор расчета", "Есеп талдауы", "Calculation breakdown")}
              </div>
              <div>
                {t("Площадь", "Ауданы", "Area")}: {calc.area.toFixed(2)} {t("га", "га", "ha")}
              </div>
              <div>
                {t("Основной препарат", "Негізгі препарат", "Main chemical")}: {calc.area.toFixed(2)} ×{" "}
                {calc.ratePerHa.toFixed(2)} = {calc.mainProductTotal.toFixed(2)} {t("л", "л", "l")}
              </div>
              <div>
                {t("Смесь", "Қоспа", "Mixture")}: {calc.area.toFixed(2)} ×{" "}
                {calc.mixtureVolumePerHa.toFixed(2)} = {calc.finishedMixtureTotal.toFixed(2)} {t("л", "л", "l")}
              </div>
              <div>
                {t("Вода", "Су", "Water")}: {calc.finishedMixtureTotal.toFixed(2)} -{" "}
                {calc.productsTotal.toFixed(2)} = {calc.waterTotal.toFixed(2)} {t("л", "л", "l")}
              </div>
              <div>
                {t("Состав", "Құрамы", "Composition")}: {t("вода", "су", "water")}{" "}
                {calc.waterPercentage.toFixed(2)}%, {t("препараты", "препараттар", "chemicals")}{" "}
                {calc.productPercentage.toFixed(2)}%
              </div>
            </div>

            <div className="rounded-md bg-white p-3 space-y-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {t("Исполнение", "Орындау", "Execution")}
              </div>
              <div className="grid grid-cols-[190px_1fr] gap-2 text-sm">
                <span className="text-slate-500 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {t("Техника / агрегат", "Техника / агрегат", "Machine / equipment")}
                </span>
                <span className="font-medium">{metadata.equipment || "-"}</span>
              </div>
              {valueRow(t("Ответственный", "Жауапты", "Responsible"), metadata.responsible)}
              {valueRow(t("Комментарии", "Түсініктеме", "Comments"), metadata.comments || draft.notes)}
            </div>
          </>
        ) : null}
      </CardContent>

      {!isConfirmed && !isCancelled && (
        <CardFooter className="flex gap-2 bg-white border-t">
          <Button variant="outline" size="sm" onClick={onCancel} className="flex-1">
            <X className="h-3.5 w-3.5 mr-1" />
            {t("Отмена", "Болдырмау", "Cancel")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEdit(draft)} className="flex-1">
            <Pencil className="h-3.5 w-3.5 mr-1" />
            {t("Редактировать", "Өңдеу", "Edit")}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={isConfirming} className="flex-1 bg-green-600 hover:bg-green-700">
            <Check className="h-3.5 w-3.5 mr-1" />
            {isConfirming
              ? t("Подтверждение...", "Расталуда...", "Confirming...")
              : t("Подтвердить", "Растау", "Confirm")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
