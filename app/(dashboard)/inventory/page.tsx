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
import { Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { getInventoryBalances, getWarehouses } from "@/lib/services/warehouses";
import type { InventoryBalance, Warehouse } from "@/lib/types/warehouse";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";

function categoryBadgeClass(type: string): string {
  switch (type) {
    case "produce":
      return "bg-purple-100 text-purple-800";
    case "seed":
      return "bg-green-100 text-green-800";
    case "fertilizer":
      return "bg-blue-100 text-blue-800";
    case "pesticide":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export default function InventoryPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    const load = async () => {
      if (!profile?.company_id) return;
      setLoading(true);
      try {
        const [balanceData, warehouseData] = await Promise.all([
          getInventoryBalances(profile.company_id, language),
          getWarehouses(profile.company_id, false, language),
        ]);
        setBalances(balanceData);
        setWarehouses(warehouseData);
      } catch (error: any) {
        toast({
          title: t("Ошибка", "Қате", "Error"),
          description: error?.message || t("Не удалось загрузить инвентарь", "Қор дерегін жүктеу мүмкін болмады", "Failed to load inventory"),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.company_id, toast, language]);

  const filteredBalances = useMemo(() => {
    return balances.filter((row) => {
      const text = `${row.product_name} ${row.warehouse_name}`.toLowerCase();
      const matchSearch = !search || text.includes(search.toLowerCase());
      const matchWarehouse = warehouseFilter === "all" || row.warehouse_id === warehouseFilter;
      const matchCategory = categoryFilter === "all" || String(row.product_type) === categoryFilter;
      return matchSearch && matchWarehouse && matchCategory;
    });
  }, [balances, search, warehouseFilter, categoryFilter]);

  if (
    profile?.role !== "warehouse" &&
    profile?.role !== "warehouse_operator" &&
    profile?.role !== "company_admin" &&
    profile?.role !== "global_admin" &&
    profile?.role !== "agronomist"
  ) {
    return (
      <div>
        <PageHeader title={t("Инвентарь", "Қор", "Inventory")} description={t("Складской инвентарь", "Қойма қоры", "Warehouse inventory")} />
        <Alert variant="destructive">
          <AlertDescription>{t("Доступ запрещен для текущей роли.", "Ағымдағы рөл үшін рұқсат жоқ.", "Access denied for current role.")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Инвентарь", "Қор", "Inventory")}
        description={t("Текущие остатки по складам и категориям", "Қойма мен санат бойынша ағымдағы қалдықтар", "Current stock by warehouse and category")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("Фильтры", "Сүзгілер", "Filters")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Input
            placeholder={t("Поиск по позиции или складу...", "Өнім немесе қойма бойынша іздеу...", "Search by item or warehouse...")}
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
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("Категория", "Санат", "Category")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Все категории", "Барлық санаттар", "All categories")}</SelectItem>
              <SelectItem value="produce">{t("Продукция", "Өнім", "Produce")}</SelectItem>
              <SelectItem value="seed">{t("Семена", "Тұқым", "Seed")}</SelectItem>
              <SelectItem value="fertilizer">{t("Удобрения", "Тыңайтқыш", "Fertilizer")}</SelectItem>
              <SelectItem value="pesticide">{t("Пестициды", "Пестицид", "Pesticide")}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("Список остатков", "Қалдықтар тізімі", "Inventory list")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Позиция", "Өнім", "Item")}</TableHead>
                <TableHead>{t("Категория", "Санат", "Category")}</TableHead>
                <TableHead>{t("Склад", "Қойма", "Warehouse")}</TableHead>
                <TableHead className="text-right">{t("Количество", "Саны", "Quantity")}</TableHead>
                <TableHead>{t("Ед.", "Өлшем", "Unit")}</TableHead>
                <TableHead>{t("Обновлено", "Жаңартылған", "Last updated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6}>{t("Загрузка...", "Жүктелуде...", "Loading...")}</TableCell>
                </TableRow>
              ) : filteredBalances.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    {t("Записей по остаткам не найдено.", "Қалдық жазбалары табылмады.", "No inventory rows found.")}
                  </TableCell>
                </TableRow>
              ) : (
                filteredBalances.map((row) => (
                  <TableRow key={`${row.warehouse_id}-${row.product_id}`}>
                    <TableCell className="font-medium">{row.product_name}</TableCell>
                    <TableCell>
                      <Badge className={categoryBadgeClass(String(row.product_type))}>
                        {String(row.product_type) === "produce"
                          ? t("продукция", "өнім", "produce")
                          : String(row.product_type) === "seed"
                          ? t("семена", "тұқым", "seed")
                          : String(row.product_type) === "fertilizer"
                          ? t("удобрение", "тыңайтқыш", "fertilizer")
                          : String(row.product_type) === "pesticide"
                          ? t("пестицид", "пестицид", "pesticide")
                          : String(row.product_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.warehouse_name}</TableCell>
                    <TableCell className="text-right">{Number(row.quantity).toFixed(2)}</TableCell>
                    <TableCell>{localizeUnit(row.unit || "kg", language)}</TableCell>
                    <TableCell>
                      {row.last_updated ? new Date(row.last_updated).toLocaleString() : "-"}
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
