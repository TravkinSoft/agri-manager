"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Factory, History, Loader2, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  getProcessingTransformations,
  performProcessingAction,
  type BatchTransformationRow,
} from "@/lib/services/processing";

type Props = { onAddOutput?: (processing: BatchTransformationRow) => void };

const typeLabels: Record<string, string> = {
  drying: "Сушка",
  cleaning: "Очистка",
  sorting: "Сортировка",
  calibration: "Калибровка",
  conditioning: "Доработка",
  potato_sorting: "Сортировка клубней",
  other: "Обработка",
};

const lossLabels = {
  dust: "Пыль",
  spillage: "Просыпь",
  sampling: "Отбор проб",
  other: "Другая потеря",
} as const;

const outputRoleLabels: Record<string, string> = {
  GRAIN: "Основная продукция",
  SCREENINGS: "Отсев",
  FEED: "Фураж",
  WASTE: "Веяльные отходы",
  TRIER_WASTE: "Триерные отходы",
  OTHER: "Прочие отходы",
};

const formatMass = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
const formatMoisture = (value: number | null | undefined) =>
  value == null ? null : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "-";

export function ProcessingWorkspace({ onAddOutput }: Props) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<BatchTransformationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [finishItem, setFinishItem] = useState<BatchTransformationRow | null>(null);
  const [manageItem, setManageItem] = useState<BatchTransformationRow | null>(null);
  const [lossType, setLossType] = useState<keyof typeof lossLabels>("dust");
  const [lossKg, setLossKg] = useState("");
  const [lossReason, setLossReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const requestKeys = useRef(new Map<string, string>());
  const canManageBalance = ["global_admin", "company_admin", "director"].includes(String(profile?.role || ""));

  const load = useCallback(async (showLoading = false) => {
    if (!profile?.company_id || !profile?.id) return;
    if (showLoading) setLoading(true);
    try {
      const rows = await getProcessingTransformations(profile.company_id, profile.id);
      setItems(rows.filter((row) => row.record_type === "transformation"));
    } catch (error) {
      toast({ title: "Обработки недоступны", description: error instanceof Error ? error.message : "Не удалось обновить данные", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [profile?.company_id, profile?.id, toast]);

  useEffect(() => {
    void load(true);
    const refresh = () => void load(false);
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("travkin:weighbridge-data-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("travkin:weighbridge-data-changed", refresh);
    };
  }, [load]);

  const activeItems = useMemo(
    () => items.filter((item) => item.processing_state !== "processing_closed" && item.status !== "voided"),
    [items]
  );
  const closedItems = useMemo(
    () => items.filter((item) => item.processing_state === "processing_closed" && item.status !== "voided"),
    [items]
  );

  const idempotencyKey = (itemId: string, action: string) => {
    const key = `${itemId}:${action}`;
    const existing = requestKeys.current.get(key);
    if (existing) return existing;
    const created = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    requestKeys.current.set(key, created);
    return created;
  };

  const runAction = async (item: BatchTransformationRow, action: "soft_finish" | "reopen" | "hard_close" | "approve_loss") => {
    if (!profile?.id || savingId) return;
    setSavingId(item.id);
    try {
      if (action === "approve_loss") {
        const qty = Number(String(lossKg).replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0 || (lossType === "other" && !lossReason.trim())) {
          toast({
            title: "Заполните потерю",
            description: lossType === "other" ? "Укажите массу и пояснение." : "Укажите массу.",
            variant: "destructive",
          });
          return;
        }
        const requestAction = `${action}:${lossType}:${qty}:${lossReason.trim()}`;
        await performProcessingAction(item.id, profile.id, {
          action,
          idempotency_key: idempotencyKey(item.id, requestAction),
          loss_type: lossType,
          qty_kg: qty,
          reason: lossReason.trim(),
        });
        requestKeys.current.delete(`${item.id}:${requestAction}`);
        setLossKg("");
        setLossReason("");
        setManageItem(null);
        toast({ title: "Потеря подтверждена", description: "Она учтена отдельно и не превращена в складской товар." });
      } else {
        await performProcessingAction(item.id, profile.id, { action, idempotency_key: idempotencyKey(item.id, action) });
        toast({
          title: action === "soft_finish"
            ? "Обработка переведена на сверку"
            : action === "reopen"
              ? "Обработка возобновлена"
              : "Материальный баланс закрыт",
          description: action === "soft_finish"
            ? "Новые входы остановлены. Фактические выходы и отходы можно продолжать оформлять."
            : action === "reopen"
              ? "Новые поступления этой партии снова можно добавлять в текущую обработку."
              : "Обработка перенесена в историю.",
        });
        requestKeys.current.delete(`${item.id}:${action}`);
      }
      setFinishItem(null);
      if (action === "hard_close") setManageItem(null);
      await load(false);
    } catch (error) {
      toast({ title: "Действие не выполнено", description: error instanceof Error ? error.message : "Повторите запрос", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  if (!loading && activeItems.length === 0 && closedItems.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="processing-workspace" aria-label="Обработки">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-50"><Factory className="h-4 w-4 text-yellow-400" />Обработки</h2>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : <Badge className="border border-slate-700 bg-slate-950 text-slate-200">{activeItems.length}</Badge>}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {activeItems.map((item) => {
          const pending = item.processing_state === "processing_pending_outputs";
          const input = Number(item.input_total_kg ?? item.input_weight_kg ?? 0);
          const unallocated = Number(item.unallocated_kg || 0);
          return (
            <article key={item.id} className="rounded-lg border border-slate-800 bg-[#101724] p-4" data-processing-state={item.processing_state}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold uppercase text-slate-100">{item.processing_node_name || "Узел обработки"} · {typeLabels[item.transformation_type] || "Обработка"}</div>
                  <div className="mt-1 truncate text-sm text-slate-300" title={item.identity_label || item.input_label}>{item.identity_label || item.input_label}</div>
                </div>
                <Badge className={pending ? "border border-amber-600/60 bg-amber-950/50 text-amber-200" : "border border-sky-700/60 bg-sky-950/50 text-sky-200"}>{pending ? "Сверка баланса" : "В работе"}</Badge>
              </div>
              {pending ? <div className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-300"><CheckCircle2 className="h-4 w-4" />Обработка физически закончена</div> : null}

              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-slate-400">Вход</dt><dd className="font-semibold text-slate-100">{formatMass(input)}</dd>
                <dt className="text-slate-400">Основная продукция</dt><dd className="font-semibold text-slate-100">{formatMass(item.main_output_kg)}</dd>
                {Number(item.byproduct_kg || 0) > 0 ? <><dt className="text-slate-400">Побочная продукция</dt><dd className="font-semibold text-slate-100">{formatMass(item.byproduct_kg)}</dd></> : null}
                <dt className="text-slate-400">Фактические отходы</dt><dd className="font-semibold text-slate-100">{formatMass(item.stock_waste_kg)}</dd>
                {Number(item.moisture_loss_kg || 0) > 0 ? <><dt className="text-slate-400">Удалённая вода</dt><dd className="font-semibold text-slate-100">{formatMass(item.moisture_loss_kg)}</dd></> : null}
                {Number(item.approved_process_loss_kg || 0) > 0 ? <><dt className="text-slate-400">Подтверждённые потери</dt><dd className="font-semibold text-slate-100">{formatMass(item.approved_process_loss_kg)}</dd></> : null}
                <dt className={pending ? (unallocated > 0.001 ? "font-medium text-amber-300" : "text-emerald-300") : "font-medium text-sky-300"}>
                  {pending ? "Нераспределённый баланс обработки" : "Сейчас в обработке"}
                </dt>
                <dd className={pending ? (unallocated > 0.001 ? "font-bold text-amber-300" : "font-bold text-emerald-300") : "font-bold text-sky-300"}>{formatMass(unallocated)}</dd>
              </dl>

              {formatMoisture(item.input_moisture_percent) || formatMoisture(item.output_moisture_percent) ? (
                <div className="mt-3 grid gap-1 border-t border-slate-800 pt-3 text-xs text-slate-400 sm:grid-cols-2">
                  {formatMoisture(item.input_moisture_percent) ? <div>Входная влажность: <b className="text-slate-200">{formatMoisture(item.input_moisture_percent)}</b> · покрытие {formatMass(item.input_moisture_coverage_kg)} из {formatMass(input)}</div> : null}
                  {formatMoisture(item.output_moisture_percent) ? <div>Выходная влажность: <b className="text-slate-200">{formatMoisture(item.output_moisture_percent)}</b> · покрытие {formatMass(item.output_moisture_coverage_kg)}</div> : null}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {!pending ? <Button size="sm" onClick={() => setFinishItem(item)} disabled={savingId === item.id}>Обработка закончена</Button> : null}
                <Button size="sm" variant="outline" onClick={() => onAddOutput?.(item)} disabled={savingId === item.id}><Plus className="mr-1 h-4 w-4" />Добавить выход</Button>
                {pending ? <Button size="sm" variant="outline" onClick={() => void runAction(item, "reopen")} disabled={savingId === item.id}><RotateCcw className="mr-1 h-4 w-4" />Возобновить обработку</Button> : null}
                {pending && canManageBalance ? <Button size="sm" variant="outline" onClick={() => setManageItem(item)}><ShieldCheck className="mr-1 h-4 w-4" />Сверить баланс</Button> : null}
              </div>
            </article>
          );
        })}
      </div>

      {closedItems.length > 0 ? (
        <div className="border-t border-slate-800 pt-3">
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-between px-2 text-slate-300 hover:text-slate-50"
            onClick={() => setHistoryOpen((value) => !value)}
            aria-expanded={historyOpen}
          >
            <span className="flex items-center gap-2"><History className="h-4 w-4 text-slate-400" />История обработок <Badge className="border border-slate-700 bg-slate-950 text-slate-300">{closedItems.length}</Badge></span>
            <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </Button>
          {historyOpen ? (
            <div className="mt-2 grid gap-3 lg:grid-cols-2">
              {closedItems.slice(0, 20).map((item) => {
                const groupedOutputs = item.outputs.reduce<Record<string, number>>((acc, output) => {
                  const key = String(output.output_role || output.output_type || output.line_type || "OTHER");
                  acc[key] = (acc[key] || 0) + Number(output.output_weight_kg || 0);
                  return acc;
                }, {});
                return (
                  <article key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/45 p-4" data-processing-state="processing_closed">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold uppercase text-slate-100">{item.processing_node_name || "Узел обработки"} · {typeLabels[item.transformation_type] || "Обработка"}</div>
                        <div className="mt-1 truncate text-sm text-slate-300" title={item.identity_label || item.input_label}>{item.identity_label || item.input_label}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.completed_at)}</div>
                      </div>
                      <Badge className="border border-emerald-700/60 bg-emerald-950/45 text-emerald-200">Закрыто</Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                      <dt className="text-slate-400">Вход</dt><dd className="font-semibold text-slate-100">{formatMass(item.input_total_kg ?? item.input_weight_kg)}</dd>
                      {Object.entries(groupedOutputs).map(([role, weight]) => (
                        <div key={role} className="contents"><dt className="text-slate-400">{outputRoleLabels[role] || "Выход"}</dt><dd className="font-semibold text-slate-100">{formatMass(weight)}</dd></div>
                      ))}
                      {Number(item.approved_process_loss_kg || 0) > 0 ? <><dt className="text-slate-400">Подтверждённые потери</dt><dd className="font-semibold text-slate-100">{formatMass(item.approved_process_loss_kg)}</dd></> : null}
                      <dt className="text-emerald-300">Баланс</dt><dd className="font-bold text-emerald-300">{formatMass(item.unallocated_kg)}</dd>
                    </dl>
                    <div className="mt-3 border-t border-slate-800 pt-3 text-xs text-slate-400">
                      <div>Завершил обработку: <span className="text-slate-200">{item.completed_by_name || item.closed_by_name || "Не зафиксировано"}</span></div>
                      <div>Закрыл баланс: <span className="text-slate-200">{item.closed_by_name || item.completed_by_name || "Не зафиксировано"}</span></div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <AlertDialog open={Boolean(finishItem)} onOpenChange={(open) => !open && setFinishItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Завершить обработку партии?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-1">
              <span className="block font-medium text-slate-200">{finishItem?.processing_node_name} · {finishItem ? typeLabels[finishItem.transformation_type] || "Обработка" : ""}</span>
              <span className="block">{finishItem?.identity_label || finishItem?.input_label}</span>
              <span className="block">Вход: {formatMass(finishItem?.input_total_kg ?? finishItem?.input_weight_kg)}</span>
              <span className="block pt-2">После подтверждения новые поступления этой партии в данную обработку добавлять будет нельзя.</span>
              <span className="block">Фактические выходы и отходы можно продолжать оформлять до окончательного закрытия материального баланса.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => finishItem && void runAction(finishItem, "soft_finish")}>Обработка закончена</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(manageItem)} onOpenChange={(open) => !open && setManageItem(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Материальный баланс</DialogTitle><DialogDescription>{manageItem?.processing_node_name} · {manageItem?.identity_label || manageItem?.input_label}</DialogDescription></DialogHeader>
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-sm">Нераспределено: <b className={Number(manageItem?.unallocated_kg || 0) > 0.001 ? "text-amber-300" : "text-emerald-300"}>{formatMass(manageItem?.unallocated_kg)}</b></div>
          <div className="space-y-3 border-t border-slate-800 pt-4">
            <div className="font-medium text-slate-100">Подтвердить не складскую потерю</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Тип</Label><Select value={lossType} onValueChange={(value) => setLossType(value as keyof typeof lossLabels)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(lossLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Масса, кг</Label><Input inputMode="decimal" value={lossKg} onChange={(event) => setLossKg(event.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>{lossType === "other" ? "Пояснение *" : "Комментарий (необязательно)"}</Label><Textarea rows={2} value={lossReason} onChange={(event) => setLossReason(event.target.value)} /></div>
            <Button type="button" variant="outline" className="w-full" disabled={!manageItem || savingId === manageItem.id} onClick={() => manageItem && void runAction(manageItem, "approve_loss")}>Подтвердить потерю</Button>
          </div>
          <DialogFooter className="border-t border-slate-800 pt-4">
            <Button variant="outline" onClick={() => setManageItem(null)}>Закрыть</Button>
            <Button disabled={!manageItem || savingId === manageItem.id || Number(manageItem?.unallocated_kg || 0) > 0.001} onClick={() => manageItem && void runAction(manageItem, "hard_close")}>Закрыть материальный баланс</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
