"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Edit3, FileText, LayoutGrid, Map as MapIcon, Maximize2, Plus, Search, Table2, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OperationFormDialog } from "@/components/operations/operation-form-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { supabase } from "@/lib/supabase/client";
import { getFieldDisplayName } from "@/lib/fields/display";
import {
  isFallowCrop,
  normalizeCropStructureSeedAttributes,
  validateAndNormalizeCropStructureRows,
} from "@/lib/crop-structure/fallow";
import { createOperation } from "@/lib/services/operations";
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
  name_kz?: string | null;
  name_kk?: string | null;
  name_en?: string | null;
  company_id?: string | null;
  archived?: boolean | null;
  is_active?: boolean | null;
};
type Variety = { id: string; name: string; crop_id: string; company_id?: string | null; archived?: boolean | null; is_active?: boolean | null };
type Reproduction = {
  id: string;
  name: string;
  name_ru?: string | null;
  name_kz?: string | null;
  name_kk?: string | null;
  name_en?: string | null;
  code?: string | null;
  company_id?: string | null;
  archived?: boolean | null;
  is_active?: boolean | null;
  level_order?: number | null;
};
type CropStructureBootstrapPayload = {
  companyId: string;
  fields: Field[];
  seasons: Season[];
  cropStructure?: unknown[];
  crops: Crop[];
  varieties: Variety[];
  reproductions: Reproduction[];
  specialists: SpecialistAssignee[];
};
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
  operation_id: string | null;
  field_id: string;
  crop_structure_row_id: string | null;
  operation_type: string;
  material_type?: string | null;
  unit?: string | null;
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

type StructureOperationMaterialFact = {
  product_id: string | null;
  product_name: string;
  material_type: string | null;
  unit: string | null;
  planned_quantity: number | null;
  issued_quantity: number;
  consumed_quantity: number | null;
  returned_quantity: number | null;
  actual_rate: number | null;
};

