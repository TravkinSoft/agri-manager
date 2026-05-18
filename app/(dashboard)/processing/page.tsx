"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import { getWarehouses } from "@/lib/services/warehouses";
import {
  BatchClass,
  TransformationOutputDraft,
  TransformationType,
  createBatchTransformation,
  finalizeBatchTransformation,
  getProcessingTransformations,
  getWarehouseStockIdentities,
  type BatchTransformationRow,
  type StockIdentityItem,
} from "@/lib/services/processing";

const PROCESSING_TYPES: Array<{ value: TransformationType; label: string; hint: string }> = [
  { value: "drying", label: "Сушка", hint: "усушка и влажность" },
  { value: "cleaning", label: "Очистка", hint: "чистый продукт, фураж, отход" },
  { value: "sorting", label: "Сортировка", hint: "фракции и классы" },
  { value: "seed_treatment", label: "Протравка", hint: "обработка семян" },
  { value: "seed_selection", label: "Семенной отбор", hint: "семенной фонд из партии" },
];

const LINE_TYPES = [
  { value: "commodity", label: "Товарное" },
  { value: "cleaned_seed", label: "Очищенные семена" },
  { value: "treated_seed", label: "Протравленные семена" },
  { value: "forage_fraction", label: "Фураж" },
  { value: "waste_fraction", label: "Отход" },
  { value: "shrink_loss", label: "Усушка" },
  { value: "calibrated_fraction", label: "Калиброванная фракция" },
  { value: "other", label: "Другое" },
];

const BATCH_CLASSES: Array<{ value: BatchClass; label: string }> = [
  { value: "commodity", label: "Товарное" },
  { value: "seed", label: "Семенной фонд" },
  { value: "feed", label: "Кормовое" },
  { value: "waste", label: "Отход" },
  { value: "processing", label: "В доработке" },
  { value: "rejected", label: "Брак" },
];

const LOSS_LINE_TYPES = new Set(["shrink_loss"]);

type OutputFormRow = {
  id: string;
  line_type: string;
  batch_class: BatchClass;
  warehouse_to_id: string;
  output_weight_kg: string;
};

const uid = () => Math.random().toString(36).slice(2);

const defaultOutputs = (type: TransformationType): OutputFormRow[] => {
  if (type === "drying") {
    return [
      { id: uid(), line_type: "commodity", batch_class: "commodity", warehouse_to_id: "", output_weight_kg: "" },
      { id: uid(), line_type: "shrink_loss", batch_class: "waste", warehouse_to_id: "", output_weight_kg: "" },
    ];
  }
  if (type === "cleaning") {
    return [
      { id: uid(), line_type: "commodity", batch_class: "commodity", warehouse_to_id: "", output_weight_kg: "" },
      { id: uid(), line_type: "forage_fraction", batch_class: "feed", warehouse_to_id: "", output_weight_kg: "" },
      { id: uid(), line_type: "waste_fraction", batch_class: "waste", warehouse_to_id: "", output_weight_kg: "" },
    ];
  }
  if (type === "seed_treatment") {
    return [{ id: uid(), line_type: "treated_seed", batch_class: "seed", warehouse_to_id: "", output_weight_kg: "" }];
  }
  if (type === "seed_selection") {
    return [
      { id: uid(), line_type: "cleaned_seed", batch_class: "seed", warehouse_to_id: "", output_weight_kg: "" },
      { id: uid(), line_type: "commodity", batch_class: "commodity", warehouse_to_id: "", output_weight_kg: "" },
    ];
  }
  return [
    { id: uid(), line_type: "commodity", batch_class: "commodity", warehouse_to_id: "", output_weight_kg: "" },
    { id: uid(), line_type: "waste_fraction", batch_class: "waste", warehouse_to_id: "", output_weight_kg: "" },
  ];
};

