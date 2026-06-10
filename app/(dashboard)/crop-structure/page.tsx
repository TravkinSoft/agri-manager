"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Edit3, FileText, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OperationFormDialog } from "@/components/operations/operation-form-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizedName } from "@/lib/i18n/helpers";
import { supabase } from "@/lib/supabase/client";
import { getFieldDisplayName } from "@/lib/fields/display";
import { createOperation, getAssignableSpecialists } from "@/lib/services/operations";
import type { OperationFormData, SpecialistAssignee } from "@/lib/types/operation";
import type { CropStructureWithDetails } from "@/lib/types/crop-structure";
import {
  getIrrigationTypeLabel,
  isPotatoCropContext,
  normalizeIrrigationType,
  type IrrigationType,
} from "@/lib/operations/operation-engine";

type Field = { id: string; name: string; area: number; notes?: string | null };
type Season = { id: string; year: number };
type Crop = {
  id: string;
  name: string;
  slug?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
  company_id?: string | null;
  archived?: boolean | null;
  is_active?: boolean | null;
};
type Variety = { id: string; name: string; crop_id: string; company_id?: string | null; archived?: boolean | null; is_active?: boolean | null };
type Reproduction = { id: string; name: string; company_id?: string | null; archived?: boolean | null; is_active?: boolean | null };
type Allocation = {
  id?: string;
  field_id: string;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  notes: string;
  area: number | null;
  seeding_rate?: number | null;
  expected_yield?: number | null;
  irrigation_type?: IrrigationType | null;
  row_spacing_m?: number | null;
  seed_spacing_cm?: number | null;
};
type Consumption = {
  id: string;
  field_id: string;
  crop_structure_row_id: string | null;
  operation_type: string;
  product_id: string | null;
  product_name: string;
  variety_name: string | null;
  reproduction_name: string | null;
  batch_class: string | null;
  quantity_kg: number;
  area_ha: number | null;
  norm_per_ha: number | null;
  consumed_at: string | null;
  ticket_id: string | null;
  responsible_name: string | null;
  vehicle_name: string | null;
  notes: string | null;
};

type FieldLegalLink = {
  id: string;
  field_id: string;
  crop_id: string | null;
  area_ha: number;
  cadastral_number: string;
  legal_entity_name: string | null;
  owner_legal_entity_name: string | null;
  usage_legal_entity_name: string | null;
  status: string;
  allocation_method: string;
  source: string;
  notes: string | null;
};

type FieldState = "empty" | "partial" | "complete" | "over";
type StageKey = "prep" | "seeding" | "care" | "harvest";
type MaterialCategory = "seed" | "fertilizer" | "chemical" | "organic" | "fuel" | "irrigation" | "other";

const EPS = 0.0001;
const FIELD_FIRST_CREATE_ENABLED =
  process.env.NEXT_PUBLIC_OPERATIONS_FIELD_FIRST_CREATE !== "0" &&
  process.env.OPERATIONS_FIELD_FIRST_CREATE !== "0";

const stageDefs: Array<{ key: StageKey; label: string; operations: string[] }> = [
  { key: "prep", label: "Подготовка", operations: ["preparation", "tillage", "cultivation", "plowing", "other"] },
  { key: "seeding", label: "Посев / посадка", operations: ["seeding", "planting"] },
  { key: "care", label: "Вегетация / уход", operations: ["fertilizing", "top_dressing", "herbicide", "fungicide", "insecticide", "desiccation", "irrigation", "gsm"] },
  { key: "harvest", label: "Уборка", operations: ["harvest", "harvesting"] },
];

const fmtHa = (value: number) => `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`;
const fmtKg = (value: number) => `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;
const fmtRate = (value: number | null) => (value == null ? "-" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг/га`);
const norm = (value?: string | null) => String(value || "").trim().toLowerCase();
const parseNum = (value: string): number | null => {
  const raw = value.trim().replace(",", ".");
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};
const CROP_STRUCTURE_BASE_SELECT = "id,field_id,crop_id,variety_id,reproduction_id,notes,area,seeding_rate,expected_yield";
const CROP_STRUCTURE_V4_SELECT = `${CROP_STRUCTURE_BASE_SELECT},irrigation_type,row_spacing_m,seed_spacing_cm`;
const isMissingCropStructureV4Column = (error: unknown) => {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("irrigation_type") ||
    message.includes("row_spacing_m") ||
    message.includes("seed_spacing_cm") ||
    message.includes("schema cache")
  );
};
const allocationFromRow = (row: any): Allocation => ({
  id: row.id,
  field_id: row.field_id,
  crop_id: row.crop_id,
  variety_id: row.variety_id,
  reproduction_id: row.reproduction_id,
  notes: row.notes || "",
  area: Number(row.area || 0),
  seeding_rate: row.seeding_rate == null ? null : Number(row.seeding_rate || 0),
  expected_yield: row.expected_yield == null ? null : Number(row.expected_yield || 0),
  irrigation_type: normalizeIrrigationType(row.irrigation_type),
  row_spacing_m: row.row_spacing_m == null ? null : Number(row.row_spacing_m || 0),
  seed_spacing_cm: row.seed_spacing_cm == null ? null : Number(row.seed_spacing_cm || 0),
});
const fmtDate = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
};

const stageForOperation = (operation: string): StageKey => {
  const key = String(operation || "").toLowerCase();
  return stageDefs.find((stage) => stage.operations.includes(key))?.key || "care";
};

const batchClassLabel = (value?: string | null) => {
  if (value === "seed") return "Семенной";
  if (value === "feed") return "Кормовой";
  if (value === "waste") return "Отходы";
  if (value === "processing") return "В переработке";
  if (value === "rejected") return "Брак";
  return "Товарное";
};

const materialCategory = (item: Consumption): MaterialCategory => {
  const op = String(item.operation_type || "").toLowerCase();
  const name = norm(item.product_name);
  if (op === "seeding" || op === "planting" || item.batch_class === "seed") return "seed";
  if (name.includes("навоз") || name.includes("помет") || name.includes("помёт") || name.includes("компост") || name.includes("органик") || name.includes("биомасс")) return "organic";
  if (op === "fertilizing" || op === "top_dressing" || name.includes("селитр") || name.includes("аммофос") || name.includes("карбамид") || name.includes("npk") || name.includes("кас") || name.includes("удобр")) return "fertilizer";
  if (["herbicide", "fungicide", "insecticide", "desiccation"].includes(op) || name.includes("roundup") || name.includes("ридомил") || name.includes("falcon")) return "chemical";
  if (op === "irrigation" || name.includes("вода") || name.includes("полив")) return "irrigation";
  if (op === "gsm" || name.includes("гсм") || name.includes("дизел") || name.includes("топлив")) return "fuel";
  return "other";
};

