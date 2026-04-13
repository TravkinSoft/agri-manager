'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import type { OperationDraft } from '@/lib/types/operation-draft';
import type { EquipmentResource } from '@/lib/services/assistant-draft';
import { useLanguage } from '@/lib/contexts/language-context';
import { applyDraftCalculations, calculateDraftValues } from '@/lib/utils/draft-calculations';

type DraftOption = { id: string; name: string; area?: number };
type AdditionalChemical = { product_id: string; product: string; rate_per_ha: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DraftEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: OperationDraft | null;
  fields: DraftOption[];
  crops: DraftOption[];
  products: DraftOption[];
  specialists: DraftOption[];
  equipment: EquipmentResource[];
  onSave: (draft: OperationDraft) => void;
}

function toDateTimeLocal(value?: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const hh = String(parsed.getHours()).padStart(2, '0');
  const min = String(parsed.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function normalizeAdditionalChemicals(raw: unknown): AdditionalChemical[] {
  if (Array.isArray(raw)) {
    return raw.map((x: any) => ({
      product_id: String(x?.product_id || ''),
      product: String(x?.product || ''),
      rate_per_ha: String(x?.rate_per_ha || ''),
    }));
  }
  return [];
}

export function DraftEditorDialog({
  open,
  onOpenChange,
  draft,
  fields,
  crops,
  products,
  specialists,
  equipment,
  onSave,
}: DraftEditorDialogProps) {
  const { t } = useLanguage();
  const [editedDraft, setEditedDraft] = useState<OperationDraft | null>(null);
  const [additionalChemicals, setAdditionalChemicals] = useState<AdditionalChemical[]>([]);

  useEffect(() => {
    if (!draft) return;
    const metadata = { ...(draft.metadata || {}) };
    const comments = String(metadata.comments || draft.notes || '').trim();
    const normalizedDraft = applyDraftCalculations(
      {
        ...draft,
        operation_datetime: toDateTimeLocal(draft.operation_datetime || draft.date),
        metadata,
        notes: comments || draft.notes || '',
      },
      Number(metadata.area || 0)
    );
    setEditedDraft(normalizedDraft);
    setAdditionalChemicals(normalizeAdditionalChemicals(metadata.additional_products_list));
  }, [draft]);

  const selectedFieldArea = useMemo(() => {
    if (!editedDraft) return 0;
    const selectedField = fields.find((f) => f.id === editedDraft.field_id);
    return Number(selectedField?.area || editedDraft.metadata?.area || 0);
  }, [editedDraft, fields]);

  const specialistUsers = useMemo(
    () => specialists.filter((specialist) => UUID_RE.test(String(specialist.id || '').trim())),
    [specialists]
  );

  if (!editedDraft) return null;
  const metadata = editedDraft.metadata || {};

  const syncDraft = (next: OperationDraft) => {
    setEditedDraft(applyDraftCalculations(next, selectedFieldArea));
  };

  const updateDraft = (patch: Partial<OperationDraft>) => {
    if (!editedDraft) return;
    syncDraft({ ...editedDraft, ...patch });
  };

  const updateMetadata = (patch: Record<string, unknown>) => {
    if (!editedDraft) return;
    syncDraft({
      ...editedDraft,
      metadata: {
        ...(editedDraft.metadata || {}),
        ...patch,
      },
    });
  };

  const updateAdditionalChemicals = (next: AdditionalChemical[]) => {
    setAdditionalChemicals(next);
    const readable = next
      .filter((item) => item.product || item.rate_per_ha)
      .map((item) => `${item.product || 'Препарат'}: ${item.rate_per_ha || '0'}`)
      .join('\n');
    updateMetadata({
      additional_products_list: next,
      additional_products: readable,
    });
  };

  const operationTypes = [
    { value: 'planting', label: t('planting') },
    { value: 'harvesting', label: t('harvesting') },
    { value: 'fertilization', label: t('fertilization') },
    { value: 'irrigation', label: t('irrigation') },
    { value: 'spraying', label: t('spraying') },
    { value: 'cultivation', label: t('cultivation') },
  ];

  const handleSave = () => {
    if (!editedDraft) return;
    const safeDate =
      editedDraft.operation_datetime && editedDraft.operation_datetime.length >= 10
        ? editedDraft.operation_datetime.slice(0, 10)
        : editedDraft.date;
    const comments = String((editedDraft.metadata?.comments as string) || editedDraft.notes || '').trim();

    onSave({
      ...editedDraft,
      date: safeDate,
      notes: comments,
      metadata: {
        ...(editedDraft.metadata || {}),
        comments,
        additional_products_list: additionalChemicals,
      },
    });
    onOpenChange(false);
  };

  const c = calculateDraftValues(editedDraft, selectedFieldArea);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('edit_draft')}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label>{t('operation_type')}</Label>
            <Select value={editedDraft.operation_type} onValueChange={(value) => updateDraft({ operation_type: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {operationTypes.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('operation_date')}</Label>
            <Input type="datetime-local" value={editedDraft.operation_datetime || ''} onChange={(e) => updateDraft({ operation_datetime: e.target.value, date: e.target.value.slice(0, 10) })} />
          </div>

          <div className="space-y-2">
            <Label>{t('field')}</Label>
            <Select
              value={editedDraft.field_id || ''}
              onValueChange={(value) => {
                const selected = fields.find((f) => f.id === value);
                updateDraft({
                  field_id: value,
                  field_name: selected?.name || editedDraft.field_name,
                  metadata: {
                    ...(editedDraft.metadata || {}),
                    area: Number(selected?.area || 0).toFixed(2),
                  },
                });
              }}
            >
              <SelectTrigger><SelectValue placeholder={t('field_required')} /></SelectTrigger>
              <SelectContent>{fields.map((field) => <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('crop')}</Label>
            <Select
              value={editedDraft.crop_id || ''}
              onValueChange={(value) => {
                const selected = crops.find((x) => x.id === value);
                updateDraft({ crop_id: value, crop_name: selected?.name || editedDraft.crop_name });
                updateMetadata({ crop: selected?.name || '' });
              }}
            >
              <SelectTrigger><SelectValue placeholder={t('crop')} /></SelectTrigger>
              <SelectContent>{crops.map((crop) => <SelectItem key={crop.id} value={crop.id}>{crop.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Target / против чего</Label>
            <Input value={String(metadata.target || '')} onChange={(e) => updateMetadata({ target: e.target.value })} />
          </div>

          <div className="space-y-2">
            <Label>Основной препарат</Label>
            <Select
              value={String(metadata.product_id || '')}
              onValueChange={(value) => {
                const selected = products.find((p) => p.id === value);
                updateMetadata({ product_id: value, product: selected?.name || '' });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Выберите препарат" /></SelectTrigger>
              <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Норма основного препарата (на га)</Label>
            <Input value={String(metadata.rate_per_ha || '')} onChange={(e) => updateMetadata({ rate_per_ha: e.target.value })} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label>Дополнительные препараты</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateAdditionalChemicals([...additionalChemicals, { product_id: '', product: '', rate_per_ha: '' }])}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add chemical
              </Button>
            </div>
            <div className="space-y-2">
              {additionalChemicals.length === 0 && (
                <div className="text-sm text-slate-500">Дополнительные препараты не добавлены</div>
              )}
              {additionalChemicals.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-7">
                    <Select
                      value={item.product_id}
                      onValueChange={(value) => {
                        const selected = products.find((p) => p.id === value);
                        const next = [...additionalChemicals];
                        next[index] = { ...next[index], product_id: value, product: selected?.name || '' };
                        updateAdditionalChemicals(next);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите препарат" /></SelectTrigger>
                      <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-4">
                    <Input
                      value={item.rate_per_ha}
                      placeholder="Норма на га"
                      onChange={(e) => {
                        const next = [...additionalChemicals];
                        next[index] = { ...next[index], rate_per_ha: e.target.value };
                        updateAdditionalChemicals(next);
                      }}
                    />
                  </div>
                  <div className="col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => updateAdditionalChemicals(additionalChemicals.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Норма вылива (л/га)</Label>
            <Input
              value={String(metadata.spray_volume_per_ha || metadata.water_rate || '')}
              onChange={(e) => updateMetadata({ spray_volume_per_ha: e.target.value, water_rate: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Техника / агрегат</Label>
            <Select
              value={String(metadata.equipment_id || '')}
              onValueChange={(value) => {
                const selected = equipment.find((x) => x.id === value);
                updateMetadata({ equipment_id: value, equipment: selected?.name || '' });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Выберите технику" /></SelectTrigger>
              <SelectContent>{equipment.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Ответственный специалист / бригадир</Label>
            <Select
              value={String(metadata.responsible_id || '')}
              onValueChange={(value) => {
                const selected = specialistUsers.find((x) => x.id === value);
                updateMetadata({ responsible_id: value, responsible: selected?.name || '' });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Выберите ответственного" /></SelectTrigger>
              <SelectContent>{specialistUsers.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Комментарий</Label>
            <Textarea
              value={String(metadata.comments || editedDraft.notes || '')}
              onChange={(e) => {
                updateMetadata({ comments: e.target.value });
                updateDraft({ notes: e.target.value });
              }}
              rows={4}
            />
          </div>
        </div>

        <div className="rounded-md border bg-slate-50 p-3">
          <div className="space-y-1 text-sm">
            <div className="font-medium text-slate-900">Расчет</div>
            <div>Площадь: {c.area.toFixed(2)} га</div>
            <div>Основной препарат: {c.area.toFixed(2)} × {c.ratePerHa.toFixed(2)} = {c.mainProductTotal.toFixed(2)} л</div>
            <div>Норма вылива: {c.area.toFixed(2)} × {c.mixtureVolumePerHa.toFixed(2)} = {c.finishedMixtureTotal.toFixed(2)} л</div>
            <div>Доп. препараты (сумма): {c.additionalProductsTotal.toFixed(2)} л</div>
            <div>Всего препараты: {c.mainProductTotal.toFixed(2)} + {c.additionalProductsTotal.toFixed(2)} = {c.productsTotal.toFixed(2)} л</div>
            <div>Вода: {c.finishedMixtureTotal.toFixed(2)} - {c.productsTotal.toFixed(2)} = {c.waterTotal.toFixed(2)} л</div>
            <div>Доли: вода {c.waterPercentage.toFixed(2)}%, препараты {c.productPercentage.toFixed(2)}%</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button onClick={handleSave}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