const formatKg = (value: number) => {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} кг`;
};

const typeLabel = (value: string) => PROCESSING_TYPES.find((item) => item.value === value)?.label || value;
const lineTypeLabel = (value: string) => LINE_TYPES.find((item) => item.value === value)?.label || value;
const batchClassLabel = (value: string) => BATCH_CLASSES.find((item) => item.value === value)?.label || value;

export default function ProcessingPage() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [stockLoading, setStockLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<BatchTransformationRow[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [stockRows, setStockRows] = useState<StockIdentityItem[]>([]);

  const [type, setType] = useState<TransformationType>("drying");
  const [processingNodeId, setProcessingNodeId] = useState("");
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [stockKey, setStockKey] = useState("");
  const [inputQty, setInputQty] = useState("");
  const [note, setNote] = useState("");
  const [outputs, setOutputs] = useState<OutputFormRow[]>(() => defaultOutputs("drying"));

  const selectedStock = useMemo(
    () => stockRows.find((row) => row.key === stockKey) || null,
    [stockRows, stockKey]
  );

  const outputTotal = outputs.reduce((sum, row) => sum + Number(row.output_weight_kg || 0), 0);
  const inputValue = Number(inputQty || 0);

  const loadData = async () => {
    if (!profile?.company_id || !profile?.id) return;
    setLoading(true);
    try {
      const [transformations, warehouseRows, nodesRes] = await Promise.all([
        getProcessingTransformations(profile.company_id, profile.id),
        getWarehouses(profile.company_id),
        supabase.from("processing_nodes").select("id,name,type,is_active").eq("company_id", profile.company_id).order("name", { ascending: true }),
      ]);
      setRows(transformations);
      setWarehouses(warehouseRows);
      setNodes((nodesRes.data || []).filter((node: any) => node.is_active !== false));
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить доработку",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadStock = async () => {
    if (!profile?.company_id || !profile?.id || !sourceWarehouseId) {
      setStockRows([]);
      return;
    }
    setStockLoading(true);
    try {
      const items = await getWarehouseStockIdentities(profile.company_id, profile.id, sourceWarehouseId);
      setStockRows(items.filter((item) => Boolean(item.batch_id)));
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить партии склада",
        variant: "destructive",
      });
    } finally {
      setStockLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [profile?.company_id, profile?.id]);

  useEffect(() => {
    setStockKey("");
    loadStock();
  }, [sourceWarehouseId, profile?.company_id, profile?.id]);

  const handleTypeChange = (nextType: TransformationType) => {
    setType(nextType);
    setOutputs(defaultOutputs(nextType));
  };

  const updateOutput = (id: string, patch: Partial<OutputFormRow>) => {
    setOutputs((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addOutput = () => {
    setOutputs((current) => [
      ...current,
      { id: uid(), line_type: "commodity", batch_class: "commodity", warehouse_to_id: "", output_weight_kg: "" },
    ]);
  };

  const removeOutput = (id: string) => {
    setOutputs((current) => current.filter((row) => row.id !== id));
  };

  const handleCreate = async () => {
    if (!profile?.company_id || !profile?.id) return;
    const normalizedOutputs: TransformationOutputDraft[] = outputs
      .map((row) => ({
        line_type: row.line_type,
        batch_class: row.batch_class,
        warehouse_to_id: LOSS_LINE_TYPES.has(row.line_type) ? null : row.warehouse_to_id || null,
        output_weight_kg: Number(row.output_weight_kg || 0),
      }))
      .filter((row) => row.output_weight_kg > 0);

    if (!sourceWarehouseId || !selectedStock?.batch_id || inputValue <= 0 || normalizedOutputs.length === 0) {
      toast({
        title: "Ошибка",
        description: "Выберите склад, входную партию и заполните массу входа/выходов",
        variant: "destructive",
      });
      return;
    }

    if (inputValue > Number(selectedStock.quantity || 0)) {
      toast({
        title: "Ошибка",
        description: "Масса входа больше доступного остатка партии",
        variant: "destructive",
      });
      return;
    }

    if (Math.abs(outputTotal - inputValue) > 0.001) {
      toast({
        title: "Проверьте баланс",
        description: "Сумма выходов и потерь должна совпадать с входной массой",
        variant: "destructive",
      });
      return;
    }

    try {
      setSubmitting(true);
      await createBatchTransformation({
        company_id: profile.company_id,
        actor_user_id: profile.id,
        transformation_type: type,
        processing_node_id: processingNodeId || null,
        note: note || null,
        input: {
          batch_id: selectedStock.batch_id,
          warehouse_from_id: sourceWarehouseId,
          input_weight_kg: inputValue,
        },
        outputs: normalizedOutputs,
      });
      toast({ title: "Создано", description: "Черновик доработки создан" });
      setInputQty("");
      setNote("");
      setStockKey("");
      setOutputs(defaultOutputs(type));
      await loadData();
      await loadStock();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось создать доработку",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinalize = async (id: string) => {
    if (!profile?.id) return;
    try {
      setSubmitting(true);
      await finalizeBatchTransformation(id, profile.id);
      toast({ title: "Готово", description: "Доработка финализирована, проводки созданы" });
      await loadData();
      await loadStock();
    } catch (error: any) {
      toast({
        title: "Ошибка финализации",
        description: error?.message || "Не удалось финализировать доработку",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Доработка продукции" description="Трансформация партий: сушка, очистка, сортировка, протравка и семенной отбор" />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Новая трансформация партии</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-5">
            {PROCESSING_TYPES.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={type === item.value ? "default" : "outline"}
                className="h-auto justify-start px-3 py-2 text-left"
                onClick={() => handleTypeChange(item.value)}
              >
                <span>
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className={type === item.value ? "block text-[11px] text-white/75" : "block text-[11px] text-slate-500"}>{item.hint}</span>
                </span>
              </Button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Узел доработки</Label>
              <Select value={processingNodeId} onValueChange={setProcessingNodeId}>
                <SelectTrigger><SelectValue placeholder="ЗАВ, сушилка, линия..." /></SelectTrigger>
                <SelectContent>
                  {nodes.map((node: any) => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Склад-источник *</Label>
              <Select value={sourceWarehouseId} onValueChange={setSourceWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse: any) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Входная партия *</Label>
              <Select value={stockKey} onValueChange={setStockKey} disabled={!sourceWarehouseId || stockLoading}>
                <SelectTrigger><SelectValue placeholder={stockLoading ? "Загрузка партий..." : "Только партии из склада"} /></SelectTrigger>
                <SelectContent>
                  {stockRows.length === 0 ? <SelectItem value="__empty" disabled>{stockLoading ? "Загрузка..." : "Партии не найдены"}</SelectItem> : null}
                  {stockRows.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {selectedStock ? (
                <>
                  <div className="font-semibold">{selectedStock.product_name} / {selectedStock.variety_name} / {selectedStock.reproduction_name}</div>
                  <div className="mt-0.5 text-xs">Класс: {selectedStock.batch_class_label} · Доступно: {formatKg(selectedStock.quantity)}</div>
                </>
              ) : (
                "Выберите точную складскую партию. Доработка не работает по глобальному каталогу."
              )}
            </div>
            <div className="space-y-1">
              <Label>Масса входа, кг *</Label>
              <Input value={inputQty} onChange={(event) => setInputQty(event.target.value)} placeholder="100000" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Выходы и потери</Label>
              <Button type="button" size="sm" variant="outline" onClick={addOutput}>Добавить строку</Button>
            </div>
            <div className="space-y-2">
              {outputs.map((row) => {
                const isLoss = LOSS_LINE_TYPES.has(row.line_type);
                return (
                  <div key={row.id} className="grid gap-2 rounded-md border p-2 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                    <Select value={row.line_type} onValueChange={(value) => updateOutput(row.id, { line_type: value, warehouse_to_id: LOSS_LINE_TYPES.has(value) ? "" : row.warehouse_to_id })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{LINE_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={row.batch_class} onValueChange={(value) => updateOutput(row.id, { batch_class: value as BatchClass })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{BATCH_CLASSES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={row.warehouse_to_id} onValueChange={(value) => updateOutput(row.id, { warehouse_to_id: value })} disabled={isLoss}>
                      <SelectTrigger><SelectValue placeholder={isLoss ? "Потеря без склада" : "Склад назначения"} /></SelectTrigger>
                      <SelectContent>{warehouses.map((warehouse: any) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input value={row.output_weight_kg} onChange={(event) => updateOutput(row.id, { output_weight_kg: event.target.value })} placeholder="кг" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeOutput(row.id)} disabled={outputs.length === 1}>Убрать</Button>
                  </div>
                );
              })}
            </div>
            <div className={Math.abs(outputTotal - inputValue) <= 0.001 ? "text-xs text-emerald-700" : "text-xs text-amber-700"}>
              Баланс: вход {formatKg(inputValue || 0)} · выходы/потери {formatKg(outputTotal || 0)}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Комментарий технолога / оператора" />
            <Button onClick={handleCreate} disabled={submitting}>Создать черновик</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Журнал доработки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <div className="text-sm text-slate-500">Загрузка...</div> : null}
          {!loading && rows.length === 0 ? <div className="text-sm text-slate-500">Операций доработки пока нет.</div> : null}
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">{typeLabel(row.transformation_type)}</div>
                  <div className="mt-1 text-sm text-slate-600">{row.input_label} · вход {formatKg(row.input_weight_kg)}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {row.source_warehouse_name || "Склад"}{row.processing_node_name ? ` · ${row.processing_node_name}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={row.status === "completed" ? "default" : "secondary"}>{row.status === "completed" ? "Завершено" : row.status === "draft" ? "Черновик" : row.status}</Badge>
                  {row.status === "draft" ? (
                    <Button size="sm" onClick={() => handleFinalize(row.id)} disabled={submitting}>Финализировать</Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {row.outputs.map((output, index) => (
                  <div key={`${row.id}-${index}`} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <div className="font-medium">{lineTypeLabel(output.line_type)} · {batchClassLabel(output.batch_class)}</div>
                    <div className="text-slate-600">{formatKg(output.output_weight_kg)}{output.warehouse_to_name ? ` → ${output.warehouse_to_name}` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
