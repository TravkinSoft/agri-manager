"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { History, PackageCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";
import { getInventoryBalances, getWarehouses } from "@/lib/services/warehouses";
import {
  adminTransitionWarehouseRequest,
  createIssueTicketFromRequest,
  getWarehouseIssueRequests,
  issueWarehouseRequest,
  reconcileWarehouseReturn,
  updateWarehouseIssueRequestStatus,
} from "@/lib/services/warehouse-requests";
import type { Warehouse } from "@/lib/types/warehouse";
import type { WarehouseIssueRequest, WarehouseIssueRequestItem } from "@/lib/types/warehouse-request";

function statusBadge(status: string) {
  if (status === "received_confirmed") return "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30";
  if (status === "issued_by_warehouse" || status === "issued") return "bg-violet-500/15 text-violet-200 border border-violet-400/30";
  if (status === "partially_issued") return "bg-amber-500/15 text-amber-200 border border-amber-400/30";
  if (status === "preparing") return "bg-cyan-500/15 text-cyan-200 border border-cyan-400/30";
  if (status === "ready") return "bg-blue-500/15 text-blue-200 border border-blue-400/30";
  if (status === "cancelled") return "bg-slate-700 text-slate-200";
  return "bg-yellow-500/15 text-yellow-200 border border-yellow-400/30";
}

function statusLabel(status: string, t: (key: any) => string): string {
  if (status === "new") return "Ожидает принятия операции";
  if (status === "active") return "К выдаче";
  if (status === "preparing") return "Готовится";
  if (status === "ready") return "Готово к выдаче";
  if (status === "partially_issued") return "Частично выдано";
  if (status === "issued") return "Выдано";
  if (status === "issued_by_warehouse") return "Выдано";
  if (status === "received_confirmed") return "Товар принят специалистом";
  if (status === "cancelled") return t("status_cancelled");
  return status;
}

function toQty(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  pesticide: "СЗР",
  crop_protection: "СЗР",
  fertilizer: "Удобрение",
  seed: "Семена",
  seed_planting_material: "Семена",
  additive: "Добавка",
  organic: "Органика",
  fuel: "Топливо",
  commodity: "Товар",
  other: "Другое",
};

const RECONCILIATION_LABELS: Record<string, string> = {
  not_required: "Сверка не нужна",
  pending: "Ожидает сверки",
  prepared: "Подготовлено",
  issued: "Выдано",
  received: "Принято специалистом",
  in_progress: "В работе",
  return_required: "Нужен возврат",
  shortage: "Дефицит",
  return_declared: "Возврат заявлен",
  return_received: "Возврат принят",
  loss_review: "Проверка потерь",
  reconciled: "Сверено",
  blocked: "Заблокировано",
  cancelled: "Отменено",
};

function productCategoryLabel(item: WarehouseIssueRequestItem): string {
  const key = String(item.product_type || item.product_category || "").trim().toLowerCase();
  if (!key) return "-";
  return PRODUCT_CATEGORY_LABELS[key] || "Другое";
}

function reconciliationLabel(status: unknown): string {
  const key = String(status || "").trim().toLowerCase();
  if (!key) return "-";
  return RECONCILIATION_LABELS[key] || "Требует проверки";
}

function itemReconciliationSummary(item: WarehouseIssueRequestItem): Array<{ label: string; value: number }> {
  const declaredReturn = Math.max(
    toQty(item.returned_quantity, 0),
    toQty(item.return_received_quantity, 0)
  );

  return [
    { label: "Возврат", value: declaredReturn },
    { label: "Потери", value: toQty(item.loss_quantity, 0) },
    { label: "Дефицит", value: toQty(item.shortage_quantity, 0) },
  ];
}

function requestRecipientLabel(row: WarehouseIssueRequest): string {
  return (
    row.recipient_name ||
    row.assigned_specialist_name ||
    row.recipient_email ||
    "-"
  );
}

function requestCropLabel(row: WarehouseIssueRequest): string {
  return [row.crop_name, row.variety_name, row.reproduction_name].filter(Boolean).join(" • ") || "Культура не указана";
}

function requestPrimaryMaterial(row: WarehouseIssueRequest): string {
  const items = row.items || [];
  if (items.length === 0) return "Материалы не указаны";
  const first = items[0]?.product_name || "Материал";
  return items.length > 1 ? `${first} + ещё ${items.length - 1}` : first;
}

function requestMaterialPreview(row: WarehouseIssueRequest, maxItems = 3): string {
  const items = row.items || [];
  if (items.length === 0) return "Материалов нет";
  const visible = items.slice(0, maxItems).map((item) => item.product_name || "Материал");
  const hidden = items.length - visible.length;
  return hidden > 0 ? `${visible.join(", ")} + ещё ${hidden}` : visible.join(", ");
}

function requestStepHint(row: WarehouseIssueRequest): string {
  const status = String(row.status || "");
  if (status === "ready") return "Склад собрал. Ждём, когда специалист подтвердит получение.";
  if (status === "received_confirmed") return "Специалист подтвердил. Можно отдать товар и списать склад.";
  if (status === "issued" || status === "issued_by_warehouse" || status === "partially_issued") return "Выдача зафиксирована в складе.";
  if (status === "preparing") return "Укажите фактически подготовленное количество и отметьте готовность.";
  return "Выберите склад, укажите фактически подготовленное количество и отметьте готовность.";
}

