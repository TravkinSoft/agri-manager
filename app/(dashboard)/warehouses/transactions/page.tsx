"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRightLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { getInventoryTransactions, getWarehouses } from "@/lib/services/warehouses";
import type { InventoryTransactionWithDetails, Warehouse } from "@/lib/types/warehouse";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";

function prettyMovementType(type: string): string {
  switch (type) {
    case "receipt":
      return "Incoming";
    case "issue":
      return "Outgoing";
    case "transfer":
      return "Transfer";
    case "writeoff":
      return "Write-off";
    case "adjustment":
      return "Adjustment";
    default:
      return type;
  }
}

function statusBadgeClass(status: string): string {
  if (status === "confirmed") return "bg-emerald-100 text-emerald-800";
  if (status === "cancelled") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

export default function InventoryTransactionsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;
  const [loading, setLoading] = useState(true);
  const [movements, setMovements] = useState<InventoryTransactionWithDetails[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    const load = async () => {
      if (!profile?.company_id) return;
      setLoading(true);
      try {
        const [movementData, warehouseData] = await Promise.all([
          getInventoryTransactions(profile.company_id, language),
          getWarehouses(profile.company_id, false, language),
        ]);
        setMovements(movementData);
        setWarehouses(warehouseData);
      } catch (error: any) {
        toast({
          title: t("Ошибка", "Қате", "Error"),
          description: error?.message || t("Не удалось загрузить движения запасов", "Қор қозғалысын жүктеу мүмкін болмады", "Failed to load stock movements"),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.company_id, toast, language]);

  const filteredMovements = useMemo(() => {
    return movements.filter((row) => {
      const text = `${row.product_name} ${row.source_warehouse_name} ${row.destination_warehouse_name} ${row.movement_source || ""} ${row.document_ref || ""} ${row.notes || ""}`.toLowerCase();
      const matchSearch = !search || text.includes(search.toLowerCase());
      const matchWarehouse =
        warehouseFilter === "all" ||
        row.source_warehouse_id === warehouseFilter ||
        row.destination_warehouse_id === warehouseFilter ||
        row.warehouse_id === warehouseFilter;
      const matchStatus = statusFilter === "all" || String(row.status || "confirmed") === statusFilter;
      return matchSearch && matchWarehouse && matchStatus;
    });
  }, [movements, search, warehouseFilter, statusFilter]);

  if (
    profile?.role !== "warehouse" &&
    profile?.role !== "warehouse_operator" &&
    profile?.role !== "company_admin" &&
    profile?.role !== "global_admin" &&
    profile?.role !== "agronomist"
  ) {
    return (
      <div>
        <PageHeader title={t("Движение запасов", "Қор қозғалысы", "Stock Movements")} description={t("История складских операций", "Қойма операциялары тарихы", "Warehouse operation history")} />
        <Alert variant="destructive">
          <AlertDescription>{t("Доступ запрещен для текущей роли.", "Ағымдағы рөл үшін рұқсат жоқ.", "Access denied for current role.")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Движение запасов", "Қор қозғалысы", "Stock Movements")}
        description={t("Все складские операции с остатками", "Қоймадағы барлық қор операциялары", "All warehouse stock operations")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("Фильтры", "Сүзгілер", "Filters")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input
            placeholder={t("Поиск по позиции, складу, комментарию...", "Өнім, қойма, түсініктеме бойынша іздеу...", "Search by item, warehouse, comment...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("Склад", "Қойма", "Warehouse")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Все склады", "Барлық қоймалар", "All warehouses")}</SelectItem>
              {warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("Статус", "Күй", "Status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Все статусы", "Барлық статустар", "All statuses")}</SelectItem>
              <SelectItem value="draft">{t("черновик", "жоба", "draft")}</SelectItem>
              <SelectItem value="confirmed">{t("подтверждено", "расталған", "confirmed")}</SelectItem>
              <SelectItem value="cancelled">{t("отменено", "болдырылмады", "cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            {t("История движений", "Қозғалыс тарихы", "Movement history")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Дата/время", "Күні/уақыты", "Date/time")}</TableHead>
                <TableHead>{t("Операция", "Операция", "Operation")}</TableHead>
                <TableHead>{t("Позиция", "Өнім", "Item")}</TableHead>
                <TableHead className="text-right">{t("Кол-во", "Саны", "Qty")}</TableHead>
                <TableHead>{t("Откуда", "Қайдан", "From")}</TableHead>
                <TableHead>{t("Куда", "Қайда", "To")}</TableHead>
                <TableHead>{t("Источник", "Көз", "Source")}</TableHead>
                <TableHead>{t("Основание", "Негіз", "Basis")}</TableHead>
                <TableHead>{t("Создал", "Құрған", "Created by")}</TableHead>
                <TableHead>{t("Статус", "Күй", "Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10}>{t("Загрузка...", "Жүктелуде...", "Loading...")}</TableCell>
                </TableRow>
              ) : filteredMovements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-slate-500">
                    {t("Записи движений не найдены.", "Қозғалыс жазбалары табылмады.", "No movement rows found.")}
                  </TableCell>
                </TableRow>
              ) : (
                filteredMovements.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.operation_datetime
                        ? new Date(row.operation_datetime).toLocaleString()
                        : row.date
                        ? new Date(row.date).toLocaleDateString()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {row.movement_type === "receipt"
                        ? t("Приход", "Кіріс", "Incoming")
                        : row.movement_type === "issue"
                        ? t("Расход", "Шығыс", "Outgoing")
                        : row.movement_type === "transfer"
                        ? t("Перемещение", "Ауыстыру", "Transfer")
                        : row.movement_type === "writeoff"
                        ? t("Списание", "Есептен шығару", "Write-off")
                        : row.movement_type === "adjustment"
                        ? t("Корректировка", "Түзету", "Adjustment")
                        : prettyMovementType(row.movement_type || "issue")}
                    </TableCell>
                    <TableCell className="font-medium">{row.product_name}</TableCell>
                    <TableCell className="text-right">
                      {typeof row.quantity_delta === "number" && row.quantity_delta < 0 ? "-" : ""}
                      {Number(row.quantity || 0).toFixed(2)} {localizeUnit(row.product_unit || "", language)}
                    </TableCell>
                    <TableCell>{row.source_warehouse_name || "-"}</TableCell>
                    <TableCell>{row.destination_warehouse_name || "-"}</TableCell>
                    <TableCell>{row.movement_source || row.source_system || "-"}</TableCell>
                    <TableCell>{row.document_ref || row.reason_ref_id || "-"}</TableCell>
                    <TableCell>{row.created_by_email || "-"}</TableCell>
                    <TableCell>
                      <Badge className={statusBadgeClass(row.status || "confirmed")}>
                        {row.status || "confirmed"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
