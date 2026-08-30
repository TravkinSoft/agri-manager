"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Factory, History, Loader2, MoreHorizontal, RotateCcw, ShieldCheck, Warehouse } from "lucide-react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BalanceSummary, StatusBadge } from "@/components/operations/operational-ui";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  getProcessingTransformations,
  performProcessingAction,
  type BatchTransformationRow,
} from "@/lib/services/processing";
import { getWarehouseSummaries } from "@/lib/services/warehouses";
import type { WarehouseSummary } from "@/lib/types/warehouse";
import { normalizeStoragePlaceType } from "@/lib/warehouse/warehouse-scope";
import {
  processingMassSnapshot,
  processingWorkState,
  selectPrimaryProcessingItems,
} from "@/lib/weighbridge/processing-work-state";

type Props = {
  enabled?: boolean;
  onItemsChange?: (items: BatchTransformationRow[]) => void;
};

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

const formatMass = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
const formatMoisture = (value: number | null | undefined) =>
  value == null ? null : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "-";

export function ProcessingWorkspace({ enabled = true, onItemsChange }: Props) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<BatchTransformationRow[]>([]);
  const [placeSummaries, setPlaceSummaries] = useState<WarehouseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [finishItem, setFinishItem] = useState<BatchTransformationRow | null>(null);
  const [manageItem, setManageItem] = useState<BatchTransformationRow | null>(null);
  const [lossType, setLossType] = useState<keyof typeof lossLabels>("dust");
  const [lossKg, setLossKg] = useState("");
  const [lossReason, setLossReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const requestKeys = useRef(new Map<string, string>());
  const loadInFlight = useRef(false);
  const loadPending = useRef(false);
  const canOperateLifecycle = ["global_admin", "company_admin"].includes(String(profile?.role || ""));
  const canManageBalance = ["global_admin", "company_admin", "director"].includes(String(profile?.role || ""));

  const load = useCallback(async (showLoading = false) => {
    if (!enabled) return;
    if (!profile?.company_id || !profile?.id) return;
    if (loadInFlight.current) {
      loadPending.current = true;
      return;
    }
    loadInFlight.current = true;
    if (showLoading) setLoading(true);
    try {
      do {
        loadPending.current = false;
        let firstError: unknown = null;
        const transformationsPromise = getProcessingTransformations(profile.company_id, profile.id).then(
          (rows) => {
            const transformations = rows.filter(
              (row) => row.record_type === "transformation" && row.processing_eligible !== false
            );
            setItems(transformations);
            onItemsChange?.(transformations);
          },
          (error) => {
            firstError ??= error;
          }
        );
        const summariesPromise = getWarehouseSummaries(profile.company_id, false, "ru").then(
          (summaries) => {
            setPlaceSummaries(summaries);
          },
          (error) => {
            firstError ??= error;
          }
        );

        await Promise.all([transformationsPromise, summariesPromise]);
        if (firstError) {
          toast({ title: "Часть данных объектов недоступна", description: firstError instanceof Error ? firstError.message : "Повторим обновление автоматически", variant: "destructive" });
        }
      } while (loadPending.current);
    } finally {
      setLoading(false);
      loadInFlight.current = false;
    }
  }, [enabled, onItemsChange, profile?.company_id, profile?.id, toast]);

  useEffect(() => {
    if (!enabled) return;
    void load(true);
    const refresh = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("travkin:weighbridge-data-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("travkin:weighbridge-data-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, load]);

  const openProcessingItems = useMemo(
    () => items.filter((item) =>
      ["active", "ready", "reconciliation"].includes(processingWorkState(item))
      && ["DRYER", "CLEANER"].includes(String(item.node_place_type || "").toUpperCase())
    ),
    [items]
  );
  const { primaryItems: activeItems, previousItems } = useMemo(
    () => selectPrimaryProcessingItems(openProcessingItems),
    [openProcessingItems]
  );
  const completedItems = useMemo(
    () => items.filter((item) =>
      processingWorkState(item) === "history"
      && ["DRYER", "CLEANER"].includes(String(item.node_place_type || "").toUpperCase())
    ),
    [items]
  );
  const visibleHistoryItems = useMemo(
    () => [...previousItems, ...completedItems.slice(0, 10)],
    [completedItems, previousItems]
  );
  const historyItemCount = previousItems.length + completedItems.length;
  const previousCountByWarehouse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of previousItems) {
      if (!item.node_warehouse_id) continue;
      counts.set(item.node_warehouse_id, (counts.get(item.node_warehouse_id) || 0) + 1);
    }
    return counts;
  }, [previousItems]);
  const activeProcessingWarehouseIds = useMemo(
    () => new Set(activeItems.map((item) => item.node_warehouse_id).filter(Boolean)),
    [activeItems]
  );
  const freeProcessingSummaries = useMemo(
    () => placeSummaries.filter((summary) => {
      const placeType = normalizeStoragePlaceType(summary.warehouse.place_type);
      return ["DRYER", "CLEANER"].includes(placeType)
        && !activeProcessingWarehouseIds.has(summary.warehouse.id);
    }),
    [activeProcessingWarehouseIds, placeSummaries]
  );
  const yardSummaries = useMemo(
    () => placeSummaries.filter((summary) => normalizeStoragePlaceType(summary.warehouse.place_type) === "YARD"),
    [placeSummaries]
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
  const manageMass = manageItem ? processingMassSnapshot(manageItem) : null;

  if (!loading && activeItems.length === 0 && historyItemCount === 0 && freeProcessingSummaries.length === 0 && yardSummaries.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-md border border-slate-800/80 bg-[#101724]/95" data-testid="processing-workspace" aria-label="Партии на объектах">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-50"><Factory className="h-4 w-4 text-yellow-400" />Партии на объектах</h2>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : <Badge className="border border-slate-700 bg-slate-950 text-slate-200">{activeItems.length + freeProcessingSummaries.length + yardSummaries.length}</Badge>}
      </div>

      <div className="max-h-[clamp(220px,38vh,430px)] space-y-2 overflow-y-auto p-3 travkin-scrollbar">
        {activeItems.map((item) => {
          const pending = item.processing_state === "processing_pending_outputs";
          const workState = processingWorkState(item);
          const reconciling = workState === "reconciliation";
          const readyToClose = workState === "ready";
          const { inputKg: input, outputKg: output, balanceDeltaKg } = processingMassSnapshot(item);
          const placeType = String(item.node_place_type || "").toUpperCase();
          const placeLabel = placeType === "DRYER" ? "Сушилка" : "Очистка";
          const showActions = canOperateLifecycle || (pending && canManageBalance);
          const previousCount = item.node_warehouse_id ? previousCountByWarehouse.get(item.node_warehouse_id) || 0 : 0;
          return (
            <article key={item.id} className="rounded-md border border-slate-800 bg-slate-950/55 p-3" data-processing-state={item.processing_state} data-place-type={placeType}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase text-slate-500">{placeLabel}</div>
                  <div className="truncate text-sm font-bold text-slate-100" title={item.processing_node_name || placeLabel}>{item.processing_node_name || placeLabel}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-400" title={item.identity_label || item.input_label}>{item.identity_label || item.input_label}</div>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <StatusBadge status={reconciling ? "warning" : readyToClose ? "closed" : "active"}>{reconciling ? "Сверка" : readyToClose ? "Готово к закрытию" : "В работе"}</StatusBadge>
                  {showActions ? <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Действия: ${item.processing_node_name || placeLabel}`}><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {!pending && canOperateLifecycle ? <DropdownMenuItem onClick={() => setFinishItem(item)}>Партия обработана</DropdownMenuItem> : null}
                      {pending && canOperateLifecycle ? <DropdownMenuItem onClick={() => void runAction(item, "reopen")}><RotateCcw className="mr-2 h-4 w-4" />Возобновить приём</DropdownMenuItem> : null}
                      {pending && canOperateLifecycle && canManageBalance ? <DropdownMenuSeparator /> : null}
                      {pending && canManageBalance ? <DropdownMenuItem onClick={() => setManageItem(item)}><ShieldCheck className="mr-2 h-4 w-4" />Сверить баланс</DropdownMenuItem> : null}
                    </DropdownMenuContent>
                  </DropdownMenu> : null}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 divide-x divide-slate-800 border-t border-slate-800 pt-2 text-xs">
                <div className="pr-2"><div className="text-[10px] uppercase text-slate-500">Вход</div><div className="truncate font-semibold text-slate-100">{formatMass(input)}</div></div>
                <div className="px-2"><div className="text-[10px] uppercase text-slate-500">Выход</div><div className="truncate font-semibold text-slate-100">{formatMass(output)}</div></div>
                <div className="pl-2"><div className="text-[10px] uppercase text-slate-500">Остаток</div><div className={`truncate font-semibold ${reconciling ? "text-amber-300" : "text-emerald-300"}`}>{formatMass(balanceDeltaKg)}</div></div>
              </div>
              {formatMoisture(item.input_moisture_percent) || formatMoisture(item.output_moisture_percent) ? (
                <div className="mt-2 truncate text-[11px] text-slate-500" title={`Влажность: ${formatMoisture(item.input_moisture_percent) || "-"} → ${formatMoisture(item.output_moisture_percent) || "-"}`}>
                  Влажность: <span className="text-slate-300">{formatMoisture(item.input_moisture_percent) || "-"} → {formatMoisture(item.output_moisture_percent) || "-"}</span>
                </div>
              ) : null}
              {previousCount > 0 ? (
                <div className="mt-2 text-[11px] text-slate-500">
                  Предыдущих обработок: {previousCount} · История
                </div>
              ) : null}
            </article>
          );
        })}

        {freeProcessingSummaries.map((summary) => {
          const placeType = normalizeStoragePlaceType(summary.warehouse.place_type);
          const weight = Number(summary.harvest_weight_kg || 0);
          const isFree = weight <= 0.001;
          return (
            <article key={summary.warehouse.id} className="rounded-md border border-slate-800 bg-slate-950/55 p-3" data-place-type={placeType} data-processing-state="empty">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-slate-500"><Factory className="h-3 w-3" />{placeType === "DRYER" ? "Сушилка" : "Очистка"}</div>
                  <div className="truncate text-sm font-bold text-slate-100" title={summary.warehouse.name}>{summary.warehouse.name}</div>
                </div>
                <StatusBadge status={isFree ? "closed" : "active"}>{isFree ? "Свободно" : "Остаток"}</StatusBadge>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3 border-t border-slate-800 pt-2">
                <div className="text-xs text-slate-400">{isFree ? "Нет активной партии" : `${Number(summary.harvest_lot_count || 0)} партий`}</div>
                <div className="text-sm font-bold text-slate-100">{formatMass(weight)}</div>
              </div>
            </article>
          );
        })}

        {yardSummaries.map((summary) => (
          <article key={summary.warehouse.id} className="rounded-md border border-slate-800 bg-slate-950/55 p-3" data-place-type="YARD">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-slate-500"><Warehouse className="h-3 w-3" />Площадка</div>
                <div className="truncate text-sm font-bold text-slate-100" title={summary.warehouse.name}>{summary.warehouse.name}</div>
              </div>
              <StatusBadge status={Number(summary.harvest_weight_kg || 0) > 0 ? "active" : "closed"}>{Number(summary.harvest_weight_kg || 0) > 0 ? "Хранение" : "Свободно"}</StatusBadge>
            </div>
            <div className="mt-2 flex items-end justify-between gap-3 border-t border-slate-800 pt-2">
              <div className="text-xs text-slate-400">{Number(summary.harvest_lot_count || 0)} {Number(summary.harvest_lot_count || 0) === 1 ? "партия" : "партий"}</div>
              <div className="text-sm font-bold text-slate-100">{formatMass(summary.harvest_weight_kg)}</div>
            </div>
          </article>
        ))}

      {historyItemCount > 0 ? (
        <div className="border-t border-slate-800 pt-2">
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-between px-1 text-xs text-slate-400 hover:text-slate-50"
            onClick={() => setHistoryOpen((value) => !value)}
            aria-expanded={historyOpen}
          >
            <span className="flex items-center gap-2"><History className="h-3.5 w-3.5" />История <Badge className="border border-slate-700 bg-slate-950 text-slate-300">{historyItemCount}</Badge></span>
            <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </Button>
          {historyOpen ? (
            <div className="space-y-1">
              {visibleHistoryItems.map((item) => {
                const itemState = processingWorkState(item);
                const pending = item.processing_state === "processing_pending_outputs";
                const showActions = itemState !== "history" && (canOperateLifecycle || (pending && canManageBalance));
                const stateLabel = itemState === "history"
                  ? "Закрыта"
                  : itemState === "reconciliation"
                    ? "Требует сверки"
                    : itemState === "ready"
                      ? "Готова к закрытию"
                      : "В работе";
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-xs hover:bg-slate-900/70">
                    <div className="min-w-0"><div className="truncate font-medium text-slate-200">{item.processing_node_name || typeLabels[item.transformation_type] || "Обработка"}</div><div className="truncate text-slate-500">{item.identity_label || item.input_label}</div></div>
                    <div className="flex shrink-0 items-center gap-1">
                      <div className="text-right text-slate-400"><div>{formatMass(item.input_total_kg ?? item.input_weight_kg)}</div><div className="text-[10px] text-slate-600">{stateLabel} · {formatDateTime(item.completed_at || item.started_at || item.created_at)}</div></div>
                      {showActions ? <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Действия предыдущей обработки: ${item.processing_node_name || typeLabels[item.transformation_type] || "Обработка"}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {!pending && canOperateLifecycle ? <DropdownMenuItem onClick={() => setFinishItem(item)}>Партия обработана</DropdownMenuItem> : null}
                          {pending && canOperateLifecycle ? <DropdownMenuItem onClick={() => void runAction(item, "reopen")}><RotateCcw className="mr-2 h-4 w-4" />Возобновить приём</DropdownMenuItem> : null}
                          {pending && canOperateLifecycle && canManageBalance ? <DropdownMenuSeparator /> : null}
                          {pending && canManageBalance ? <DropdownMenuItem onClick={() => setManageItem(item)}><ShieldCheck className="mr-2 h-4 w-4" />Сверить баланс</DropdownMenuItem> : null}
                        </DropdownMenuContent>
                      </DropdownMenu> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      </div>

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
          {manageItem ? <BalanceSummary
            inputKg={Number(manageItem.input_total_kg ?? manageItem.input_weight_kg ?? 0)}
            outputKg={Number(manageItem.main_output_kg || 0) + Number(manageItem.byproduct_kg || 0) + Number(manageItem.stock_waste_kg || 0)}
            lossesKg={Number(manageItem.moisture_loss_kg || 0) + Number(manageItem.approved_process_loss_kg || 0)}
            differenceKg={manageMass?.balanceDeltaKg || 0}
          /> : null}
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
            <Button disabled={!manageItem || savingId === manageItem.id || !manageMass?.hasCanonicalInput || !manageMass?.hasRequiredDryingMoisture || Math.abs(manageMass.balanceDeltaKg) > 0.001} onClick={() => manageItem && void runAction(manageItem, "hard_close")}>Закрыть материальный баланс</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
