'use client';

import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, MapPin, FileText, Check, X, Pencil } from 'lucide-react';
import { OperationDraft } from '@/lib/types/operation-draft';
import { useLanguage } from '@/lib/contexts/language-context';
import { format } from 'date-fns';

interface OperationDraftCardProps {
  draft: OperationDraft;
  onEdit: (draft: OperationDraft) => void;
  onConfirm: (draft: OperationDraft) => void;
  onCancel: () => void;
}

export function OperationDraftCard({
  draft,
  onEdit,
  onConfirm,
  onCancel,
}: OperationDraftCardProps) {
  const { t } = useLanguage();
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await onConfirm(draft);
    } finally {
      setIsConfirming(false);
    }
  };

  const getOperationTypeLabel = (type: string): string => {
    const typeMap: Record<string, any> = {
      'planting': 'planting',
      'harvesting': 'harvesting',
      'fertilization': 'fertilization',
      'irrigation': 'irrigation',
      'spraying': 'spraying',
      'cultivation': 'cultivation',
    };
    return t(typeMap[type] || type as any);
  };

  return (
    <Card className="border-green-200 bg-green-50/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-green-600" />
            {t('operation_draft')}
          </CardTitle>
          <Badge variant="outline" className="bg-white">
            {t('review_and_confirm')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-slate-500 mt-0.5" />
            <div>
              <div className="text-xs text-slate-500">{t('operation_type')}</div>
              <div className="font-medium">{getOperationTypeLabel(draft.operation_type)}</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 text-slate-500 mt-0.5" />
            <div>
              <div className="text-xs text-slate-500">{t('operation_date')}</div>
              <div className="font-medium">
                {draft.date ? format(new Date(draft.date), 'dd.MM.yyyy') : '-'}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 col-span-2">
            <MapPin className="h-4 w-4 text-slate-500 mt-0.5" />
            <div>
              <div className="text-xs text-slate-500">{t('field')}</div>
              <div className="font-medium">{draft.field_name || draft.field_id || '-'}</div>
            </div>
          </div>
        </div>

        {draft.notes && (
          <div className="pt-2 border-t">
            <div className="text-xs text-slate-500 mb-1">{t('notes')}</div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{draft.notes}</p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex gap-2 bg-white border-t">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="flex-1"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          {t('cancel_draft')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(draft)}
          className="flex-1"
        >
          <Pencil className="h-3.5 w-3.5 mr-1" />
          {t('edit_draft')}
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={isConfirming}
          className="flex-1 bg-green-600 hover:bg-green-700"
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {t('confirm_draft')}
        </Button>
      </CardFooter>
    </Card>
  );
}
