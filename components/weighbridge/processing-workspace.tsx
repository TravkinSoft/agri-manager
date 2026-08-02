"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Factory, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  createBatchTransformation,
  finalizeBatchTransformation,
  getProcessingTransformations,
  type BatchTransformationRow,
} from "@/lib/services/processing";
import { getWarehouses } from "@/lib/services/warehouses";
import type { Warehouse } from "@/lib/types/warehouse";
import { isHarvestWarehouseType } from "@/lib/warehouse/warehouse-scope";

type QueueFilter = "waiting" | "in_progress" | "completed";

const transformationLabels: Record<string, string> = {
  drying: "Сушка",
  cleaning: "Очистка",
  sorting: "Сортировка",
  calibration: "Калибровка",
  conditioning: "Доработка",
  potato_sorting: "Сортировка клубней",
  other: "Переработка",
};

const formatMass = (value: number) =>
  `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;

export function ProcessingWorkspace() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<BatchTransformationRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("waiting");
  const [selected, setSelected] = useState<BatchTransformationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transformationType, setTransformationType] = useState("cleaning");
  const [outputKg, setOutputKg] = useState("");
  const [lossKg, setLossKg] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!profile?.company_id || !profile?.id) return;
    setLoading(true);
    try {
      const [rows, warehouseRows] = await Promise.all([
        getProcessingTransformations(profile.company_id, profile.id),
        getWarehouses(profile.company_id),
      ]);
      setItems(rows);
      setWarehouses(warehouseRows.filter((row) => !row.archived && !row.is_archived && isHarvestWarehouseType(row.warehouse_type)));
    } catch (error) {
      toast({
        title: "Переработка недоступна",
        description: error instanceof Error ? error.message : "Не удалось загрузить очередь",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.company_id, profile?.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    setTransformationType(selected.transformation_type || "cleaning");
    setOutputKg("");
    setLossKg("");
    setWarehouseId("");
    setNote(selected.note || "");
  }, [selected?.id]);

  const filtered = useMemo(
    () => items.filter((row) => String(row.queue_status || row.status) === filter),
    [filter, items]
  );
  const counts = useMemo(
    () => ({
      waiting: items.filter((row) => row.queue_status === "waiting").length,
      in_progress: items.filter((row) => row.queue_status === "in_progress").length,
      completed: items.filter((row) => row.queue_status === "completed").length,
    }),
    [items]
  );

  const start = async () => {
    if (!selected || selected.record_type !== "waiting_ticket" || !profile?.company_id || !profile?.id) return;
    const input = Number(selected.input_weight_kg || 0);
    const output = Number(outputKg || 0);
    const loss = Number(lossKg || 0);
    if (!warehouseId || output <= 0 || loss < 0) {
      toast({ title: "Заполните результат", description: "Укажите выход, потери и склад готового продукта.", variant: "destructive" });
      return;
    }
    if (Math.abs(output + loss - input) > 0.001) {
      toast({
        title: "Не сходится баланс",
        description: `Выход и потери должны составить ${formatMass(input)}.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await createBatchTransformation({
        company_id: profile.company_id,
        actor_user_id: profile.id,
        transformation_type: transformationType as any,
        processing_node_id: selected.processing_node_id,
        source_ticket_id: selected.source_ticket_id,
        note: note || null,
        input: { batch_id: "from-ticket", warehouse_from_id: "from-ticket", input_weight_kg: input },
        outputs: [
          { line_type: "commodity", batch_class: "commodity", warehouse_to_id: warehouseId, output_weight_kg: output },
          ...(loss > 0
            ? [{ line_type: "process_loss", batch_class: "waste" as const, warehouse_to_id: null, output_weight_kg: loss }]
            : []),
        ],
      });
      setSelected(null);
      setFilter("in_progress");
      await load();
      toast({ title: "Переработка начата", description: "Сырьё переведено в статус «В работе»." });
    } catch (error) {
      toast({ title: "Не удалось начать", description: error instanceof Error ? error.message : "Ошибка", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    if (!selected || selected.record_type === "waiting_ticket" || !profile?.id) return;
    setSaving(true);
    try {
      await finalizeBatchTransformation(selected.id, profile.id);
      setSelected(null);
      setFilter("completed");
      await load();
      toast({ title: "Переработка завершена", description: "Результат один раз проведён на склад." });
    } catch (error) {
      toast({ title: "Не удалось завершить", description: error instanceof Error ? error.message : "Ошибка", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4" data-testid="processing-workspace">
      <div>
        <h2 className="text-xl font-semibold text-slate-50">Переработка</h2>
        <p className="mt-1 text-sm text-slate-400">Сырьё из закрытых весовых талонов и результат его доработки.</p>
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as QueueFilter)}>
        <TabsList className="grid h-11 w-full grid-cols-3 border border-slate-800 bg-slate-950 p-1 sm:w-[520px]">
          <TabsTrigger value="waiting">Ожидают · {counts.waiting}</TabsTrigger>
          <TabsTrigger value="in_progress">В работе · {counts.in_progress}</TabsTrigger>
          <TabsTrigger value="completed">Завершено · {counts.completed}</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
          {filter === "waiting" ? "Талонов, ожидающих переработки, нет" : filter === "in_progress" ? "Переработок в работе нет" : "Завершённых переработок пока нет"}
        </div>
      ) : (
        <div className="divide-y divide-slate-800 border-y border-slate-800">
          {filtered.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSelected(row)}
              className="grid w-full gap-2 px-2 py-4 text-left hover:bg-slate-900/60 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center sm:px-3"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-100">{row.crop_name || row.input_label}</div>
                <div className="mt-1 text-xs text-slate-400">{row.field_name || "Поле не указано"} · {row.ticket_no || "Без талона"}</div>
              </div>
              <div className="text-sm text-slate-300">{formatMass(row.input_weight_kg)}</div>
              <div className="text-sm text-slate-400">{row.processing_node_name || "Линия не указана"}</div>
              <Badge className="w-fit border border-slate-700 bg-slate-950 text-slate-200">
                {row.queue_status === "waiting" ? "Ожидает" : row.queue_status === "in_progress" ? "В работе" : "Завершено"}
              </Badge>
            </button>
          ))}
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Factory className="h-5 w-5" />{selected.crop_name || "Переработка сырья"}</DialogTitle>
                <DialogDescription>Талон {selected.ticket_no || "-"} · {selected.field_name || "Поле не указано"}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div><span className="text-slate-500">Сырьё:</span> <b>{formatMass(selected.input_weight_kg)}</b></div>
                <div><span className="text-slate-500">Линия:</span> <b>{selected.processing_node_name || "-"}</b></div>
                <div><span className="text-slate-500">Дата:</span> <b>{new Date(selected.created_at).toLocaleString("ru-RU")}</b></div>
                <div><span className="text-slate-500">Ответственный:</span> <b>{profile?.full_name || profile?.email || "Текущий пользователь"}</b></div>
              </div>

              {selected.queue_status === "waiting" ? (
                <div className="space-y-4 border-t pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Вид переработки</Label>
                      <Select value={transformationType} onValueChange={setTransformationType}>
                        <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(transformationLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Склад готового продукта</Label>
                      <Select value={warehouseId} onValueChange={setWarehouseId}>
                        <SelectTrigger className="min-h-11"><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                        <SelectContent>
                          {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Готовый продукт, кг</Label><Input className="min-h-11" inputMode="decimal" value={outputKg} onChange={(event) => setOutputKg(event.target.value)} /></div>
                    <div className="space-y-2"><Label>Отходы / потери, кг</Label><Input className="min-h-11" inputMode="decimal" value={lossKg} onChange={(event) => setLossKg(event.target.value)} /></div>
                  </div>
                  <div className="space-y-2"><Label>Комментарий</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></div>
                  <div className="text-sm text-slate-500">Баланс: готовый продукт + потери = {formatMass(selected.input_weight_kg)}</div>
                </div>
              ) : selected.queue_status === "in_progress" ? (
                <div className="space-y-2 border-t pt-4">
                  {selected.outputs.map((output, index) => (
                    <div key={`${output.line_type}-${index}`} className="flex items-center justify-between text-sm">
                      <span>{output.line_type === "process_loss" ? "Отходы / потери" : "Готовый продукт"}{output.warehouse_to_name ? ` · ${output.warehouse_to_name}` : ""}</span>
                      <b>{formatMass(output.output_weight_kg)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 border-t pt-4 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Результат проведён. Повторное проведение заблокировано.</div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>Закрыть</Button>
                {selected.queue_status === "waiting" ? <Button onClick={start} disabled={saving}>{saving ? "Сохранение..." : "Начать переработку"}</Button> : null}
                {selected.queue_status === "in_progress" ? <Button onClick={finish} disabled={saving}>{saving ? "Проведение..." : "Завершить"}</Button> : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
