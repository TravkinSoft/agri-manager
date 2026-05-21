"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ClipboardList, PackageCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";
import { getInventoryBalances, getWarehouses } from "@/lib/services/warehouses";
import {
  createIssueTicketFromRequest,
  getWarehouseIssueRequests,
  issueWarehouseRequest,
  updateWarehouseIssueRequestStatus,
} from "@/lib/services/warehouse-requests";
import type { Warehouse } from "@/lib/types/warehouse";
import type { WarehouseIssueRequest } from "@/lib/types/warehouse-request";

function statusBadge(status: string) {
  if (status === "received_confirmed") return "bg-emerald-100 text-emerald-800";
  if (status === "issued_by_warehouse" || status === "issued") return "bg-violet-100 text-violet-800";
  if (status === "partially_issued") return "bg-amber-100 text-amber-800";
  if (status === "preparing") return "bg-cyan-100 text-cyan-800";
  if (status === "ready") return "bg-blue-100 text-blue-800";
  if (status === "cancelled") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

function statusLabel(status: string, t: (key: any) => string): string {
  if (status === "new" || status === "active") return t("status_new");
  if (status === "preparing") return "Preparing";
  if (status === "ready") return t("status_ready");
  if (status === "partially_issued") return "Partially issued";
  if (status === "issued") return t("status_issued_by_warehouse");
  if (status === "issued_by_warehouse") return t("status_issued_by_warehouse");
  if (status === "received_confirmed") return t("status_received_confirmed");
  if (status === "cancelled") return t("status_cancelled");
  return status;
}

function toQty(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function WarehouseRequestsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<WarehouseIssueRequest[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceWarehouseId, setSourceWarehouseId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [mobileTab, setMobileTab] = useState<"requests" | "preparing" | "ready" | "history" | "stock">("requests");
  const [balanceByWarehouseProduct, setBalanceByWarehouseProduct] = useState<Record<string, number>>({});
  const [issueQtyByItem, setIssueQtyByItem] = useState<Record<string, string>>({});

  const canProcess =
    profile?.role === "warehouse" ||
    profile?.role === "warehouse_operator" ||
    profile?.role === "company_admin" ||
    profile?.role === "global_admin";
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

      if (!selectedId && requestRows.length > 0) {
        setSelectedId(requestRows[0].id);
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
  }, [profile?.company_id, language]);

  const filteredRequests = useMemo(() => {
    return requests.filter((row) => {
      const text = `${row.request_number} ${row.field_name || ""} ${row.recipient_email || ""}`.toLowerCase();
      const matchSearch = !search || text.includes(search.toLowerCase());
      const workflowStatus = String((row as any).workflow_status || row.status || "");
      const matchStatus =
        statusFilter === "all" ||
        row.status === statusFilter ||
        workflowStatus === statusFilter ||
        (statusFilter === "active" && row.status === "new");
      return matchSearch && matchStatus;
    });
  }, [requests, search, statusFilter]);

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
    (selectedRequest.items || []).forEach((item) => {
      const planned = toQty(item.planned_quantity ?? item.required_quantity, 0);
      const alreadyIssued = toQty(item.issued_quantity, 0);
      const remaining = Math.max(planned - alreadyIssued, 0);
      defaults[item.id] = remaining > 0 ? remaining.toFixed(2) : "0";
    });
    setIssueQtyByItem(defaults);
  }, [selectedRequest?.id]);

  const stockCheckRows = useMemo(() => {
    if (!selectedRequest || !effectiveSourceWarehouseId) return [];
    return (selectedRequest.items || []).map((item) => {
      const available = toQty(balanceByWarehouseProduct[`${effectiveSourceWarehouseId}|${item.product_id}`], 0);
      const planned = toQty(item.planned_quantity ?? item.required_quantity, 0);
      const alreadyIssued = toQty(item.issued_quantity, 0);
      const remaining = Math.max(planned - alreadyIssued, 0);
      const toIssueRaw = toQty(issueQtyByItem[item.id], remaining);
      const toIssue = Math.max(0, toIssueRaw);
      const missing = Math.max(0, toIssue - available);
      const exceedsRemaining = toIssue > remaining + 0.000001;
      return {
        item,
        available,
        planned,
        alreadyIssued,
        remaining,
        toIssue,
        missing,
        exceedsRemaining,
        enough: available + 0.000001 >= toIssue,
      };
    });
  }, [selectedRequest, effectiveSourceWarehouseId, balanceByWarehouseProduct, issueQtyByItem]);

  const hasStockShortage = stockCheckRows.some((row) => row.toIssue > 0 && !row.enough);
  const hasIssueQtyOverRemaining = stockCheckRows.some((row) => row.exceedsRemaining);

  const runAction = async (fn: () => Promise<void>, successMessage: string) => {
    if (!selectedRequest || !profile?.company_id) return;
    try {
      setSubmitting(true);
      await fn();
      await loadData();
      toast({ title: "Success", description: successMessage });
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

  const handleMobileTab = (tab: "requests" | "preparing" | "ready" | "history" | "stock") => {
    setMobileTab(tab);
    if (tab === "stock") {
      router.push("/inventory");
      return;
    }
    if (tab === "requests") {
      setStatusFilter("all");
      return;
    }
    if (tab === "preparing") {
      setStatusFilter("preparing");
      return;
    }
    if (tab === "ready") {
      setStatusFilter("ready");
      return;
    }
    if (tab === "history") {
      setStatusFilter("received_confirmed");
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

    await runAction(
      () =>
        updateWarehouseIssueRequestStatus({
          requestId: selectedRequest.id,
          companyId: profile.company_id!,
          status: "ready",
          sourceWarehouseId,
        }),
      t("request_marked_ready")
    );
  };

  const handleCancel = async () => {
    if (!selectedRequest || !profile?.company_id) return;
    await runAction(
      () =>
        updateWarehouseIssueRequestStatus({
          requestId: selectedRequest.id,
          companyId: profile.company_id!,
          status: "cancelled",
        }),
      t("request_cancelled")
    );
  };

  const handleIssue = async () => {
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
          ? `${firstOver.item.product_name || t("material")}: issue quantity exceeds remaining planned amount.`
          : "Issue quantity exceeds remaining planned amount.",
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
        description: "Set at least one issue quantity greater than zero.",
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
          formattedMessage = `${shortageRow.item.product_name || "Material"}: ${selectedWarehouseName}. Available ${shortageRow.available.toFixed(2)} ${shortageRow.item.unit || shortageRow.item.product_unit || ""}, required ${shortageRow.toIssue.toFixed(2)} ${shortageRow.item.unit || shortageRow.item.product_unit || ""}.`;
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
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("filters")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder={t("search_requests_placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("status")} />
            </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all_statuses")}</SelectItem>
                <SelectItem value="new">{t("status_new")}</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="preparing">Preparing</SelectItem>
                <SelectItem value="ready">{t("status_ready")}</SelectItem>
                <SelectItem value="partially_issued">Partially issued</SelectItem>
                <SelectItem value="issued_by_warehouse">{t("status_issued_by_warehouse")}</SelectItem>
                <SelectItem value="issued">{t("status_issued_by_warehouse")}</SelectItem>
                <SelectItem value="received_confirmed">{t("status_received_confirmed")}</SelectItem>
                <SelectItem value="cancelled">{t("status_cancelled")}</SelectItem>
              </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {t("requests_list")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-slate-500">{t("loading")}</div>
            ) : filteredRequests.length === 0 ? (
              <div className="text-center text-sm text-slate-500">{t("no_issue_requests_found")}</div>
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {filteredRequests.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={`w-full rounded-lg border p-3 text-left ${row.id === selectedId ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">{row.request_number}</div>
                        <Badge className={statusBadge(row.status)}>{statusLabel(row.status, t)}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        <div>{t("field")}: {row.field_name || "-"}</div>
                        <div>{t("recipient")}: {row.recipient_email || "-"}</div>
                        <div>{t("planned_date")}: {row.planned_datetime ? new Date(row.planned_datetime).toLocaleString() : "-"}</div>
                        <div>{t("items")}: {row.items?.length || 0}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("request_number")}</TableHead>
                        <TableHead>{t("status")}</TableHead>
                        <TableHead>{t("field")}</TableHead>
                        <TableHead>{t("recipient")}</TableHead>
                        <TableHead>{t("planned_date")}</TableHead>
                        <TableHead>{t("items")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRequests.map((row) => (
                        <TableRow
                          key={row.id}
                          className={row.id === selectedId ? "bg-emerald-50" : ""}
                          onClick={() => setSelectedId(row.id)}
                        >
                          <TableCell className="font-medium">{row.request_number}</TableCell>
                          <TableCell>
                            <Badge className={statusBadge(row.status)}>{statusLabel(row.status, t)}</Badge>
                          </TableCell>
                          <TableCell>{row.field_name || "-"}</TableCell>
                          <TableCell>{row.recipient_email || "-"}</TableCell>
                          <TableCell>
                            {row.planned_datetime ? new Date(row.planned_datetime).toLocaleString() : "-"}
                          </TableCell>
                          <TableCell>{row.items?.length || 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5" />
              {t("request_details")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedRequest ? (
              <div className="text-sm text-slate-500">{t("select_request_from_list")}</div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div><span className="text-slate-500">{t("request_number")}:</span> {selectedRequest.request_number}</div>
                  <div><span className="text-slate-500">{t("status")}:</span> {statusLabel(selectedRequest.status, t)}</div>
                  <div><span className="text-slate-500">{t("operation")}:</span> {selectedRequest.operation_type} ({selectedRequest.operation_date || "-"})</div>
                  <div><span className="text-slate-500">{t("field")}:</span> {selectedRequest.field_name || "-"}</div>
                  <div><span className="text-slate-500">{t("recipient")}:</span> {selectedRequest.recipient_email || "-"}</div>
                  <div><span className="text-slate-500">{t("planned_date")}:</span> {selectedRequest.planned_datetime ? new Date(selectedRequest.planned_datetime).toLocaleString() : "-"}</div>
                  <div><span className="text-slate-500">{t("comment")}:</span> {selectedRequest.comment || "-"}</div>
                  <div><span className="text-slate-500">Талон весовой:</span> {selectedRequest.linked_ticket_id || "-"}</div>
                </div>

                <div className="space-y-2">
                  <Label>{t("source_warehouse")}</Label>
                  <Select
                    value={sourceWarehouseId}
                    onValueChange={setSourceWarehouseId}
                    disabled={
                      !canProcess ||
                      selectedRequest.status === "issued_by_warehouse" ||
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
                  <div className="rounded-md border p-3 text-sm">
                    <div className="font-medium mb-2">{t("stock_check_selected_warehouse")}</div>
                    <div className="space-y-1">
                      {stockCheckRows.map((row) => (
                        <div key={row.item.id} className={row.enough ? "text-emerald-700" : "text-red-700"}>
                          {row.item.product_name || "-"}: {t("available")} {row.available.toFixed(2)} {localizeUnit(row.item.unit || row.item.product_unit || "", language)}, to issue {row.toIssue.toFixed(2)} {localizeUnit(row.item.unit || row.item.product_unit || "", language)}, remaining {row.remaining.toFixed(2)} {localizeUnit(row.item.unit || row.item.product_unit || "", language)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 md:hidden">
                  {(selectedRequest.items || []).map((item) => {
                    const planned = toQty(item.planned_quantity ?? item.required_quantity, 0);
                    const issued = toQty(item.issued_quantity, 0);
                    const remaining = Math.max(planned - issued, 0);
                    const editable =
                      selectedRequest.status === "ready" || selectedRequest.status === "partially_issued";
                    return (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <div className="font-medium text-slate-900">{item.product_name || "-"}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.product_type || item.product_category || "-"}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                          <div>Planned: {planned.toFixed(2)}</div>
                          <div>Issued: {issued.toFixed(2)}</div>
                          <div>Remaining: {remaining.toFixed(2)}</div>
                          <div>{t("unit")}: {localizeUnit(item.unit || item.product_unit || "kg", language)}</div>
                        </div>
                        <div className="mt-2">
                          <Label className="mb-1 block text-xs">To issue</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            max={remaining}
                            value={issueQtyByItem[item.id] ?? "0"}
                            onChange={(e) =>
                              setIssueQtyByItem((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            disabled={!editable || submitting}
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
                        <TableHead className="text-right">Planned</TableHead>
                        <TableHead className="text-right">Issued</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead className="text-right">To issue</TableHead>
                        <TableHead>{t("unit")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedRequest.items || []).map((item) => {
                        const planned = toQty(item.planned_quantity ?? item.required_quantity, 0);
                        const issued = toQty(item.issued_quantity, 0);
                        const remaining = Math.max(planned - issued, 0);
                        const editable =
                          selectedRequest.status === "ready" || selectedRequest.status === "partially_issued";
                        return (
                        <TableRow key={item.id}>
                          <TableCell>{item.product_name || "-"}</TableCell>
                          <TableCell>{item.product_type || item.product_category || "-"}</TableCell>
                          <TableCell className="text-right">{planned.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{issued.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{remaining.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              max={remaining}
                              value={issueQtyByItem[item.id] ?? "0"}
                              onChange={(e) =>
                                setIssueQtyByItem((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              disabled={!editable || submitting}
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
                  <div className="flex flex-wrap gap-2">
                    {(selectedRequest.status === "new" ||
                      selectedRequest.status === "active" ||
                      selectedRequest.status === "preparing") && (
                      <>
                        {selectedRequest.status !== "preparing" ? (
                          <Button
                            variant="outline"
                            onClick={() =>
                              runAction(
                                () =>
                                  updateWarehouseIssueRequestStatus({
                                    requestId: selectedRequest.id,
                                    companyId: profile.company_id!,
                                    status: "preparing",
                                    sourceWarehouseId,
                                  }),
                                "Request moved to preparing"
                              )
                            }
                            disabled={submitting}
                          >
                            Start preparation
                          </Button>
                        ) : null}
                        <Button onClick={handleReady} disabled={submitting}>{t("mark_ready")}</Button>
                        <Button variant="outline" onClick={handleCancel} disabled={submitting}>{t("cancel")}</Button>
                      </>
                    )}

                    {(selectedRequest.status === "ready" || selectedRequest.status === "partially_issued") && (
                      <>
                        <Button className="hidden" onClick={handleCreateIssueTicket} disabled={submitting || !effectiveSourceWarehouseId || hasStockShortage}>
                          Создать талон выдачи
                        </Button>
                        <Button onClick={handleIssue} disabled={submitting || !effectiveSourceWarehouseId || hasStockShortage}>
                          {t("confirm_physical_issue")}
                        </Button>
                        <Button variant="outline" onClick={handleCancel} disabled={submitting}>{t("cancel")}</Button>
                      </>
                    )}
                  </div>
                )}

                {(selectedRequest.status === "issued_by_warehouse" ||
                  selectedRequest.status === "issued" ||
                  selectedRequest.status === "partially_issued") && (
                  <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
                    {t("waiting_recipient_confirmation")}
                  </div>
                )}

                {selectedRequest.status === "received_confirmed" && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    {t("recipient_confirmed_inventory_finalized")}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-2 py-2 shadow md:hidden">
        <div className="grid grid-cols-5 gap-1 text-[11px]">
          <Button
            type="button"
            variant={mobileTab === "requests" ? "default" : "outline"}
            className="h-9 px-1"
            onClick={() => handleMobileTab("requests")}
          >
            Заявки
          </Button>
          <Button
            type="button"
            variant={mobileTab === "preparing" ? "default" : "outline"}
            className="h-9 px-1"
            onClick={() => handleMobileTab("preparing")}
          >
            Подг.
          </Button>
          <Button
            type="button"
            variant={mobileTab === "ready" ? "default" : "outline"}
            className="h-9 px-1"
            onClick={() => handleMobileTab("ready")}
          >
            Готово
          </Button>
          <Button
            type="button"
            variant={mobileTab === "history" ? "default" : "outline"}
            className="h-9 px-1"
            onClick={() => handleMobileTab("history")}
          >
            История
          </Button>
          <Button
            type="button"
            variant={mobileTab === "stock" ? "default" : "outline"}
            className="h-9 px-1"
            onClick={() => handleMobileTab("stock")}
          >
            Остатки
          </Button>
        </div>
      </div>
    </div>
  );
}