type StructureOperationFact = {
  id: string;
  field_id: string;
  crop_structure_row_id: string | null;
  operation_type: string;
  operation_type_slug: string | null;
  operation_category_slug: string | null;
  date: string | null;
  status: string | null;
  work_status: string | null;
  completed_at: string | null;
  planned_area_ha: number | null;
  actual_area_ha: number | null;
  materials: StructureOperationMaterialFact[];
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
type ViewMode = "cards" | "table" | "map";

const EPS = 0.0001;
const CROP_STRUCTURE_VIEW_KEY = "travkinflow.cropStructure.viewMode";
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

const normalizeReproductionToken = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");

const standardReproductionLabel = (item: Reproduction | null | undefined) => {
  if (!item) return "-";
  const tokens = [item.code, item.name_ru, item.name, item.name_en].map(normalizeReproductionToken);
  const has = (...values: string[]) => tokens.some((token) => values.includes(token));

  if (has("os", "original", "оригинальные", "оригинальные семена")) return "ОС — оригинальные семена";
  if (has("sse", "суперсуперэлита", "супер-суперэлита", "super super elite", "super-super-elite")) return "ССЭ — супер-суперэлита";
  if (has("se", "суперэлита", "супер элита", "super elite", "superelite")) return "СЭ — суперэлита";
  if (has("es", "e", "elite", "элита", "элитные", "элитные семена")) return "ЭС — элитные семена";
  if (has("r1", "rs1", "рс1", "1 репродукция", "первая репродукция", "first reproduction")) return "РС1 — 1-я репродукция";
  if (has("r2", "rs2", "рс2", "2 репродукция", "вторая репродукция", "second reproduction")) return "РС2 — 2-я репродукция";
  if (has("r3", "rs3", "рс3", "3 репродукция", "третья репродукция", "third reproduction")) return "РС3 — 3-я репродукция";
  if (has("r4", "rs4", "рс4", "4 репродукция", "четвертая репродукция", "fourth reproduction")) return "РС4 — 4-я репродукция";
  if (has("f1", "гибрид f1", "hybrid f1")) return "F1 — гибрид 1-го поколения";

  return localizedName(item as never, "ru", ["name", "code"]) || item.name || item.code || "-";
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
const buildAllocationMap = (rows: unknown[]) => {
  const map = new Map<string, Allocation[]>();
  for (const row of rows as any[]) {
    if (!row?.field_id) continue;
    const fieldId = String(row.field_id);
    map.set(fieldId, [...(map.get(fieldId) || []), allocationFromRow(row)]);
  }
  return map;
};
const cloneAllocationMap = (map: Map<string, Allocation[]>) =>
  new Map(Array.from(map.entries()).map(([key, value]) => [key, value.map((item) => ({ ...item }))]));
const fmtDate = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
};

const stageForOperation = (operation: string): StageKey => {
  const key = String(operation || "").toLowerCase();
  const exact = stageDefs.find((stage) => stage.operations.includes(key))?.key;
  if (exact) return exact;
  if (key.includes("harvest") || key.includes("уборк") || key.includes("комбайн")) return "harvest";
  if (key.includes("plant") || key.includes("seed") || key.includes("посев") || key.includes("посад")) return "seeding";
  if (
    key.includes("soil") ||
    key.includes("tillage") ||
    key.includes("cultiv") ||
    key.includes("диск") ||
    key.includes("культива") ||
    key.includes("почво") ||
    key.includes("греб") ||
    key.includes("вспаш")
  ) return "prep";
  return "care";
};

const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const oneRelation = (value: unknown): any => (Array.isArray(value) ? value[0] : value);

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
  const materialType = norm(item.material_type);
  const name = norm(item.product_name);
  if (materialType.includes("seed")) return "seed";
  if (materialType.includes("fertilizer") || materialType.includes("micro_fertilizer")) return "fertilizer";
  if (
    materialType.includes("pesticide") ||
    materialType.includes("crop_protection") ||
    materialType.includes("adjuvant") ||
    materialType.includes("ph_corrector") ||
    materialType.includes("biological") ||
    materialType.includes("biostimulant") ||
    materialType.includes("defoamer")
  ) return "chemical";
  if (materialType.includes("water")) return "irrigation";
  if (materialType.includes("fuel")) return "fuel";
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
  const { profile, loading: authLoading } = useAuth();
  const { language } = useLanguage();
  const tr = (ru: string, kz: string, en: string) => (language === "kz" ? kz : language === "en" ? en : ru);
  const activeCompanyId = profile?.company_id || null;
  const activeProfileId = profile?.id || null;
  const isGlobalAdmin = profile?.role === "global_admin";
  const canEditStructure = isGlobalAdmin || profile?.role === "agronomist";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [bootstrappedStructureKey, setBootstrappedStructureKey] = useState<string | null>(null);
  const [consumptions, setConsumptions] = useState<Consumption[]>([]);
  const [operationFacts, setOperationFacts] = useState<StructureOperationFact[]>([]);
  const [operationConsumptions, setOperationConsumptions] = useState<Consumption[]>([]);
  const [search, setSearch] = useState("");
  const [cropFilter, setCropFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | FieldState>("all");
  const [sortBy, setSortBy] = useState<"field" | "area" | "main_crop" | "state">("field");
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [draftRows, setDraftRows] = useState<Allocation[]>([]);
  const [fieldDialogTab, setFieldDialogTab] = useState<"dossier" | "editor" | "legal">("dossier");
  const [selectedDossierAllocationKey, setSelectedDossierAllocationKey] = useState<string | null>(null);
  const [dossierDetailTab, setDossierDetailTab] = useState<"overview" | "operations" | "materials">("overview");
  const [legalLinksByField, setLegalLinksByField] = useState<Map<string, FieldLegalLink[]>>(new Map());
  const [operationDialogOpen, setOperationDialogOpen] = useState(false);
  const [operationDefaults, setOperationDefaults] = useState<Partial<OperationFormData> | undefined>();
  const [operationSourceLabel, setOperationSourceLabel] = useState("");
  const [sectionChoiceField, setSectionChoiceField] = useState<Field | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistAssignee[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);

  const fieldMap = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const selectedField = selectedFieldId ? fieldMap.get(selectedFieldId) || null : null;
  const season = useMemo(() => seasons.find((item) => item.id === seasonId) || null, [seasons, seasonId]);

  const cropLabel = (crop: Crop) => (localizedName(crop as never, language) || crop.name || "").trim();
  const cropOptionKey = (crop: Crop) => {
    const key = cropLabel(crop).replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
    if (key === "травосмесь") return "травосмеси";
    return key;
  };
  const cropOptionPriority = (crop: Crop) => {
    const label = cropLabel(crop);
    const ownName = String(crop.name || crop.name_ru || "").trim();
    const hasReadableRuName = /[А-Яа-яЁё]/.test(ownName);
    return (crop.company_id == null ? 0 : 100) + (hasReadableRuName && ownName === label ? 10 : 0);
  };
  const isVisibleCatalogItem = (item: { company_id?: string | null; archived?: boolean | null; is_active?: boolean | null }) =>
    (item.company_id == null || item.company_id === activeCompanyId) && !item.archived && item.is_active !== false;
  const visibleCrops = useMemo(() => allCrops.filter(isVisibleCatalogItem), [allCrops, activeCompanyId]);
  const cropCatalog = useMemo(() => {
    const byKey = new Map<string, Crop>();
    const aliases = new Map<string, string>();

    for (const crop of visibleCrops) {
      const key = cropOptionKey(crop);
      if (!key) continue;
      const current = byKey.get(key);
      if (
        !current ||
        cropOptionPriority(crop) > cropOptionPriority(current) ||
        (cropOptionPriority(crop) === cropOptionPriority(current) && cropLabel(crop).localeCompare(cropLabel(current), "ru") < 0)
      ) {
        byKey.set(key, crop);
      }
    }

    for (const crop of visibleCrops) {
      const canonical = byKey.get(cropOptionKey(crop));
      if (canonical) aliases.set(crop.id, canonical.id);
    }

    return {
      options: Array.from(byKey.values()).sort((a, b) => cropLabel(a).localeCompare(cropLabel(b), "ru")),
      aliasById: aliases,
    };
  }, [visibleCrops, language]);
  const globalCrops = cropCatalog.options;
  const displayCropId = (id?: string | null) => (id ? cropCatalog.aliasById.get(id) || id : null);
  const cropMap = useMemo(
    () => new Map(visibleCrops.map((crop) => [crop.id, crop])),
    [visibleCrops],
  );
  const globalCropIds = useMemo(() => new Set(globalCrops.map((crop) => crop.id)), [globalCrops]);
  const cropSelectOptions = (selectedCropId?: string | null) =>
    selectedCropId && !globalCropIds.has(selectedCropId) && cropMap.get(selectedCropId)
      ? [...globalCrops, cropMap.get(selectedCropId) as Crop].sort((a, b) => cropLabel(a).localeCompare(cropLabel(b), "ru"))
      : globalCrops;
  const globalVarieties = useMemo(() => allVarieties.filter(isVisibleCatalogItem), [allVarieties, activeCompanyId]);
  const globalReproductions = useMemo(
    () =>
      allReproductions
        .filter(isVisibleCatalogItem)
        .sort((a, b) => Number(a.level_order || 0) - Number(b.level_order || 0) || standardReproductionLabel(a).localeCompare(standardReproductionLabel(b), "ru")),
    [allReproductions, activeCompanyId]
  );
  const varietyMap = useMemo(() => new Map(globalVarieties.map((item) => [item.id, item])), [globalVarieties]);
  const reproductionMap = useMemo(() => new Map(globalReproductions.map((item) => [item.id, item])), [globalReproductions]);
  const varietiesByCrop = useMemo(() => {
    const map = new Map<string, Variety[]>();
    for (const variety of globalVarieties) {
      const cropIds = [variety.crop_id];
      const visibleCropId = displayCropId(variety.crop_id);
      if (visibleCropId && visibleCropId !== variety.crop_id) {
        cropIds.push(visibleCropId);
      }
      for (const cropId of cropIds) {
        map.set(cropId, [...(map.get(cropId) || []), variety]);
      }
    }
    return map;
  }, [globalVarieties, cropCatalog.aliasById]);

  useEffect(() => {
    if (!selectedField) {
      setSelectedDossierAllocationKey(null);
      setDossierDetailTab("overview");
      return;
    }

    const rows = draftRows.length ? draftRows : allocByField.get(selectedField.id) || [];
    if (!rows.length) {
      setSelectedDossierAllocationKey(null);
      setDossierDetailTab("overview");
      return;
    }

    const keys = rows.map((row, index) => allocationKey(row, index));
    if (!selectedDossierAllocationKey || !keys.includes(selectedDossierAllocationKey)) {
      setSelectedDossierAllocationKey(keys[0]);
      setDossierDetailTab("overview");
    }
  }, [allocByField, draftRows, selectedDossierAllocationKey, selectedField]);

  const cropName = (id?: string | null) => (id && cropMap.get(id) ? cropLabel(cropMap.get(id) as Crop) : "-");
  const varietyName = (id?: string | null) => (id && varietyMap.get(id) ? varietyMap.get(id)?.name || "-" : "-");
  const reproductionName = (id?: string | null) => (id && reproductionMap.get(id) ? standardReproductionLabel(reproductionMap.get(id)) : "-");
  const isPotatoAllocation = (row: Pick<Allocation, "crop_id" | "variety_id">) =>
    isPotatoCropContext(cropName(row.crop_id), varietyName(row.variety_id));
  const isFallowAllocation = (row: Pick<Allocation, "crop_id">) =>
    isFallowCrop(row.crop_id ? cropMap.get(row.crop_id) : null);
  const sumArea = (rows: Allocation[]) => rows.reduce((sum, row) => sum + Number(row.area || 0), 0);
  const allocationKey = (row: Allocation, index = 0) =>
    row.id || `${row.field_id || "field"}-${row.crop_id || "crop"}-${row.variety_id || "variety"}-${row.reproduction_id || "repro"}-${Number(row.area || 0)}-${index}`;

  const cropIcon = (name: string) => {
    const value = name.toLowerCase();
    if (value.includes("карто")) return "🥔";
    if (value.includes("морков")) return "🥕";
    if (value.includes("кукуруз")) return "🌽";
    if (value.includes("пшени") || value.includes("ячмен") || value.includes("зерн")) return "🌾";
    if (value.includes("подсол")) return "🌻";
    if (value.includes("соя") || value.includes("горох") || value.includes("боб")) return "🌱";
    return "🌿";
  };

  const cropSummaries = (rows: Allocation[]) => {
    const grouped = new Map<string, { cropId: string | null; name: string; area: number }>();
    for (const row of rows) {
      const key = row.crop_id || "unknown";
      const resolvedName = row.crop_id ? cropName(row.crop_id) : "";
      const name = resolvedName && resolvedName !== "-" ? resolvedName : "Культура не задана";
      const current = grouped.get(key);
      if (current) {
        current.area += Number(row.area || 0);
      } else {
        grouped.set(key, { cropId: row.crop_id, name, area: Number(row.area || 0) });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.area - a.area || a.name.localeCompare(b.name, "ru"));
  };

  const operationAllocationsForField = (fieldId: string) =>
    [...(allocByField.get(fieldId) || [])]
      .filter((row) => row.id && row.crop_id)
      .sort((a, b) => Number(b.area || 0) - Number(a.area || 0));

  const allocationTitle = (allocation: Allocation) =>
    `${cropName(allocation.crop_id)} / ${varietyName(allocation.variety_id)} / ${reproductionName(allocation.reproduction_id)} — ${fmtHa(Number(allocation.area || 0))}`;

  const selectedCropStructureRowIds = useMemo(
    () => {
      if (!selectedFieldId) return [];
      return Array.from(
        new Set(
          (allocByField.get(selectedFieldId) || [])
            .map((row) => row.id)
            .filter((id): id is string => Boolean(id))
        )
      );
    },
    [allocByField, selectedFieldId]
  );

  const consumptionIdentityKey = (
    item: Pick<Consumption, "operation_id" | "crop_structure_row_id" | "product_id">
  ) => {
    if (!item.operation_id || !item.crop_structure_row_id || !item.product_id) return "";
    return [item.operation_id, item.crop_structure_row_id, item.product_id].join("|");
  };

  const allConsumptions = useMemo(() => {
    const materialFacts = new Set(consumptions.map(consumptionIdentityKey).filter(Boolean));
    const derivedRows = operationConsumptions.filter((item) => {
      const key = consumptionIdentityKey(item);
      return !key || !materialFacts.has(key);
    });
    return [...consumptions, ...derivedRows];
  }, [consumptions, operationConsumptions]);

  const consumptionsByAllocation = useMemo(() => {
    const map = new Map<string, Consumption[]>();
    for (const item of allConsumptions) {
      if (!item.crop_structure_row_id) continue;
      map.set(item.crop_structure_row_id, [...(map.get(item.crop_structure_row_id) || []), item]);
    }
    return map;
  }, [allConsumptions]);

  const consumptionsByField = useMemo(() => {
    const map = new Map<string, Consumption[]>();
    for (const item of allConsumptions) {
      map.set(item.field_id, [...(map.get(item.field_id) || []), item]);
    }
    return map;
  }, [allConsumptions]);

  const operationFactsByAllocation = useMemo(() => {
    const map = new Map<string, StructureOperationFact[]>();
    for (const item of operationFacts) {
      if (!item.crop_structure_row_id) continue;
      map.set(item.crop_structure_row_id, [...(map.get(item.crop_structure_row_id) || []), item]);
    }
    for (const [key, rows] of Array.from(map.entries())) {
      map.set(
        key,
        rows.sort((a: StructureOperationFact, b: StructureOperationFact) => new Date(b.completed_at || b.date || 0).getTime() - new Date(a.completed_at || a.date || 0).getTime())
      );
    }
    return map;
  }, [operationFacts]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CROP_STRUCTURE_VIEW_KEY);
      if (saved === "cards" || saved === "table" || (saved === "map" && isGlobalAdmin)) {
        setViewMode(saved as ViewMode);
      }
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, [isGlobalAdmin]);

  const changeViewMode = (mode: ViewMode) => {
    const nextMode = mode === "map" && !isGlobalAdmin ? "cards" : mode;
    setViewMode(nextMode);
    try {
      window.localStorage.setItem(CROP_STRUCTURE_VIEW_KEY, nextMode);
    } catch {
      // View persistence is a convenience; the page should still work without it.
    }
  };

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
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
    (async () => {
      if (authLoading) return;
      if (!activeCompanyId) {
        if (mounted) {
          setFields([]);
          setSeasons([]);
          setSeasonId("");
          setAllCrops([]);
          setAllVarieties([]);
          setAllReproductions([]);
          setAllocByField(new Map());
          setInitialByField(new Map());
          setBootstrappedStructureKey(null);
          setConsumptions([]);
          setOperationFacts([]);
          setOperationConsumptions([]);
          setLegalLinksByField(new Map());
          setSpecialists([]);
          setLoadError("Компания не выбрана. Выберите компанию и обновите страницу.");
          setLoading(false);
        }
        return;
      }
      try {
        setLoading(true);
        setLoadError(null);
        setFields([]);
        setSeasons([]);
        setSeasonId("");
        setAllocByField(new Map());
        setInitialByField(new Map());
        setBootstrappedStructureKey(null);
        setConsumptions([]);
        setOperationFacts([]);
        setOperationConsumptions([]);
        setLegalLinksByField(new Map());
        setSelectedFieldId(null);
        setDraftRows([]);

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (sessionError || !token) {
          throw new Error("User is not authenticated");
        }

        const params = new URLSearchParams({ companyId: activeCompanyId });
        const response = await fetch(`/api/crop-structure/bootstrap?${params.toString()}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<CropStructureBootstrapPayload> & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load crop structure bootstrap");
        }
        if (payload.companyId && payload.companyId !== activeCompanyId) {
          throw new Error("Selected company context changed while loading crop structure");
        }
        if (!mounted) return;
        const normalizedFields = ((payload.fields || []) as Field[]).map((field) => ({
          ...field,
          name: getFieldDisplayName(field),
        }));
        setFields(normalizedFields);
        const seasonRows = (payload.seasons || []) as Season[];
        setSeasons(seasonRows);
        setAllCrops((payload.crops || []) as Crop[]);
        setAllVarieties((payload.varieties || []) as Variety[]);
        setAllReproductions((payload.reproductions || []) as Reproduction[]);
        setSpecialists((payload.specialists || []) as SpecialistAssignee[]);
        const nextSeasonId = seasonRows[0]?.id || "";
        const bootstrapMap = buildAllocationMap(payload.cropStructure || []);
        setAllocByField(bootstrapMap);
        setInitialByField(cloneAllocationMap(bootstrapMap));
        setBootstrappedStructureKey(nextSeasonId ? `${activeCompanyId}:${nextSeasonId}` : null);
        setSeasonId(nextSeasonId);
      } catch (error) {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Не удалось загрузить структуру посевов";
        if (mounted) setLoadError(message);
        toast({ title: "Ошибка", description: message, variant: "destructive" });
      } finally {
        if (mounted) setLoading(false);
        window.clearTimeout(timeoutId);
      }
    })();
    return () => {
      mounted = false;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [authLoading, activeCompanyId, toast]);

  useEffect(() => {
    if (!activeCompanyId || !seasonId) {
      setAllocByField(new Map());
      setInitialByField(new Map());
      return;
    }
    if (bootstrappedStructureKey === `${activeCompanyId}:${seasonId}`) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let res: any = await supabase
          .from("crop_structure")
          .select(CROP_STRUCTURE_V4_SELECT)
          .eq("company_id", activeCompanyId)
          .eq("season_id", seasonId)
          .eq("archived", false);
        if (res.error && isMissingCropStructureV4Column(res.error)) {
          res = await supabase
            .from("crop_structure")
            .select(CROP_STRUCTURE_BASE_SELECT)
            .eq("company_id", activeCompanyId)
            .eq("season_id", seasonId)
            .eq("archived", false);
        }
        if (res.error) throw res.error;
        const map = buildAllocationMap(res.data || []);
        if (cancelled) return;
        setAllocByField(map);
        setInitialByField(cloneAllocationMap(map));
      } catch (error) {
        toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Не удалось загрузить посевные строки", variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, seasonId, bootstrappedStructureKey, toast]);

  useEffect(() => {
    if (!isGlobalAdmin || !activeCompanyId || !seasonId || !selectedFieldId) {
      setConsumptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await supabase
          .from("field_material_consumptions")
          .select("id,operation_id,field_id,crop_structure_row_id,operation_type,product_id,variety_id,reproduction_id,batch_class,quantity_kg,area_ha,norm_per_ha,consumed_at,ticket_id,responsible_personnel_id,vehicle_id,notes")
          .eq("company_id", activeCompanyId)
          .eq("season_id", seasonId)
          .eq("field_id", selectedFieldId)
          .order("consumed_at", { ascending: false });

        if (res.error) {
          const message = String(res.error.message || "").toLowerCase();
          if (message.includes("field_material_consumptions") || message.includes("schema cache")) {
            if (!cancelled) setConsumptions([]);
            return;
          }
          throw res.error;
        }

        const rows = (res.data || []) as any[];
        const productIds = Array.from(new Set(rows.map((row) => String(row.product_id || "")).filter(Boolean)));
        const specialistIds = Array.from(new Set(rows.map((row) => String(row.responsible_personnel_id || "")).filter(Boolean)));
        const vehicleIds = Array.from(new Set(rows.map((row) => String(row.vehicle_id || "")).filter(Boolean)));
        const [productsRes, specialistsRes, vehiclesRes] = await Promise.all([
          productIds.length ? supabase.from("products").select("id,name,trade_name,normalized_name").in("id", productIds) : Promise.resolve({ data: [] } as any),
          specialistIds.length ? supabase.from("reference_specialists").select("id,full_name").in("id", specialistIds) : Promise.resolve({ data: [] } as any),
          vehicleIds.length ? supabase.from("reference_vehicles").select("id,name,plate_number").in("id", vehicleIds) : Promise.resolve({ data: [] } as any),
        ]);
        const productNames = new Map<string, string>((productsRes.data || []).map((row: any) => [String(row.id), brandName(row) || "Материал"]));
        const specialistNames = new Map<string, string>((specialistsRes.data || []).map((row: any) => [String(row.id), String(row.full_name || "Ответственный")]));
        const vehicleNames = new Map<string, string>((vehiclesRes.data || []).map((row: any) => [String(row.id), [row.name, row.plate_number].filter(Boolean).join(" ") || "Техника"]));
        if (cancelled) return;
        setConsumptions(rows.map((row: any) => ({
          id: String(row.id),
          operation_id: row.operation_id ? String(row.operation_id) : null,
          field_id: String(row.field_id),
          crop_structure_row_id: row.crop_structure_row_id ? String(row.crop_structure_row_id) : null,
          operation_type: String(row.operation_type || "other"),
          material_type: null,
          unit: null,
          product_id: row.product_id ? String(row.product_id) : null,
          product_name: productNames.get(String(row.product_id || "")) || "Материал",
          variety_name: row.variety_id ? brandName(varietyMap.get(String(row.variety_id)) as never) || null : null,
          reproduction_name: row.reproduction_id
            ? localizedName(reproductionMap.get(String(row.reproduction_id)) as never, language, ["name", "code"]) || null
            : null,
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
        if (cancelled) return;
        setConsumptions([]);
        toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Не удалось загрузить фактический расход по полям", variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, seasonId, selectedFieldId, varietyMap, reproductionMap, toast, language]);

  useEffect(() => {
    if (!activeCompanyId || !seasonId || !selectedFieldId || selectedCropStructureRowIds.length === 0) {
      setOperationFacts([]);
      setOperationConsumptions([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await supabase
          .from("operations")
          .select(`
            id,
            field_id,
            crop_structure_id,
            operation_type,
            operation_type_slug,
            operation_category_slug,
            date,
            status,
            work_status,
            completed_at,
            planned_area_ha,
            operation_materials:operation_materials (
              id,
              product_id,
              material_type,
              unit,
              planned_quantity,
              issued_quantity,
              consumed_quantity,
              returned_quantity,
              actual_rate,
              products:product_id (name,trade_name,normalized_name)
            ),
            operation_lines:operation_lines (
              id,
              field_id,
              planned_area_ha,
              actual_area_ha
            )
          `)
          .eq("company_id", activeCompanyId)
          .eq("archived", false)
          .in("crop_structure_id", selectedCropStructureRowIds)
          .order("date", { ascending: false });

        if (res.error) throw res.error;

        const facts: StructureOperationFact[] = ((res.data || []) as any[]).map((row) => {
          const lineRows = Array.isArray(row.operation_lines) ? row.operation_lines : [];
          const plannedFromLines = lineRows.reduce((sum: number, line: any) => sum + Number(line.planned_area_ha || 0), 0);
          const actualLineValues = lineRows
            .map((line: any) => numberOrNull(line.actual_area_ha))
            .filter((value: number | null): value is number => value != null);
          const actualFromLines = actualLineValues.length
            ? actualLineValues.reduce((sum: number, value: number) => sum + value, 0)
            : null;
          const materials: StructureOperationMaterialFact[] = (Array.isArray(row.operation_materials) ? row.operation_materials : []).map((material: any) => {
            const product = oneRelation(material.products);
            return {
              product_id: material.product_id ? String(material.product_id) : null,
              product_name: brandName(product) || String(product?.name || "Материал"),
              material_type: material.material_type ? String(material.material_type) : null,
              unit: material.unit ? String(material.unit) : null,
              planned_quantity: numberOrNull(material.planned_quantity),
              issued_quantity: Number(material.issued_quantity || 0),
              consumed_quantity: numberOrNull(material.consumed_quantity),
              returned_quantity: numberOrNull(material.returned_quantity),
              actual_rate: numberOrNull(material.actual_rate),
            };
          });

          return {
            id: String(row.id),
            field_id: String(row.field_id || ""),
            crop_structure_row_id: row.crop_structure_id ? String(row.crop_structure_id) : null,
            operation_type: String(row.operation_type || "Операция"),
            operation_type_slug: row.operation_type_slug ? String(row.operation_type_slug) : null,
            operation_category_slug: row.operation_category_slug ? String(row.operation_category_slug) : null,
            date: row.date || null,
            status: row.status ? String(row.status) : null,
            work_status: row.work_status ? String(row.work_status) : null,
            completed_at: row.completed_at || null,
            planned_area_ha: plannedFromLines > 0 ? plannedFromLines : numberOrNull(row.planned_area_ha),
            actual_area_ha: actualFromLines,
            materials,
          };
        });

        const derivedConsumptions: Consumption[] = facts.flatMap((fact) => {
          if (!fact.crop_structure_row_id) return [];
          const area = fact.actual_area_ha ?? fact.planned_area_ha ?? null;
          const operationKey = fact.operation_type_slug || fact.operation_category_slug || fact.operation_type;
          return fact.materials.flatMap((material) => {
            const quantity = material.consumed_quantity ?? (material.issued_quantity > 0 ? material.issued_quantity : null);
            if (!material.product_id || quantity == null || quantity <= 0) return [];
            return [{
              id: `operation-${fact.id}-${material.product_id}`,
              operation_id: fact.id,
              field_id: fact.field_id,
              crop_structure_row_id: fact.crop_structure_row_id,
              operation_type: operationKey,
              material_type: material.material_type,
              unit: material.unit,
              product_id: material.product_id,
              product_name: material.product_name,
              variety_name: null,
              reproduction_name: null,
              batch_class: null,
              quantity_kg: quantity,
              area_ha: area,
              norm_per_ha: material.actual_rate ?? (area && area > 0 ? quantity / area : null),
              consumed_at: fact.completed_at || fact.date,
              ticket_id: fact.id,
              responsible_name: null,
              vehicle_name: null,
              notes: "operation_materials",
            }];
          });
        });

        if (cancelled) return;
        setOperationFacts(facts);
        setOperationConsumptions(derivedConsumptions);
      } catch (error) {
        if (cancelled) return;
        setOperationFacts([]);
        setOperationConsumptions([]);
        toast({
          title: "Ошибка",
          description: error instanceof Error ? error.message : "Не удалось загрузить операции по участкам",
          variant: "destructive",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, seasonId, selectedFieldId, selectedCropStructureRowIds, toast]);

  useEffect(() => {
    if (!activeCompanyId || !seasonId || !selectedFieldId) {
      setLegalLinksByField(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: links, error: linksError } = await supabase
          .from("field_cadastre_links")
          .select("id, field_id, crop_id, area_ha, cadastral_parcel_id, legal_entity_id, owner_legal_entity_id, usage_legal_entity_id, status, allocation_method, source, notes")
          .eq("company_id", activeCompanyId)
          .eq("season_id", seasonId)
          .eq("field_id", selectedFieldId)
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
  }, [activeCompanyId, seasonId, selectedFieldId, cropMap, isGlobalAdmin]);

  const openField = (fieldId: string, tab: "dossier" | "editor" | "legal" = "dossier") => {
    const allowedTab = tab === "editor" && !canEditStructure
      ? "dossier"
      : tab === "legal" && !isGlobalAdmin
        ? "dossier"
        : tab;
    setSelectedFieldId(fieldId);
    setFieldDialogTab(allowedTab);
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
      let merged = { ...old, ...patch };
      if (patch.crop_id && patch.crop_id !== old.crop_id) {
        merged.variety_id = null;
      }
      merged = normalizeCropStructureSeedAttributes(
        merged,
        merged.crop_id ? cropMap.get(merged.crop_id) : null
      );
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

  const requestRemoveRow = (index: number) => {
    const row = draftRows[index];
    if (!row) return;
    const operationsCount = row.id ? operationFactsByAllocation.get(row.id)?.length || 0 : 0;
    const materialsCount = row.id ? consumptionsByAllocation.get(row.id)?.length || 0 : 0;
    if (operationsCount || materialsCount) {
      toast({
        title: "Нельзя удалить участок",
        description: `По этому участку уже есть ${operationsCount} операций и ${materialsCount} строк материалов. Сначала разберите связанные данные.`,
        variant: "destructive",
      });
      return;
    }
    setPendingDeleteIndex(index);
  };

  const confirmRemoveRow = () => {
    if (pendingDeleteIndex == null) return;
    removeRow(pendingDeleteIndex);
    setPendingDeleteIndex(null);
  };

  const fillRemainingArea = (index: number) => {
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
      return prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const otherArea = prev.reduce((sum, item, itemIndex) => (itemIndex === index ? sum : sum + Number(item.area || 0)), 0);
        return { ...row, area: Math.max(0, selectedField.area - otherArea) };
      });
    });
  };

  const save = async () => {
    if (!canEditStructure || !selectedFieldId || !selectedField || !activeCompanyId || !seasonId) return;
    const validation = validateAndNormalizeCropStructureRows({
      rows: draftRows,
      cropsById: cropMap,
      fieldArea: selectedField.area,
      areaEpsilon: EPS,
    });
    if (!validation.ok) {
      toast({ title: "Ошибка", description: validation.message, variant: "destructive" });
      return;
    }
    for (const row of validation.rows) {
      if (isPotatoAllocation(row) && (!row.seed_spacing_cm || row.seed_spacing_cm <= 0)) {
        toast({ title: "Ошибка", description: "Для картофеля укажите межсемянное расстояние в структуре.", variant: "destructive" });
        return;
      }
    }
    try {
      setSaving(true);
      const prev = initialByField.get(selectedFieldId) || [];
      const prevIds = new Set(prev.map((row) => row.id).filter(Boolean) as string[]);
      const curIds = new Set(validation.rows.map((row) => row.id).filter(Boolean) as string[]);
      const delIds = Array.from(prevIds).filter((id) => !curIds.has(id));
      if (delIds.length) {
        const protectedIds = delIds.filter((id) => (operationFactsByAllocation.get(id)?.length || 0) > 0 || (consumptionsByAllocation.get(id)?.length || 0) > 0);
        if (protectedIds.length) {
          toast({
            title: "Нельзя удалить участок",
            description: "У участка уже есть операции или материалы. Сначала разберите связанные данные.",
            variant: "destructive",
          });
          return;
        }
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("User is not authenticated");

      const response = await fetch(`/api/crop-structure/fields/${selectedFieldId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: activeCompanyId,
          seasonId,
          rows: validation.rows,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { rows?: unknown[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to save crop structure");

      const savedRows = (payload.rows || []).map(allocationFromRow);
      setAllocByField((current) => {
        const next = new Map(current);
        next.set(selectedFieldId, savedRows);
        return next;
      });
      setInitialByField((current) => {
        const next = cloneAllocationMap(current);
        next.set(selectedFieldId, savedRows.map((item) => ({ ...item })));
        return next;
      });
      setBootstrappedStructureKey(`${activeCompanyId}:${seasonId}`);
      setDraftRows(savedRows.map((item) => ({ ...item })));
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
        company_id: activeCompanyId,
      })),
    [fields, activeCompanyId]
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
    setSectionChoiceField(null);
    setOperationDialogOpen(true);
  };

  const openWholeFieldOperationPlan = (field: Field, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!FIELD_FIRST_CREATE_ENABLED) return;
    setOperationDefaults({
      field_id: field.id,
      crop_structure_id: null,
      crop_id: null,
      planned_area_ha: Number(field.area || 0),
      operation_params: {
        scope: "whole_field",
      },
      date: new Date().toISOString().slice(0, 10),
      notes: "",
    });
    setOperationSourceLabel(`План по полю: ${field.name} • Всё поле • ${fmtHa(Number(field.area || 0))}`);
    setSelectedFieldId(null);
    setSectionChoiceField(null);
    setOperationDialogOpen(true);
  };

  const openPrimaryOperationPlan = (field: Field, event: React.MouseEvent) => {
    event.stopPropagation();
    const allocations = operationAllocationsForField(field.id);
    if (allocations.length === 1) {
      openOperationPlan(field, allocations[0], event);
      return;
    }
    if (allocations.length > 1) {
      setSectionChoiceField(field);
      return;
    }
    toast({
      title: "Сначала задайте культуру",
      description: "Для операции нужна сохранённая строка посева по полю.",
      variant: "destructive",
    });
    if (canEditStructure) openField(field.id, "editor");
  };

  const handleCreateOperationPlan = async (data: OperationFormData, options?: { idempotencyKey?: string }) => {
    if (!activeCompanyId) {
      const message = "Не выбран контекст компании.";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
      throw new Error(message);
    }
    try {
      const created = await createOperation(activeCompanyId, data, options);
      setOperationDialogOpen(false);
      setOperationDefaults(undefined);
      if ((created as any)?.offline_queued) {
        toast({
          title: "Сохранено оффлайн",
          description: "План добавлен в очередь и отправится автоматически, когда появится интернет.",
        });
        return;
      }
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
    const crops = cropSummaries(rows);
    const visibleCrops = crops.slice(0, 3);
    const hiddenCrops = Math.max(0, crops.length - visibleCrops.length);

    return (
      <Card
        key={field.id}
        className="h-[202px] cursor-pointer overflow-hidden border-slate-200 transition hover:border-emerald-300 hover:shadow-sm"
        onClick={() => openField(field.id)}
      >
        <CardContent className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-2 p-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 truncate text-[20px] font-bold leading-tight text-[#facc15]">
              Поле {field.name}
            </div>
            <div className="shrink-0 rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-100">
              {fmtHa(field.area)}
            </div>
          </div>

          <div className="min-h-0 space-y-1 overflow-hidden">
            {visibleCrops.length ? visibleCrops.map((item) => (
              <div key={`${field.id}-${item.cropId || item.name}`} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-0 text-[12px] leading-[18px] text-slate-100">
                <span className="shrink-0 text-base leading-none">{cropIcon(item.name)}</span>
                <span className="min-w-0 truncate font-medium">{item.name}</span>
                <span className="shrink-0 rounded-md bg-slate-800/80 px-1.5 py-0 text-[10px] font-semibold tabular-nums text-slate-100">{fmtHa(item.area)}</span>
              </div>
            )) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-2 py-3 text-center text-xs text-slate-500">
                Культура не задана
              </div>
            )}
            {hiddenCrops > 0 ? <div className="truncate px-1 text-[12px] font-medium leading-[18px] text-slate-400">+ ещё {hiddenCrops}</div> : null}
          </div>

          <Button
            type="button"
            className="h-8 w-full text-[12px]"
            onClick={(event) => openPrimaryOperationPlan(field, event)}
            disabled={!FIELD_FIRST_CREATE_ENABLED}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />Операция
          </Button>
        </CardContent>
      </Card>
    );
  };

  const renderTableView = () => (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-[220px] px-3 py-2 font-medium">Поле</th>
                <th className="px-3 py-2 font-medium">Культуры</th>
                <th className="w-[130px] px-3 py-2 text-right font-medium">Площадь</th>
                <th className="w-[150px] px-3 py-2 text-right font-medium">Действие</th>
              </tr>
            </thead>
            <tbody>
              {filteredFields.map((field) => {
                const crops = cropSummaries(allocByField.get(field.id) || []);
                const visibleCrops = crops.slice(0, 3);
                const hiddenCrops = Math.max(0, crops.length - visibleCrops.length);
                return (
                  <tr key={field.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => openField(field.id)}>
                    <td className="px-3 py-2 font-semibold text-[#facc15]">Поле {field.name}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {visibleCrops.length ? (
                        <div className="flex min-w-0 flex-wrap gap-2">
                          {visibleCrops.map((item) => (
                            <span key={`${field.id}-table-${item.cropId || item.name}`} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1">
                              <span className="shrink-0">{cropIcon(item.name)}</span>
                              <span className="min-w-0 truncate">{item.name}</span>
                              <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-900">{fmtHa(item.area)}</span>
                            </span>
                          ))}
                          {hiddenCrops > 0 ? <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-slate-500">+ ещё {hiddenCrops}</span> : null}
                        </div>
                      ) : (
                        <span className="text-slate-400">Культура не задана</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{fmtHa(field.area)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        onClick={(event) => openPrimaryOperationPlan(field, event)}
                        disabled={!FIELD_FIRST_CREATE_ENABLED}
                      >
                        Операция
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  const renderMapView = () => (
    <Card>
      <CardContent className="flex min-h-[420px] items-center justify-center p-6">
        <Button type="button" size="lg" onClick={() => { window.location.href = "/fields-map"; }}>
          <MapIcon className="mr-2 h-5 w-5" />Открыть карту полей
        </Button>
      </CardContent>
    </Card>
  );

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

  const operationKindLabel = (operation: StructureOperationFact) => {
    const value = [
      operation.operation_type,
      operation.operation_type_slug,
      operation.operation_category_slug,
    ].filter(Boolean).join(" ").toLowerCase();

    if (value.includes("herbicide") || value.includes("гербиц")) return "Гербицидная";
    if (value.includes("fungicide") || value.includes("фунгиц")) return "Фунгицидная";
    if (value.includes("insecticide") || value.includes("инсектиц")) return "Инсектицидная";
    if (value.includes("desiccation") || value.includes("десика")) return "Десикация";
    if (value.includes("fertigation") || value.includes("фертиг")) return "Фертигация";
    if (value.includes("fertilizer") || value.includes("удобр") || value.includes("разбрасыв")) return "Удобрение";
    if (value.includes("spraying") || value.includes("опрыск") || value.includes("сзр")) return "СЗР";
    if (value.includes("soil") || value.includes("tillage") || value.includes("почво") || value.includes("диск") || value.includes("греб")) return "Почвообработка";
    if (value.includes("planting") || value.includes("seeding") || value.includes("посев") || value.includes("посад")) return "Посев / посадка";
    if (value.includes("harvest") || value.includes("уборк")) return "Уборка";
    return "Операция";
  };

  const operationStatusLabel = (operation: StructureOperationFact) => {
    const value = String(operation.work_status || operation.status || "").toLowerCase();
    if (value === "completed" || value === "done" || operation.completed_at) return "Закрыта";
    if (value === "in_progress") return "В работе";
    if (value === "accepted") return "Принята";
    if (value === "active" || value === "planned") return "Запланирована";
    return value || "Статус не указан";
  };

  const operationStatusClass = (operation: StructureOperationFact) => {
    const label = operationStatusLabel(operation);
    if (label === "Закрыта") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10";
    if (label === "В работе") return "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/10";
    return "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-800";
  };

  const operationAreaLabel = (operation: StructureOperationFact) => {
    const value = operation.actual_area_ha ?? operation.planned_area_ha;
    return value == null ? "площадь не указана" : fmtHa(value);
  };

  const operationMaterialsPreview = (operation: StructureOperationFact) => {
    const actualMaterials = operation.materials.filter((material) => {
      const quantity = material.consumed_quantity ?? material.issued_quantity;
      return quantity != null && quantity > 0;
    });
    if (!actualMaterials.length) return "без фактических материалов";
    const names = actualMaterials.slice(0, 3).map((material) => material.product_name);
    const extra = actualMaterials.length > 3 ? ` + ещё ${actualMaterials.length - 3}` : "";
    return `${names.join(", ")}${extra}`;
  };

  const buildOperationSummary = (operations: StructureOperationFact[]) => {
    const grouped = new Map<string, number>();
    for (const operation of operations) {
      const label = operationKindLabel(operation);
      grouped.set(label, (grouped.get(label) || 0) + 1);
    }
    return Array.from(grouped.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
  };

  const renderFieldDossierLegacy = () => {
    if (!selectedField) return null;
    const rows = draftRows.length ? draftRows : allocByField.get(selectedField.id) || [];
    const planned = sumArea(rows);
    const fieldConsumptions = consumptionsByField.get(selectedField.id) || [];
    return (
      <div className="space-y-3 text-slate-100">
        <div className="rounded-2xl border border-slate-800 bg-[#111827] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Сезонный контур поля</div>
              <div className="mt-1 text-2xl font-semibold text-white">Поле {selectedField.name}</div>
              <div className="mt-1 text-sm text-slate-400">
                Всего {fmtHa(selectedField.area)} · структура {fmtHa(planned)} · сезон {season?.year || "-"} · фактических выдач {fieldConsumptions.length}
              </div>
            </div>
            <Badge className={stateClass(fieldState(selectedField.id))}>{stateText(fieldState(selectedField.id))}</Badge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {rows.length ? rows.map((allocation) => (
              <div key={`dossier-head-${allocation.id || allocation.crop_id}`} className="rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-2 text-sm">
                <div className="truncate font-semibold text-slate-100">{cropName(allocation.crop_id)} / {varietyName(allocation.variety_id)} / {reproductionName(allocation.reproduction_id)}</div>
                <div className="text-xs text-slate-400">{fmtHa(Number(allocation.area || 0))}</div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/55 px-3 py-3 text-sm text-slate-400">Посевные строки ещё не заданы.</div>
            )}
          </div>
        </div>

        {rows.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {rows.map((allocation) => {
              const facts = allocationFacts(allocation);
              const operationsForAllocation = allocation.id ? operationFactsByAllocation.get(allocation.id) || [] : [];
              const operationSummary = buildOperationSummary(operationsForAllocation);
              const plannedArea = Number(allocation.area || 0);
              const field = fieldMap.get(allocation.field_id);
              const actualCompletedArea = facts.stageCompleted.get("seeding") || facts.stageCompleted.get("care") || facts.stageCompleted.get("prep") || 0;
              const rateArea = actualCompletedArea || plannedArea;
              const rateBasis = actualCompletedArea ? "по выполненной площади" : "по площади участка";
              const materialRows = buildSeasonMaterialRows(facts.rows, rateArea);
              const hasMaterials = materialRows.length > 0;

              return (
                <div key={`detail-${allocation.id || allocation.crop_id}`} className="rounded-2xl border border-slate-800 bg-[#111827] p-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-white">{cropName(allocation.crop_id)} / {varietyName(allocation.variety_id)} / {reproductionName(allocation.reproduction_id)}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {fmtHa(plannedArea)} · операций {operationsForAllocation.length} · материалов {facts.rows.length}
                      </div>
                    </div>
                    {FIELD_FIRST_CREATE_ENABLED && field ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 bg-yellow-400 px-3 text-xs font-semibold text-slate-950 hover:bg-yellow-300"
                        onClick={(event) => openOperationPlan(field, allocation, event)}
                      >
                        Запланировать
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-100">Материалы</div>
                          <div className="text-[11px] text-slate-500">Факт: {rateBasis}</div>
                        </div>
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300">{materialRows.length}</span>
                      </div>

                      {hasMaterials ? (
                        <div className="mt-2 max-h-48 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:#334155_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">
                          <table className="w-full text-left text-xs">
                            <tbody>
                              {materialRows.map((item) => (
                                <tr key={`${item.category}-${item.identity}-${item.batchClass}`} className="border-t border-slate-800 first:border-t-0">
                                  <td className="py-2 pr-2">
                                    <div className="font-medium text-slate-100">{item.identity}</div>
                                    <div className="text-[11px] text-slate-500">{item.categoryLabel} · {item.batchClass}</div>
                                  </td>
                                  <td className="py-2 text-right">
                                    <div className="font-semibold text-slate-100">{item.total}</div>
                                    <div className="text-[11px] text-slate-500">{item.perHa}</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="mt-2 rounded-lg border border-dashed border-slate-700 bg-slate-950/60 px-3 py-3 text-xs text-slate-500">
                          Фактических выдач пока нет.
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-100">Операции</div>
                          <div className="text-[11px] text-slate-500">План и факт по участку</div>
                        </div>
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300">{operationsForAllocation.length}</span>
                      </div>

                      {operationSummary.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {operationSummary.slice(0, 4).map((item) => (
                            <span key={item.label} className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                              {item.label}: {item.count}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {operationsForAllocation.length ? (
                        <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:#334155_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">
                          {operationsForAllocation.map((operation) => (
                            <div key={operation.id} className="rounded-lg border border-slate-800 bg-[#0b1220] px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-slate-100">{operation.operation_type}</div>
                                  <div className="mt-0.5 text-[11px] text-slate-500">
                                    {fmtDate(operation.completed_at || operation.date)} · {operationKindLabel(operation)} · {operationAreaLabel(operation)}
                                  </div>
                                </div>
                                <Badge className={operationStatusClass(operation)}>{operationStatusLabel(operation)}</Badge>
                              </div>
                              <div className="mt-1 truncate text-[11px] text-slate-400">{operationMaterialsPreview(operation)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 rounded-lg border border-dashed border-slate-700 bg-slate-950/60 px-3 py-3 text-xs text-slate-500">
                          Операций по этому участку пока нет.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-700 bg-[#111827] p-5 text-sm text-slate-400">Посевные строки ещё не заданы.</div>
        )}
      </div>
    );
  };

  const renderFieldDossier = () => {
    if (!selectedField) return null;
    const rows = draftRows.length ? draftRows : allocByField.get(selectedField.id) || [];
    const planned = sumArea(rows);
    const fieldConsumptions = consumptionsByField.get(selectedField.id) || [];
    const rowItems = rows.map((allocation, index) => {
      const facts = allocationFacts(allocation);
      const operationsForAllocation = allocation.id ? operationFactsByAllocation.get(allocation.id) || [] : [];
      const operationSummary = buildOperationSummary(operationsForAllocation);
      const plannedArea = Number(allocation.area || 0);
      const actualCompletedArea = facts.stageCompleted.get("seeding") || facts.stageCompleted.get("care") || facts.stageCompleted.get("prep") || 0;
      const rateArea = actualCompletedArea || plannedArea;
      const rateBasis = actualCompletedArea ? "по выполненной площади" : "по площади участка";
      const materialRows = buildSeasonMaterialRows(facts.rows, rateArea);
      const title = `${cropName(allocation.crop_id)} / ${varietyName(allocation.variety_id)} / ${reproductionName(allocation.reproduction_id)}`;
      return {
        allocation,
        facts,
        key: allocationKey(allocation, index),
        materialRows,
        operationSummary,
        operationsForAllocation,
        plannedArea,
        rateBasis,
        title,
      };
    });
    const selectedItem = rowItems.find((item) => item.key === selectedDossierAllocationKey) || rowItems[0] || null;
    const selectedItemField = selectedItem ? fieldMap.get(selectedItem.allocation.field_id) || selectedField : selectedField;
    const totalOperations = rowItems.reduce((sum, item) => sum + item.operationsForAllocation.length, 0);
    const totalMaterials = rowItems.reduce((sum, item) => sum + item.materialRows.length, 0);

    return (
      <div className="space-y-3 text-slate-100">
        <div className="rounded-2xl border border-slate-800 bg-[#111827] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Сезонный контур поля</div>
              <div className="mt-1 text-2xl font-semibold text-white">Поле {selectedField.name}</div>
              <div className="mt-1 text-sm text-slate-400">
                Всего {fmtHa(selectedField.area)} · структура {fmtHa(planned)} · сезон {season?.year || "-"} · фактических выдач {fieldConsumptions.length}
              </div>
            </div>
            <Badge className={stateClass(fieldState(selectedField.id))}>{stateText(fieldState(selectedField.id))}</Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Участков</div>
              <div className="mt-1 text-lg font-semibold text-white">{rows.length}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Операций</div>
              <div className="mt-1 text-lg font-semibold text-white">{totalOperations}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Материалов</div>
              <div className="mt-1 text-lg font-semibold text-white">{totalMaterials}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Площадь</div>
              <div className="mt-1 text-lg font-semibold text-white">{fmtHa(planned)}</div>
            </div>
          </div>
        </div>

        {selectedItem ? (
          <div className="grid gap-3 lg:h-[600px] lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#111827]">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-white">Участки</div>
                  <div className="text-xs text-slate-500">Выберите объект операции</div>
                </div>
                <Badge className="border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-900">{rowItems.length}</Badge>
              </div>
              <div className="min-h-0 overflow-y-auto p-2 [scrollbar-width:thin] [scrollbar-color:#334155_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">
                {rowItems.map((item) => {
                  const isSelected = item.key === selectedItem.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`mb-2 flex h-[72px] w-full items-center justify-between gap-3 rounded-xl border px-3 text-left transition ${
                        isSelected
                          ? "border-yellow-400/70 bg-yellow-400/10 shadow-[inset_3px_0_0_rgba(250,204,21,1)]"
                          : "border-slate-800 bg-slate-950/45 hover:border-slate-600"
                      }`}
                      onClick={() => {
                        setSelectedDossierAllocationKey(item.key);
                        setDossierDetailTab("overview");
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-100">{item.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{fmtHa(item.plannedArea)}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300">{item.operationsForAllocation.length} оп.</span>
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300">{item.materialRows.length} мат.</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#111827]">
              <div className="border-b border-slate-800 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold text-white">{selectedItem.title}</div>
                    <div className="mt-1 text-sm text-slate-400">
                      {fmtHa(selectedItem.plannedArea)} · операций {selectedItem.operationsForAllocation.length} · материалов {selectedItem.materialRows.length}
                    </div>
                  </div>
                  {FIELD_FIRST_CREATE_ENABLED && selectedItemField ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 bg-yellow-400 px-4 text-sm font-semibold text-slate-950 hover:bg-yellow-300"
                      onClick={(event) => openOperationPlan(selectedItemField, selectedItem.allocation, event)}
                    >
                      Запланировать
                    </Button>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    { key: "overview", label: "Обзор" },
                    { key: "operations", label: "Операции" },
                    { key: "materials", label: "Материалы" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        dossierDetailTab === tab.key
                          ? "border-yellow-400 bg-yellow-400 text-slate-950"
                          : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500"
                      }`}
                      onClick={() => setDossierDetailTab(tab.key as "overview" | "operations" | "materials")}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:thin] [scrollbar-color:#334155_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">
                {dossierDetailTab === "overview" ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Площадь участка</div>
                        <div className="mt-2 text-xl font-semibold text-white">{fmtHa(selectedItem.plannedArea)}</div>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Операций</div>
                        <div className="mt-2 text-xl font-semibold text-white">{selectedItem.operationsForAllocation.length}</div>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Материалов</div>
                        <div className="mt-2 text-xl font-semibold text-white">{selectedItem.materialRows.length}</div>
                      </div>
                    </div>

                    {selectedItem.operationSummary.length ? (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                        <div className="text-sm font-semibold text-slate-100">Сводка операций</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedItem.operationSummary.map((item) => (
                            <span key={item.label} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
                              {item.label}: {item.count}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/45 p-4 text-sm text-slate-500">
                        По участку пока нет операций.
                      </div>
                    )}

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                        <div className="text-sm font-semibold text-slate-100">Последние операции</div>
                        <div className="mt-3 space-y-2">
                          {selectedItem.operationsForAllocation.slice(0, 4).map((operation) => (
                            <div key={operation.id} className="rounded-lg border border-slate-800 bg-[#0b1220] px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-slate-100">{operation.operation_type}</div>
                                  <div className="mt-0.5 text-[11px] text-slate-500">
                                    {fmtDate(operation.completed_at || operation.date)} · {operationKindLabel(operation)} · {operationAreaLabel(operation)}
                                  </div>
                                </div>
                                <Badge className={operationStatusClass(operation)}>{operationStatusLabel(operation)}</Badge>
                              </div>
                              <div className="mt-1 truncate text-[11px] text-slate-400">{operationMaterialsPreview(operation)}</div>
                            </div>
                          ))}
                          {!selectedItem.operationsForAllocation.length ? <div className="text-xs text-slate-500">Операций нет.</div> : null}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">
                        <div className="text-sm font-semibold text-slate-100">Основные материалы</div>
                        <div className="mt-3 space-y-2">
                          {selectedItem.materialRows.slice(0, 4).map((item) => (
                            <div key={`${item.category}-${item.identity}-${item.batchClass}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0b1220] px-3 py-2 text-xs">
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-100">{item.identity}</div>
                                <div className="text-[11px] text-slate-500">{item.categoryLabel}</div>
                              </div>
                              <div className="shrink-0 text-right font-semibold text-slate-100">{item.total}</div>
                            </div>
                          ))}
                          {!selectedItem.materialRows.length ? <div className="text-xs text-slate-500">Материалов нет.</div> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {dossierDetailTab === "operations" ? (
                  <div className="overflow-hidden rounded-xl border border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/70 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Дата</th>
                          <th className="px-3 py-2 font-medium">Тип</th>
                          <th className="px-3 py-2 font-medium">Работа</th>
                          <th className="px-3 py-2 text-right font-medium">Площадь</th>
                          <th className="px-3 py-2 text-right font-medium">Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedItem.operationsForAllocation.map((operation) => (
                          <tr key={operation.id} className="border-t border-slate-800">
                            <td className="px-3 py-2 text-slate-400">{fmtDate(operation.completed_at || operation.date)}</td>
                            <td className="px-3 py-2 text-slate-300">{operationKindLabel(operation)}</td>
                            <td className="px-3 py-2 font-medium text-slate-100">{operation.operation_type}</td>
                            <td className="px-3 py-2 text-right text-slate-300">{operationAreaLabel(operation)}</td>
                            <td className="px-3 py-2 text-right"><Badge className={operationStatusClass(operation)}>{operationStatusLabel(operation)}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!selectedItem.operationsForAllocation.length ? (
                      <div className="border-t border-slate-800 px-4 py-8 text-center text-sm text-slate-500">Операций по этому участку пока нет.</div>
                    ) : null}
                  </div>
                ) : null}

                {dossierDetailTab === "materials" ? (
                  <div className="space-y-3">
                    <div className="text-xs text-slate-500">Расчёт факта: {selectedItem.rateBasis}</div>
                    <div className="overflow-hidden rounded-xl border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950/70 text-[11px] uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-medium">Группа</th>
                            <th className="px-3 py-2 font-medium">Материал</th>
                            <th className="px-3 py-2 font-medium">Партия/класс</th>
                            <th className="px-3 py-2 text-right font-medium">Итого</th>
                            <th className="px-3 py-2 text-right font-medium">На га</th>
                            <th className="px-3 py-2 font-medium">Дата</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedItem.materialRows.map((item) => (
                            <tr key={`${item.category}-${item.identity}-${item.batchClass}`} className="border-t border-slate-800">
                              <td className="px-3 py-2 text-slate-400">{item.categoryLabel}</td>
                              <td className="px-3 py-2 font-medium text-slate-100">{item.identity}</td>
                              <td className="px-3 py-2 text-slate-500">{item.batchClass}</td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-100">{item.total}</td>
                              <td className="px-3 py-2 text-right text-slate-300">{item.perHa}</td>
                              <td className="px-3 py-2 text-slate-500">{item.date}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!selectedItem.materialRows.length ? (
                        <div className="border-t border-slate-800 px-4 py-8 text-center text-sm text-slate-500">Фактических выдач по этому участку пока нет.</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-700 bg-[#111827] p-5 text-sm text-slate-400">Посевные строки ещё не заданы.</div>
        )}
      </div>
    );
  };

  const renderEditor = () => {
    if (!selectedField) return null;
    const editorLabelClass = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400";
    const editorControlClass =
      "h-10 border-slate-700 bg-[#0f1622] text-slate-100 shadow-inner shadow-black/20 placeholder:text-slate-500 focus-visible:border-yellow-400 focus-visible:ring-2 focus-visible:ring-yellow-400/50 focus-visible:ring-offset-0";
    const editorSelectContentClass = "border-slate-700 bg-[#101720] text-slate-100 shadow-xl";

    return (
      <div className="text-slate-100">
        <div className="mb-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Редактор структуры</div>
            <div className="mt-1 text-xs text-slate-400">План: {fmtHa(sumArea(draftRows))} / {fmtHa(selectedField.area)} · Остаток: {fmtHa(selectedField.area - sumArea(draftRows))}</div>
          </div>
        </div>

        <div className="space-y-3">
          {draftRows.map((row, index) => {
            const rowCropId = displayCropId(row.crop_id);
            const vars = rowCropId ? varietiesByCrop.get(rowCropId) || [] : [];
            const pct = selectedField.area > 0 ? ((Number(row.area || 0) / selectedField.area) * 100).toFixed(2) : "0.00";
            const operationsCount = row.id ? operationFactsByAllocation.get(row.id)?.length || 0 : 0;
            const materialsCount = row.id ? consumptionsByAllocation.get(row.id)?.length || 0 : 0;
            const isDeleteLocked = operationsCount > 0 || materialsCount > 0;
            const isFallowRow = isFallowAllocation(row);
            return (
              <div key={`${row.id || "new"}-${index}`} className="overflow-hidden rounded-xl border border-slate-700/80 bg-[#101823] shadow-sm ring-1 ring-slate-900/40">
                <div className="flex items-center justify-between border-b border-slate-700/70 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500 text-[11px] font-bold text-slate-950">{index + 1}</span>
                    <span className="text-xs font-semibold text-slate-200">Участок структуры</span>
                  </div>
                  <span className="text-xs text-slate-400">{fmtHa(Number(row.area || 0))}</span>
                </div>
                <div className="grid grid-cols-12 items-end gap-2 p-3">
                <div className={isFallowRow ? "col-span-12 md:col-span-7" : "col-span-12 md:col-span-3"}>
                  <Label className={editorLabelClass}>Культура *</Label>
                  <Select value={rowCropId || "none"} onValueChange={(value) => patchDraft(index, { crop_id: value === "none" ? null : value })}>
                    <SelectTrigger className={editorControlClass}><SelectValue placeholder="Выберите культуру" /></SelectTrigger>
                    <SelectContent className={editorSelectContentClass}><SelectItem value="none">—</SelectItem>{cropSelectOptions(rowCropId).map((crop) => <SelectItem key={crop.id} value={crop.id}>{cropLabel(crop)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {!isFallowRow ? (
                  <>
                    <div className="col-span-12 md:col-span-2">
                      <Label className={editorLabelClass}>Сорт *</Label>
                      <Select value={row.variety_id || "none"} onValueChange={(value) => patchDraft(index, { variety_id: value === "none" ? null : value })}>
                        <SelectTrigger className={editorControlClass}><SelectValue placeholder="Выберите сорт" /></SelectTrigger>
                        <SelectContent className={editorSelectContentClass}><SelectItem value="none">—</SelectItem>{vars.map((variety) => <SelectItem key={variety.id} value={variety.id}>{variety.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 md:col-span-2">
                      <Label className={editorLabelClass}>Репродукция *</Label>
                      <Select value={row.reproduction_id || "none"} onValueChange={(value) => patchDraft(index, { reproduction_id: value === "none" ? null : value })}>
                        <SelectTrigger className={editorControlClass}><SelectValue placeholder="Репродукция" /></SelectTrigger>
                        <SelectContent className={editorSelectContentClass}><SelectItem value="none">—</SelectItem>{globalReproductions.map((item) => <SelectItem key={item.id} value={item.id}>{standardReproductionLabel(item)}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </>
                ) : null}
                <div className="col-span-7 md:col-span-3">
                  <Label className={editorLabelClass}>Площадь, га *</Label>
                  <div className="flex gap-1.5">
                    <Input className={editorControlClass} type="number" min={0} step="0.01" value={row.area == null ? "" : String(row.area)} onChange={(event) => patchDraft(index, { area: parseNum(event.target.value) })} placeholder="га" />
                    <Button
                      type="button"
                      title="Заполнить остатком площади"
                      aria-label="Заполнить остатком площади"
                      className="h-10 w-10 shrink-0 border border-slate-700 bg-[#0b1220] p-0 text-slate-400 hover:border-yellow-500/50 hover:bg-[#172033] hover:text-yellow-300"
                      variant="outline"
                      onClick={() => fillRemainingArea(index)}
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="col-span-3 md:col-span-1">
                  <Label className={editorLabelClass}>%</Label>
                  <div className="flex h-10 items-center rounded-md border border-slate-700 bg-[#0b1220] px-3 text-sm font-semibold text-slate-200 shadow-inner shadow-black/20">{pct}</div>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <Label className={editorLabelClass}>Удалить</Label>
                  <Button
                    className="h-10 w-10 border border-transparent text-slate-400 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                    variant="ghost"
                    size="icon"
                    title={isDeleteLocked ? "Нельзя удалить: есть операции или материалы" : "Удалить участок"}
                    onClick={() => requestRemoveRow(index)}
                    disabled={isDeleteLocked}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className={`col-span-12 grid grid-cols-1 gap-2 border-t border-slate-700/70 pt-3 ${isFallowRow ? "" : "md:grid-cols-3"}`}>
                  <div>
                    <Label className={editorLabelClass}>Орошение</Label>
                    <Select
                      value={normalizeIrrigationType(row.irrigation_type)}
                      onValueChange={(value) => patchDraft(index, { irrigation_type: normalizeIrrigationType(value) })}
                    >
                      <SelectTrigger className={editorControlClass}><SelectValue /></SelectTrigger>
                      <SelectContent className={editorSelectContentClass}>
                        <SelectItem value="unknown">Не указано</SelectItem>
                        <SelectItem value="drip">Капельное</SelectItem>
                        <SelectItem value="sprinkler">Дождевание</SelectItem>
                        <SelectItem value="dryland">Богара</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {!isFallowRow ? (
                    <>
                      <div>
                        <Label className={editorLabelClass}>Междурядье, м</Label>
                        <Input
                          className={editorControlClass}
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.row_spacing_m == null ? "" : String(row.row_spacing_m)}
                          onChange={(event) => patchDraft(index, { row_spacing_m: parseNum(event.target.value) })}
                          placeholder={isPotatoAllocation(row) ? "0.75" : "м"}
                        />
                      </div>
                      <div>
                        <Label className={editorLabelClass}>Межсемянное расстояние, см</Label>
                        <Input
                          className={editorControlClass}
                          type="number"
                          min={0}
                          step="0.1"
                          value={row.seed_spacing_cm == null ? "" : String(row.seed_spacing_cm)}
                          onChange={(event) => patchDraft(index, { seed_spacing_cm: parseNum(event.target.value) })}
                          placeholder={isPotatoAllocation(row) ? "32" : "см"}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="border-slate-700 bg-[#0b1220] text-slate-100 hover:border-yellow-500/50 hover:bg-[#172033] hover:text-white" variant="outline" onClick={addRow}><Plus className="mr-2 h-4 w-4" />Добавить строку</Button>
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

  const hasFields = fields.length > 0;
  const sectionChoiceRows = sectionChoiceField ? operationAllocationsForField(sectionChoiceField.id) : [];
  const pendingDeleteRow = pendingDeleteIndex == null ? null : draftRows[pendingDeleteIndex] || null;

  return (
    <div className="space-y-4">
      <PageHeader title="Структура посевов" description="Компактный агрономический обзор по полям" />

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={seasonId} onValueChange={setSeasonId}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Сезон" /></SelectTrigger>
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
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canEditStructure && fields.length ? (
                <Button
                  type="button"
                  onClick={() => openField((fields.find((field) => fieldState(field.id) === "empty") || fields[0]).id, "editor")}
                >
                  <Plus className="mr-2 h-4 w-4" />Добавить карточку
                </Button>
              ) : null}
              <div className="flex rounded-md border border-slate-200 bg-white p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === "cards" ? "default" : "ghost"}
                  className="h-8 px-3"
                  onClick={() => changeViewMode("cards")}
                >
                  <LayoutGrid className="mr-1.5 h-4 w-4" />Карточки
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === "table" ? "default" : "ghost"}
                  className="h-8 px-3"
                  onClick={() => changeViewMode("table")}
                >
                  <Table2 className="mr-1.5 h-4 w-4" />Таблица
                </Button>
                {isGlobalAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={viewMode === "map" ? "default" : "ghost"}
                    className="h-8 px-3"
                    onClick={() => changeViewMode("map")}
                  >
                    <MapIcon className="mr-1.5 h-4 w-4" />Карта
                  </Button>
                ) : null}
              </div>
              <Button variant="outline" onClick={exportExcel}><Download className="mr-2 h-4 w-4" />Excel</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loadError ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-lg font-semibold text-slate-900">Не удалось загрузить структуру посевов</div>
            <div className="mt-2 text-sm text-slate-500">{loadError}</div>
          </CardContent>
        </Card>
      ) : null}

      {!loadError && !hasFields ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-lg font-semibold text-slate-900">Поля не найдены</div>
            <div className="mt-2 text-sm text-slate-500">
              Создайте поля или импортируйте структуру посевов, чтобы заполнить сезон {season?.year || "2026"}.
            </div>
            {isGlobalAdmin ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button type="button" onClick={() => { window.location.href = "/import"; }}>
                  <Plus className="mr-2 h-4 w-4" />Импортировать структуру
                </Button>
                <Button type="button" variant="outline" onClick={() => { window.location.href = "/fields-map"; }}>
                  <MapIcon className="mr-2 h-4 w-4" />Открыть карту полей
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!loadError && hasFields && viewMode === "cards" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {filteredFields.map(renderOverviewCard)}
        </div>
      ) : null}
      {!loadError && hasFields && viewMode === "table" ? renderTableView() : null}
      {!loadError && hasFields && viewMode === "map" && isGlobalAdmin ? renderMapView() : null}
      {!loadError && hasFields && !filteredFields.length ? (
        <Card><CardContent className="p-8 text-center text-sm text-slate-500">По заданным фильтрам поля не найдены.</CardContent></Card>
      ) : null}

      <Dialog open={Boolean(selectedFieldId)} onOpenChange={(open) => !open && closeField()}>
        <DialogContent className="max-h-[92vh] w-[94vw] max-w-none overflow-y-auto border-slate-800 bg-[#0b1017] text-slate-100 shadow-2xl shadow-black/50 sm:max-w-[1180px] [scrollbar-width:thin] [scrollbar-color:#334155_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700/80 [&::-webkit-scrollbar-track]:bg-transparent">
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
              {canEditStructure ? (
                <Button variant={fieldDialogTab === "editor" ? "default" : "outline"} size="sm" onClick={() => setFieldDialogTab("editor")}>
                  Редактор структуры
                </Button>
              ) : null}
              {isGlobalAdmin ? (
                <Button variant={fieldDialogTab === "legal" ? "default" : "outline"} size="sm" onClick={() => setFieldDialogTab("legal")}>
                  Юридический контур
                </Button>
              ) : null}
            </div>
            {fieldDialogTab === "dossier" ? renderFieldDossier() : null}
            {fieldDialogTab === "editor" ? renderEditor() : null}
            {fieldDialogTab === "legal" ? renderLegalContour() : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeField}>Закрыть</Button>
            {canEditStructure && fieldDialogTab === "editor" ? (
              <Button onClick={save} disabled={saving}>
                <Edit3 className="mr-2 h-4 w-4" />{saving ? "Сохранение..." : "Сохранить"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDeleteIndex !== null} onOpenChange={(open) => !open && setPendingDeleteIndex(null)}>
        <DialogContent className="max-w-md border-slate-800 bg-[#0b1017] text-slate-100 shadow-2xl shadow-black/50">
          <DialogHeader>
            <DialogTitle>Удалить участок структуры?</DialogTitle>
            <DialogDescription className="text-slate-400">
              {pendingDeleteRow
                ? `Будет удалена строка на ${fmtHa(Number(pendingDeleteRow.area || 0))}. Это действие применится после сохранения структуры.`
                : "Будет удалена выбранная строка структуры после сохранения."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Если у участка уже есть операции, материалы или история, удаление заблокируется.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteIndex(null)}>Отмена</Button>
            <Button className="bg-rose-600 text-white hover:bg-rose-500" onClick={confirmRemoveRow}>
              Удалить участок
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(sectionChoiceField)} onOpenChange={(open) => !open && setSectionChoiceField(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Что обрабатываем?</DialogTitle>
            <DialogDescription>
              {sectionChoiceField
                ? `Поле ${sectionChoiceField.name} содержит несколько участков. Выберите конкретный участок или всё поле.`
                : "Выберите участок для операции."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {sectionChoiceRows.map((allocation) => (
              <button
                key={allocation.id}
                type="button"
                className="w-full rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-left text-sm text-slate-100 transition hover:border-yellow-400"
                onClick={(event) => sectionChoiceField && openOperationPlan(sectionChoiceField, allocation, event)}
              >
                <div className="font-semibold">{allocationTitle(allocation)}</div>
                <div className="mt-1 text-xs text-slate-400">
                  Операция будет привязана к этому участку структуры.
                </div>
              </button>
            ))}
            {sectionChoiceField ? (
              <button
                type="button"
                className="w-full rounded-lg border border-dashed border-slate-600 bg-slate-950 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-yellow-400"
                onClick={(event) => openWholeFieldOperationPlan(sectionChoiceField, event)}
              >
                <div className="font-semibold">Всё поле — {fmtHa(Number(sectionChoiceField.area || 0))}</div>
                <div className="mt-1 text-xs text-slate-400">
                  Только для уборки, логистики, сервиса и послеуборочных работ.
                </div>
              </button>
            ) : null}
          </div>
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
        lockedContext={Boolean(operationDefaults?.crop_structure_id || operationDefaults?.operation_params?.scope === "whole_field")}
        sourceLabel={operationSourceLabel}
        fields={operationDialogFields as any}
        cropStructures={operationDialogCropStructures}
        specialists={specialists}
      />
    </div>
  );
}
