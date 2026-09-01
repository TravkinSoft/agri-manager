"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { MapPin, Maximize, TrendingUp, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getSeasonSummary,
  getCropStructureReport,
  getOperationsSummary,
  getInventorySummary,
  type SeasonSummary,
  type CropStructureReport,
  type OperationsSummary,
  type InventorySummary,
} from "@/lib/services/analytics";
import { supabase } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeMaterialType, localizeOperationType, localizeUnit } from "@/lib/i18n/helpers";
import { useAuth } from "@/lib/contexts/auth-context";
import { selectCurrentSeason } from "@/lib/seasons/current-season";
import { formatDateOnly } from "@/lib/dates/date-only";
import { isVisualSystemV2Enabled } from "@/lib/ui/visual-system";
import { VisualSystemScope } from "@/components/ui/visual-system-scope";

type AnalyticsState = "loading" | "loaded" | "error" | "no-season";
const ANALYTICS_VISUAL_ROLES = new Set(["global_admin", "company_admin", "legal_operator"]);

export default function AnalyticsPage() {
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; year: number }>>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>("");
  const [seasonSummary, setSeasonSummary] = useState<SeasonSummary>({
    totalFields: 0,
    totalPlantedArea: 0,
    totalFallowArea: 0,
    totalExpectedYield: 0,
    totalOperations: 0,
  });
  const [cropReport, setCropReport] = useState<CropStructureReport[]>([]);
  const [operationsSummary, setOperationsSummary] = useState<OperationsSummary[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary[]>([]);
  const [state, setState] = useState<AnalyticsState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const { profile } = useAuth();
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) =>
    language === "ru" ? ru : language === "kz" ? kz : en;
  const visualV2 = ANALYTICS_VISUAL_ROLES.has(String(profile?.role || "")) && isVisualSystemV2Enabled("analytics");
  const title = t("Отчеты и аналитика", "Есептер және аналитика", "Reports & Analytics");
  const description = t("Комплексный обзор ваших сельхозопераций", "Ауылшаруашылық операцияларыңыздың толық шолуы", "Comprehensive overview of your agricultural operations");
  const metricCardClassName = visualV2 ? "tf-work-surface min-w-0 shadow-none" : undefined;
  const metricTitleClassName = visualV2 ? "text-xs font-medium text-[color:var(--tf-text-secondary)]" : "text-sm font-medium text-slate-600";
  const metricIconClassName = visualV2 ? "h-4 w-4 text-[color:var(--tf-accent-primary)]" : "h-4 w-4 text-slate-400";
  const metricValueClassName = visualV2 ? "tf-tabular break-words text-xl font-semibold text-[color:var(--tf-text-primary)] sm:text-2xl" : "text-2xl font-bold";
  const metricHintClassName = visualV2 ? "mt-1 text-xs text-[color:var(--tf-text-muted)]" : "mt-1 text-xs text-slate-500";

  useEffect(() => {
    async function loadSeasons() {
      if (!profile?.company_id) return;
      setState("loading");
      setLoadError(null);

      const { data, error } = await supabase
        .from("seasons")
        .select("id,name,year,archived")
        .eq("company_id", profile.company_id)
        .eq("archived", false)
        .order("year", { ascending: false });

      if (error) {
        setLoadError(error.message);
        setState("error");
        return;
      }
      const rows = (data || []).map((row: any) => ({
        id: String(row.id),
        name: String(row.name || row.year),
        year: Number(row.year),
        archived: Boolean(row.archived),
      }));
      const current = selectCurrentSeason(rows, 2026);
      setSeasons(rows);
      setSelectedSeasonId(current?.id || "");
      if (!current) setState("no-season");
    }

    void loadSeasons();
  }, [profile?.company_id]);

  useEffect(() => {
    async function loadAnalytics() {
      if (!selectedSeasonId) return;
      setState("loading");
      setLoadError(null);
      try {
        const [summary, crop, operations, inventory] = await Promise.all([
          getSeasonSummary(selectedSeasonId),
          getCropStructureReport(selectedSeasonId),
          getOperationsSummary(selectedSeasonId),
          getInventorySummary(),
        ]);

        setSeasonSummary(summary);
        setCropReport(crop);
        setOperationsSummary(operations);
        setInventorySummary(inventory);
        setState("loaded");
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Не удалось загрузить данные");
        setState("error");
      }
    }

    loadAnalytics();
  }, [selectedSeasonId]);

  return (
    <VisualSystemScope scope="analytics" forceLegacy={!visualV2}>
    <div
      data-visual-pilot={visualV2 ? "analytics-overview" : undefined}
      data-role-scope={visualV2 ? String(profile?.role || "") : undefined}
      data-analytics-state={visualV2 ? state : undefined}
    >
      {visualV2 ? (
        <header data-visual-region="analytics-header" className="mb-4 min-w-0 sm:mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--tf-accent-primary)]">
            {t("Контур решений", "Шешімдер контуры", "Decision layer")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--tf-text-primary)] sm:text-3xl">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[color:var(--tf-text-secondary)]">{description}</p>
        </header>
      ) : (
        <PageHeader title={title} description={description} />
      )}

      <div data-visual-region={visualV2 ? "analytics-season" : undefined} className={visualV2 ? "mb-5 sm:mb-6" : "mb-6"}>
        <Card className={visualV2 ? "tf-work-surface-raised shadow-none" : undefined}>
          <CardHeader className={visualV2 ? "pb-3" : undefined}>
            <CardTitle className={visualV2 ? "text-base text-[color:var(--tf-text-primary)]" : undefined}>{t("Выбор сезона", "Маусымды таңдау", "Select Season")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
              <SelectTrigger
                aria-label={t("Выбор сезона", "Маусымды таңдау", "Select Season")}
                className={visualV2 ? "tf-input-surface tf-focus-ring h-12 w-full text-base text-[color:var(--tf-text-primary)] sm:h-10 sm:text-sm md:w-96" : "w-full md:w-96"}
              >
                <SelectValue placeholder={t("Выберите сезон", "Маусымды таңдаңыз", "Select a season")} />
              </SelectTrigger>
              <SelectContent>
                {seasons.map((season) => (
                  <SelectItem key={season.id} value={season.id}>
                    {season.year} - {season.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {state === "loading" ? (
        <div className="text-center py-12">
          <p className="text-slate-500">{t("Загрузка аналитики...", "Аналитика жүктелуде...", "Loading analytics...")}</p>
        </div>
      ) : state === "error" ? (
        <Card className="border-red-500/40">
          <CardContent className="py-8 text-center">
            <p className="font-semibold text-red-600">
              {t("Не удалось загрузить данные", "Деректерді жүктеу мүмкін болмады", "Failed to load data")}
            </p>
          </CardContent>
        </Card>
      ) : state === "no-season" ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            {t("Нет активного сезона.", "Белсенді маусым жоқ.", "No active season.")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div data-visual-region={visualV2 ? "analytics-kpis" : undefined} className={visualV2 ? "grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5" : "grid gap-6 md:grid-cols-2 xl:grid-cols-5"}>
            <Card className={metricCardClassName}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className={metricTitleClassName}>
                  {t("Всего полей", "Барлық алаңдар", "Total Fields")}
                </CardTitle>
                <MapPin className={metricIconClassName} />
              </CardHeader>
              <CardContent>
                <div className={metricValueClassName}>{seasonSummary.totalFields}</div>
                <p className={metricHintClassName}>
                  {selectedSeasonId ? t("Поля в выбранном сезоне", "Таңдалған маусымдағы алаңдар", "Fields in selected season") : t("Выберите сезон", "Маусымды таңдаңыз", "Select a season")}
                </p>
              </CardContent>
            </Card>

            <Card className={metricCardClassName}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className={metricTitleClassName}>
                  {t("Площадь посева", "Егіс ауданы", "Planted Area")}
                </CardTitle>
                <Maximize className={metricIconClassName} />
              </CardHeader>
              <CardContent>
                <div className={metricValueClassName}>
                  {seasonSummary.totalPlantedArea.toFixed(2)} {localizeUnit("ha", language)}
                </div>
                <p className={metricHintClassName}>{t("Общая площадь в обработке", "Өңделіп жатқан жалпы аудан", "Total area under cultivation")}</p>
              </CardContent>
            </Card>

            <Card className={metricCardClassName}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className={metricTitleClassName}>
                  {t("Ожидаемый урожай", "Күтілетін өнім", "Expected Yield")}
                </CardTitle>
                <TrendingUp className={metricIconClassName} />
              </CardHeader>
              <CardContent>
                <div className={metricValueClassName}>
                  {seasonSummary.totalExpectedYield.toFixed(2)} {localizeUnit("t", language)}
                </div>
                <p className={metricHintClassName}>{t("Прогноз общего урожая", "Жалпы өнім болжамы", "Projected total harvest")}</p>
              </CardContent>
            </Card>

            <Card className={metricCardClassName}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className={metricTitleClassName}>
                  {t("Площадь пара", "Сүрі жер ауданы", "Fallow Area")}
                </CardTitle>
                <Maximize className={metricIconClassName} />
              </CardHeader>
              <CardContent>
                <div className={metricValueClassName}>
                  {seasonSummary.totalFallowArea.toFixed(2)} {localizeUnit("ha", language)}
                </div>
                <p className={metricHintClassName}>{t("Не входит в площадь посева", "Егіс ауданына кірмейді", "Excluded from planted area")}</p>
              </CardContent>
            </Card>

            <Card className={metricCardClassName}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className={metricTitleClassName}>
                  {t("Операции", "Операциялар", "Operations")}
                </CardTitle>
                <Activity className={metricIconClassName} />
              </CardHeader>
              <CardContent>
                <div className={metricValueClassName}>{seasonSummary.totalOperations}</div>
                <p className={metricHintClassName}>{t("Всего зафиксировано операций", "Тіркелген операциялар саны", "Total operations recorded")}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("Отчет по структуре посевов", "Егіс құрылымы бойынша есеп", "Crop Structure Report")}</CardTitle>
            </CardHeader>
            <CardContent>
              {cropReport.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {t("Нет данных по структуре посевов для выбранного сезона.", "Таңдалған маусым үшін егіс құрылымы деректері жоқ.", "No crop structure data for the selected season.")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Культура", "Дақыл", "Crop")}</TableHead>
                      <TableHead>{t("Сорт", "Сорт", "Variety")}</TableHead>
                      <TableHead>{t("Репродукция", "Репродукция", "Reproduction")}</TableHead>
                      <TableHead className="text-right">{t("Кол-во полей", "Алаң саны", "Fields Count")}</TableHead>
                      <TableHead className="text-right">{t("Общая площадь (га)", "Жалпы аудан (га)", "Total Area (ha)")}</TableHead>
                      <TableHead className="text-right">{t("Ожидаемый урожай (т)", "Күтілетін өнім (т)", "Expected Yield (t)")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cropReport.map((report, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{report.cropName}</TableCell>
                        <TableCell>{report.varietyName || "—"}</TableCell>
                        <TableCell>{report.reproductionName || "—"}</TableCell>
                        <TableCell className="text-right">{report.fieldsCount}</TableCell>
                        <TableCell className="text-right">{report.totalArea.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          {report.expectedYield.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("Сводка операций", "Операциялар жиыны", "Operations Summary")}</CardTitle>
            </CardHeader>
            <CardContent>
              {operationsSummary.length === 0 ? (
                <p className="text-sm text-slate-500">{t("Операции пока не зафиксированы.", "Операциялар әлі тіркелмеген.", "No operations recorded yet.")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Тип операции", "Операция түрі", "Operation Type")}</TableHead>
                      <TableHead className="text-right">{t("Всего записей", "Жалпы жазба", "Total Records")}</TableHead>
                      <TableHead>{t("Последняя дата", "Соңғы күн", "Last Date")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {operationsSummary.map((summary, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{localizeOperationType(summary.operationType, language)}</TableCell>
                        <TableCell className="text-right">{summary.totalRecords}</TableCell>
                        <TableCell>
                          {summary.lastDate ? formatDateOnly(summary.lastDate, language === "en" ? "en-US" : language === "kz" ? "kk-KZ" : "ru-RU") : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("Сводка остатков", "Қалдықтар жиыны", "Inventory Summary")}</CardTitle>
            </CardHeader>
            <CardContent>
              {inventorySummary.length === 0 ? (
                <p className="text-sm text-slate-500">{t("Нет данных по остаткам.", "Қалдық деректері жоқ.", "No inventory data available.")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Продукт", "Өнім", "Product")}</TableHead>
                      <TableHead>{t("Тип", "Түрі", "Type")}</TableHead>
                      <TableHead className="text-right">{t("Общее количество", "Жалпы саны", "Total Quantity")}</TableHead>
                      <TableHead className="text-right">{t("Кол-во складов", "Қойма саны", "Warehouses Count")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventorySummary.map((summary, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{summary.productName}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              summary.productType === "seed"
                                ? "bg-green-100 text-green-800 hover:bg-green-100"
                                : summary.productType === "fertilizer"
                                ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                                : "bg-orange-100 text-orange-800 hover:bg-orange-100"
                            }
                          >
                            {localizeMaterialType(summary.productType, language)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.totalQuantity.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">{summary.warehousesCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
    </VisualSystemScope>
  );
}