type WarehouseColumnKey =
  | "collecting"
  | "ready"
  | "handoff"
  | "history";
type ActiveWarehouseColumnKey = Exclude<WarehouseColumnKey, "history">;

function warehouseColumnKey(row: WarehouseIssueRequest): WarehouseColumnKey {
  const v5Status = String(row.warehouse_request_status || "");
  if (v5Status === "collecting") return "collecting";
  if (v5Status === "ready_for_pickup") return "ready";
  if (v5Status === "picked_up_by_specialist") return "handoff";
  if (v5Status === "issued") return "handoff";
  if (v5Status === "return_expected") return "handoff";
  if (v5Status === "return_received" || v5Status === "closed") return "history";
  if (v5Status === "cancelled") return "history";

  if (row.status === "new" || row.status === "active" || row.status === "preparing") return "collecting";
  if (row.status === "ready") return "ready";
  if (row.status === "received_confirmed") return "handoff";
  if (row.status === "issued" || row.status === "issued_by_warehouse" || row.status === "partially_issued") return "handoff";
  if (row.status === "cancelled") return "history";
  return "collecting";
}

const WAREHOUSE_COLUMNS: Array<{ key: ActiveWarehouseColumnKey; title: string; description: string }> = [
  { key: "collecting", title: "Новые и в сборке", description: "Новые заявки и подготовка" },
  { key: "ready", title: "Готово к выдаче", description: "Ждём подтверждение специалиста" },
  { key: "handoff", title: "Выдано / возврат", description: "Выдача и приём возврата" },
];

