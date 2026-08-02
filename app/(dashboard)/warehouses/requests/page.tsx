"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  PackageCheck,
  Search,
  UserRound,
  Warehouse as WarehouseIcon,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";
import { supabase } from "@/lib/supabase/client";
import {
  adminTransitionWarehouseRequest,
  getWarehouseIssueRequests,
  issueWarehouseRequest,
  reconcileWarehouseReturn,
  updateWarehouseIssueRequestStatus,
} from "@/lib/services/warehouse-requests";
import {
  getInventoryBalances,
  getWarehouses,
  getWarehouseStockDetails,
} from "@/lib/services/warehouses";
import type {
  Warehouse,
  WarehouseStockDetails,
} from "@/lib/types/warehouse";
import type {
  WarehouseIssueRequest,
  WarehouseIssueRequestItem,
} from "@/lib/types/warehouse-request";
import {
  allocateQuantityAcrossLots,
  materialIssueStatusLabel,
  validateMaterialIssue,
} from "@/lib/warehouse/material-issue";

type WarehouseTab = "new" | "ready" | "issued" | "history";

const WAREHOUSE_TABS: Array<{ key: WarehouseTab; title: string }> = [
  { key: "new", title: "Новые" },
  { key: "ready", title: "Готовы к выдаче" },
  { key: "issued", title: "Выданы" },
  { key: "history", title: "История" },
];

const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  pesticide: "СЗР",
  crop_protection: "СЗР",
  fertilizer: "Удобрение",
  additive: "Добавка",
  organic: "Органика",
  fuel: "Топливо",
  commodity: "Товар",
  other: "Другое",
};

