"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Plus, Save, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizedName } from "@/lib/i18n/helpers";
import { supabase } from "@/lib/supabase/client";

type Field = { id: string; name: string; area: number };
type Season = { id: string; year: number };
type Crop = { id: string; name: string; name_ru?: string | null; name_kz?: string | null; name_en?: string | null };
type Allocation = { id?: string; field_id: string; crop_id: string; area: number };
type StructureRow = { id: string; field_id: string; season_id: string; crop_id: string; area: number };
type ViewMode = "grid" | "table";
type RowStatus = "ok" | "risk" | "error";

const EPS = 0.0001;
const CHIP_COLORS = [
  "bg-emerald-100 text-emerald-900 border-emerald-300",
  "bg-sky-100 text-sky-900 border-sky-300",
  "bg-amber-100 text-amber-900 border-amber-300",
  "bg-violet-100 text-violet-900 border-violet-300",
  "bg-rose-100 text-rose-900 border-rose-300",
  "bg-cyan-100 text-cyan-900 border-cyan-300",
  "bg-lime-100 text-lime-900 border-lime-300",
];

export default function CropStructurePage() {
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = (ru: string, kz: string, en: string) => (language === "ru" ? ru : language === "kz" ? kz : en);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [allocByField, setAllocByField] = useState<Map<string, Allocation[]>>(new Map());
  const [initialByField, setInitialByField] = useState<Map<string, Allocation[]>>(new Map());
  const [historyByFieldSeason, setHistoryByFieldSeason] = useState<Map<string, Allocation[]>>(new Map());

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [cropFilter, setCropFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RowStatus>("all");
  const [areaFilter, setAreaFilter] = useState<"all" | "small" | "medium" | "large">("all");
  const [sortBy, setSortBy] = useState<"field" | "area" | "main_crop" | "status">("field");

  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  const [bulkCropId, setBulkCropId] = useState("");
  const [bulkMode, setBulkMode] = useState<"percent" | "ha">("percent");
  const [bulkValue, setBulkValue] = useState("100");

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const cropMap = useMemo(() => new Map(crops.map((c) => [c.id, c])), [crops]);
  const activeSeason = useMemo(() => seasons.find((s) => s.id === seasonId) ?? null, [seasons, seasonId]);

  const cropName = (cropId: string) => localizedName(cropMap.get(cropId) as never, language) || cropMap.get(cropId)?.name || "-";
  const chipClass = (cropId: string) => {
    const i = Math.abs(cropId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % CHIP_COLORS.length;
    return CHIP_COLORS[i];
  };

  const getCurrentRows = (fieldId: string) => allocByField.get(fieldId) || [];
  const totalForField = (fieldId: string) => getCurrentRows(fieldId).reduce((sum, row) => sum + Number(row.area || 0), 0);
  const remainingForField = (fieldId: string) => (fieldMap.get(fieldId)?.area || 0) - totalForField(fieldId);
  const isOverAllocated = (fieldId: string) => remainingForField(fieldId) < -EPS;
  const selectedField = selectedFieldId ? fieldMap.get(selectedFieldId) || null : null;
  const selectedRows = selectedFieldId ? getCurrentRows(selectedFieldId) : [];

  const getHistoryRows = (fieldId: string, take = 5) => {
    if (!activeSeason) return [];
    return seasons
      .filter((s) => s.year < activeSeason.year)
      .sort((a, b) => b.year - a.year)
      .slice(0, take)
      .map((s) => ({ season: s, rows: historyByFieldSeason.get(`${fieldId}|${s.id}`) || [] }));
  };

  const dominantCropId = (rows: Allocation[]) => (!rows.length ? null : [...rows].sort((a, b) => b.area - a.area)[0]?.crop_id ?? null);

  const getWarnings = (fieldId: string) => {
    const currentRows = getCurrentRows(fieldId);
    const history = getHistoryRows(fieldId, 5);
    const chain = [currentRows, ...history.map((h) => h.rows)].map((rows) => dominantCropId(rows)).filter(Boolean) as string[];
    let repeatStreak = 1;
    let maxRepeat = 1;
    for (let i = 1; i < chain.length; i += 1) {
      if (chain[i] === chain[i - 1]) repeatStreak += 1;
      else repeatStreak = 1;
      if (repeatStreak > maxRepeat) maxRepeat = repeatStreak;
    }
    const hasFallow = [currentRows, ...history.map((h) => h.rows)].some((rows) =>
      rows.some((r) => {
        const name = cropName(r.crop_id).toLowerCase();
        return name.includes("пар") || name.includes("fallow");
      }),
    );
    const fieldArea = fieldMap.get(fieldId)?.area || 0;
    return {
      repeat: maxRepeat >= 2,
      noFallow: fieldArea >= 120 && !hasFallow,
    };
  };

  const rowStatus = (fieldId: string): RowStatus => {
    if (isOverAllocated(fieldId)) return "error";
    const w = getWarnings(fieldId);
    return w.repeat || w.noFallow ? "risk" : "ok";
  };

  const rowStatusWeight = (status: RowStatus) => (status === "error" ? 3 : status === "risk" ? 2 : 1);

  const rowStatusBadge = (status: RowStatus) =>
    status === "error" ? (
      <Badge className="bg-red-100 text-red-700 border-red-300">🔴 {t("ошибка", "қате", "error")}</Badge>
    ) : status === "risk" ? (
      <Badge className="bg-amber-100 text-amber-700 border-amber-300">🟡 {t("риск", "тәуекел", "risk")}</Badge>
    ) : (
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">🟢 {t("норм", "қалыпты", "ok")}</Badge>
    );

  const overviewTotals = useMemo(() => {
    const map = new Map<string, number>();
    allocByField.forEach((rows) => rows.forEach((r) => map.set(r.crop_id, (map.get(r.crop_id) || 0) + Number(r.area || 0))));
    return Array.from(map.entries())
      .map(([cropId, area]) => ({ cropId, area }))
      .sort((a, b) => b.area - a.area);
  }, [allocByField]);

  const comparisonWithPrevious = useMemo(() => {
    if (!activeSeason) return [];
    const prev = seasons.filter((s) => s.year < activeSeason.year).sort((a, b) => b.year - a.year)[0];
    if (!prev) return [];
    const current = new Map<string, number>();
    const prevMap = new Map<string, number>();
    allocByField.forEach((rows) => rows.forEach((r) => current.set(r.crop_id, (current.get(r.crop_id) || 0) + Number(r.area || 0))));
    fields.forEach((field) => {
      const rows = historyByFieldSeason.get(`${field.id}|${prev.id}`) || [];
      rows.forEach((r) => prevMap.set(r.crop_id, (prevMap.get(r.crop_id) || 0) + Number(r.area || 0)));
    });
    const ids = new Set([...Array.from(current.keys()), ...Array.from(prevMap.keys())]);
    return Array.from(ids)
      .map((cropId) => ({ cropId, delta: (current.get(cropId) || 0) - (prevMap.get(cropId) || 0) }))
      .filter((x) => Math.abs(x.delta) > EPS)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [activeSeason, seasons, allocByField, fields, historyByFieldSeason]);

  const riskOverview = useMemo(() => {
    let repeatCount = 0;
    let noFallowCount = 0;
    fields.forEach((field) => {
      const w = getWarnings(field.id);
      if (w.repeat) repeatCount += 1;
      if (w.noFallow) noFallowCount += 1;
    });
    return { repeatCount, noFallowCount };
  }, [fields, allocByField, historyByFieldSeason, activeSeason, seasons, language]);

  const loadBase = async () => {
    const [fieldsRes, seasonsRes, cropsRes] = await Promise.all([
      supabase.from("fields").select("id,name,area").eq("archived", false).order("name"),
      supabase.from("seasons").select("id,year").eq("archived", false).order("year", { ascending: false }),
      supabase.from("crops").select("id,name,name_ru,name_kz,name_en").eq("archived", false).order("name"),
    ]);
    if (fieldsRes.error) throw fieldsRes.error;
    if (seasonsRes.error) throw seasonsRes.error;
    if (cropsRes.error) throw cropsRes.error;
    setFields((fieldsRes.data || []) as Field[]);
    const seasonsData = (seasonsRes.data || []) as Season[];
    setSeasons(seasonsData);
    setCrops((cropsRes.data || []) as Crop[]);
    if (!seasonId && seasonsData[0]) {
      const current = seasonsData.find((s) => s.year === 2026) || seasonsData[0];
      setSeasonId(current.id);
    }
    return seasonsData;
  };

  const loadStructure = async (targetSeasonId: string, seasonsList?: Season[]) => {
    if (!targetSeasonId) return;
    const list = seasonsList ?? seasons;
    const selected = list.find((s) => s.id === targetSeasonId);
    if (!selected) return;
    const seasonIds = list
      .filter((s) => s.year <= selected.year)
      .sort((a, b) => b.year - a.year)
      .slice(0, 6)
      .map((s) => s.id);
    const structureRes = await supabase.from("crop_structure").select("id,field_id,season_id,crop_id,area").in("season_id", seasonIds).eq("archived", false);
    if (structureRes.error) throw structureRes.error;

    const currentMap = new Map<string, Allocation[]>();
    const historyMap = new Map<string, Allocation[]>();
    ((structureRes.data || []) as StructureRow[]).forEach((row) => {
      const item: Allocation = { id: row.id, field_id: row.field_id, crop_id: row.crop_id, area: Number(row.area || 0) };
      if (row.season_id === targetSeasonId) currentMap.set(row.field_id, [...(currentMap.get(row.field_id) || []), item]);
      else historyMap.set(`${row.field_id}|${row.season_id}`, [...(historyMap.get(`${row.field_id}|${row.season_id}`) || []), item]);
    });
    setAllocByField(currentMap);
    setInitialByField(new Map(Array.from(currentMap.entries()).map(([k, v]) => [k, [...v]])));
    setHistoryByFieldSeason(historyMap);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const seasonsData = await loadBase();
        if (!mounted) return;
        const targetSeasonId = seasonId || seasonsData[0]?.id;
        if (targetSeasonId) await loadStructure(targetSeasonId, seasonsData);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Load failed";
        toast({ title: t("Ошибка", "Қате", "Error"), description: message, variant: "destructive" });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    (async () => {
      try {
        setLoading(true);
        await loadStructure(seasonId);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Load failed";
        toast({ title: t("Ошибка", "Қате", "Error"), description: message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [seasonId]);

  const setFieldRows = (fieldId: string, rows: Allocation[]) =>
    setAllocByField((prev) => new Map(prev).set(fieldId, rows.filter((r) => r.crop_id && Number(r.area) >= 0)));

  const addCropRow = () => {
    if (!selectedFieldId || crops.length === 0) return;
    setFieldRows(selectedFieldId, [...selectedRows, { field_id: selectedFieldId, crop_id: crops[0].id, area: 0 }]);
  };
  const patchCropRow = (idx: number, patch: Partial<Allocation>) => {
    if (!selectedFieldId) return;
    const next = [...selectedRows];
    next[idx] = { ...next[idx], ...patch };
    setFieldRows(selectedFieldId, next);
  };
  const removeCropRow = (idx: number) => {
    if (!selectedFieldId) return;
    const next = [...selectedRows];
    next.splice(idx, 1);
    setFieldRows(selectedFieldId, next);
  };
  const fillRemaining = () => {
    if (!selectedFieldId || crops.length === 0) return;
    const rest = remainingForField(selectedFieldId);
    if (rest <= EPS) return;
    const next = [...selectedRows];
    if (!next.length) next.push({ field_id: selectedFieldId, crop_id: crops[0].id, area: Number(rest.toFixed(3)) });
    else next[next.length - 1].area = Number((next[next.length - 1].area + rest).toFixed(3));
    setFieldRows(selectedFieldId, next);
  };

  const applyBulkForSelection = () => {
    if (!bulkCropId || selectedFields.size === 0) return;
    const value = Number(bulkValue || 0);
    if (!(value > 0)) return;
    const next = new Map(allocByField);
    selectedFields.forEach((fieldId) => {
      const field = fieldMap.get(fieldId);
      if (!field) return;
      const area = bulkMode === "percent" ? (field.area * value) / 100 : value;
      next.set(fieldId, [{ field_id: fieldId, crop_id: bulkCropId, area: Number(Math.max(0, Math.min(field.area, area)).toFixed(3)) }]);
    });
    setAllocByField(next);
  };

  const clearSelection = () => {
    if (selectedFields.size === 0) return;
    const next = new Map(allocByField);
    selectedFields.forEach((fieldId) => next.set(fieldId, []));
    setAllocByField(next);
  };

  const clearCurrentField = () => {
    if (!selectedFieldId) return;
    setFieldRows(selectedFieldId, []);
  };

  const applyCurrentToSelected = () => {
    if (!selectedFieldId || selectedFields.size === 0) return;
    const sourceRows = getCurrentRows(selectedFieldId);
    const next = new Map(allocByField);
    selectedFields.forEach((fieldId) => {
      if (fieldId === selectedFieldId) return;
      next.set(
        fieldId,
        sourceRows.map((r) => ({ field_id: fieldId, crop_id: r.crop_id, area: r.area })),
      );
    });
    setAllocByField(next);
  };

  const exportCsv = () => {
    const header = ["Поле", "План 2026", "Площадь", "Статус"];
    const rows = filteredFields.map((field) => {
      const plan = getCurrentRows(field.id).map((r) => `${cropName(r.crop_id)} (${r.area.toFixed(1)} га)`).join(" | ") || "Нет плана";
      return [field.name, plan, field.area.toFixed(1), rowStatus(field.id)].join(";");
    });
    const csvText = `\uFEFF${[header.join(";"), ...rows].join("\n")}`;
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `crop-plan-${activeSeason?.year ?? "season"}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const savePlan = async () => {
    if (!seasonId) return;
    if (fields.some((field) => isOverAllocated(field.id))) {
      toast({ title: t("Ошибка", "Қате", "Error"), description: t("Есть поля с превышением площади", "Ауданы асқан алқаптар бар", "Some fields exceed area"), variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const oldIds = new Set<string>();
      initialByField.forEach((rows) => rows.forEach((row) => row.id && oldIds.add(row.id)));
      const upsertRows: Array<{ id?: string; field_id: string; season_id: string; crop_id: string; area: number; status: string }> = [];
      allocByField.forEach((rows, fieldId) => {
        rows.forEach((row) => {
          if (Number(row.area) <= 0) return;
          upsertRows.push({ id: row.id, field_id: fieldId, season_id: seasonId, crop_id: row.crop_id, area: Number(row.area), status: "planned" });
        });
      });
      const newIds = new Set(upsertRows.map((r) => r.id).filter(Boolean) as string[]);
      const toDelete = Array.from(oldIds).filter((id) => !newIds.has(id));
      if (toDelete.length > 0) {
        const delRes = await supabase.from("crop_structure").delete().in("id", toDelete);
        if (delRes.error) throw delRes.error;
      }
      if (upsertRows.length > 0) {
        const upsertRes = await supabase.from("crop_structure").upsert(upsertRows, { onConflict: "id" });
        if (upsertRes.error) throw upsertRes.error;
      }
      setInitialByField(new Map(Array.from(allocByField.entries()).map(([k, v]) => [k, [...v]])));
      toast({ title: t("Сохранено", "Сақталды", "Saved"), description: t("План обновлён", "Жоспар жаңартылды", "Plan updated") });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Save failed";
      toast({ title: t("Ошибка", "Қате", "Error"), description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const filteredFields = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fields
      .filter((field) => {
        if (q && !field.name.toLowerCase().includes(q)) return false;
        if (cropFilter !== "all" && !getCurrentRows(field.id).some((r) => r.crop_id === cropFilter)) return false;
        const status = rowStatus(field.id);
        if (statusFilter !== "all" && status !== statusFilter) return false;
        if (areaFilter === "small" && field.area > 100) return false;
        if (areaFilter === "medium" && (field.area <= 100 || field.area > 300)) return false;
        if (areaFilter === "large" && field.area <= 300) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "field") return a.name.localeCompare(b.name, "ru");
        if (sortBy === "area") return b.area - a.area;
        if (sortBy === "main_crop") {
          const aMain = dominantCropId(getCurrentRows(a.id));
          const bMain = dominantCropId(getCurrentRows(b.id));
          return (aMain ? cropName(aMain) : "").localeCompare(bMain ? cropName(bMain) : "", "ru");
        }
        return rowStatusWeight(rowStatus(b.id)) - rowStatusWeight(rowStatus(a.id));
      });
  }, [fields, search, cropFilter, statusFilter, areaFilter, sortBy, allocByField, historyByFieldSeason, seasons, activeSeason]);

  if (loading) {
    return <PageHeader title={t("Структура посевов", "Егіс құрылымы", "Crop structure")} description={t("Загрузка...", "Жүктелуде...", "Loading...")} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("Структура посевов", "Егіс құрылымы", "Crop structure")} description={t("План сезона и севооборот по полям", "Маусым жоспары және алқап ауыспалы егісі", "Season plan and field rotation")} />

      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={seasonId} onValueChange={setSeasonId}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>{seasons.map((s) => <SelectItem key={s.id} value={s.id}>{s.year}</SelectItem>)}</SelectContent>
            </Select>
            <div className="relative w-[260px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-8" placeholder={t("Поиск поля...", "Алқап іздеу...", "Search field...")} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={cropFilter} onValueChange={setCropFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder={t("Культура", "Дақыл", "Crop")} /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("Все культуры", "Барлық дақыл", "All crops")}</SelectItem>{crops.map((c) => <SelectItem key={c.id} value={c.id}>{cropName(c.id)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v: "all" | RowStatus) => setStatusFilter(v)}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("Все статусы", "Барлық күй", "All statuses")}</SelectItem><SelectItem value="ok">{t("Норм", "Қалыпты", "OK")}</SelectItem><SelectItem value="risk">{t("Риск", "Тәуекел", "Risk")}</SelectItem><SelectItem value="error">{t("Ошибка", "Қате", "Error")}</SelectItem></SelectContent>
            </Select>
            <Select value={areaFilter} onValueChange={(v: "all" | "small" | "medium" | "large") => setAreaFilter(v)}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("Любая площадь", "Кез келген аудан", "Any area")}</SelectItem><SelectItem value="small">{t("До 100 га", "100 га дейін", "Up to 100 ha")}</SelectItem><SelectItem value="medium">{t("100-300 га", "100-300 га", "100-300 ha")}</SelectItem><SelectItem value="large">{t("300+ га", "300+ га", "300+ ha")}</SelectItem></SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v: "field" | "area" | "main_crop" | "status") => setSortBy(v)}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="field">{t("Сорт: поле", "Сұрып: алқап", "Sort: field")}</SelectItem><SelectItem value="area">{t("Сорт: площадь", "Сұрып: аудан", "Sort: area")}</SelectItem><SelectItem value="main_crop">{t("Сорт: культура", "Сұрып: дақыл", "Sort: crop")}</SelectItem><SelectItem value="status">{t("Сорт: статус", "Сұрып: күй", "Sort: status")}</SelectItem></SelectContent>
            </Select>
            <div className="ml-auto flex gap-2">
              <Button variant={viewMode === "grid" ? "default" : "outline"} onClick={() => setViewMode("grid")}>Grid</Button>
              <Button variant={viewMode === "table" ? "default" : "outline"} onClick={() => setViewMode("table")}>Table</Button>
              <Button variant="outline" onClick={() => setSelectedFieldId(filteredFields[0]?.id || null)}><Plus className="mr-2 h-4 w-4" />{t("Add plan", "Жоспар қосу", "Add plan")}</Button>
              <Button variant="outline" onClick={() => window.print()}><Download className="mr-2 h-4 w-4" />PDF</Button>
              <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Excel</Button>
              <Button variant="outline" onClick={savePlan}><Save className="mr-2 h-4 w-4" />{saving ? t("Сохранение...", "Сақталуда...", "Saving...") : t("Сохранить", "Сақтау", "Save")}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="cursor-pointer" onClick={() => setCropFilter("all")}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("Итог по культурам", "Дақылдар жиынтығы", "Totals by crop")}</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {overviewTotals.length === 0 ? (
              <div className="text-slate-500">{t("План на 2026 ещё не заполнен", "2026 жоспары әлі толтырылмаған", "Plan for 2026 is not filled yet")}</div>
            ) : (
              <>
                {overviewTotals.slice(0, 6).map((r) => <div key={r.cropId} className="flex justify-between"><span>{cropName(r.cropId)}</span><span className="font-medium">{r.area.toFixed(1)} га</span></div>)}
                {overviewTotals.length > 6 && <div className="text-slate-500">+{overviewTotals.length - 6} {t("ещё", "тағы", "more")}</div>}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("Сравнение с прошлым годом", "Өткен жылмен салыстыру", "Comparison vs previous year")}</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {overviewTotals.length === 0 ? (
              <div className="text-slate-500">{t("План на 2026 ещё не заполнен", "2026 жоспары әлі толтырылмаған", "Plan for 2026 is not filled yet")}</div>
            ) : comparisonWithPrevious.length === 0 ? (
              <div className="text-slate-500">{t("Существенных отличий нет", "Айқын айырмашылық жоқ", "No meaningful changes")}</div>
            ) : (
              comparisonWithPrevious.slice(0, 6).map((r) => <div key={r.cropId} className="flex justify-between"><span>{cropName(r.cropId)}</span><span className={r.delta >= 0 ? "text-emerald-700 font-medium" : "text-red-700 font-medium"}>{r.delta >= 0 ? "+" : ""}{r.delta.toFixed(1)} га</span></div>)
            )}
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setStatusFilter("risk")}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("Риски", "Тәуекелдер", "Risks")}</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1"><div>⚠️ {t("Повтор культуры", "Дақыл қайталануы", "Crop repeat")}: {riskOverview.repeatCount}</div><div>⚠️ {t("Нет пара", "Пар жоқ", "No fallow")}: {riskOverview.noFallowCount}</div></CardContent>
        </Card>
      </div>

      {selectedFields.size > 0 && (
        <Card className="border-emerald-300 bg-emerald-50/60">
          <CardContent className="pt-4 flex flex-wrap items-end gap-2">
            <div className="text-sm font-medium">{t("Выбрано полей", "Таңдалған алқаптар", "Selected fields")}: {selectedFields.size}</div>
            <Select value={bulkCropId} onValueChange={setBulkCropId}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder={t("Назначить культуру", "Дақыл тағайындау", "Assign crop")} /></SelectTrigger>
              <SelectContent>{crops.map((crop) => <SelectItem key={crop.id} value={crop.id}>{cropName(crop.id)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={bulkMode} onValueChange={(v: "percent" | "ha") => setBulkMode(v)}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="ha">{t("га", "га", "ha")}</SelectItem></SelectContent>
            </Select>
            <Input className="w-[120px]" type="number" min={0} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
            <Button onClick={applyBulkForSelection} disabled={!bulkCropId}>{t("Применить", "Қолдану", "Apply")}</Button>
            <Button variant="outline" onClick={clearSelection}>{t("Очистить", "Тазалау", "Clear")}</Button>
            <div className="text-xs text-slate-600">
              {t("Выбрано полей: можно массово назначить культуру", "Алқаптар таңдалды: дақылды жаппай тағайындауға болады", "Fields selected: you can assign crop in bulk")}
            </div>
          </CardContent>
        </Card>
      )}
      {fields.some((f) => isOverAllocated(f.id)) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{t("Есть поля с превышением площади", "Ауданы асқан алқаптар бар", "Some fields exceed area")}</AlertDescription>
        </Alert>
      )}

      {viewMode === "grid" ? (
        <TooltipProvider>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {filteredFields.map((field) => {
              const rows = getCurrentRows(field.id);
              const status = rowStatus(field.id);
              const previewHistory = getHistoryRows(field.id, 3);
              const extraCount = rows.length > 3 ? rows.length - 3 : 0;
              return (
                <Tooltip key={field.id}>
                  <TooltipTrigger asChild>
                    <Card className="rounded-xl border shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedFieldId(field.id)}>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold">{field.name}</div>
                            <div className="text-xs text-slate-500">{field.area.toFixed(1)} га</div>
                          </div>
                          <Checkbox
                            checked={selectedFields.has(field.id)}
                            onCheckedChange={(checked) => {
                              const next = new Set(selectedFields);
                              if (checked) next.add(field.id);
                              else next.delete(field.id);
                              setSelectedFields(next);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {rows.slice(0, 3).map((row, idx) => <Badge key={`${field.id}-${row.crop_id}-${idx}`} variant="outline" className={chipClass(row.crop_id)}>{cropName(row.crop_id)} {row.area.toFixed(0)}га</Badge>)}
                          {extraCount > 0 && <Badge variant="secondary">+{extraCount}</Badge>}
                          {rows.length === 0 && <span className="text-xs text-slate-400">{t("Нет плана", "Жоспар жоқ", "No plan")}</span>}
                        </div>
                        <div className="flex items-center justify-between">
                          {rowStatusBadge(status)}
                          <div className={`text-xs ${isOverAllocated(field.id) ? "text-red-600 font-semibold" : "text-slate-500"}`}>{totalForField(field.id).toFixed(1)} / {field.area.toFixed(1)} га</div>
                        </div>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs space-y-1">
                    <div className="font-medium">{field.name}</div>
                    <div>{t("Площадь", "Аудан", "Area")}: {field.area.toFixed(1)} га</div>
                    <div>{rows.length ? rows.map((r) => `${cropName(r.crop_id)} ${r.area.toFixed(1)}га`).join(", ") : t("Нет плана", "Жоспар жоқ", "No plan")}</div>
                    {previewHistory.map((h) => {
                      const main = dominantCropId(h.rows);
                      return <div key={h.season.id}>{h.season.year} — {main ? cropName(main) : "-"}</div>;
                    })}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="p-2 w-10" />
                  <th className="p-2 text-left">{t("Поле", "Алқап", "Field")}</th>
                  <th className="p-2 text-left">{t("План", "Жоспар", "Plan")}</th>
                  <th className="p-2 text-left">{t("История", "Тарих", "History")}</th>
                  <th className="p-2 text-left">{t("Статус", "Күй", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredFields.map((field) => {
                  const status = rowStatus(field.id);
                  const rows = getCurrentRows(field.id);
                  const previewHistory = getHistoryRows(field.id, 3);
                  return (
                    <tr key={field.id} className="border-b">
                      <td className="p-2">
                        <Checkbox
                          checked={selectedFields.has(field.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedFields);
                            if (checked) next.add(field.id);
                            else next.delete(field.id);
                            setSelectedFields(next);
                          }}
                        />
                      </td>
                      <td className="p-2">
                        <button className="text-left hover:underline font-medium" onClick={() => setSelectedFieldId(field.id)}>
                          {field.name}
                        </button>
                        <div className="text-xs text-slate-500">{field.area.toFixed(1)} га</div>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {rows.map((row, idx) => (
                            <Badge key={`${field.id}-${row.crop_id}-${idx}`} variant="outline" className={chipClass(row.crop_id)}>
                              {cropName(row.crop_id)} {row.area.toFixed(0)}га
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-2 text-xs text-slate-500">
                        {previewHistory.map((h) => {
                          const main = dominantCropId(h.rows);
                          return <div key={h.season.id}>{h.season.year} — {main ? cropName(main) : "-"}</div>;
                        })}
                      </td>
                      <td className="p-2">{rowStatusBadge(status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Sheet open={Boolean(selectedFieldId)} onOpenChange={(open) => !open && setSelectedFieldId(null)}>
        <SheetContent className="sm:max-w-xl w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedField ? `${selectedField.name} — ${selectedField.area.toFixed(1)} га` : "-"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="rounded-md border p-3 space-y-2">
              <div className="font-medium">{t("Структура посевов", "Егіс құрылымы", "Crop structure")}</div>
              {selectedRows.map((row, idx) => (
                <div key={`${row.crop_id}-${idx}`} className="grid grid-cols-[1fr_90px_36px] gap-2 items-end">
                  <Select value={row.crop_id} onValueChange={(value) => patchCropRow(idx, { crop_id: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{crops.map((crop) => <SelectItem key={crop.id} value={crop.id}>{cropName(crop.id)}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={0} value={row.area} onChange={(e) => patchCropRow(idx, { area: Number(e.target.value || 0) })} />
                  <Button variant="ghost" size="icon" onClick={() => removeCropRow(idx)}><X className="h-4 w-4" /></Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" onClick={addCropRow}><Plus className="mr-2 h-4 w-4" />{t("Добавить культуру", "Дақыл қосу", "Add crop")}</Button>
                <Button variant="outline" onClick={fillRemaining}>{t("Заполнить остаток", "Қалдықты толтыру", "Fill remaining")}</Button>
              </div>
              <div className="rounded-md bg-slate-50 p-3 text-sm space-y-1">
                <div>{t("Запланировано", "Жоспарланған", "Planned")}: {selectedFieldId ? totalForField(selectedFieldId).toFixed(2) : "0.00"} га</div>
                <div className={selectedFieldId && remainingForField(selectedFieldId) < -EPS ? "text-red-600 font-semibold" : ""}>{t("Остаток", "Қалдық", "Remaining")}: {selectedFieldId ? remainingForField(selectedFieldId).toFixed(2) : "0.00"} га</div>
              </div>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <div className="font-medium">{t("История севооборота (5 лет)", "Ауыспалы егіс тарихы (5 жыл)", "Rotation history (5 years)")}</div>
              {selectedFieldId && getHistoryRows(selectedFieldId, 5).map((h) => <div key={h.season.id} className="text-sm"><span className="font-medium">{h.season.year}</span> — {h.rows.length ? h.rows.map((row) => `${cropName(row.crop_id)} (${row.area.toFixed(1)} га)`).join(", ") : "-"}</div>)}
              {selectedFieldId && (() => {
                const w = getWarnings(selectedFieldId);
                if (!w.repeat && !w.noFallow) return null;
                return <div className="rounded-md bg-amber-50 border border-amber-300 p-2 text-sm space-y-1">{w.repeat && <div>⚠️ {t("Повтор культуры 2 года подряд", "Дақыл 2 жыл қатарынан қайталануда", "Same crop 2 years in a row")}</div>}{w.noFallow && <div>⚠️ {t("Нет парового года", "Пар жылы жоқ", "No fallow year")}</div>}</div>;
              })()}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={clearCurrentField}>{t("Очистить план", "Жоспарды тазалау", "Clear plan")}</Button>
              <Button variant="outline" onClick={applyCurrentToSelected} disabled={selectedFields.size === 0}>{t("Дублировать в выбранные", "Таңдалғандарға көшіру", "Duplicate to selected")}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
