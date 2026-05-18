"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter } from "lucide-react";
import {
  getAllFieldHistory,
  type FieldHistoryRecord,
} from "@/lib/services/field-history";
import { supabase } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/contexts/language-context";
import { getFieldDisplayName } from "@/lib/fields/display";

const statusColors: Record<string, string> = {
  planned: "bg-slate-100 text-slate-800 hover:bg-slate-100",
  planted: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  growing: "bg-green-100 text-green-800 hover:bg-green-100",
  harvested: "bg-amber-100 text-amber-800 hover:bg-amber-100",
};

export default function FieldHistoryPage() {
  const [fields, setFields] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>("all");
  const [fieldHistory, setFieldHistory] = useState<FieldHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;

  useEffect(() => {
    async function loadFields() {
      const { data } = await supabase
        .from("fields")
        .select("id, name, notes")
        .eq("archived", false)
        .order("name");

      const normalized = (data || []).map((field: any) => ({
        id: String(field.id),
        name: getFieldDisplayName(field),
      }));
      setFields(normalized);
    }

    loadFields();
  }, []);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const history = await getAllFieldHistory(selectedFieldId, language);
        setFieldHistory(history);
      } catch (error) {
        console.error("Error loading field history:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [selectedFieldId, language]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("История полей", "Алаң тарихы", "Field History")}</h1>
        <p className="text-slate-600 mt-2">
          {t("История севооборота по каждому полю за разные сезоны", "Әр алаң бойынша маусымдардағы ауыспалы егіс тарихы", "View crop rotation history for each field across seasons")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            {t("Фильтр по полю", "Алаң бойынша сүзгі", "Filter by Field")}
          </CardTitle>
          <CardDescription>
            {t("Выберите конкретное поле или покажите все", "Нақты алаңды таңдаңыз немесе барлығын көрсетіңіз", "Select a specific field or view all fields")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedFieldId} onValueChange={setSelectedFieldId}>
            <SelectTrigger className="w-full md:w-96">
              <SelectValue placeholder={t("Выберите поле для просмотра истории", "Тарихты көру үшін алаңды таңдаңыз", "Select a field to view history")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Все поля", "Барлық алаңдар", "All Fields")}</SelectItem>
              {fields.map((field) => (
                <SelectItem key={field.id} value={field.id}>
                  {field.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("История севооборота", "Ауыспалы егіс тарихы", "Crop Rotation History")}</CardTitle>
          <CardDescription>
            {selectedFieldId === "all"
              ? t(`Показаны все поля (${fieldHistory.length} записей)`, `Барлық алаңдар көрсетілді (${fieldHistory.length} жазба)`, `Showing all fields (${fieldHistory.length} records)`)
              : t(`Показано поле ${fields.find(f => f.id === selectedFieldId)?.name || "выбранное поле"} (${fieldHistory.length} записей)`, `${fields.find(f => f.id === selectedFieldId)?.name || "таңдалған алаң"} көрсетілді (${fieldHistory.length} жазба)`, `Showing ${fields.find(f => f.id === selectedFieldId)?.name || "selected field"} (${fieldHistory.length} records)`)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <p className="text-slate-500">{t("Загрузка данных...", "Деректер жүктелуде...", "Loading data...")}</p>
            </div>
          ) : fieldHistory.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500">{t("История отсутствует.", "Тарих жоқ.", "No history available.")}</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="font-semibold">{t("Поле", "Алаң", "Field")}</TableHead>
                    <TableHead className="font-semibold">{t("Сезон", "Маусым", "Season")}</TableHead>
                    <TableHead className="font-semibold">{t("Культура", "Дақыл", "Crop")}</TableHead>
                    <TableHead className="font-semibold">{t("Сорт", "Сорт", "Variety")}</TableHead>
                    <TableHead className="text-right font-semibold">{t("Площадь (га)", "Ауданы (га)", "Area (ha)")}</TableHead>
                    <TableHead className="text-right font-semibold">{t("Ожидаемая урожайность (т/га)", "Күтілетін өнімділік (т/га)", "Expected Yield (t/ha)")}</TableHead>
                    <TableHead className="font-semibold">{t("Статус", "Күй", "Status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fieldHistory.map((record) => (
                    <TableRow key={record.id} className="hover:bg-slate-50">
                      <TableCell className="font-medium">{record.fieldName}</TableCell>
                      <TableCell>{record.seasonYear}</TableCell>
                      <TableCell>{record.cropName}</TableCell>
                      <TableCell>{record.varietyName || "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {record.area.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {record.expectedYield ? record.expectedYield.toFixed(2) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={statusColors[record.status] || ""}
                        >
                          {record.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