function toQty(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function numberText(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function statusLabel(status: string): string {
  if (status === "new" || status === "active") return "Новая";
  if (status === "preparing") return "Готовится";
  if (status === "ready") return "Готово к выдаче";
  if (status === "received_confirmed") return "Подтверждено специалистом";
  if (status === "partially_issued") return "Частично выдано";
  if (status === "closed") return "Закрыто";
  if (status === "issued" || status === "issued_by_warehouse") return "Выдано";
  if (status === "cancelled") return "Отменено";
  return status;
}

function statusClass(status: string): string {
  if (status === "ready") return "border-blue-400/30 bg-blue-500/15 text-blue-200";
  if (status === "received_confirmed") {
    return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
  }
  if (status === "issued" || status === "issued_by_warehouse") {
    return "border-violet-400/30 bg-violet-500/15 text-violet-200";
  }
  if (status === "closed") {
    return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
  }
  if (status === "partially_issued") {
    return "border-amber-400/30 bg-amber-500/15 text-amber-200";
  }
  if (status === "cancelled") return "border-slate-600 bg-slate-800 text-slate-300";
  return "border-yellow-400/30 bg-yellow-500/15 text-yellow-200";
}

function tabForRequest(row: WarehouseIssueRequest): WarehouseTab {
  const status = String(row.warehouse_request_status || row.status || "");
  if (
    status === "return_received" ||
    status === "closed" ||
    status === "cancelled"
  ) {
    return "history";
  }
  if (status === "ready_for_pickup" || row.status === "ready") return "ready";
  if (
    status === "picked_up_by_specialist" ||
    status === "issued" ||
    status === "return_expected" ||
    row.status === "received_confirmed" ||
    row.status === "issued" ||
    row.status === "issued_by_warehouse" ||
    row.status === "partially_issued"
  ) {
    return "issued";
  }
  return "new";
}

function recipientLabel(row: WarehouseIssueRequest): string {
  return (
    row.recipient_name ||
    row.assigned_specialist_name ||
    row.recipient_email ||
    "Не указан"
  );
}

function cropLabel(row: WarehouseIssueRequest): string {
  return [row.crop_name, row.variety_name, row.reproduction_name]
    .filter(Boolean)
    .join(" / ");
}

function productCategoryLabel(item: WarehouseIssueRequestItem): string {
  const key = String(item.product_type || item.product_category || "")
    .trim()
    .toLowerCase();
  return PRODUCT_CATEGORY_LABELS[key] || "Другое";
}

function visibleComment(value: string | null | undefined): string | null {
  const comment = String(value || "").trim();
  if (!comment || /^auto-created(?: atomically)? from operation/i.test(comment)) {
    return null;
  }
  return comment;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function requestHistory(row: WarehouseIssueRequest) {
  return [
    {
      key: "created",
      at: row.created_at,
      title: "Заявка создана из операции",
      actor: "Система",
    },
    row.ready_at || row.prepared_at
      ? {
          key: "ready",
          at: row.ready_at || row.prepared_at,
          title: "Материалы подготовлены",
          actor: "Склад",
        }
      : null,
    row.received_confirmed_at || row.specialist_confirmed_at
      ? {
          key: "received",
          at: row.received_confirmed_at || row.specialist_confirmed_at,
          title: "Получение подтверждено специалистом",
          actor: recipientLabel(row),
        }
      : null,
    row.issued_at
      ? {
          key: "issued",
          at: row.issued_at,
          title: "Материалы выданы",
          actor: "Склад",
        }
      : null,
    row.return_received_at
      ? {
          key: "return",
          at: row.return_received_at,
          title: "Возврат принят",
          actor: "Склад",
        }
      : null,
    row.cancelled_at
      ? {
          key: "cancelled",
          at: row.cancelled_at,
          title: "Заявка отменена администратором",
          actor: "Администратор",
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    at: string;
    title: string;
    actor: string;
  }>;
}

export default function WarehouseRequestsPage() {
  const { profile } = useAuth();
  const { language, t } = useLanguage();
  const { toast } = useToast();
  const [requests, setRequests] = useState<WarehouseIssueRequest[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<WarehouseTab>("new");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailDismissed, setDetailDismissed] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [stockDetailsByItem, setStockDetailsByItem] = useState<
    Record<string, WarehouseStockDetails | null>
  >({});
  const [stockDetailsLoading, setStockDetailsLoading] = useState(false);
  const [preparedByItem, setPreparedByItem] = useState<Record<string, string>>(
    {}
  );
  const [returnByItem, setReturnByItem] = useState<Record<string, string>>({});
  const [lossByItem, setLossByItem] = useState<Record<string, string>>({});
  const [adminReason, setAdminReason] = useState("");
  const [isQaCompany, setIsQaCompany] = useState(false);
  const [showTestData, setShowTestData] = useState(false);

  const canProcess =
    profile?.role === "warehouse" ||
    profile?.role === "warehouse_operator" ||
    profile?.role === "global_admin";
  const canAdmin =
    profile?.role === "company_admin" || profile?.role === "global_admin";
  const canView =
    canProcess ||
    canAdmin ||
    profile?.role === "agronomist";

  const loadData = async ({ foreground = true }: { foreground?: boolean } = {}) => {
    if (!profile?.company_id) return;
    if (foreground) setLoading(true);
    try {
      const [requestRows, warehouseRows, balanceRows, companyResult] = await Promise.all([
        getWarehouseIssueRequests(profile.company_id, {
          includeTestData: showTestData,
        }),
        getWarehouses(profile.company_id, false, language),
        getInventoryBalances(profile.company_id, language),
        supabase
          .from("companies")
          .select("name")
          .eq("id", profile.company_id)
          .maybeSingle(),
      ]);
      if (companyResult.error) throw companyResult.error;
      const nextBalances: Record<string, number> = {};
      balanceRows.forEach((row) => {
        nextBalances[`${row.warehouse_id}|${row.product_id}`] = Number(
          row.quantity || 0
        );
      });
      setRequests(requestRows);
      setWarehouses(warehouseRows);
      setBalances(nextBalances);
      setIsQaCompany(
        /(?:^|[^a-z0-9])qa(?:$|[^a-z0-9])/i.test(
          String(companyResult.data?.name || "")
        )
      );
    } catch (error: any) {
      if (foreground) {
        toast({
          title: "Ошибка",
          description: error?.message || "Не удалось загрузить заявки",
          variant: "destructive",
        });
      } else {
        console.error("Background warehouse request refresh failed", error);
      }
    } finally {
      if (foreground) setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.company_id) void loadData();
  }, [profile?.company_id, profile?.role, language, showTestData]);

  useLiveRefresh({
    enabled: Boolean(profile?.company_id && canView),
    onRefresh: () => loadData({ foreground: false }),
  });

  const tabCounts = useMemo(() => {
    const counts: Record<WarehouseTab, number> = {
      new: 0,
      ready: 0,
      issued: 0,
      history: 0,
    };
    requests.forEach((row) => {
      counts[tabForRequest(row)] += 1;
    });
    return counts;
  }, [requests]);

  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((row) => {
      if (tabForRequest(row) !== activeTab) return false;
      if (!query) return true;
      return [
        row.request_number,
        row.operation_type,
        row.field_name,
        cropLabel(row),
        recipientLabel(row),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [activeTab, requests, search]);

  const selectedRequest =
    requests.find((row) => row.id === selectedId) || null;

  useEffect(() => {
    if (visibleRequests.length === 0) {
      setSelectedId(null);
      setMobileDetailOpen(false);
      return;
    }
    if (
      !detailDismissed &&
      !visibleRequests.some((row) => row.id === selectedId)
    ) {
      setSelectedId(visibleRequests[0].id);
    }
  }, [detailDismissed, selectedId, visibleRequests]);

  useEffect(() => {
    if (!selectedRequest) return;
    setSourceWarehouseId(selectedRequest.source_warehouse_id || "");
    setStockDetailsByItem({});
    setPreparedByItem(
      Object.fromEntries(
        selectedRequest.items.map((item) => {
          const planned = toQty(
            item.planned_quantity ?? item.required_quantity,
            0
          );
          const prepared = toQty(item.prepared_quantity, planned);
          return [item.id, String(prepared)];
        })
      )
    );
    setReturnByItem(
      Object.fromEntries((selectedRequest.items || []).map((item) => [item.id, "0"]))
    );
    setLossByItem(
      Object.fromEntries((selectedRequest.items || []).map((item) => [item.id, "0"]))
    );
    setAdminReason("");
  }, [selectedRequest?.id]);

  useEffect(() => {
    if (!mobileDetailOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileDetailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileDetailOpen]);

  const effectiveWarehouseId =
    sourceWarehouseId || selectedRequest?.source_warehouse_id || "";
  const selectedWarehouseName =
    warehouses.find((warehouse) => warehouse.id === effectiveWarehouseId)?.name ||
    selectedRequest?.source_warehouse_name ||
    "";

  useEffect(() => {
    if (
      !profile?.company_id ||
      !selectedRequest ||
      !effectiveWarehouseId ||
      !canProcess ||
      !["new", "active", "preparing"].includes(selectedRequest.status)
    ) {
      return;
    }
    let cancelled = false;
    setStockDetailsLoading(true);
    Promise.all(
      selectedRequest.items.map(async (item) => {
        const productId = item.actual_product_id || item.product_id;
        if (!productId) return [item.id, null] as const;
        const details = await getWarehouseStockDetails({
          companyId: profile.company_id!,
          warehouseId: effectiveWarehouseId,
          productId,
          unit: item.unit || item.product_unit || "kg",
          excludeRequestId: selectedRequest.id,
        });
        return [item.id, details] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setStockDetailsByItem(Object.fromEntries(entries));
      })
      .catch((error: any) => {
        if (cancelled) return;
        toast({
          title: "Не удалось загрузить партии",
          description: error?.message || "Проверьте складской остаток.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setStockDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    canProcess,
    effectiveWarehouseId,
    profile?.company_id,
    selectedRequest?.id,
    selectedRequest?.status,
  ]);

  const stockRows = useMemo(() => {
    if (!selectedRequest) return [];
    return (selectedRequest.items || []).map((item) => {
      const unit = localizeUnit(
        item.unit || item.product_unit || "kg",
        language
      );
      const planned = toQty(
        item.planned_quantity ?? item.required_quantity,
        0
      );
      const details = stockDetailsByItem[item.id] || null;
      const hasProductIdentity = Boolean(item.actual_product_id || item.product_id);
      const lifecycleStatus = String(
        selectedRequest.warehouse_request_status || selectedRequest.status || ""
      );
      const preparingNow = [
        "pending",
        "collecting",
        "new",
        "active",
        "preparing",
      ].includes(lifecycleStatus);
      const prepared = preparingNow
        ? Math.max(
            toQty(
              preparedByItem[item.id],
              toQty(item.prepared_quantity, planned)
            ),
            0
          )
        : Math.max(toQty(item.prepared_quantity, 0), 0);
      const available = details
        ? toQty(details.available_quantity, 0)
        : effectiveWarehouseId
          ? toQty(balances[`${effectiveWarehouseId}|${item.product_id}`], 0)
          : 0;
      const validation = validateMaterialIssue({
        plannedQuantity: planned,
        preparedQuantity: prepared,
        availableQuantity: available,
        unit: item.unit,
      });
      if (!preparingNow) {
        validation.errors = [];
        validation.valid = true;
      }
      const lotDistribution = allocateQuantityAcrossLots({
        quantity: prepared,
        lots: (details?.lots || []).map((lot) => ({
          batchId: lot.batch_id,
          batchIdText: lot.batch_id,
          batchClass: lot.batch_class,
          batchLabel: lot.batch_label,
          availableQuantity: lot.available_quantity,
        })),
      });
      const issued = toQty(item.issued_quantity, 0);
      const expectedReturn = preparingNow
        ? validation.expectedReturnQuantity
        : toQty(item.expected_return_quantity, Math.max(prepared - planned, 0));
      const rowStatus = !hasProductIdentity
        ? "Семенной материал с таким сортом и репродукцией ещё не оприходован"
        : lifecycleStatus === "closed" ||
        item.reconciliation_status === "reconciled"
          ? "Сверка завершена"
          : lifecycleStatus === "return_expected"
            ? `Ожидается возврат ${numberText(expectedReturn)} ${unit}`
            : materialIssueStatusLabel({
                preparedQuantity: prepared,
                availableQuantity: available,
                expectedReturnQuantity: expectedReturn,
                unit,
              });
      return {
        item,
        unit,
        planned,
        prepared,
        issued,
        available,
        details,
        allocations: lotDistribution.allocations,
        expectedReturn,
        validation,
        status: rowStatus,
        remainingToIssue: Math.max(prepared - issued, 0),
        exceedsStock:
          preparingNow && prepared > available + 0.000001,
        valid:
          !preparingNow ||
          (hasProductIdentity && Boolean(details) &&
            validation.valid &&
            lotDistribution.deficitQuantity <= 0.000001 &&
            prepared <= available + 0.000001),
      };
    });
  }, [
    balances,
    effectiveWarehouseId,
    language,
    preparedByItem,
    selectedRequest,
    stockDetailsByItem,
  ]);

  const hasStockProblem = stockRows.some((row) => row.exceedsStock);
  const hasPrepared = stockRows.some((row) => row.prepared > 0.000001);
  const allPreparedRowsValid =
    stockRows.length > 0 && stockRows.every((row) => row.valid);

  const runAction = async (
    action: () => Promise<void>,
    successMessage: string,
    nextTab?: WarehouseTab
  ) => {
    try {
      setSubmitting(true);
      await action();
      if (nextTab) setActiveTab(nextTab);
      await loadData();
      toast({ title: "Готово", description: successMessage });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Действие не выполнено",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReady = async () => {
    if (!selectedRequest || !profile?.company_id) return;
    if (!effectiveWarehouseId) {
      toast({
        title: "Выберите склад",
        description: "Нужно указать склад выдачи.",
        variant: "destructive",
      });
      return;
    }
    if (!hasPrepared) {
      toast({
        title: "Укажите количество",
        description: "Подготовьте хотя бы одну позицию.",
        variant: "destructive",
      });
      return;
    }
    if (hasStockProblem || !allPreparedRowsValid) {
      toast({
        title: "Проверьте позиции",
        description:
          stockRows.flatMap((row) => row.validation.errors)[0] ||
          "Для каждой позиции укажите количество в пределах доступного остатка.",
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
          sourceWarehouseId: effectiveWarehouseId,
          items: stockRows.map((row) => ({
            itemId: row.item.id,
            preparedQuantity: row.prepared,
            allocations: row.allocations.map((allocation) => ({
              batchId: allocation.batchId,
              batchIdText: allocation.batchIdText,
              batchClass: allocation.batchClass,
              batchLabel: allocation.batchLabel,
              quantity: Number(allocation.quantity.toFixed(4)),
            })),
          })),
        }),
      "Материалы подготовлены. Ожидаем подтверждение специалиста.",
      "ready"
    );
  };

  const handleIssue = async () => {
    if (!selectedRequest || !profile?.company_id) return;
    if (selectedRequest.status !== "received_confirmed") {
      toast({
        title: "Выдача пока недоступна",
        description: "Сначала специалист должен подтвердить получение.",
        variant: "destructive",
      });
      return;
    }
    if (!effectiveWarehouseId) return;
    const items = stockRows
      .filter((row) => row.remainingToIssue > 0.000001)
      .map((row) => ({
        itemId: row.item.id,
        issuedQuantity: Number(row.remainingToIssue.toFixed(4)),
      }));
    if (items.length === 0) {
      toast({
        title: "Нечего выдавать",
        description: "В заявке нет подготовленного остатка к выдаче.",
        variant: "destructive",
      });
      return;
    }
    await runAction(
      () =>
        issueWarehouseRequest({
          requestId: selectedRequest.id,
          companyId: profile.company_id!,
          sourceWarehouseId: effectiveWarehouseId,
          items,
        }),
      "Выдача зафиксирована в складском учёте.",
      "issued"
    );
  };

  const handleReturn = async (closeWithoutReturn: boolean) => {
    if (!selectedRequest || !profile?.company_id) return;
    const items = (selectedRequest.items || [])
      .map((item) => ({
        itemId: item.id,
        returnedQuantity: toQty(returnByItem[item.id], 0),
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
        : "Физический возврат принят на склад.",
      "history"
    );
  };

  const handleAdmin = async (
    action: "return_to_preparation" | "cancel" | "record_loss"
  ) => {
    if (!selectedRequest || !profile?.company_id || !adminReason.trim()) {
      toast({
        title: "Нужен комментарий",
        description: "Административное действие требует причины.",
        variant: "destructive",
      });
      return;
    }
    const items = (selectedRequest.items || [])
      .map((item) => ({
        itemId: item.id,
        lossQuantity: toQty(lossByItem[item.id], 0),
      }))
      .filter((item) => item.lossQuantity > 0.000001);
    if (action === "record_loss" && items.length === 0) {
      toast({
        title: "Укажите потери",
        description: "Нужна хотя бы одна положительная строка.",
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
          items,
        }),
      "Административное действие записано в историю.",
      action === "cancel" ? "history" : "new"
    );
  };

  if (!canView) {
    return (
      <div>
        <PageHeader
          title="Заявки на склад"
          description="Материалы для полевых операций"
        />
        <Alert variant="destructive">
          <AlertDescription>{t("access_denied")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const selectedComment = selectedRequest
    ? visibleComment(selectedRequest.operation_notes || selectedRequest.comment)
    : null;
  const preparing =
    selectedRequest &&
    ["new", "active", "preparing"].includes(selectedRequest.status);
  const issued =
    selectedRequest &&
    ["issued", "issued_by_warehouse", "partially_issued"].includes(
      selectedRequest.status
    );

  const closeDetail = () => {
    setMobileDetailOpen(false);
    setSelectedId(null);
    setDetailDismissed(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Заявки на склад"
          description="Подготовка, выдача и возврат материалов"
        />
        {isQaCompany ? (
          <div className="flex items-center gap-2 pt-2">
            <Switch
              id="warehouse-test-data"
              checked={showTestData}
              onCheckedChange={setShowTestData}
            />
            <Label htmlFor="warehouse-test-data" className="text-sm text-slate-300">
              Показать тестовые данные
            </Label>
          </div>
        ) : null}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-800">
        {WAREHOUSE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setDetailDismissed(false);
              setMobileDetailOpen(false);
            }}
            className={[
              "relative shrink-0 px-3 py-3 text-sm font-medium text-slate-400 transition-colors",
              activeTab === tab.key ? "text-slate-100" : "hover:text-slate-200",
            ].join(" ")}
          >
            {tab.title}
            <span className="ml-1.5 rounded-full bg-slate-800 px-1.5 py-0.5 text-[11px]">
              {tabCounts[tab.key]}
            </span>
            {activeTab === tab.key ? (
              <span className="absolute inset-x-2 bottom-0 h-0.5 bg-yellow-400" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid min-h-[660px] gap-4 lg:grid-cols-[minmax(310px,370px)_minmax(0,1fr)]">
        <aside className="min-w-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по заявке, полю или работе"
              className="h-11 border-slate-800 bg-slate-950 pl-9"
            />
          </div>

          <div className="mt-3 max-h-[calc(100dvh-245px)] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <div className="py-10 text-center text-sm text-slate-500">
                Загрузка заявок...
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                В этой вкладке заявок нет.
              </div>
            ) : (
              visibleRequests.map((row) => {
                const selected = row.id === selectedId;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(row.id);
                      setDetailDismissed(false);
                      setMobileDetailOpen(true);
                    }}
                    className={[
                      "w-full rounded-lg border p-4 text-left transition-colors",
                      selected
                        ? "border-yellow-400/80 bg-yellow-400/10"
                        : "border-slate-800 bg-slate-900/55 hover:border-slate-700 hover:bg-slate-900",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-bold text-slate-100">
                          {row.request_number}
                        </div>
                        <div className="mt-2 truncate text-[12px] font-semibold uppercase text-yellow-300">
                          {row.operation_type || "Полевая работа"}
                        </div>
                      </div>
                      <Badge className={`${statusClass(row.workflow_status || row.status)} shrink-0`}>
                        {statusLabel(row.workflow_status || row.status)}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-200">
                      {row.field_name || "Поле не указано"}
                      {row.crop_name ? ` · ${row.crop_name}` : ""}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-slate-500">
                      <span>{formatDate(row.planned_datetime || row.operation_date)}</span>
                      <span className="shrink-0">{row.items.length} поз.</span>
                    </div>
                    <div className="mt-2 truncate text-[13px] text-slate-400">
                      {recipientLabel(row)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section
          className={[
            "min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-slate-800 bg-slate-950 text-slate-100",
            mobileDetailOpen ? "fixed inset-0 z-50 grid h-[100dvh] border" : "hidden",
            "lg:sticky lg:top-4 lg:z-auto lg:grid lg:h-[calc(100dvh-120px)] lg:rounded-lg lg:border",
          ].join(" ")}
          aria-label="Полная складская заявка"
        >
          {selectedRequest ? (
            <>
              <header className="border-b border-slate-800 px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-100 sm:text-2xl">
                        Заявка {selectedRequest.request_number}
                      </h2>
                      <Badge className={statusClass(selectedRequest.workflow_status || selectedRequest.status)}>
                        {statusLabel(selectedRequest.workflow_status || selectedRequest.status)}
                      </Badge>
                    </div>
                    <div className="mt-2 text-[13px] font-semibold uppercase text-yellow-300">
                      {selectedRequest.operation_type || "Полевая работа"}
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-200 sm:text-lg">
                      {selectedRequest.field_name || "Поле не указано"}
                      {selectedRequest.crop_name
                        ? ` · ${selectedRequest.crop_name}`
                        : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={closeDetail}
                    aria-label="Закрыть заявку"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </header>

              <div className="min-h-0 space-y-7 overflow-y-auto px-4 py-5 sm:px-6">
                <section className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Плановая дата
                    </div>
                    <div className="mt-1 font-semibold text-slate-100">
                      {formatDate(
                        selectedRequest.planned_datetime ||
                          selectedRequest.operation_date
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                      <UserRound className="h-3.5 w-3.5" />
                      Ответственный
                    </div>
                    <div className="mt-1 font-semibold text-slate-100">
                      {recipientLabel(selectedRequest)}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                      <WarehouseIcon className="h-3.5 w-3.5" />
                      Склад выдачи
                    </div>
                    {preparing && canProcess ? (
                      <Select
                        value={sourceWarehouseId}
                        onValueChange={setSourceWarehouseId}
                      >
                        <SelectTrigger className="mt-1 h-9">
                          <SelectValue placeholder="Выберите склад" />
                        </SelectTrigger>
                        <SelectContent>
                          {warehouses.map((warehouse) => (
                            <SelectItem key={warehouse.id} value={warehouse.id}>
                              {warehouse.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="mt-1 font-semibold text-slate-100">
                        {selectedWarehouseName || "Не выбран"}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[12px] text-slate-500">Позиций</div>
                    <div className="mt-1 font-semibold text-slate-100">
                      {selectedRequest.items.length}
                    </div>
                  </div>
                </section>

                {selectedComment ? (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-100">
                      Комментарий агронома
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {selectedComment}
                    </p>
                  </section>
                ) : null}

                <section className="space-y-3">
                  <h3 className="text-base font-semibold text-slate-100">
                    Позиции заявки
                  </h3>
                  <div className="hidden grid-cols-[minmax(180px,1.4fr)_110px_100px_130px_120px_minmax(160px,1fr)] gap-3 border-b border-slate-800 pb-2 text-[12px] text-slate-500 md:grid">
                    <span>Материал</span>
                    <span>Плановая потребность</span>
                    <span>Доступно</span>
                    <span>К выдаче</span>
                    <span>Ожидаемый возврат</span>
                    <span>Статус</span>
                  </div>
                  <div className="space-y-2 md:space-y-0">
                    {stockRows.map((row) => (
                      <div
                        key={row.item.id}
                        className="grid gap-3 rounded-lg border border-slate-800 p-3 text-sm md:grid-cols-[minmax(180px,1.4fr)_110px_100px_130px_120px_minmax(160px,1fr)] md:items-center md:rounded-none md:border-x-0 md:border-t-0 md:px-0 md:py-3"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-100">
                            {row.item.product_name || "Материал"}
                          </div>
                          <div className="mt-1 text-[12px] text-slate-500">
                            {productCategoryLabel(row.item)}
                          </div>
                        </div>
                        <div>
                          <span className="mr-1 text-[12px] text-slate-500 md:hidden">
                            Плановая потребность:
                          </span>
                          {numberText(row.planned)} {row.unit}
                        </div>
                        <div className={row.exceedsStock ? "text-red-300" : ""}>
                          <span className="mr-1 text-[12px] text-slate-500 md:hidden">
                            Доступно:
                          </span>
                          {numberText(row.available)} {row.unit}
                        </div>
                        <div>
                          <Label
                            htmlFor={`prepared-${row.item.id}`}
                            className="mb-1 block text-[12px] text-slate-500 md:hidden"
                          >
                            К выдаче
                          </Label>
                          {preparing && canProcess ? (
                            <div className="relative max-w-40">
                              <Input
                                id={`prepared-${row.item.id}`}
                                type="number"
                                min={0}
                                step="0.0001"
                                value={preparedByItem[row.item.id] ?? ""}
                                onChange={(event) =>
                                  setPreparedByItem((previous) => ({
                                    ...previous,
                                    [row.item.id]: event.target.value,
                                  }))
                                }
                                className="h-10 pr-10"
                                disabled={submitting || stockDetailsLoading}
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-slate-500">
                                {row.unit}
                              </span>
                            </div>
                          ) : (
                            <span>
                              {numberText(row.prepared)} {row.unit}
                            </span>
                          )}
                        </div>
                        <div className="text-slate-200">
                          <span className="mr-1 text-[12px] text-slate-500 md:hidden">
                            Ожидаемый возврат:
                          </span>
                          {numberText(row.expectedReturn)} {row.unit}
                        </div>
                        <div
                          className={
                            row.exceedsStock
                              ? "text-red-300"
                              : row.expectedReturn > 0.000001
                                ? "text-slate-200"
                                : "text-emerald-300"
                          }
                        >
                          {row.status}
                          {row.validation.errors.length > 0 ? (
                            <div className="mt-1 text-[11px] leading-4 text-red-300">
                              {row.validation.errors[0]}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {hasStockProblem ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {stockRows.find((row) => row.exceedsStock)?.validation
                        .errors[0] ||
                        "Подготовленное количество превышает доступный остаток."}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {issued && selectedRequest.warehouse_request_status !== "closed" ? (
                  <section className="space-y-3 rounded-lg border border-slate-800 p-4">
                    <div>
                      <h3 className="font-semibold text-slate-100">
                        Физический возврат
                      </h3>
                      <p className="mt-1 text-[13px] text-slate-500">
                        Укажите только фактически принятый возврат.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedRequest.items.map((item) => (
                        <div key={item.id}>
                          <Label htmlFor={`return-${item.id}`}>
                            {item.product_name || "Материал"}
                          </Label>
                          <Input
                            id={`return-${item.id}`}
                            type="number"
                            min={0}
                            step="0.01"
                            value={returnByItem[item.id] ?? "0"}
                            onChange={(event) =>
                              setReturnByItem((previous) => ({
                                ...previous,
                                [item.id]: event.target.value,
                              }))
                            }
                            className="mt-1"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => void handleReturn(false)}
                        disabled={submitting}
                      >
                        Принять возврат
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleReturn(true)}
                        disabled={submitting}
                      >
                        Возврата нет
                      </Button>
                    </div>
                  </section>
                ) : null}

                {canAdmin ? (
                  <section className="space-y-3 rounded-lg border border-slate-800 p-4">
                    <div>
                      <h3 className="font-semibold text-slate-100">
                        Действия Company Admin
                      </h3>
                      <p className="mt-1 text-[13px] text-slate-500">
                        Складовщику эти действия недоступны.
                      </p>
                    </div>
                    <Input
                      value={adminReason}
                      onChange={(event) => setAdminReason(event.target.value)}
                      placeholder="Обязательный комментарий"
                    />
                    {issued ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {selectedRequest.items.map((item) => (
                            <div key={item.id}>
                              <Label htmlFor={`loss-${item.id}`}>
                                {item.product_name || "Материал"}, потери
                              </Label>
                              <Input
                                id={`loss-${item.id}`}
                                type="number"
                                min={0}
                                step="0.01"
                                value={lossByItem[item.id] ?? "0"}
                                onChange={(event) =>
                                  setLossByItem((previous) => ({
                                    ...previous,
                                    [item.id]: event.target.value,
                                  }))
                                }
                                className="mt-1"
                              />
                            </div>
                          ))}
                        </div>
                        <Button
                          variant="destructive"
                          onClick={() => void handleAdmin("record_loss")}
                          disabled={submitting}
                        >
                          Подтвердить потери
                        </Button>
                      </>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => void handleAdmin("return_to_preparation")}
                          disabled={submitting}
                        >
                          Вернуть в подготовку
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => void handleAdmin("cancel")}
                          disabled={submitting}
                        >
                          Отменить заявку
                        </Button>
                      </div>
                    )}
                  </section>
                ) : null}

                <section className="space-y-3">
                  <h3 className="text-base font-semibold text-slate-100">
                    История заявки
                  </h3>
                  <div className="space-y-3">
                    {requestHistory(selectedRequest).map((event) => (
                      <div
                        key={event.key}
                        className="flex items-start justify-between gap-4 text-sm"
                      >
                        <div>
                          <div className="font-medium text-slate-200">
                            {event.title}
                          </div>
                          <div className="mt-0.5 text-[13px] text-slate-500">
                            {event.actor}
                          </div>
                        </div>
                        <div className="shrink-0 text-[13px] text-slate-500">
                          {formatDate(event.at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <footer className="border-t border-slate-800 bg-slate-950 px-4 py-4 sm:px-6">
                {preparing && canProcess ? (
                  <div className="flex justify-end">
                    <Button
                      className="h-12 w-full bg-yellow-400 text-slate-950 hover:bg-yellow-300 sm:w-auto sm:min-w-72"
                      onClick={() => void handleReady()}
                      disabled={
                        submitting ||
                        stockDetailsLoading ||
                        hasStockProblem ||
                        !hasPrepared ||
                        !allPreparedRowsValid
                      }
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Готово к выдаче
                    </Button>
                  </div>
                ) : selectedRequest.status === "ready" ? (
                  <div className="flex items-center gap-3 text-sm text-blue-200">
                    <PackageCheck className="h-5 w-5 shrink-0" />
                    Материалы подготовлены. Ожидаем подтверждение специалиста.
                  </div>
                ) : selectedRequest.status === "received_confirmed" && canProcess ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-slate-400">
                      Специалист подтвердил получение.
                    </span>
                    <Button
                      className="h-12 bg-yellow-400 px-8 text-slate-950 hover:bg-yellow-300"
                      onClick={() => void handleIssue()}
                      disabled={submitting}
                    >
                      Выдать
                    </Button>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">
                    {statusLabel(selectedRequest.workflow_status || selectedRequest.status)}
                  </div>
                )}
              </footer>
            </>
          ) : (
            <div className="hidden h-full place-items-center text-sm text-slate-500 lg:grid">
              Выберите заявку слева.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