export default function CropStructurePage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { language } = useLanguage();
  const tr = (ru: string, kz: string, en: string) => (language === "kz" ? kz : language === "en" ? en : ru);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [allCrops, setAllCrops] = useState<Crop[]>([]);
  const [allVarieties, setAllVarieties] = useState<Variety[]>([]);
  const [allReproductions, setAllReproductions] = useState<Reproduction[]>([]);
  const [allocByField, setAllocByField] = useState<Map<string, Allocation[]>>(new Map());
  const [initialByField, setInitialByField] = useState<Map<string, Allocation[]>>(new Map());
  const [consumptions, setConsumptions] = useState<Consumption[]>([]);
  const [search, setSearch] = useState("");
  const [cropFilter, setCropFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | FieldState>("all");
  const [sortBy, setSortBy] = useState<"field" | "area" | "main_crop" | "state">("field");
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [draftRows, setDraftRows] = useState<Allocation[]>([]);
  const [fieldDialogTab, setFieldDialogTab] = useState<"dossier" | "editor" | "legal">("dossier");
  const [legalLinksByField, setLegalLinksByField] = useState<Map<string, FieldLegalLink[]>>(new Map());
  const [operationDialogOpen, setOperationDialogOpen] = useState(false);
  const [operationDefaults, setOperationDefaults] = useState<Partial<OperationFormData> | undefined>();
  const [operationSourceLabel, setOperationSourceLabel] = useState("");
  const [specialists, setSpecialists] = useState<SpecialistAssignee[]>([]);

  const fieldMap = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const selectedField = selectedFieldId ? fieldMap.get(selectedFieldId) || null : null;
  const season = useMemo(() => seasons.find((item) => item.id === seasonId) || null, [seasons, seasonId]);

  const cropLabel = (crop: Crop) => (crop.name_ru || localizedName(crop as never, language) || crop.name || "").trim();
  const globalCrops = useMemo(
    () => allCrops.filter((crop) => crop.company_id == null && !crop.archived && crop.is_active !== false).sort((a, b) => cropLabel(a).localeCompare(cropLabel(b), "ru")),
    [allCrops, language],
  );
  const globalVarieties = useMemo(() => allVarieties.filter((item) => item.company_id == null && !item.archived && item.is_active !== false), [allVarieties]);
  const globalReproductions = useMemo(() => allReproductions.filter((item) => item.company_id == null && !item.archived && item.is_active !== false), [allReproductions]);
  const cropMap = useMemo(() => new Map(globalCrops.map((crop) => [crop.id, crop])), [globalCrops]);
  const varietyMap = useMemo(() => new Map(globalVarieties.map((item) => [item.id, item])), [globalVarieties]);
  const reproductionMap = useMemo(() => new Map(globalReproductions.map((item) => [item.id, item])), [globalReproductions]);
  const varietiesByCrop = useMemo(() => {
    const map = new Map<string, Variety[]>();
    for (const variety of globalVarieties) map.set(variety.crop_id, [...(map.get(variety.crop_id) || []), variety]);
    return map;
  }, [globalVarieties]);

  const cropName = (id?: string | null) => (id && cropMap.get(id) ? cropLabel(cropMap.get(id) as Crop) : "-");
  const varietyName = (id?: string | null) => (id && varietyMap.get(id) ? varietyMap.get(id)?.name || "-" : "-");
  const reproductionName = (id?: string | null) => (id && reproductionMap.get(id) ? reproductionMap.get(id)?.name || "-" : "-");
  const isPotatoAllocation = (row: Pick<Allocation, "crop_id" | "variety_id">) =>
    isPotatoCropContext(cropName(row.crop_id), varietyName(row.variety_id));
  const sumArea = (rows: Allocation[]) => rows.reduce((sum, row) => sum + Number(row.area || 0), 0);

  const consumptionsByAllocation = useMemo(() => {
    const map = new Map<string, Consumption[]>();
    for (const item of consumptions) {
      if (!item.crop_structure_row_id) continue;
      map.set(item.crop_structure_row_id, [...(map.get(item.crop_structure_row_id) || []), item]);
    }
    return map;
  }, [consumptions]);

  const consumptionsByField = useMemo(() => {
    const map = new Map<string, Consumption[]>();
    for (const item of consumptions) {
      map.set(item.field_id, [...(map.get(item.field_id) || []), item]);
    }
    return map;
  }, [consumptions]);

  const fieldState = (fieldId: string): FieldState => {
    const field = fieldMap.get(fieldId);
    const planned = sumArea(allocByField.get(fieldId) || []);
    if (!field || planned <= EPS) return "empty";
    if (planned > field.area + EPS) return "over";
    if (planned < field.area - EPS) return "partial";
    return "complete";
  };

  const stateText = (state: FieldState) => {
    if (state === "empty") return "Пусто";
    if (state === "partial") return "Частично";
    if (state === "over") return "Переплан";
    return "Заполнено";
  };

  const stateClass = (state: FieldState) => {
    if (state === "empty") return "border-amber-200 bg-amber-100 text-amber-800";
    if (state === "partial") return "border-slate-200 bg-slate-100 text-slate-700";
    if (state === "over") return "border-rose-200 bg-rose-100 text-rose-800";
    return "border-emerald-200 bg-emerald-100 text-emerald-800";
  };

  const allocationFacts = (allocation: Allocation) => {
    const rows = allocation.id ? consumptionsByAllocation.get(allocation.id) || [] : [];
    const stageCompleted = new Map<StageKey, number>();
    const stageLatest = new Map<StageKey, string>();

    for (const stage of stageDefs) {
      const byTicket = new Map<string, number>();
      const stageRows = rows.filter((row) => stageForOperation(row.operation_type) === stage.key);
      for (const row of stageRows) {
        const key = row.ticket_id || row.id;
        byTicket.set(key, Math.max(byTicket.get(key) || 0, Number(row.area_ha || 0)));
        if (row.consumed_at && (!stageLatest.get(stage.key) || new Date(row.consumed_at) > new Date(stageLatest.get(stage.key) || 0))) {
          stageLatest.set(stage.key, row.consumed_at);
        }
      }
      stageCompleted.set(stage.key, Array.from(byTicket.values()).reduce((sum, value) => sum + value, 0));
    }

    const plannedArea = Number(allocation.area || 0);
    const actualAreaForRate = stageCompleted.get("seeding") || stageCompleted.get("care") || stageCompleted.get("prep") || plannedArea;
    const operationRows = [...rows].sort((a, b) => new Date(b.consumed_at || 0).getTime() - new Date(a.consumed_at || 0).getTime());
    const currentStage =
      stageCompleted.get("harvest") ? "Уборка" :
      stageCompleted.get("care") ? "Вегетация / уход" :
      stageCompleted.get("seeding") ? "Посев / посадка" :
      stageCompleted.get("prep") ? "Подготовка" :
      "План";
    return { rows, stageCompleted, stageLatest, operationRows, actualAreaForRate, currentStage };
  };

  const mainCrop = (fieldId: string) => {
    const rows = allocByField.get(fieldId) || [];
    return [...rows].sort((a, b) => Number(b.area || 0) - Number(a.area || 0))[0]?.crop_id || null;
  };

  const filteredFields = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fields
      .filter((field) => !q || field.name.toLowerCase().includes(q))
      .filter((field) => cropFilter === "all" || (allocByField.get(field.id) || []).some((row) => row.crop_id === cropFilter))
      .filter((field) => statusFilter === "all" || fieldState(field.id) === statusFilter)
      .sort((a, b) => {
        if (sortBy === "field") return a.name.localeCompare(b.name, "ru");
        if (sortBy === "area") return b.area - a.area;
        if (sortBy === "main_crop") return cropName(mainCrop(a.id)).localeCompare(cropName(mainCrop(b.id)), "ru");
        const rank: Record<FieldState, number> = { over: 4, partial: 3, empty: 2, complete: 1 };
        return rank[fieldState(b.id)] - rank[fieldState(a.id)];
      });
  }, [fields, search, cropFilter, statusFilter, sortBy, allocByField]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!profile?.company_id) return;
      try {
        setLoading(true);
        const [fieldsRes, seasonsRes, cropsRes, varietiesRes, reproductionsRes, specialistsRes] = await Promise.all([
          supabase.from("fields").select("id,name,notes,area").eq("company_id", profile.company_id).eq("archived", false).order("name"),
          supabase.from("seasons").select("id,year").eq("company_id", profile.company_id).eq("archived", false).order("year", { ascending: false }),
          supabase.from("crops").select("id,name,name_ru,name_en,company_id,archived,is_active"),
          supabase.from("varieties").select("id,name,crop_id,company_id,archived,is_active"),
          supabase.from("seed_reproductions").select("id,name,company_id,archived,is_active").order("level_order"),
          getAssignableSpecialists(profile.company_id).catch(() => [] as SpecialistAssignee[]),
        ]);
        if (fieldsRes.error || seasonsRes.error || cropsRes.error || varietiesRes.error || reproductionsRes.error) {
          throw fieldsRes.error || seasonsRes.error || cropsRes.error || varietiesRes.error || reproductionsRes.error;
        }
        if (!mounted) return;
        const normalizedFields = ((fieldsRes.data || []) as Field[]).map((field) => ({
          ...field,
          name: getFieldDisplayName(field),
        }));
        setFields(normalizedFields);
        const seasonRows = (seasonsRes.data || []) as Season[];
        setSeasons(seasonRows);
        setAllCrops((cropsRes.data || []) as Crop[]);
        setAllVarieties((varietiesRes.data || []) as Variety[]);
        setAllReproductions((reproductionsRes.data || []) as Reproduction[]);
        setSpecialists(specialistsRes as SpecialistAssignee[]);
        if (seasonRows.length) setSeasonId((prev) => prev || seasonRows[0].id);
      } catch (error) {
        toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Не удалось загрузить структуру посевов", variant: "destructive" });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [profile?.company_id]);

  useEffect(() => {
    if (!profile?.company_id || !seasonId) return;
    (async () => {
      try {
        let res: any = await supabase
          .from("crop_structure")
          .select(CROP_STRUCTURE_V4_SELECT)
          .eq("company_id", profile.company_id)
          .eq("season_id", seasonId)
          .eq("archived", false);
        if (res.error && isMissingCropStructureV4Column(res.error)) {
          res = await supabase
            .from("crop_structure")
            .select(CROP_STRUCTURE_BASE_SELECT)
            .eq("company_id", profile.company_id)
            .eq("season_id", seasonId)
            .eq("archived", false);
        }
        if (res.error) throw res.error;
        const map = new Map<string, Allocation[]>();
        for (const row of (res.data || []) as any[]) {
          const allocation = allocationFromRow(row);
          map.set(row.field_id, [...(map.get(row.field_id) || []), allocation]);
        }
        setAllocByField(map);
        setInitialByField(new Map(Array.from(map.entries()).map(([key, value]) => [key, value.map((item) => ({ ...item }))])));
      } catch (error) {
        toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Не удалось загрузить посевные строки", variant: "destructive" });
      }
    })();
  }, [profile?.company_id, seasonId]);

  useEffect(() => {
    if (!profile?.company_id || !seasonId) return;
    (async () => {
      try {
        const res = await supabase
          .from("field_material_consumptions")
          .select("id,field_id,crop_structure_row_id,operation_type,product_id,variety_id,reproduction_id,batch_class,quantity_kg,area_ha,norm_per_ha,consumed_at,ticket_id,responsible_personnel_id,vehicle_id,notes")
          .eq("company_id", profile.company_id)
          .eq("season_id", seasonId)
          .order("consumed_at", { ascending: false });

        if (res.error) {
          const message = String(res.error.message || "").toLowerCase();
          if (message.includes("field_material_consumptions") || message.includes("schema cache")) {
            setConsumptions([]);
            return;
          }
          throw res.error;
        }

        const rows = (res.data || []) as any[];
        const productIds = Array.from(new Set(rows.map((row) => String(row.product_id || "")).filter(Boolean)));
        const specialistIds = Array.from(new Set(rows.map((row) => String(row.responsible_personnel_id || "")).filter(Boolean)));
        const vehicleIds = Array.from(new Set(rows.map((row) => String(row.vehicle_id || "")).filter(Boolean)));
        const [productsRes, specialistsRes, vehiclesRes] = await Promise.all([
          productIds.length ? supabase.from("products").select("id,name").in("id", productIds) : Promise.resolve({ data: [] } as any),
          specialistIds.length ? supabase.from("reference_specialists").select("id,full_name").in("id", specialistIds) : Promise.resolve({ data: [] } as any),
          vehicleIds.length ? supabase.from("reference_vehicles").select("id,name,plate_number").in("id", vehicleIds) : Promise.resolve({ data: [] } as any),
        ]);
        const productNames = new Map<string, string>((productsRes.data || []).map((row: any) => [String(row.id), String(row.name || "Материал")]));
        const specialistNames = new Map<string, string>((specialistsRes.data || []).map((row: any) => [String(row.id), String(row.full_name || "Ответственный")]));
        const vehicleNames = new Map<string, string>((vehiclesRes.data || []).map((row: any) => [String(row.id), [row.name, row.plate_number].filter(Boolean).join(" ") || "Техника"]));
        setConsumptions(rows.map((row: any) => ({
          id: String(row.id),
          field_id: String(row.field_id),
          crop_structure_row_id: row.crop_structure_row_id ? String(row.crop_structure_row_id) : null,
          operation_type: String(row.operation_type || "other"),
          product_id: row.product_id ? String(row.product_id) : null,
          product_name: productNames.get(String(row.product_id || "")) || "Материал",
          variety_name: row.variety_id ? varietyMap.get(String(row.variety_id))?.name || null : null,
          reproduction_name: row.reproduction_id ? reproductionMap.get(String(row.reproduction_id))?.name || null : null,
          batch_class: row.batch_class ? String(row.batch_class) : null,
          quantity_kg: Number(row.quantity_kg || 0),
          area_ha: row.area_ha == null ? null : Number(row.area_ha || 0),
          norm_per_ha: row.norm_per_ha == null ? null : Number(row.norm_per_ha || 0),
          consumed_at: row.consumed_at || null,
          ticket_id: row.ticket_id ? String(row.ticket_id) : null,
          responsible_name: row.responsible_personnel_id ? specialistNames.get(String(row.responsible_personnel_id)) || null : null,
          vehicle_name: row.vehicle_id ? vehicleNames.get(String(row.vehicle_id)) || null : null,
          notes: row.notes || null,
        })));
      } catch (error) {
        setConsumptions([]);
        toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Не удалось загрузить фактический расход по полям", variant: "destructive" });
      }
    })();
  }, [profile?.company_id, seasonId, varietyMap, reproductionMap]);

  useEffect(() => {
    if (!profile?.company_id || !seasonId) {
      setLegalLinksByField(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: links, error: linksError } = await supabase
          .from("field_cadastre_links")
          .select("id, field_id, crop_id, area_ha, cadastral_parcel_id, legal_entity_id, owner_legal_entity_id, usage_legal_entity_id, status, allocation_method, source, notes")
          .eq("company_id", profile.company_id)
          .eq("season_id", seasonId)
          .neq("status", "archived");
        if (linksError) throw new Error(linksError.message);

        const cadastreIds = Array.from(new Set((links || []).map((row: any) => String(row.cadastral_parcel_id || "")).filter(Boolean)));
        const entityIds = Array.from(
          new Set(
            (links || [])
              .flatMap((row: any) => [row.legal_entity_id, row.owner_legal_entity_id, row.usage_legal_entity_id])
              .map((value: any) => String(value || ""))
              .filter(Boolean)
          )
        );

        const [{ data: cadastres, error: cadastresError }, { data: entities, error: entitiesError }] = await Promise.all([
          cadastreIds.length
            ? supabase.from("cadastral_parcels").select("id, cadastral_number").in("id", cadastreIds)
            : Promise.resolve({ data: [], error: null } as any),
          entityIds.length
            ? supabase.from("legal_entities").select("id, name").in("id", entityIds)
            : Promise.resolve({ data: [], error: null } as any),
        ]);
        if (cadastresError) throw new Error(cadastresError.message);
        if (entitiesError) throw new Error(entitiesError.message);

        const cadastreMap = new Map<string, string>(
          (cadastres || []).map((row: any) => [String(row.id), String(row.cadastral_number || "-")])
        );
        const entityMap = new Map<string, string>(
          (entities || []).map((row: any) => [String(row.id), String(row.name || "-")])
        );
        const grouped = new Map<string, FieldLegalLink[]>();

        (links || []).forEach((row: any) => {
          const fieldId = String(row.field_id || "");
          if (!fieldId) return;
          grouped.set(fieldId, [
            ...(grouped.get(fieldId) || []),
            {
              id: String(row.id),
              field_id: fieldId,
              crop_id: row.crop_id ? String(row.crop_id) : null,
              area_ha: Number(row.area_ha || 0),
              cadastral_number: cadastreMap.get(String(row.cadastral_parcel_id || "")) || "-",
              legal_entity_name: entityMap.get(String(row.legal_entity_id || "")) || null,
              owner_legal_entity_name: entityMap.get(String(row.owner_legal_entity_id || "")) || null,
              usage_legal_entity_name: entityMap.get(String(row.usage_legal_entity_id || "")) || null,
              status: String(row.status || "active"),
              allocation_method: String(row.allocation_method || "manual_adjusted"),
              source: String(row.source || "manual"),
              notes: row.notes ? String(row.notes) : null,
            },
          ]);
        });

        if (!cancelled) setLegalLinksByField(grouped);
      } catch (error) {
        if (!cancelled) setLegalLinksByField(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.company_id, seasonId, cropMap]);

  const openField = (fieldId: string) => {
    setSelectedFieldId(fieldId);
    setFieldDialogTab("dossier");
    setDraftRows((allocByField.get(fieldId) || []).map((item) => ({ ...item })));
  };

  const closeField = () => {
    setSelectedFieldId(null);
    setDraftRows([]);
    setFieldDialogTab("dossier");
  };

  const patchDraft = (index: number, patch: Partial<Allocation>) => {
    setDraftRows((prev) => {
      const next = [...prev];
      const old = next[index];
      const merged = { ...old, ...patch };
      if (patch.crop_id && patch.crop_id !== old.crop_id) {
        merged.variety_id = null;
      }
      if (isPotatoAllocation(merged)) {
        merged.row_spacing_m = merged.row_spacing_m || 0.75;
        merged.irrigation_type = normalizeIrrigationType(merged.irrigation_type);
      }
      next[index] = merged;
      return next;
    });
  };

  const addRow = () => {
    if (!selectedFieldId) return;
    setDraftRows((prev) => [
      ...prev,
      {
        field_id: selectedFieldId,
        crop_id: null,
        variety_id: null,
        reproduction_id: null,
        notes: "",
        area: null,
        irrigation_type: "unknown",
        row_spacing_m: null,
        seed_spacing_cm: null,
      },
    ]);
  };

  const removeRow = (index: number) => {
    setDraftRows((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const fillFullArea = () => {
    if (!selectedField) return;
    setDraftRows((prev) => {
      if (!prev.length) {
        return [
          {
            field_id: selectedField.id,
            crop_id: null,
            variety_id: null,
            reproduction_id: null,
            notes: "",
            area: selectedField.area,
            irrigation_type: "unknown",
            row_spacing_m: null,
            seed_spacing_cm: null,
          },
        ];
      }
      const otherArea = prev.slice(1).reduce((sum, row) => sum + Number(row.area || 0), 0);
      return [{ ...prev[0], area: Math.max(0, selectedField.area - otherArea) }, ...prev.slice(1)];
    });
  };

  const save = async () => {
    if (!selectedFieldId || !selectedField || !profile?.company_id || !profile.id || !seasonId) return;
    for (const row of draftRows) {
      if (!row.crop_id || !row.variety_id || !row.reproduction_id || row.area == null || row.area <= 0) {
        toast({ title: "Ошибка", description: "Заполните культуру, сорт, репродукцию и площадь.", variant: "destructive" });
        return;
      }
      if (isPotatoAllocation(row) && (!row.seed_spacing_cm || row.seed_spacing_cm <= 0)) {
        toast({ title: "Ошибка", description: "Для картофеля укажите межклубневое расстояние в структуре.", variant: "destructive" });
        return;
      }
    }
    if (sumArea(draftRows) > selectedField.area + EPS) {
      toast({ title: "Ошибка", description: "Площадь посевных строк превышает площадь поля.", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const toStructurePayload = (row: Allocation, includeTechnology: boolean) => ({
        company_id: profile.company_id,
        user_id: profile.id,
        field_id: selectedFieldId,
        season_id: seasonId,
        crop_id: row.crop_id,
        variety_id: row.variety_id,
        reproduction_id: row.reproduction_id,
        notes: row.notes || null,
        area: Number(row.area || 0),
        status: "planned",
        ...(includeTechnology
          ? {
              irrigation_type: normalizeIrrigationType(row.irrigation_type),
              row_spacing_m: row.row_spacing_m ?? (isPotatoAllocation(row) ? 0.75 : null),
              seed_spacing_cm: row.seed_spacing_cm ?? null,
            }
          : {}),
      });
      const prev = initialByField.get(selectedFieldId) || [];
      const prevIds = new Set(prev.map((row) => row.id).filter(Boolean) as string[]);
      const curIds = new Set(draftRows.map((row) => row.id).filter(Boolean) as string[]);
      const delIds = Array.from(prevIds).filter((id) => !curIds.has(id));
      if (delIds.length) {
        const del = await supabase.from("crop_structure").delete().eq("company_id", profile.company_id).eq("field_id", selectedFieldId).eq("season_id", seasonId).in("id", delIds);
        if (del.error) throw del.error;
      }
      const updates = draftRows.filter((row) => row.id);
      if (updates.length) {
        let up = await supabase.from("crop_structure").upsert(
          updates.map((row) => ({ id: row.id, ...toStructurePayload(row, true) })),
          { onConflict: "id" },
        );
        if (up.error && isMissingCropStructureV4Column(up.error)) {
          up = await supabase.from("crop_structure").upsert(
            updates.map((row) => ({ id: row.id, ...toStructurePayload(row, false) })),
            { onConflict: "id" },
          );
        }
        if (up.error) throw up.error;
      }
      const inserts = draftRows.filter((row) => !row.id);
      if (inserts.length) {
        let ins = await supabase.from("crop_structure").insert(inserts.map((row) => toStructurePayload(row, true)));
        if (ins.error && isMissingCropStructureV4Column(ins.error)) {
          ins = await supabase.from("crop_structure").insert(inserts.map((row) => toStructurePayload(row, false)));
        }
        if (ins.error) throw ins.error;
      }
      let res: any = await supabase.from("crop_structure").select(CROP_STRUCTURE_V4_SELECT).eq("company_id", profile.company_id).eq("season_id", seasonId).eq("archived", false);
      if (res.error && isMissingCropStructureV4Column(res.error)) {
        res = await supabase.from("crop_structure").select(CROP_STRUCTURE_BASE_SELECT).eq("company_id", profile.company_id).eq("season_id", seasonId).eq("archived", false);
      }
      if (res.error) throw res.error;
      const map = new Map<string, Allocation[]>();
      for (const row of (res.data || []) as any[]) {
        const item = allocationFromRow(row);
        map.set(row.field_id, [...(map.get(row.field_id) || []), item]);
      }
      setAllocByField(map);
      setInitialByField(new Map(Array.from(map.entries()).map(([key, value]) => [key, value.map((item) => ({ ...item }))])));
      setDraftRows((map.get(selectedFieldId) || []).map((item) => ({ ...item })));
      toast({ title: "Сохранено", description: "Структура поля обновлена." });
    } catch (error) {
      toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = () => {
    if (!season) return;
    const lines = [["Сезон", "Поле", "Площадь поля, га", "Культура", "Сорт", "Репродукция", "Площадь, га"].join(";")];
    for (const field of fields) {
      const rows = allocByField.get(field.id) || [];
      if (!rows.length) lines.push([season.year, field.name, field.area.toFixed(2), "", "", "", "0.00"].join(";"));
      for (const row of rows) {
        lines.push([season.year, field.name, field.area.toFixed(2), cropName(row.crop_id), varietyName(row.variety_id), reproductionName(row.reproduction_id), Number(row.area || 0).toFixed(2)].join(";"));
      }
    }
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crop-structure-${season.year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportFieldPdf = async () => {
    if (!selectedFieldId || !seasonId || !profile?.id) return;
    try {
      setPdfLoading(true);
      const res = await fetch(`/api/crop-structure/fields/${selectedFieldId}/pdf?seasonId=${encodeURIComponent(seasonId)}&userId=${encodeURIComponent(profile.id)}`);
      if (!res.ok) throw new Error("PDF export failed");
      const html = await res.text();
      const w = window.open("", "_blank", "noopener,noreferrer");
      if (!w) throw new Error("Разрешите всплывающее окно для печати PDF.");
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (error) {
      toast({ title: "Ошибка", description: error instanceof Error ? error.message : "PDF export failed", variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  const operationDialogFields = useMemo(
    () =>
      fields.map((field) => ({
        ...field,
        display_name: field.name,
        soil_type: null,
        archived: false,
        created_at: "",
        updated_at: "",
        user_id: "",
        company_id: profile?.company_id || null,
      })),
    [fields, profile?.company_id]
  );

  const operationDialogCropStructures = useMemo<CropStructureWithDetails[]>(() => {
    const rows: CropStructureWithDetails[] = [];
    allocByField.forEach((allocations, fieldId) => {
      const field = fieldMap.get(fieldId);
      allocations.forEach((allocation) => {
        if (!allocation.id || !allocation.crop_id) return;
        rows.push({
          id: allocation.id,
          field_id: fieldId,
          season_id: seasonId,
          crop_id: allocation.crop_id,
          variety_id: allocation.variety_id,
          reproduction_id: allocation.reproduction_id,
          area: Number(allocation.area || 0),
          seeding_rate: allocation.seeding_rate ?? null,
          expected_yield: allocation.expected_yield ?? null,
          irrigation_type: normalizeIrrigationType(allocation.irrigation_type),
          row_spacing_m: allocation.row_spacing_m ?? null,
          seed_spacing_cm: allocation.seed_spacing_cm ?? null,
          status: "planned",
          notes: allocation.notes || null,
          archived: false,
          created_at: "",
          updated_at: "",
          user_id: "",
          field_name: field?.name || "-",
          season_year: season?.year || 0,
          crop_name: cropName(allocation.crop_id),
          variety_name: varietyName(allocation.variety_id),
          reproduction_name: reproductionName(allocation.reproduction_id),
        });
      });
    });
    return rows;
  }, [allocByField, fieldMap, season?.year, seasonId]);

  const openOperationPlan = (field: Field, allocation: Allocation, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!FIELD_FIRST_CREATE_ENABLED) return;
    if (!allocation.id || !allocation.crop_id) {
      toast({
        title: "Нужен план по культуре",
        description: "Сначала сохраните культуру и площадь по полю.",
        variant: "destructive",
      });
      return;
    }
    const allocationIsPotato = isPotatoAllocation(allocation);
    setOperationDefaults({
      field_id: field.id,
      crop_structure_id: allocation.id,
      crop_id: allocation.crop_id,
      planned_area_ha: Number(allocation.area || 0),
      row_spacing_m: allocation.row_spacing_m ?? (allocationIsPotato ? 0.75 : null),
      seed_spacing_cm: allocation.seed_spacing_cm ?? (allocationIsPotato ? 32 : null),
      operation_params: {
        irrigation_type: normalizeIrrigationType(allocation.irrigation_type),
      },
      date: new Date().toISOString().slice(0, 10),
      notes: "",
    });
    setOperationSourceLabel(
      `План по полю: ${field.name} • ${cropName(allocation.crop_id)} • ${varietyName(allocation.variety_id)} • ${reproductionName(allocation.reproduction_id)} • ${fmtHa(Number(allocation.area || 0))}`
    );
    setSelectedFieldId(null);
    setOperationDialogOpen(true);
  };

  const handleCreateOperationPlan = async (data: OperationFormData, options?: { idempotencyKey?: string }) => {
    if (!profile?.company_id) {
      const message = "Не выбран контекст компании.";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
      throw new Error(message);
    }
    try {
      await createOperation(profile.company_id, data, options);
      setOperationDialogOpen(false);
      setOperationDefaults(undefined);
      toast({ title: "План создан", description: "Работа добавлена в журнал операций." });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать план работы", variant: "destructive" });
      throw error;
    }
  };

  const renderStageStrip = (rows: Allocation[], compact = false) => {
    const plannedArea = Math.max(sumArea(rows), 0);
    return (
      <div className={compact ? "space-y-1.5" : "space-y-2"}>
        {stageDefs.map((stage) => {
          const done = rows.reduce((sum, row) => {
            const facts = allocationFacts(row);
            return sum + Math.min(facts.stageCompleted.get(stage.key) || 0, Number(row.area || 0));
          }, 0);
          const pct = plannedArea > 0 ? Math.min(100, (done / plannedArea) * 100) : 0;
          return (
            <div key={stage.key} className="grid grid-cols-[104px_1fr_42px] items-center gap-2 text-[11px]">
              <div className="truncate font-medium text-slate-600">{stage.label}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-right text-slate-500">{pct.toFixed(0)}%</div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderOverviewCard = (field: Field) => {
    const rows = allocByField.get(field.id) || [];
    const state = fieldState(field.id);
    const fieldConsumptions = consumptionsByField.get(field.id) || [];
    const planned = sumArea(rows);
    const materialLabels = Array.from(new Set(fieldConsumptions.map((item) => materialCategory(item))))
      .filter((category) => category !== "other")
      .map((category) => {
        if (category === "seed") return "семена";
        if (category === "fertilizer") return "удобрения";
        if (category === "chemical") return "СЗР";
        if (category === "organic") return "органика";
        if (category === "fuel") return "ГСМ";
        if (category === "irrigation") return "полив";
        return "прочее";
      });

    return (
      <Card key={field.id} className="cursor-pointer border-slate-200 transition hover:border-emerald-300 hover:shadow-sm" onClick={() => openField(field.id)}>
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-slate-950">Поле {field.name} — {fmtHa(field.area)}</div>
              <div className="text-xs text-slate-500">Структура: {fmtHa(planned)}</div>
            </div>
            <Badge className={stateClass(state)}>{stateText(state)}</Badge>
          </div>

          <div className="mt-2 space-y-1">
            {rows.length ? rows.slice(0, 3).map((row) => (
              <div key={row.id || `${field.id}-${row.crop_id}`} className="rounded-md bg-slate-50 px-2 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-800">
                      {cropName(row.crop_id)} / {varietyName(row.variety_id)} / {reproductionName(row.reproduction_id)}
                    </div>
                    <div className="text-[11px] text-slate-500">{fmtHa(Number(row.area || 0))}</div>
                  </div>
                  {FIELD_FIRST_CREATE_ENABLED ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={(event) => openOperationPlan(field, row, event)}
                    >
                      Запланировать
                    </Button>
                  ) : null}
                </div>
              </div>
            )) : (
              <div className="rounded-md border border-dashed bg-slate-50 px-2 py-3 text-center text-xs text-slate-500">Нет посевных строк</div>
            )}
            {rows.length > 3 ? <div className="text-[11px] text-slate-500">+ ещё {rows.length - 3} строк</div> : null}
          </div>

          <div className="mt-3 border-t pt-2 text-xs text-slate-600">
            <span className="font-medium text-slate-800">Материалы:</span>{" "}
            {materialLabels.length ? materialLabels.join(", ") : "нет фактических выдач"}
          </div>
        </CardContent>
      </Card>
    );
  };

  const categoryLabel = (category: MaterialCategory) => {
    if (category === "seed") return "Семена";
    if (category === "fertilizer") return "Удобрения";
    if (category === "chemical") return "СЗР";
    if (category === "organic") return "Органика";
    if (category === "fuel") return "ГСМ";
    if (category === "irrigation") return "Полив";
    return "Прочее";
  };

  const categoryRank: Record<MaterialCategory, number> = {
    seed: 1,
    fertilizer: 2,
    chemical: 3,
    organic: 4,
    fuel: 5,
    irrigation: 6,
    other: 7,
  };

  const formatMaterialQty = (category: MaterialCategory, value: number) => {
    if (category === "organic") return `${(value / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
    if (category === "chemical" || category === "fuel") return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} л`;
    if (category === "irrigation") return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} м³`;
    return fmtKg(value);
  };

  const formatMaterialRate = (category: MaterialCategory, value: number | null) => {
    if (value == null) return "-";
    if (category === "organic") return `${(value / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т/га`;
    if (category === "chemical" || category === "fuel") return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} л/га`;
    if (category === "irrigation") return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} м³/га`;
    return fmtRate(value);
  };

  const buildSeasonMaterialRows = (rows: Consumption[], actualArea: number) => {
    const grouped = new Map<
      string,
      {
        category: MaterialCategory;
        product_name: string;
        variety_name: string | null;
        reproduction_name: string | null;
        batch_class: string | null;
        total: number;
        latestDate: string | null;
      }
    >();

    for (const row of rows) {
      const category = materialCategory(row);
      const key = [category, row.product_id || row.product_name, row.variety_name || "", row.reproduction_name || "", row.batch_class || ""].join("|");
      const current = grouped.get(key);
      if (current) {
        current.total += Number(row.quantity_kg || 0);
        if (row.consumed_at && (!current.latestDate || new Date(row.consumed_at) > new Date(current.latestDate))) {
          current.latestDate = row.consumed_at;
        }
      } else {
        grouped.set(key, {
          category,
          product_name: row.product_name,
          variety_name: row.variety_name,
          reproduction_name: row.reproduction_name,
          batch_class: row.batch_class,
          total: Number(row.quantity_kg || 0),
          latestDate: row.consumed_at || null,
        });
      }
    }

    return Array.from(grouped.values())
      .map((item) => {
        const identity =
          item.category === "seed"
            ? [item.product_name, item.variety_name, item.reproduction_name].filter(Boolean).join(" / ") || item.product_name
            : item.product_name;
        const rate = actualArea > 0 ? item.total / actualArea : null;
        return {
          category: item.category,
          categoryLabel: categoryLabel(item.category),
          identity,
          batchClass: batchClassLabel(item.batch_class),
          total: formatMaterialQty(item.category, item.total),
          perHa: formatMaterialRate(item.category, rate),
          date: fmtDate(item.latestDate),
          latestDate: item.latestDate ? new Date(item.latestDate).getTime() : 0,
        };
      })
      .sort((a, b) => {
        const byCategory = categoryRank[a.category] - categoryRank[b.category];
        if (byCategory !== 0) return byCategory;
        const byDate = b.latestDate - a.latestDate;
        if (byDate !== 0) return byDate;
        return a.identity.localeCompare(b.identity, "ru");
      });
  };

  const renderFieldDossier = () => {
    if (!selectedField) return null;
    const rows = draftRows.length ? draftRows : allocByField.get(selectedField.id) || [];
    const planned = sumArea(rows);
    const fieldConsumptions = consumptionsByField.get(selectedField.id) || [];
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border bg-[#f8faf7] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Что поле фактически получило за сезон</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">Поле {selectedField.name}</div>
              <div className="mt-1 text-sm text-slate-600">
                Всего {fmtHa(selectedField.area)} · структура {fmtHa(planned)} · сезон {season?.year || "-"} · фактических выдач {fieldConsumptions.length}
              </div>
            </div>
            <Badge className={stateClass(fieldState(selectedField.id))}>{stateText(fieldState(selectedField.id))}</Badge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {rows.length ? rows.map((allocation) => (
              <div key={`dossier-head-${allocation.id || allocation.crop_id}`} className="rounded-xl bg-white px-3 py-2 text-sm">
                <div className="font-semibold text-slate-900">{cropName(allocation.crop_id)} / {varietyName(allocation.variety_id)} / {reproductionName(allocation.reproduction_id)}</div>
                <div className="text-xs text-slate-500">{fmtHa(Number(allocation.area || 0))}</div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed bg-white px-3 py-3 text-sm text-slate-500">Посевные строки ещё не заданы.</div>
            )}
          </div>
        </div>

        {rows.length ? rows.map((allocation) => {
          const facts = allocationFacts(allocation);
          const plannedArea = Number(allocation.area || 0);
          const field = fieldMap.get(allocation.field_id);
          const actualCompletedArea = facts.stageCompleted.get("seeding") || facts.stageCompleted.get("care") || facts.stageCompleted.get("prep") || 0;
          const rateArea = actualCompletedArea || plannedArea;
          const rateBasis = actualCompletedArea ? "по выполненной площади" : "по площади посевной строки";
          const materialRows = buildSeasonMaterialRows(facts.rows, rateArea);
          const hasMaterials = materialRows.length > 0;

          return (
            <div key={`detail-${allocation.id || allocation.crop_id}`} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-semibold text-slate-950">{cropName(allocation.crop_id)} / {varietyName(allocation.variety_id)} / {reproductionName(allocation.reproduction_id)}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {fmtHa(plannedArea)} · фактических выдач {facts.rows.length}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {FIELD_FIRST_CREATE_ENABLED && field ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={(event) => openOperationPlan(field, allocation, event)}
                    >
                      Запланировать работу
                    </Button>
                  ) : null}
                  <Badge className="bg-slate-900 text-white hover:bg-slate-900">Материалы сезона</Badge>
                </div>
              </div>

              {hasMaterials ? (
                <div className="mt-4 overflow-hidden rounded-xl border bg-white">
                  <div className="flex items-center justify-end border-b bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    Расчёт факта: {rateBasis}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white text-[11px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Группа</th>
                          <th className="px-3 py-2 font-medium">Продукт</th>
                          <th className="px-3 py-2 font-medium">Партия/класс</th>
                          <th className="px-3 py-2 text-right font-medium">Итого</th>
                          <th className="px-3 py-2 text-right font-medium">На га</th>
                          <th className="px-3 py-2 font-medium">Дата</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialRows.map((item) => (
                          <tr key={`${item.category}-${item.identity}-${item.batchClass}`} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-slate-700">{item.categoryLabel}</td>
                            <td className="px-3 py-2 font-medium text-slate-900">{item.identity}</td>
                            <td className="px-3 py-2 text-slate-500">{item.batchClass}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900">{item.total}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{item.perHa}</td>
                            <td className="px-3 py-2 text-slate-500">{item.date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">
                  Фактических выдач материалов на эту посевную строку пока нет.
                </div>
              )}

            </div>
          );
        }) : (
          <div className="rounded-xl border border-dashed bg-white p-5 text-sm text-slate-500">Посевные строки ещё не заданы.</div>
        )}
      </div>
    );
  };

  const renderEditor = () => {
    if (!selectedField) return null;
    return (
      <div className="rounded-2xl border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-950">Редактор структуры</div>
            <div className="text-xs text-slate-500">План: {fmtHa(sumArea(draftRows))} / {fmtHa(selectedField.area)} · Остаток: {fmtHa(selectedField.area - sumArea(draftRows))}</div>
          </div>
          <Button variant="outline" size="sm" onClick={fillFullArea}>Вся площадь</Button>
        </div>

        <div className="space-y-2">
          {draftRows.map((row, index) => {
            const vars = row.crop_id ? varietiesByCrop.get(row.crop_id) || [] : [];
            const pct = selectedField.area > 0 ? ((Number(row.area || 0) / selectedField.area) * 100).toFixed(2) : "0.00";
            return (
              <div key={`${row.id || "new"}-${index}`} className="grid grid-cols-12 items-end gap-2 rounded-xl bg-slate-50 p-2">
                <div className="col-span-12 md:col-span-3">
                  <Label>Культура *</Label>
                  <Select value={row.crop_id || "none"} onValueChange={(value) => patchDraft(index, { crop_id: value === "none" ? null : value })}>
                    <SelectTrigger><SelectValue placeholder="Выберите культуру" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{globalCrops.map((crop) => <SelectItem key={crop.id} value={crop.id}>{cropLabel(crop)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-12 md:col-span-2">
                  <Label>Сорт *</Label>
                  <Select value={row.variety_id || "none"} onValueChange={(value) => patchDraft(index, { variety_id: value === "none" ? null : value })}>
                    <SelectTrigger><SelectValue placeholder="Выберите сорт" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{vars.map((variety) => <SelectItem key={variety.id} value={variety.id}>{variety.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-12 md:col-span-2">
                  <Label>Репродукция *</Label>
                  <Select value={row.reproduction_id || "none"} onValueChange={(value) => patchDraft(index, { reproduction_id: value === "none" ? null : value })}>
                    <SelectTrigger><SelectValue placeholder="Репродукция" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{globalReproductions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-6 md:col-span-2">
                  <Label>Площадь, га *</Label>
                  <Input type="number" min={0} step="0.01" value={row.area == null ? "" : String(row.area)} onChange={(event) => patchDraft(index, { area: parseNum(event.target.value) })} placeholder="га" />
                </div>
                <div className="col-span-3 md:col-span-1">
                  <Label>%</Label>
                  <div className="flex h-10 items-center rounded-md border bg-white px-3 text-sm">{pct}</div>
                </div>
                <div className="col-span-3 md:col-span-1">
                  <Label>Удалить</Label>
                  <Button className="w-full" variant="ghost" size="icon" onClick={() => removeRow(index)}><X className="h-4 w-4" /></Button>
                </div>
                <div className="col-span-12 grid grid-cols-1 gap-2 border-t border-slate-200 pt-2 md:grid-cols-4">
                  <div>
                    <Label>Орошение</Label>
                    <Select
                      value={normalizeIrrigationType(row.irrigation_type)}
                      onValueChange={(value) => patchDraft(index, { irrigation_type: normalizeIrrigationType(value) })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unknown">Не указано</SelectItem>
                        <SelectItem value="drip">Капельное</SelectItem>
                        <SelectItem value="sprinkler">Дождевание</SelectItem>
                        <SelectItem value="dryland">Богара</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Междурядье, м</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.row_spacing_m == null ? "" : String(row.row_spacing_m)}
                      onChange={(event) => patchDraft(index, { row_spacing_m: parseNum(event.target.value) })}
                      placeholder={isPotatoAllocation(row) ? "0.75" : "м"}
                    />
                  </div>
                  <div>
                    <Label>{isPotatoAllocation(row) ? "Межклубневое, см" : "Расстояние в ряду, см"}</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={row.seed_spacing_cm == null ? "" : String(row.seed_spacing_cm)}
                      onChange={(event) => patchDraft(index, { seed_spacing_cm: parseNum(event.target.value) })}
                      placeholder={isPotatoAllocation(row) ? "32" : "см"}
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200">
                      {getIrrigationTypeLabel(row.irrigation_type)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={addRow}><Plus className="mr-2 h-4 w-4" />Добавить строку</Button>
        </div>
      </div>
    );
  };

  const renderLegalContour = () => {
    if (!selectedField) return null;
    const links = legalLinksByField.get(selectedField.id) || [];
    const totalLegalArea = links.reduce((sum, row) => sum + Number(row.area_ha || 0), 0);
    const diff = totalLegalArea - selectedField.area;
    const diffAbs = Math.abs(diff);
    const diffStatus =
      diffAbs <= 0.01 ? "ok" : diffAbs <= 1 ? "warning" : links.length ? "mismatch" : "missing_cadastre";

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Юридический контур поля</div>
              <div className="mt-1 text-sm text-slate-600">
                Поле {selectedField.name} · Агро-площадь {fmtHa(selectedField.area)} · Юр-площадь {fmtHa(totalLegalArea)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Разница: {diff > 0 ? "+" : ""}{fmtHa(diffAbs).replace(" га", "")} га
              </div>
            </div>
            <Badge
              className={
                diffStatus === "ok"
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                  : diffStatus === "warning"
                    ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
                    : "bg-rose-100 text-rose-800 hover:bg-rose-100"
              }
            >
              {diffStatus}
            </Badge>
          </div>
        </div>

        {links.length ? (
          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Кадастровый номер</th>
                    <th className="px-3 py-2 font-medium">Площадь</th>
                    <th className="px-3 py-2 font-medium">Культура</th>
                    <th className="px-3 py-2 font-medium">Юрлицо</th>
                    <th className="px-3 py-2 font-medium">Владелец</th>
                    <th className="px-3 py-2 font-medium">Метод</th>
                    <th className="px-3 py-2 font-medium">Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">{row.cadastral_number}</td>
                      <td className="px-3 py-2 text-slate-700">{fmtHa(row.area_ha)}</td>
                      <td className="px-3 py-2 text-slate-700">{row.crop_id ? cropName(row.crop_id) : "—"}</td>
                      <td className="px-3 py-2 text-slate-700">{row.legal_entity_name || "—"}</td>
                      <td className="px-3 py-2 text-slate-700">{row.owner_legal_entity_name || row.usage_legal_entity_name || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{row.allocation_method}</td>
                      <td className="px-3 py-2 text-slate-500">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-slate-50 p-4 text-sm text-slate-600">
            Для этого поля пока нет юридической разбивки по кадастрам в выбранном сезоне.
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <PageHeader title="Структура посевов" description="Загрузка..." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Структура посевов" description="Компактный агрономический обзор по полям" />

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={seasonId} onValueChange={setSeasonId}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>{seasons.map((item) => <SelectItem key={item.id} value={item.id}>{item.year}</SelectItem>)}</SelectContent>
            </Select>
            <div className="relative w-[240px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск поля..." />
            </div>
            <Select value={cropFilter} onValueChange={setCropFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Все культуры</SelectItem>{globalCrops.map((crop) => <SelectItem key={crop.id} value={crop.id}>{cropLabel(crop)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value: "all" | FieldState) => setStatusFilter(value)}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="empty">Пусто</SelectItem>
                <SelectItem value="partial">Частично</SelectItem>
                <SelectItem value="complete">Заполнено</SelectItem>
                <SelectItem value="over">Переплан</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(value: "field" | "area" | "main_crop" | "state") => setSortBy(value)}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="field">Сорт: поле</SelectItem>
                <SelectItem value="area">Сорт: площадь</SelectItem>
                <SelectItem value="main_crop">Сорт: культура</SelectItem>
                <SelectItem value="state">Сорт: статус</SelectItem>
              </SelectContent>
            </Select>
            <Button className="ml-auto" variant="outline" onClick={exportExcel}><Download className="mr-2 h-4 w-4" />Excel</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3">
        {filteredFields.map(renderOverviewCard)}
      </div>
      {!filteredFields.length ? (
        <Card><CardContent className="p-8 text-center text-sm text-slate-500">По заданным фильтрам поля не найдены.</CardContent></Card>
      ) : null}

      <Dialog open={Boolean(selectedFieldId)} onOpenChange={(open) => !open && closeField()}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>{selectedField ? `Поле ${selectedField.name} — ${fmtHa(selectedField.area)}` : "Поле"}</DialogTitle>
              <Button variant="outline" onClick={exportFieldPdf} disabled={pdfLoading || !selectedFieldId || !seasonId}>
                <FileText className="mr-2 h-4 w-4" />{pdfLoading ? "Формирование..." : "PDF поля"}
              </Button>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant={fieldDialogTab === "dossier" ? "default" : "outline"} size="sm" onClick={() => setFieldDialogTab("dossier")}>
                Агро-контур
              </Button>
              <Button variant={fieldDialogTab === "legal" ? "default" : "outline"} size="sm" onClick={() => setFieldDialogTab("legal")}>
                Юридический контур
              </Button>
              <Button variant={fieldDialogTab === "editor" ? "default" : "outline"} size="sm" onClick={() => setFieldDialogTab("editor")}>
                Редактор структуры
              </Button>
            </div>
            {fieldDialogTab === "dossier" ? renderFieldDossier() : null}
            {fieldDialogTab === "legal" ? renderLegalContour() : null}
            {fieldDialogTab === "editor" ? renderEditor() : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeField}>Закрыть</Button>
            <Button onClick={save} disabled={saving}>
              <Edit3 className="mr-2 h-4 w-4" />{saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OperationFormDialog
        open={operationDialogOpen}
        onOpenChange={(open) => {
          setOperationDialogOpen(open);
          if (!open) {
            setOperationDefaults(undefined);
            setOperationSourceLabel("");
          }
        }}
        onSubmit={handleCreateOperationPlan}
        defaultValues={operationDefaults}
        lockedContext={Boolean(operationDefaults?.crop_structure_id)}
        sourceLabel={operationSourceLabel}
        fields={operationDialogFields as any}
        cropStructures={operationDialogCropStructures}
        specialists={specialists}
      />
    </div>
  );
}