export default function WarehouseRequestsPage() {
  const { profile } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<WarehouseIssueRequest[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceWarehouseId, setSourceWarehouseId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [mobileTab, setMobileTab] = useState<ActiveWarehouseColumnKey>("collecting");
  const [balanceByWarehouseProduct, setBalanceByWarehouseProduct] = useState<Record<string, number>>({});
  const [issueQtyByItem, setIssueQtyByItem] = useState<Record<string, string>>({});
  const [preparedQtyByItem, setPreparedQtyByItem] = useState<Record<string, string>>({});
  const [returnQtyByItem, setReturnQtyByItem] = useState<Record<string, string>>({});
  const [lossQtyByItem, setLossQtyByItem] = useState<Record<string, string>>({});
  const [adminReason, setAdminReason] = useState("");

  const canProcess =
    profile?.role === "warehouse" ||
    profile?.role === "warehouse_operator" ||
    profile?.role === "global_admin";
  const canAdminTransition =
    profile?.role === "company_admin" || profile?.role === "global_admin";
  const canView =
    profile?.role === "warehouse" ||
    profile?.role === "warehouse_operator" ||
    profile?.role === "company_admin" ||
    profile?.role === "global_admin" ||
    profile?.role === "agronomist";

  const loadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    try {
      const [requestRows, warehouseRows, balances] = await Promise.all([
        getWarehouseIssueRequests(profile.company_id),
        getWarehouses(profile.company_id, false, language),
        getInventoryBalances(profile.company_id, language),
      ]);
      setRequests(requestRows);
      setWarehouses(warehouseRows);
      const nextBalanceMap: Record<string, number> = {};
      balances.forEach((row) => {
        nextBalanceMap[`${row.warehouse_id}|${row.product_id}`] = Number(row.quantity || 0);
      });
      setBalanceByWarehouseProduct(nextBalanceMap);

      if (selectedId && !requestRows.some((row) => row.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (error: any) {
      toast({
        title: t("error"),
        description: error?.message || t("error"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.company_id) {
      loadData();
    }
  }, [profile?.company_id, profile?.role, language]);

  const filteredRequests = useMemo(() => {
    return requests.filter((row) => {
      const text = `${row.request_number} ${row.field_name || ""} ${requestRecipientLabel(row)}`.toLowerCase();
      const matchSearch = !search || text.includes(search.toLowerCase());
      const workflowStatus = String((row as any).workflow_status || row.status || "");
      const matchStatus =
        statusFilter === "all" ||
        row.status === statusFilter ||
        workflowStatus === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [requests, search, statusFilter]);

  const requestsByWarehouseColumn = useMemo(() => {
    const grouped = new Map<WarehouseColumnKey, WarehouseIssueRequest[]>();
    WAREHOUSE_COLUMNS.forEach((column) => grouped.set(column.key, []));
    filteredRequests.forEach((row) => {
      const key = warehouseColumnKey(row);
      const list = grouped.get(key) || [];
      list.push(row);
      grouped.set(key, list);
    });
    return grouped;
  }, [filteredRequests]);

  const historyRequests = useMemo(
    () => filteredRequests.filter((row) => warehouseColumnKey(row) === "history"),
    [filteredRequests]
  );

  const selectedRequest = filteredRequests.find((row) => row.id === selectedId) || null;
  const effectiveSourceWarehouseId = sourceWarehouseId || selectedRequest?.source_warehouse_id || "";
  const selectedWarehouseName =
    warehouses.find((warehouse) => warehouse.id === effectiveSourceWarehouseId)?.name ||
    selectedRequest?.source_warehouse_name ||
    t("selected_warehouse");

  useEffect(() => {
    if (!selectedRequest) return;
    setSourceWarehouseId(selectedRequest.source_warehouse_id || "");
    const defaults: Record<string, string> = {};
    const preparedDefaults: Record<string, string> = {};
    const returnDefaults: Record<string, string> = {};
    const lossDefaults: Record<string, string> = {};
    (selectedRequest.items || []).forEach((item) => {
      const prepared = toQty(item.prepared_quantity, 0);
      const alreadyIssued = toQty(item.issued_quantity, 0);
      const remaining = Math.max(prepared - alreadyIssued, 0);
      defaults[item.id] = remaining > 0 ? remaining.toFixed(2) : "0";
      preparedDefaults[item.id] = prepared > 0 ? prepared.toFixed(2) : "0";
      returnDefaults[item.id] = "0";
      lossDefaults[item.id] = "0";
    });
    setIssueQtyByItem(defaults);
    setPreparedQtyByItem(preparedDefaults);
    setReturnQtyByItem(returnDefaults);
    setLossQtyByItem(lossDefaults);
    setAdminReason("");
  }, [selectedRequest?.id]);

  const stockCheckRows = useMemo(() => {
    if (!selectedRequest || !effectiveSourceWarehouseId) return [];
    return (selectedRequest.items || []).map((item) => {
      const available = toQty(balanceByWarehouseProduct[`${effectiveSourceWarehouseId}|${item.product_id}`], 0);
      const planned = toQty(item.planned_quantity ?? item.required_quantity, 0);
      const prepared = Math.max(toQty(preparedQtyByItem[item.id], toQty(item.prepared_quantity, 0)), 0);
      const alreadyIssued = toQty(item.issued_quantity, 0);
      const remaining = Math.max(prepared - alreadyIssued, 0);
      const toIssueRaw = toQty(issueQtyByItem[item.id], remaining);
      const toIssue = Math.max(0, toIssueRaw);
      const missing = Math.max(0, toIssue - available);
      const stockDeficit = Math.max(0, prepared - available);
      const remainingToPrepare = Math.max(planned - prepared, 0);
      const preparationDeviation = prepared - planned;
      const exceedsRemaining = toIssue > remaining + 0.000001;
      return {
        item,
        available,
        planned,
        prepared,
        alreadyIssued,
        remaining,
        toIssue,
        missing,
        stockDeficit,
        remainingToPrepare,
        preparationDeviation,
        preparedExceedsAvailable: prepared > available + 0.000001,
        exceedsRemaining,
        enough: available + 0.000001 >= toIssue,
      };
    });
  }, [
    selectedRequest,
    effectiveSourceWarehouseId,
    balanceByWarehouseProduct,
    issueQtyByItem,
    preparedQtyByItem,
  ]);

  const hasStockShortage = stockCheckRows.some((row) => row.toIssue > 0 && !row.enough);
  const hasPreparationStockShortage = stockCheckRows.some((row) => row.preparedExceedsAvailable);
  const hasPreparedMaterials = stockCheckRows.some((row) => row.prepared > 0);
  const hasIssueQtyOverRemaining = stockCheckRows.some((row) => row.exceedsRemaining);
  const stockDeficitRows = stockCheckRows.filter((row) => row.stockDeficit > 0.000001);

  const runAction = async (fn: () => Promise<void>, successMessage: string) => {
    if (!selectedRequest || !profile?.company_id) return;
    try {
      setSubmitting(true);
      await fn();
      await loadData();
      toast({ title: "Готово", description: successMessage });
    } catch (error: any) {
      toast({
        title: t("error"),
        description: error?.message || "Action failed",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReady = async () => {
    if (!selectedRequest || !profile?.company_id) return;
    if (!sourceWarehouseId) {
      toast({
        title: t("error"),
        description: t("select_source_warehouse_first"),
        variant: "destructive",
      });
      return;
    }

    if (hasPreparationStockShortage) {
      const firstShortage = stockCheckRows.find((row) => row.preparedExceedsAvailable);
      toast({
        title: t("insufficient_stock"),
        description: firstShortage
          ? `${firstShortage.item.product_name || t("material")}: доступно ${firstShortage.available.toFixed(2)} ${localizeUnit(firstShortage.item.unit || firstShortage.item.product_unit || "", language)}, подготовлено ${firstShortage.prepared.toFixed(2)} ${localizeUnit(firstShortage.item.unit || firstShortage.item.product_unit || "", language)}.`
          : "Подготовленное количество превышает остаток на складе.",
        variant: "destructive",
      });
      return;
    }

    if (!hasPreparedMaterials) {
      toast({
        title: t("insufficient_stock"),
        description: "На выбранном складе нет подготовленных материалов. Заявка остаётся в подготовке.",
        variant: "destructive",
      });
      return;
    }

    await runAction(
      () =>
        updateWarehouseIssueRequestStatus({
          requestId: selectedRequest.id,
          companyId: profile.company_id!,
          status: "ready",
          sourceWarehouseId,
          items: (selectedRequest.items || []).map((item) => ({
            itemId: item.id,
            preparedQuantity: toQty(preparedQtyByItem[item.id], toQty(item.prepared_quantity, 0)),
          })),
        }),
      t("request_marked_ready")
    );
  };

  const handleIssue = async () => {
    if (!selectedRequest || !profile?.company_id) return;
    if (selectedRequest.status !== "received_confirmed") {
      toast({
        title: t("error"),
        description: "Сначала специалист должен нажать «Товар принят». До этого складская выдача запрещена.",
        variant: "destructive",
      });
      return;
    }
    const warehouseId = effectiveSourceWarehouseId;
    if (!warehouseId) {
      toast({
        title: t("error"),
        description: t("select_source_before_issuing"),
        variant: "destructive",
      });
      return;
    }

    if (hasStockShortage) {
      const firstShortage = stockCheckRows.find((row) => !row.enough);
      toast({
        title: t("insufficient_stock"),
        description: firstShortage
          ? `${firstShortage.item.product_name || t("material")}: ${selectedWarehouseName}. ${t("available")} ${firstShortage.available.toFixed(2)} ${localizeUnit(firstShortage.item.unit || firstShortage.item.product_unit || "", language)}, ${t("required_qty")} ${firstShortage.toIssue.toFixed(2)} ${localizeUnit(firstShortage.item.unit || firstShortage.item.product_unit || "", language)}.`
          : `${t("selected_warehouse")} ${selectedWarehouseName}: ${t("insufficient_stock")}.`,
        variant: "destructive",
      });
      return;
    }

    if (hasIssueQtyOverRemaining) {
      const firstOver = stockCheckRows.find((row) => row.exceedsRemaining);
      toast({
        title: t("error"),
        description: firstOver
          ? `${firstOver.item.product_name || t("material")}: количество к выдаче больше остатка по заявке.`
          : "Количество к выдаче больше остатка по заявке.",
        variant: "destructive",
      });
      return;
    }

    const issueItems = stockCheckRows
      .filter((row) => row.toIssue > 0)
      .map((row) => ({
        itemId: row.item.id,
        issuedQuantity: Number(row.toIssue.toFixed(4)),
        batchId: row.item.batch_id || null,
      }));

    if (issueItems.length === 0) {
      toast({
        title: t("error"),
        description: "Укажите количество к выдаче больше нуля хотя бы по одной позиции.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSubmitting(true);
      await issueWarehouseRequest({
        requestId: selectedRequest.id,
        companyId: profile.company_id,
        sourceWarehouseId: warehouseId,
        items: issueItems,
      });
      await loadData();
      toast({ title: t("success"), description: t("request_issued_waiting") });
    } catch (error: any) {
      const rawMessage = String(error?.message || "Action failed");
      let formattedMessage = rawMessage;
      const productIdMatch = rawMessage.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
      const referencedItem = productIdMatch
        ? (selectedRequest.items || []).find((item) => item.product_id === productIdMatch[0])
        : null;

      if (/Insufficient stock/i.test(rawMessage)) {
        const shortageRow = referencedItem
          ? stockCheckRows.find((row) => row.item.product_id === referencedItem.product_id)
          : stockCheckRows.find((row) => !row.enough);
        if (shortageRow) {
          formattedMessage = `${shortageRow.item.product_name || "Материал"}: ${selectedWarehouseName}. Доступно ${shortageRow.available.toFixed(2)} ${shortageRow.item.unit || shortageRow.item.product_unit || ""}, нужно ${shortageRow.toIssue.toFixed(2)} ${shortageRow.item.unit || shortageRow.item.product_unit || ""}.`;
        }
      }

      toast({
        title: t("error"),
        description: formattedMessage,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleWarehouseReturn = async (closeWithoutReturn = false) => {
    if (!selectedRequest || !profile?.company_id) return;
    const items = (selectedRequest.items || [])
      .map((item) => ({
        itemId: item.id,
        returnedQuantity: toQty(returnQtyByItem[item.id], 0),
      }))
      .filter((item) => item.returnedQuantity > 0.000001);

    await runAction(
      () =>
        reconcileWarehouseReturn({
          requestId: selectedRequest.id,
          companyId: profile.company_id!,
          items,
          closeWithoutReturn,
        }),
      closeWithoutReturn
        ? "Заявка закрыта без физического возврата."
        : "Физический возврат принят на склад и отражён в остатках."
    );
  };

  const handleAdminTransition = async (
    action: "return_to_preparation" | "cancel" | "record_loss"
  ) => {
    if (!selectedRequest || !profile?.company_id) return;
    if (!adminReason.trim()) {
      toast({
        title: "Нужна причина",
        description: "Административное действие нельзя выполнить без причины.",
        variant: "destructive",
      });
      return;
    }
    const lossItems = (selectedRequest.items || [])
      .map((item) => ({
        itemId: item.id,
        lossQuantity: toQty(lossQtyByItem[item.id], 0),
      }))
      .filter((item) => item.lossQuantity > 0.000001);
    if (action === "record_loss" && lossItems.length === 0) {
      toast({
        title: "Укажите потери",
        description: "Для подтверждения потерь нужна хотя бы одна положительная строка.",
        variant: "destructive",
      });
      return;
    }
    await runAction(
      () =>
        adminTransitionWarehouseRequest({
          requestId: selectedRequest.id,
          companyId: profile.company_id!,
          action,
          reason: adminReason.trim(),
          items: action === "record_loss" ? lossItems : [],
        }),
      action === "cancel"
        ? "Заявка отменена администратором."
        : action === "return_to_preparation"
          ? "Заявка возвращена в подготовку."
          : "Потери подтверждены администратором."
    );
  };

  const handleCreateIssueTicket = async () => {
    if (!selectedRequest || !profile?.company_id) return;
    const warehouseId = effectiveSourceWarehouseId;
    if (!warehouseId) {
      toast({
        title: t("error"),
        description: t("select_source_before_issuing"),
        variant: "destructive",
      });
      return;
    }

    if (hasStockShortage) {
      toast({
        title: t("insufficient_stock"),
        description: "Недостаточно остатка для создания талона выдачи.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSubmitting(true);
      const result = await createIssueTicketFromRequest({
        requestId: selectedRequest.id,
        companyId: profile.company_id,
        sourceWarehouseId: warehouseId,
      });
      await loadData();
      toast({
        title: t("success"),
        description: result.duplicate
          ? `Талон уже создан: ${result.ticketId}`
          : `Талон выдачи создан (${result.ticketNo || result.ticketId}). Закройте его в модуле "Весовая".`,
      });
    } catch (error: any) {
      toast({
        title: t("error"),
        description: error?.message || "Не удалось создать талон выдачи",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!canView) {
    return (
      <div>
        <PageHeader title="Warehouse Requests" description="Issue requests linked to agronomy operations" />
        <Alert variant="destructive">
          <AlertDescription>{t("access_denied")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("requests_page_title")}
        description={t("requests_page_desc")}
      >
        <Button variant="outline" onClick={() => setHistoryOpen(true)}>
          <History className="mr-2 h-4 w-4" /> История заявок
        </Button>
      </PageHeader>

      <Card className="rounded-md border-slate-800 bg-slate-900/60">
        <CardContent className="grid gap-3 p-3 md:grid-cols-[1fr_260px]">
          <Input
            placeholder={t("search_requests_placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder={t("status")} />
            </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all_statuses")}</SelectItem>
                <SelectItem value="active">К выдаче</SelectItem>
                <SelectItem value="preparing">Готовится</SelectItem>
                <SelectItem value="ready">{t("status_ready")}</SelectItem>
                <SelectItem value="partially_issued">Частично выдано</SelectItem>
                <SelectItem value="issued_by_warehouse">{t("status_issued_by_warehouse")}</SelectItem>
                <SelectItem value="issued">{t("status_issued_by_warehouse")}</SelectItem>
                <SelectItem value="received_confirmed">{t("status_received_confirmed")}</SelectItem>
                <SelectItem value="cancelled">{t("status_cancelled")}</SelectItem>
              </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-800 p-1 md:hidden">
        {WAREHOUSE_COLUMNS.map((column) => (
          <Button key={column.key} type="button" variant={mobileTab === column.key ? "default" : "ghost"} className="h-11 px-2 text-xs" onClick={() => setMobileTab(column.key)}>
            {column.title}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 md:h-[calc(100dvh-280px)] md:min-h-[420px] md:grid-cols-3 md:overflow-hidden">
        {WAREHOUSE_COLUMNS.map((column) => {
          const rows = requestsByWarehouseColumn.get(column.key) || [];
          return (
            <section key={column.key} className={`${mobileTab === column.key ? "flex" : "hidden"} min-h-[260px] min-w-0 flex-col rounded-md border border-slate-800/80 bg-slate-950/40 p-3 md:flex md:min-h-0`}>
              <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">{column.title}</h2>
                  <div className="text-[11px] text-slate-500">{column.description}</div>
                </div>
                <Badge className="bg-slate-800 text-slate-200">{rows.length}</Badge>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {loading ? (
                  <div className="rounded-md border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-400">Загрузка...</div>
                ) : rows.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-800 bg-slate-900/30 p-4 text-xs text-slate-500">Пусто</div>
                ) : (
                  rows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={`w-full rounded-md border p-3 text-left transition ${
                        row.id === selectedId
                          ? "border-yellow-500/80 bg-yellow-500/10 shadow-lg shadow-yellow-950/20"
                          : "border-slate-800 bg-slate-900/70 hover:border-yellow-500/40 hover:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-white">{row.field_name || "Поле не указано"}</div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-400">{row.request_number}</div>
                        </div>
                        <Badge className={`${statusBadge(row.status)} shrink-0`}>{statusLabel(row.status, t)}</Badge>
                      </div>
                      <div className="mt-2 text-xs font-semibold text-slate-200">{row.operation_type || "Операция"}</div>
                      <div className="mt-1 truncate text-[11px] text-slate-500">{requestCropLabel(row)}</div>
                      <div className="mt-2 rounded-lg bg-slate-950/55 p-2">
                        <div className="truncate text-xs text-slate-200">{requestPrimaryMaterial(row)}</div>
                        <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">{requestMaterialPreview(row)}</div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate">Кому: {requestRecipientLabel(row)}</span>
                        <span className="shrink-0">{row.items?.length || 0} поз.</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-[11px] text-slate-400">{requestStepHint(row)}</div>
                    </button>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog open={Boolean(selectedRequest)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(1180px,calc(100vw-32px))] sm:max-w-[1180px] sm:rounded-lg">
          <DialogHeader className="shrink-0 border-b border-slate-800 px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-lg"><PackageCheck className="h-5 w-5 text-yellow-400" />Заявка {selectedRequest?.request_number || ""}</DialogTitle>
            <DialogDescription>{selectedRequest ? `${selectedRequest.field_name || "Поле не указано"} · ${selectedRequest.operation_type || "Операция"} · ${requestRecipientLabel(selectedRequest)}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {!selectedRequest ? (
              <div className="text-sm text-slate-500">{t("select_request_from_list")}</div>
            ) : (
              <>
                <div className="border-b border-slate-800 pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{selectedRequest.request_number}</div>
                      <div className="mt-1 text-2xl font-bold leading-tight text-white">{selectedRequest.field_name || "Поле не указано"}</div>
                      <div className="mt-1 text-sm text-slate-400">{requestCropLabel(selectedRequest)}</div>
                    </div>
                    <Badge className={statusBadge(selectedRequest.status)}>{statusLabel(selectedRequest.status, t)}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                    <div>
                      <div className="text-xs text-slate-500">Операция</div>
                      <div className="font-semibold text-slate-100">{selectedRequest.operation_type || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Кому</div>
                      <div className="font-semibold text-slate-100">{requestRecipientLabel(selectedRequest)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Дата работ</div>
                      <div className="text-slate-200">{selectedRequest.planned_datetime ? new Date(selectedRequest.planned_datetime).toLocaleString() : selectedRequest.operation_date || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Следующий шаг</div>
                      <div className="text-slate-200">{requestStepHint(selectedRequest)}</div>
                    </div>
                    {selectedRequest.comment ? (
                      <div className="md:col-span-2">
                        <div className="text-xs text-slate-500">Комментарий</div>
                        <div className="text-slate-300">{selectedRequest.comment}</div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950/35 p-3">
                  <Label>Склад выдачи</Label>
                  <Select
                    value={sourceWarehouseId}
                    onValueChange={setSourceWarehouseId}
                    disabled={
                      !canProcess ||
                      selectedRequest.status === "issued_by_warehouse" ||
                      selectedRequest.status === "ready" ||
                      selectedRequest.status === "received_confirmed" ||
                      selectedRequest.status === "cancelled"
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("select_warehouse")} />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>
                          {warehouse.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {effectiveSourceWarehouseId && stockCheckRows.length > 0 && (
                  <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm">
                    <div className="mb-2 font-medium text-slate-100">Остаток на выбранном складе</div>
                    <div className="space-y-1">
                      {stockCheckRows.map((row) => (
                        <div key={row.item.id} className={row.enough ? "text-emerald-300" : "text-red-300"}>
                          {row.item.product_name || "-"}: доступно {row.available.toFixed(2)} {localizeUnit(row.item.unit || row.item.product_unit || "", language)}, подготовлено {row.prepared.toFixed(2)}, к выдаче {row.toIssue.toFixed(2)}, осталось подготовить {row.remainingToPrepare.toFixed(2)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stockDeficitRows.length > 0 && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <span className="font-semibold">Дефицит на выбранном складе.</span>{" "}
                      {stockDeficitRows
                        .map(
                          (row) =>
                            `${row.item.product_name || "Материал"}: не хватает ${row.stockDeficit.toFixed(2)} ${localizeUnit(
                              row.item.unit || row.item.product_unit || "",
                              language
                            )}`
                        )
                        .join("; ")}
                      . Подготовленное количество нельзя указать выше фактического остатка.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2 md:hidden">
                  {(selectedRequest.items || []).map((item) => {
                    const planned = toQty(item.planned_quantity ?? item.required_quantity, 0);
                    const prepared = toQty(preparedQtyByItem[item.id], toQty(item.prepared_quantity, 0));
                    const issued = toQty(item.issued_quantity, 0);
                    const available = toQty(
                      balanceByWarehouseProduct[`${effectiveSourceWarehouseId}|${item.product_id}`],
                      0
                    );
                    const remainingToPrepare = Math.max(planned - prepared, 0);
                    const remainingToIssue = Math.max(prepared - issued, 0);
                    const preparedEditable =
                      canProcess &&
                      (selectedRequest.status === "new" ||
                        selectedRequest.status === "active" ||
                        selectedRequest.status === "preparing");
                    const issueEditable =
                      selectedRequest.status === "ready" || selectedRequest.status === "received_confirmed";
                    return (
                      <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-sm">
                        <div className="font-medium text-slate-100">{item.product_name || "-"}</div>
                        <div className="mt-1 text-xs text-slate-500">{productCategoryLabel(item)}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                          <div>План: {planned.toFixed(2)}</div>
                          <div>Доступно: {available.toFixed(2)}</div>
                          <div>Подготовлено: {prepared.toFixed(2)}</div>
                          <div>Выдано: {issued.toFixed(2)}</div>
                          <div>Осталось подготовить: {remainingToPrepare.toFixed(2)}</div>
                          <div>Осталось выдать: {remainingToIssue.toFixed(2)}</div>
                          <div>
                            Отклонение: {prepared - planned > 0 ? "+" : ""}
                            {(prepared - planned).toFixed(2)}
                          </div>
                          <div>{t("unit")}: {localizeUnit(item.unit || item.product_unit || "kg", language)}</div>
                        </div>
                        <div className="mt-2 rounded-md border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-300">
                          <div className="mb-1 font-medium text-slate-200">{reconciliationLabel(item.reconciliation_status)}</div>
                          <div className="grid grid-cols-3 gap-1">
                            {itemReconciliationSummary(item).map((row) => (
                              <div key={row.label}>
                                <span className="text-slate-500">{row.label}: </span>
                                <span className="font-semibold text-slate-100">{row.value.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {preparedEditable ? (
                          <div className="mt-2">
                            <Label className="mb-1 block text-xs">Подготовлено фактически</Label>
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              max={available}
                              value={preparedQtyByItem[item.id] ?? prepared.toFixed(2)}
                              onChange={(event) => {
                                setPreparedQtyByItem((prev) => ({
                                  ...prev,
                                  [item.id]: event.target.value,
                                }));
                                setIssueQtyByItem((prev) => ({
                                  ...prev,
                                  [item.id]: event.target.value,
                                }));
                              }}
                              disabled={submitting}
                              className="h-9"
                            />
                          </div>
                        ) : null}
                        <div className="mt-2">
                          <Label className="mb-1 block text-xs">К выдаче</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            max={remainingToIssue}
                            value={issueQtyByItem[item.id] ?? "0"}
                            onChange={(e) =>
                              setIssueQtyByItem((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            disabled={!issueEditable || submitting}
                            className="h-9"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("material")}</TableHead>
                        <TableHead>{t("category")}</TableHead>
                        <TableHead className="text-right">План</TableHead>
                        <TableHead className="text-right">Доступно</TableHead>
                        <TableHead className="text-right">Подготовлено</TableHead>
                        <TableHead className="text-right">Выдано</TableHead>
                        <TableHead className="text-right">Осталось подготовить</TableHead>
                        <TableHead className="text-right">Отклонение</TableHead>
                        <TableHead>Сверка</TableHead>
                        <TableHead className="text-right">К выдаче</TableHead>
                        <TableHead>{t("unit")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedRequest.items || []).map((item) => {
                        const planned = toQty(item.planned_quantity ?? item.required_quantity, 0);
                        const prepared = toQty(preparedQtyByItem[item.id], toQty(item.prepared_quantity, 0));
                        const issued = toQty(item.issued_quantity, 0);
                        const remainingToIssue = Math.max(prepared - issued, 0);
                        const remainingToPrepare = Math.max(planned - prepared, 0);
                        const preparationDeviation = prepared - planned;
                        const available = toQty(balanceByWarehouseProduct[`${effectiveSourceWarehouseId}|${item.product_id}`], 0);
                        const preparedEditable =
                          canProcess &&
                          (selectedRequest.status === "new" ||
                            selectedRequest.status === "active" ||
                            selectedRequest.status === "preparing");
                        const issueEditable =
                          selectedRequest.status === "ready" || selectedRequest.status === "received_confirmed";
                        return (
                        <TableRow key={item.id}>
                          <TableCell>{item.product_name || "-"}</TableCell>
                          <TableCell>{productCategoryLabel(item)}</TableCell>
                          <TableCell className="text-right">{planned.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{available.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={preparedQtyByItem[item.id] ?? prepared.toFixed(2)}
                              onChange={(e) => {
                                const value = e.target.value;
                                setPreparedQtyByItem((prev) => ({ ...prev, [item.id]: value }));
                                setIssueQtyByItem((prev) => ({ ...prev, [item.id]: value }));
                              }}
                              disabled={!preparedEditable || submitting}
                              className="ml-auto h-8 w-24"
                            />
                          </TableCell>
                          <TableCell className="text-right">{issued.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{remainingToPrepare.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {preparationDeviation > 0 ? "+" : ""}
                            {preparationDeviation.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="border-slate-700 bg-slate-950 text-slate-200">
                              {reconciliationLabel(item.reconciliation_status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              max={remainingToIssue}
                              value={issueQtyByItem[item.id] ?? "0"}
                              onChange={(e) =>
                                setIssueQtyByItem((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              disabled={!issueEditable || submitting}
                              className="ml-auto h-8 w-24"
                            />
                          </TableCell>
                          <TableCell>{localizeUnit(item.unit || item.product_unit || "kg", language)}</TableCell>
                        </TableRow>
                      )})}
                    </TableBody>
                  </Table>
                </div>

                {canProcess && (
                  <div className="space-y-3">
                    {(selectedRequest.status === "new" ||
                      selectedRequest.status === "active" ||
                      selectedRequest.status === "preparing") && (
                      <Button onClick={handleReady} disabled={submitting}>
                        Готово к выдаче
                      </Button>
                    )}

                    {selectedRequest.status === "ready" && (
                      <div className="rounded-md border border-blue-500/40 bg-blue-950/30 px-3 py-2 text-sm text-blue-100">
                        Склад собрал товар. Ожидаем, когда специалист нажмёт «Товар принят». До этого «Товар отдан» недоступно.
                      </div>
                    )}

                    {selectedRequest.status === "received_confirmed" && (
                      <div className="flex flex-wrap gap-2">
                        <Button className="hidden" onClick={handleCreateIssueTicket} disabled={submitting || !effectiveSourceWarehouseId || hasStockShortage}>
                          Создать талон выдачи
                        </Button>
                        <Button onClick={handleIssue} disabled={submitting || !effectiveSourceWarehouseId || hasStockShortage}>
                          Товар отдан
                        </Button>
                      </div>
                    )}

                    {["issued_by_warehouse", "issued", "partially_issued"].includes(selectedRequest.status) &&
                    selectedRequest.warehouse_request_status !== "closed" ? (
                      <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-950/20 p-3">
                        <div>
                          <div className="font-semibold text-amber-100">Физический возврат на склад</div>
                          <div className="text-xs text-amber-200/80">
                            Складовщик указывает только реально принятый возврат. Расход вычисляется автоматически.
                          </div>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {(selectedRequest.items || []).map((item) => (
                            <div key={item.id}>
                              <Label className="text-xs">
                                {item.product_name || "Материал"}, возврат
                              </Label>
                              <Input
                                type="number"
                                min={0}
                                max={Math.max(
                                  toQty(item.issued_quantity, 0) -
                                    toQty(item.return_received_quantity, 0) -
                                    toQty(item.loss_quantity, 0),
                                  0
                                )}
                                step="0.01"
                                value={returnQtyByItem[item.id] ?? "0"}
                                onChange={(event) =>
                                  setReturnQtyByItem((prev) => ({
                                    ...prev,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => void handleWarehouseReturn(false)} disabled={submitting}>
                            Принять возврат
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => void handleWarehouseReturn(true)}
                            disabled={submitting}
                          >
                            Возврата нет
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {canAdminTransition ? (
                  <div className="space-y-3 rounded-md border border-red-500/40 bg-red-950/15 p-3">
                    <div>
                      <div className="font-semibold text-red-100">Административное действие</div>
                      <div className="text-xs text-red-200/75">
                        Возврат заявки, отмена и подтверждение потерь всегда записываются с причиной.
                      </div>
                    </div>
                    <Input
                      value={adminReason}
                      onChange={(event) => setAdminReason(event.target.value)}
                      placeholder="Обязательная причина"
                    />
                    {!["issued_by_warehouse", "issued", "partially_issued", "received_confirmed", "cancelled"].includes(
                      selectedRequest.status
                    ) ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => void handleAdminTransition("return_to_preparation")}
                          disabled={submitting}
                        >
                          Вернуть в подготовку
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => void handleAdminTransition("cancel")}
                          disabled={submitting}
                        >
                          Отменить заявку
                        </Button>
                      </div>
                    ) : null}
                    {["issued_by_warehouse", "issued", "partially_issued"].includes(
                      selectedRequest.status
                    ) ? (
                      <>
                        <div className="grid gap-2 md:grid-cols-2">
                          {(selectedRequest.items || []).map((item) => (
                            <div key={item.id}>
                              <Label className="text-xs">
                                {item.product_name || "Материал"}, потери
                              </Label>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={lossQtyByItem[item.id] ?? "0"}
                                onChange={(event) =>
                                  setLossQtyByItem((prev) => ({
                                    ...prev,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <Button
                          variant="destructive"
                          onClick={() => void handleAdminTransition("record_loss")}
                          disabled={submitting}
                        >
                          Подтвердить потери
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {(selectedRequest.status === "issued_by_warehouse" ||
                  selectedRequest.status === "issued" ||
                  selectedRequest.status === "partially_issued") && (
                    <div className="rounded-md border border-violet-500/40 bg-violet-950/30 p-3 text-sm text-violet-100">
                    Товар отдан. Складское списание зафиксировано.
                  </div>
                )}

                {selectedRequest.status === "received_confirmed" && (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm text-emerald-100">
                    Специалист подтвердил получение. Теперь можно нажать «Товар отдан» и списать материалы со склада.
                  </div>
                )}

              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="flex max-h-[86vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>История заявок</DialogTitle>
            <DialogDescription>Закрытые, отменённые и полностью сверенные заявки.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {historyRequests.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
                Завершённых заявок пока нет.
              </div>
            ) : (
              historyRequests.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/40 p-3 text-left hover:border-yellow-500/40"
                  onClick={() => {
                    setHistoryOpen(false);
                    setSelectedId(row.id);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {row.field_name || "Поле не указано"} · {row.operation_type || "Операция"}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {row.request_number} · {requestMaterialPreview(row)}
                    </span>
                  </span>
                  <Badge className={`${statusBadge(row.status)} shrink-0`}>{statusLabel(row.status, t)}</Badge>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
