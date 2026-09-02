"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createWarehouseOpeningBalance,
  getWarehouseOpeningBalanceReferences,
  type WarehouseOpeningBalanceLineInput,
} from "@/lib/services/warehouses";
import type { Warehouse } from "@/lib/types/warehouse";

type References = Awaited<ReturnType<typeof getWarehouseOpeningBalanceReferences>>;
type StructureRow = References["cropStructure"][number];

type DraftLine = {
  key: string;
  warehouseId: string;
  cropId: string;
  varietyId: string;
  reproductionId: string;
  fieldId: string;
  sourceIds: string[];
  sourceQuantities: Record<string, string>;
  originMode: "explicit" | "auto" | "unknown";
  physicalState: WarehouseOpeningBalanceLineInput["physical_state"];
  batchCode: string;
  batchName: string;
  quantityKg: string;
  moisturePercent: string;
  dockagePercent: string;
  notes: string;
  parentBatchId: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATE_OPTIONS: Array<{ value: DraftLine["physicalState"]; label: string }> = [
  { value: "SOURCE", label: "С поля / необработанное" },
  { value: "AFTER_CLEANING", label: "После очистки" },
  { value: "AFTER_DRYING", label: "После сушки" },
  { value: "COMMODITY_GRAIN", label: "Товарное зерно" },
  { value: "SCREENINGS", label: "Зерновая примесь" },
  { value: "TRIER_WASTE", label: "Триерный отход" },
  { value: "OTHER", label: "Другое состояние" },
];

function localDateTimeValue() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createDraftLine(defaultWarehouseId?: string | null): DraftLine {
  return {
    key: crypto.randomUUID(),
    warehouseId: defaultWarehouseId || "",
    cropId: "",
    varietyId: "",
    reproductionId: "",
    fieldId: "",
    sourceIds: [],
    sourceQuantities: {},
    originMode: "explicit",
    physicalState: "SOURCE",
    batchCode: "",
    batchName: "",
    quantityKg: "",
    moisturePercent: "",
    dockagePercent: "",
    notes: "",
    parentBatchId: "",
  };
}

function sameIdentity(left: StructureRow, right: StructureRow) {
  return left.crop_id === right.crop_id
    && left.variety_id === right.variety_id
    && left.reproduction_id === right.reproduction_id;
}

function displayName(row: { name?: string; name_ru?: string | null; code?: string | null } | undefined, fallback: string) {
  return String(row?.name_ru || row?.name || row?.code || fallback);
}

export function WarehouseOpeningBalanceDialog({
  open,
  onOpenChange,
  companyId,
  warehouses,
  defaultWarehouseId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  warehouses: Warehouse[];
  defaultWarehouseId?: string | null;
  onCreated: (result: Awaited<ReturnType<typeof createWarehouseOpeningBalance>>) => Promise<void> | void;
}) {
  const [references, setReferences] = useState<References | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentNo, setDocumentNo] = useState("");
  const [snapshotAt, setSnapshotAt] = useState(localDateTimeValue());
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([createDraftLine(defaultWarehouseId)]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getWarehouseOpeningBalanceReferences(companyId, { signal: controller.signal })
      .then(setReferences)
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить структуру посевов");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [companyId, open]);

  useEffect(() => {
    if (!open) return;
    setLines((current) => current.map((line, index) => index === 0 && !line.warehouseId
      ? { ...line, warehouseId: defaultWarehouseId || "" }
      : line));
  }, [defaultWarehouseId, open]);

  const fieldsById = useMemo(
    () => new Map((references?.fields || []).map((row) => [row.id, row])),
    [references],
  );
  const cropsById = useMemo(
    () => new Map((references?.crops || []).map((row) => [row.id, row])),
    [references],
  );
  const varietiesById = useMemo(
    () => new Map((references?.varieties || []).map((row) => [row.id, row])),
    [references],
  );
  const reproductionsById = useMemo(
    () => new Map((references?.reproductions || []).map((row) => [row.id, row])),
    [references],
  );
  const selectableStructures = useMemo(
    () => (references?.cropStructure || []).filter((row) =>
      row.crop_id
      && row.land_use_type !== "fallow"
      && !row.identity_review_required),
    [references],
  );

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  };

  const toggleSource = (line: DraftLine, row: StructureRow) => {
    const selected = line.sourceIds.includes(row.id);
    if (selected) {
      const nextIds = line.sourceIds.filter((id) => id !== row.id);
      const nextQuantities = { ...line.sourceQuantities };
      delete nextQuantities[row.id];
      if (nextIds.length === 0) {
        updateLine(line.key, { sourceIds: [], sourceQuantities: {}, cropId: "", varietyId: "", reproductionId: "" });
      } else {
        updateLine(line.key, { sourceIds: nextIds, sourceQuantities: nextQuantities });
      }
      return;
    }
    const first = selectableStructures.find((candidate) => candidate.id === line.sourceIds[0]);
    if (first && !sameIdentity(first, row)) {
      setError("В одной партии можно объединить только участки с одинаковой культурой, сортом и репродукцией.");
      return;
    }
    updateLine(line.key, {
      sourceIds: [...line.sourceIds, row.id],
      cropId: row.crop_id || "",
      varietyId: row.variety_id || "",
      reproductionId: row.reproduction_id || "",
      fieldId: line.sourceIds.length === 0 ? row.field_id : "",
    });
    setError(null);
  };

  const structureLabel = (row: StructureRow) => {
    const field = fieldsById.get(row.field_id);
    const crop = cropsById.get(String(row.crop_id || ""));
    const variety = varietiesById.get(String(row.variety_id || ""));
    const reproduction = reproductionsById.get(String(row.reproduction_id || ""));
    return `${field?.name || "Поле"} · ${displayName(crop, "Культура")} · ${displayName(variety, "без сорта")} · ${displayName(reproduction, "без репродукции")} · ${Number(row.area || 0).toLocaleString("ru-RU")} га`;
  };

  const submit = async () => {
    setError(null);
    if (!references?.activeSeasonId) {
      setError("Активный сезон не найден.");
      return;
    }
    if (!documentNo.trim() || !snapshotAt || !confirmed) {
      setError("Укажите документ, дату среза и подтвердите однократное проведение.");
      return;
    }
    const payloadLines: WarehouseOpeningBalanceLineInput[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const quantityKg = Number(line.quantityKg);
      if (!line.warehouseId || !line.cropId || !line.batchCode.trim() || !Number.isFinite(quantityKg) || quantityKg <= 0) {
        setError(`Строка ${index + 1}: заполните объект, культуру, код партии и массу.`);
        return;
      }
      if (line.originMode === "explicit" && line.sourceIds.length === 0) {
        setError(`Строка ${index + 1}: выберите точный участок структуры или смените режим происхождения.`);
        return;
      }
      const sourceQuantityValues = line.sourceIds.map((sourceId) => line.sourceQuantities[sourceId]?.trim() || "");
      const providedSourceQuantityCount = sourceQuantityValues.filter(Boolean).length;
      if (providedSourceQuantityCount > 0 && providedSourceQuantityCount !== line.sourceIds.length) {
        setError(`Строка ${index + 1}: укажите массу для каждого выбранного источника либо оставьте все доли неизвестными.`);
        return;
      }
      if (line.parentBatchId.trim() && !UUID_RE.test(line.parentBatchId.trim())) {
        setError(`Строка ${index + 1}: UUID родительской партии указан неверно.`);
        return;
      }
      payloadLines.push({
        warehouse_id: line.warehouseId,
        crop_id: line.cropId,
        variety_id: line.varietyId || null,
        reproduction_id: line.reproductionId || null,
        field_id: line.originMode === "auto" ? line.fieldId || null : null,
        batch_code: line.batchCode.trim(),
        batch_name: line.batchName.trim() || null,
        quantity_kg: quantityKg,
        physical_state: line.physicalState,
        origin_mode: line.originMode,
        sources: line.originMode === "explicit"
          ? line.sourceIds.map((cropStructureId) => ({
              crop_structure_id: cropStructureId,
              quantity_kg: providedSourceQuantityCount > 0 ? Number(line.sourceQuantities[cropStructureId]) : null,
            }))
          : [],
        parent_batch_id: line.parentBatchId.trim() || null,
        moisture_percent: line.moisturePercent ? Number(line.moisturePercent) : null,
        dockage_percent: line.dockagePercent ? Number(line.dockagePercent) : null,
        notes: line.notes.trim() || null,
      });
    }

    setSubmitting(true);
    try {
      const result = await createWarehouseOpeningBalance(companyId, {
        season_id: references.activeSeasonId,
        document_no: documentNo.trim(),
        snapshot_at: new Date(snapshotAt).toISOString(),
        notes: notes.trim() || null,
        lines: payloadLines,
      });
      await onCreated(result);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось провести начальный остаток");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Начальный остаток</DialogTitle>
          <DialogDescription>
            Однократный снимок реальных остатков без фиктивных талонов и взвешиваний. Структура посевов не изменяется.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
          {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div> : null}
          {loading ? <div className="text-sm text-slate-400">Загрузка структуры и справочников...</div> : null}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5"><Label>Номер документа *</Label><Input value={documentNo} onChange={(event) => setDocumentNo(event.target.value)} placeholder="ОСТ-2026-01" /></div>
            <div className="space-y-1.5"><Label>Дата и время среза *</Label><Input type="datetime-local" value={snapshotAt} onChange={(event) => setSnapshotAt(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Сезон</Label><Input value={references?.activeSeasonId ? "Активный сезон" : "Не найден"} disabled /></div>
          </div>
          <div className="space-y-1.5"><Label>Примечание к документу</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></div>

          <div className="space-y-3">
            {lines.map((line, index) => {
              const selectedIdentity = selectableStructures.find((row) => row.id === line.sourceIds[0]);
              const compatibleSources = selectedIdentity
                ? selectableStructures.filter((row) => sameIdentity(row, selectedIdentity))
                : selectableStructures;
              const varieties = (references?.varieties || []).filter((row) => row.crop_id === line.cropId && !row.archived && row.is_active !== false);
              return (
                <section key={line.key} className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/35 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">Строка {index + 1}</h3>
                    {lines.length > 1 ? <Button type="button" size="icon" variant="ghost" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 className="h-4 w-4" /></Button> : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1.5"><Label>Объект *</Label><Select value={line.warehouseId} onValueChange={(value) => updateLine(line.key, { warehouseId: value })}><SelectTrigger><SelectValue placeholder="Выберите объект" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label>Состояние *</Label><Select value={line.physicalState} onValueChange={(value) => updateLine(line.key, { physicalState: value as DraftLine["physicalState"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label>Происхождение *</Label><Select value={line.originMode} onValueChange={(value) => updateLine(line.key, { originMode: value as DraftLine["originMode"], sourceIds: value === "explicit" ? line.sourceIds : [], sourceQuantities: value === "explicit" ? line.sourceQuantities : {} })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="explicit">Точные участки</SelectItem><SelectItem value="auto">Авто — только одно совпадение</SelectItem><SelectItem value="unknown">Неизвестно</SelectItem></SelectContent></Select></div>
                  </div>

                  {line.originMode === "explicit" ? (
                    <div className="space-y-1.5">
                      <Label>Поле / участок структуры *</Label>
                      <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-800 p-2">
                        {compatibleSources.map((row) => {
                          const selected = line.sourceIds.includes(row.id);
                          return (
                            <div key={row.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-900">
                              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                                <input type="checkbox" className="mt-1" checked={selected} onChange={() => toggleSource(line, row)} />
                                <span>{structureLabel(row)}</span>
                              </label>
                              {selected ? (
                                <Input
                                  aria-label={`Масса источника ${structureLabel(row)}`}
                                  className="h-8 w-36"
                                  type="number"
                                  min="0.001"
                                  step="0.001"
                                  placeholder="кг, если известно"
                                  value={line.sourceQuantities[row.id] || ""}
                                  onChange={(event) => updateLine(line.key, {
                                    sourceQuantities: { ...line.sourceQuantities, [row.id]: event.target.value },
                                  })}
                                />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {line.sourceIds.length > 1 ? <p className="text-xs text-amber-300">Смешанная партия: сохранено {line.sourceIds.length} источника. Массы заполните для всех источников либо оставьте все неизвестными.</p> : null}
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="space-y-1.5"><Label>Культура *</Label><Select value={line.cropId} onValueChange={(value) => updateLine(line.key, { cropId: value, varietyId: "", reproductionId: "" })}><SelectTrigger><SelectValue placeholder="Культура" /></SelectTrigger><SelectContent>{(references?.crops || []).filter((row) => !row.archived && row.is_active !== false).map((row) => <SelectItem key={row.id} value={row.id}>{displayName(row, "Культура")}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1.5"><Label>Сорт</Label><Select value={line.varietyId || "none"} onValueChange={(value) => updateLine(line.key, { varietyId: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Не указан</SelectItem>{varieties.map((row) => <SelectItem key={row.id} value={row.id}>{displayName(row, "Сорт")}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1.5"><Label>Репродукция</Label><Select value={line.reproductionId || "none"} onValueChange={(value) => updateLine(line.key, { reproductionId: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Не указана</SelectItem>{(references?.reproductions || []).filter((row) => !row.archived && row.is_active !== false).map((row) => <SelectItem key={row.id} value={row.id}>{displayName(row, "Репродукция")}</SelectItem>)}</SelectContent></Select></div>
                      {line.originMode === "auto" ? <div className="space-y-1.5"><Label>Поле-фильтр</Label><Select value={line.fieldId || "any"} onValueChange={(value) => updateLine(line.key, { fieldId: value === "any" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Любое — если совпадение одно</SelectItem>{(references?.fields || []).map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></div> : null}
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1.5"><Label>Код партии *</Label><Input value={line.batchCode} onChange={(event) => updateLine(line.key, { batchCode: event.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Название партии</Label><Input value={line.batchName} onChange={(event) => updateLine(line.key, { batchName: event.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Фактическое нетто, кг *</Label><Input type="number" min="0.001" step="0.001" value={line.quantityKg} onChange={(event) => updateLine(line.key, { quantityKg: event.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Влажность, %</Label><Input type="number" min="0" max="100" step="0.001" value={line.moisturePercent} onChange={(event) => updateLine(line.key, { moisturePercent: event.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Сорность, %</Label><Input type="number" min="0" max="100" step="0.001" value={line.dockagePercent} onChange={(event) => updateLine(line.key, { dockagePercent: event.target.value })} /></div>
                    <div className="space-y-1.5"><Label>UUID родительской партии</Label><Input value={line.parentBatchId} onChange={(event) => updateLine(line.key, { parentBatchId: event.target.value })} placeholder="Если происхождение от известной партии" /></div>
                    <div className="space-y-1.5"><Label>Примечание</Label><Input value={line.notes} onChange={(event) => updateLine(line.key, { notes: event.target.value })} /></div>
                  </div>
                </section>
              );
            })}
          </div>
          <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, createDraftLine(defaultWarehouseId)])}><Plus className="mr-2 h-4 w-4" />Добавить строку</Button>
          <label className="flex items-start gap-2 rounded-md border border-amber-800/60 bg-amber-950/20 p-3 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Подтверждаю: это полный однократный начальный срез сезона. После проведения документ и lineage неизменяемы.</span></label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={submitting || loading}>{submitting ? "Проведение..." : "Провести начальный остаток"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
