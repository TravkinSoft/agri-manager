'use client';

import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, Pencil, Calendar, FileText, Beaker, Tractor, User } from 'lucide-react';
import type { OperationDraft } from '@/lib/types/operation-draft';
import { format } from 'date-fns';
import { calculateDraftValues } from '@/lib/utils/draft-calculations';

interface EnhancedOperationDraftCardProps {
  draft: OperationDraft;
  fieldArea?: number;
  status?: "pending" | "confirmed";
  onEdit: (draft: OperationDraft) => void;
  onConfirm: (draft: OperationDraft) => void;
  onCancel: () => void;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, 'dd.MM.yyyy HH:mm');
}

function row(label: string, value?: string | null) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium whitespace-pre-wrap">{value && String(value).trim() ? value : '-'}</span>
    </div>
  );
}

export function EnhancedOperationDraftCard({
  draft,
  fieldArea,
  status = "pending",
  onEdit,
  onConfirm,
  onCancel,
}: EnhancedOperationDraftCardProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const metadata = draft.metadata || {};
  const c = calculateDraftValues(draft, fieldArea);

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await onConfirm(draft);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Card className="border-green-200 bg-green-50/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-green-700" />
            Черновик операции
          </CardTitle>
          <Badge variant="outline" className="bg-white">
            {status === "confirmed" ? "Операция создана" : "Готов к подтверждению"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="bg-white rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-600">
            <FileText className="h-3.5 w-3.5" />
            Основные данные
          </div>
          {row('Тип операции', draft.operation_type)}
          {row('Поле', draft.field_name || draft.field_id)}
          {row('Культура', draft.crop_name || metadata.crop)}
          {row('Цель / против чего', metadata.target)}
          <div className="grid grid-cols-[200px_1fr] gap-2 text-sm">
            <span className="text-slate-500 flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Дата/время</span>
            <span className="font-medium">{formatDate(draft.operation_datetime || draft.date)}</span>
          </div>
        </div>

        <div className="bg-white rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-600">
            <Beaker className="h-3.5 w-3.5" />
            Препараты и смесь
          </div>
          {row('Основной препарат', metadata.product)}
          {row('Норма основного препарата (на га)', metadata.rate_per_ha || metadata.rate)}
          {row('Дополнительные препараты / pH-корректоры', metadata.additional_products)}
          {row('Норма вылива (л/га)', metadata.spray_volume_per_ha || metadata.water_rate)}
          {row('Итого смесь', metadata.total_mixture_volume)}
          {row('Итого вода', metadata.total_water_volume || metadata.total_water)}
          {row('Итого препараты', metadata.total_product_volume || metadata.total_amount)}
          {row('Доля воды (%)', metadata.water_percentage)}
          {row('Доля препаратов (%)', metadata.product_percentage)}
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-1 text-sm">
          <div className="font-semibold text-emerald-900">Разбор расчета</div>
          <div>Площадь: {c.area.toFixed(2)} га</div>
          <div>Норма: {c.ratePerHa.toFixed(2)} л/га</div>
          <div>Основной препарат: {c.area.toFixed(2)} × {c.ratePerHa.toFixed(2)} = {c.mainProductTotal.toFixed(2)} л</div>
          <div>Норма вылива: {c.mixtureVolumePerHa.toFixed(2)} л/га</div>
          <div>Итого смесь: {c.area.toFixed(2)} × {c.mixtureVolumePerHa.toFixed(2)} = {c.finishedMixtureTotal.toFixed(2)} л</div>
          <div>Доп. препараты: {c.additionalProductsTotal.toFixed(2)} л</div>
          <div>Всего препараты: {c.mainProductTotal.toFixed(2)} + {c.additionalProductsTotal.toFixed(2)} = {c.productsTotal.toFixed(2)} л</div>
          <div>Итого вода: {c.finishedMixtureTotal.toFixed(2)} - {c.productsTotal.toFixed(2)} = {c.waterTotal.toFixed(2)} л</div>
          <div>Состав: вода {c.waterPercentage.toFixed(2)}%, препараты {c.productPercentage.toFixed(2)}%</div>
        </div>

        <div className="bg-white rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-600">
            <Tractor className="h-3.5 w-3.5" />
            Исполнение
          </div>
          {row('Техника / агрегат', metadata.equipment)}
          <div className="grid grid-cols-[200px_1fr] gap-2 text-sm">
            <span className="text-slate-500 flex items-center gap-1"><User className="h-3.5 w-3.5" />Ответственный</span>
            <span className="font-medium">{metadata.responsible || '-'}</span>
          </div>
          {row('Комментарии', metadata.comments || draft.notes)}
        </div>
      </CardContent>

      {status !== "confirmed" && (
        <CardFooter className="flex gap-2 bg-white border-t">
          <Button variant="outline" size="sm" onClick={onCancel} className="flex-1">
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEdit(draft)} className="flex-1">
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={isConfirming} className="flex-1 bg-green-600 hover:bg-green-700">
            <Check className="h-3.5 w-3.5 mr-1" />
            Confirm
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
