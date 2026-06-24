"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Leaf,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Sprout,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  buildProductDisplayLabel,
  buildProductSearchText,
  dedupeProductsForSelect,
  normalizeCatalogName,
} from "@/lib/catalog/catalog-identity";
import { calculateTankMix, normalizeMixUnit } from "@/lib/materials/mix-calculations";
import { cn } from "@/lib/utils";

type SchemeStatus = "draft" | "active" | "paused" | "completed" | "archived";
type SchemeType = "protection" | "nutrition" | "fertigation" | "combined" | "other";
type RateBasis = "per_ha" | "per_t_solution" | "per_1000_l_solution" | "per_l_water";
type TargetType = "disease" | "pest" | "weed" | "nutrition" | "stress" | "general";

type Season = {
  id: string;
  year: number;
  name: string | null;
};

type Crop = {
  id: string;
  name: string;
};

type Variety = {
  id: string;
  crop_id: string;
  name: string;
};

type Product = {
  id: string;
  name: string;
  trade_name: string | null;
  normalized_name: string | null;
  company_id: string | null;
  manufacturer: string | null;
  product_type: string | null;
  category: string | null;
  subcategory: string | null;
  unit: string | null;
  base_uom: string | null;
  default_unit: string | null;
  application_unit: string | null;
  default_dosing_type: string | null;
};

type ResponsibleUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type StructureSection = {
  crop_structure_id: string;
  field_id: string;
  field_name: string;
  crop_name: string;
  variety_name: string;
  reproduction_name: string;
  area_ha: number;
  irrigation_type: string | null;
};

type SchemeField = StructureSection & {
  id: string;
  included: boolean;
  notes: string | null;
};

type SchemeMaterial = {
  id: string;
  product_id: string;
  product_name: string;
  product_type: string | null;
  rate: number;
  rate_unit: string;
  rate_basis: RateBasis;
  water_rate_l_ha: number | null;
  total_solution_l_ha: number | null;
  planned_quantity: number | null;
  planned_unit: string | null;
  target_type: TargetType;
  target_id: string | null;
  notes: string | null;
};

type SchemeStep = {
  id: string;
  step_no: number;
  title: string;
  phenological_phase: string | null;
  planned_date: string | null;
  window_start_date: string | null;
  window_end_date: string | null;
  operation_type: string;
  responsible_user_id: string | null;
  lead_time_days: number;
  status: string;
  notes: string | null;
  materials: SchemeMaterial[];
  generated_operation_id: string | null;
  generated_operation_status: string | null;
};

type Scheme = {
  id: string;
  season_id: string;
  crop_id: string;
  variety_id: string | null;
  name: string;
  scheme_type: SchemeType;
  description: string | null;
  status: SchemeStatus;
  revision_no: number;
  total_area_ha: number;
  field_count: number;
  included_field_count: number;
  progress_percent: number;
  crop_name: string;
  variety_name: string;
  fields: SchemeField[];
  steps: SchemeStep[];
};

type Bootstrap = {
  season: Season | null;
  read_only: boolean;
  read_only_reason: string | null;
  crops: Crop[];
  varieties: Variety[];
  products: Product[];
  responsible_users: ResponsibleUser[];
  schemes: Scheme[];
};

type MaterialDraft = {
  product_id: string;
  rate: string;
  rate_unit: "kg" | "l" | "g" | "ml" | "pcs";
  rate_basis: RateBasis;
  water_rate_l_ha: string;
  total_solution_l_ha: string;
  target_type: TargetType;
  notes: string;
};

const SCHEME_TYPE_LABELS: Record<SchemeType, string> = {
  protection: "Защита",
  nutrition: "Питание",
  fertigation: "Фертигация",
  combined: "Комбинированная",
  other: "Другая",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  active: "Активна",
  paused: "Пауза",
  completed: "Завершена",
  planned: "Запланирован",
  pending: "Ожидает",
  generated: "Операция создана",
  in_progress: "В работе",
  skipped: "Пропущен",
  cancelled: "Отменён",
};

const RATE_BASIS_LABELS: Record<RateBasis, string> = {
  per_ha: "на гектар",
  per_1000_l_solution: "на 1000 л раствора",
  per_l_water: "на литр воды",
  per_t_solution: "на тонну раствора",
};

const VISIBLE_RATE_BASIS: RateBasis[] = ["per_ha", "per_1000_l_solution", "per_l_water"];
const UNIT_LABELS: Record<MaterialDraft["rate_unit"], string> = {
  l: "л",
  ml: "мл",
  kg: "кг",
  g: "г",
  pcs: "шт",
};

const TARGET_TYPE_LABELS: Record<TargetType, string> = {
  disease: "Болезнь",
  pest: "Вредитель",
  weed: "Сорняк",
  nutrition: "Питание",
  stress: "Стресс",
  general: "Общее",
};

const OPERATION_TYPE_OPTIONS = [
  { value: "spraying", label: "Опрыскивание" },
  { value: "fertilizing", label: "Внесение удобрений" },
  { value: "fertigation", label: "Фертигация" },
  { value: "irrigation", label: "Полив" },
];

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[#1F2937]">
      <div
        className="h-full rounded-full bg-[#E0B100] transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

const EMPTY_MATERIAL: MaterialDraft = {
  product_id: "",
  rate: "",
  rate_unit: "l",
  rate_basis: "per_ha",
  water_rate_l_ha: "",
  total_solution_l_ha: "",
  target_type: "general",
  notes: "",
};

function numeric(value: unknown): number {
  const next = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(next) ? next : 0;
}

function formatHa(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`;
}

function formatQuantity(value: number | null | undefined, unit?: string | null) {
  if (value === null || value === undefined) return "не рассчитано";
  const normalizedUnit = unit ? normalizeMixUnit(unit) : null;
  return `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${normalizedUnit ? UNIT_LABELS[normalizedUnit] : unit || ""}`.trim();
}

function normalizeOptionName(value: string | null | undefined) {
  return normalizeCatalogName(value);
}

function dedupeByKey<T>(items: T[], key: (item: T) => string, prefer?: (current: T, candidate: T) => T) {
  const map = new Map<string, T>();
  for (const item of items) {
    const nextKey = key(item);
    if (!nextKey) continue;
    const current = map.get(nextKey);
    map.set(nextKey, current && prefer ? prefer(current, item) : current || item);
  }
  return Array.from(map.values());
}

function productHint(product: Product) {
  return [product.product_type || product.category, product.application_unit || product.unit, product.company_id ? "товар компании" : "общий каталог"]
    .filter(Boolean)
    .join(" • ");
}

function unitFromRateUnit(value: string | null | undefined): MaterialDraft["rate_unit"] | null {
  const source = String(value || "").toLowerCase();
  if (!source || source === "unknown") return null;
  if (source.includes("мл") || /\bml\b/.test(source)) return "ml";
  if (source.includes("г") || /\bg\b/.test(source)) return "g";
  if (source.includes("л") || /\bl\b/.test(source)) return "l";
  if (source.includes("кг") || /\bkg\b/.test(source)) return "kg";
  return null;
}

function basisFromRateUnit(value: string | null | undefined): RateBasis | null {
  const source = String(value || "").toLowerCase();
  if (!source || source === "unknown") return null;
  if (source.includes("/1000") || source.includes("1000 л") || source.includes("1000l")) return "per_1000_l_solution";
  if (source.includes("/л") || source.includes("/ l") || source.includes("/l")) return "per_l_water";
  if (source.includes("/га") || source.includes("/ha")) return "per_ha";
  return null;
}

function materialDefaults(product: Product | undefined) {
  const applicationUnit = product?.application_unit || product?.default_unit || product?.unit || product?.base_uom;
  const unit = unitFromRateUnit(applicationUnit) || unitFromRateUnit(product?.unit) || "l";
  const rateBasis = basisFromRateUnit(product?.application_unit) || "per_ha";
  return { unit, rateBasis };
}

function calculatePreview(material: MaterialDraft, totalArea: number, solutionRateLHa: number | null) {
  const mix = calculateTankMix({
    areaHa: totalArea,
    solutionRateLHa,
    materials: [
      {
        productId: material.product_id,
        rate: numeric(material.rate),
        rateUnit: material.rate_unit,
        rateBasis: material.rate_basis,
      },
    ],
  });
  const first = mix.materials[0];
  return { value: first?.plannedQuantity ?? null, unit: first?.plannedUnit ?? material.rate_unit, error: first?.error || null };
}

type SearchOption = {
  id: string;
  label: string;
  hint?: string;
  search?: string;
};

function SearchableSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const { value, onChange, options, placeholder, emptyLabel = "Ничего не найдено", disabled } = props;
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between"
        >
          <span className="truncate text-left">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Поиск..." />
          <CommandList className="max-h-72 overflow-y-auto overscroll-contain">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.label} ${option.hint || ""} ${option.search || ""}`}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", option.id === value ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0">
                    <div className="truncate">{option.label}</div>
                    {option.hint ? <div className="truncate text-xs text-[#9CA3AF]">{option.hint}</div> : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function CareSystemsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedSchemeId, setSelectedSchemeId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [sections, setSections] = useState<StructureSection[]>([]);
  const [includedSectionIds, setIncludedSectionIds] = useState<Set<string>>(new Set());
  const [newScheme, setNewScheme] = useState({
    name: "",
    crop_id: "",
    variety_id: "none",
    scheme_type: "combined" as SchemeType,
    description: "",
  });
  const [newStep, setNewStep] = useState({
    title: "",
    phenological_phase: "",
    planned_date: "",
    window_start_date: "",
    window_end_date: "",
    operation_type: "spraying",
    responsible_user_id: "none",
    lead_time_days: "0",
    solution_rate_l_ha: "",
    notes: "",
  });
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [sectionSearch, setSectionSearch] = useState("");
  const [schemeFieldSearch, setSchemeFieldSearch] = useState("");

  const selectedScheme = useMemo(
    () => data?.schemes.find((scheme) => scheme.id === selectedSchemeId) || data?.schemes[0] || null,
    [data?.schemes, selectedSchemeId]
  );

  const cropsForCreate = useMemo(
    () => dedupeByKey(data?.crops || [], (crop) => normalizeOptionName(crop.name)),
    [data?.crops]
  );

  const varietiesForCreate = useMemo(
    () =>
      dedupeByKey(
        (data?.varieties || []).filter((variety) => variety.crop_id === newScheme.crop_id),
        (variety) => `${variety.crop_id}|${normalizeOptionName(variety.name)}`
      ),
    [data?.varieties, newScheme.crop_id]
  );

  const activeProducts = useMemo(() => {
    const source = data?.products || [];
    const filtered = source.filter((product) => {
      const haystack = `${product.product_type || ""} ${product.category || ""} ${product.subcategory || ""}`.toLowerCase();
      return haystack.includes("pesticide") || haystack.includes("fertilizer") || haystack.includes("additive") || haystack.includes("adjuvant");
    });
    return dedupeProductsForSelect(filtered);
  }, [data?.products]);

  const cropOptions = useMemo(
    () => cropsForCreate.map((crop) => ({ id: crop.id, label: crop.name })),
    [cropsForCreate]
  );
  const varietyOptions = useMemo(
    () => [
      { id: "none", label: "Все сорта культуры" },
      ...varietiesForCreate.map((variety) => ({ id: variety.id, label: variety.name })),
    ],
    [varietiesForCreate]
  );
  const productOptions = useMemo(
    () =>
      activeProducts.map((product) => ({
        id: product.id,
        label: buildProductDisplayLabel(product),
        hint: productHint(product),
        search: buildProductSearchText(product),
      })),
    [activeProducts]
  );
  const responsibleOptions = useMemo(
    () => [
      { id: "none", label: "Выберите ответственного" },
      ...dedupeByKey(data?.responsible_users || [], (user) => user.id).map((user) => ({
        id: user.id,
        label: user.name,
        hint: user.role,
        search: user.email,
      })),
    ],
    [data?.responsible_users]
  );
  const filteredSections = useMemo(() => {
    const query = normalizeOptionName(sectionSearch);
    return dedupeByKey(sections, (section) => section.crop_structure_id).filter((section) => {
      if (!query) return true;
      return normalizeOptionName(`${section.field_name} ${section.crop_name} ${section.variety_name} ${section.reproduction_name}`).includes(query);
    });
  }, [sectionSearch, sections]);
  const filteredSchemeFields = useMemo(() => {
    const query = normalizeOptionName(schemeFieldSearch);
    const fields = selectedScheme?.fields || [];
    if (!query) return fields;
    return fields.filter((field) => normalizeOptionName(`${field.field_name} ${field.crop_name} ${field.variety_name} ${field.reproduction_name}`).includes(query));
  }, [schemeFieldSearch, selectedScheme?.fields]);
  const requiresSolutionRate = newStep.operation_type === "spraying" || newStep.operation_type === "fertigation";
  const needsSolutionRate = requiresSolutionRate || materials.some((material) => material.rate_basis !== "per_ha");
  const solutionRateLHa = numeric(newStep.solution_rate_l_ha);
  const stepMix = useMemo(
    () =>
      calculateTankMix({
        areaHa: selectedScheme?.total_area_ha || 0,
        solutionRateLHa: needsSolutionRate ? solutionRateLHa || null : null,
        materials: materials.map((material) => ({
          productId: material.product_id,
          rate: numeric(material.rate),
          rateUnit: material.rate_unit,
          rateBasis: material.rate_basis,
        })),
      }),
    [materials, needsSolutionRate, selectedScheme?.total_area_ha, solutionRateLHa]
  );
  const stepValidationError = useMemo(() => {
    if (!materials.length) return "Добавьте хотя бы один материал.";
    const emptyProduct = materials.find((material) => !material.product_id);
    if (emptyProduct) return "Выберите продукт в каждой строке материала.";
    const emptyRate = materials.find((material) => !numeric(material.rate));
    if (emptyRate) return "Укажите норму для каждого материала.";
    if (needsSolutionRate && !solutionRateLHa) return "Укажите норму рабочего раствора л/га.";
    if (stepMix.error) return stepMix.error;
    return null;
  }, [materials, needsSolutionRate, solutionRateLHa, stepMix.error]);

  const canEdit = Boolean(data && !data.read_only);
  const selectedSchemeHasGenerated = Boolean(selectedScheme?.steps.some((step) => step.generated_operation_id));
  const selectedSchemeFieldsLocked = selectedSchemeHasGenerated;

  async function authHeaders(contentType = false) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Сессия не найдена. Войдите снова.");
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (contentType) headers["Content-Type"] = "application/json";
    return headers;
  }

  function withCompany(path: string) {
    const companyId = profile?.company_id;
    const separator = path.includes("?") ? "&" : "?";
    return companyId ? `${path}${separator}companyId=${companyId}` : path;
  }

  async function load() {
    if (!profile) return;
    setLoading(true);
    try {
      const response = await fetch(withCompany("/api/crop-care-schemes"), {
        headers: await authHeaders(),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить схемы");
      setData(payload);
      if (!selectedSchemeId && payload.schemes?.[0]?.id) {
        setSelectedSchemeId(payload.schemes[0].id);
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось загрузить страницу", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadSections(cropId: string, varietyId: string) {
    if (!cropId || !profile) {
      setSections([]);
      setIncludedSectionIds(new Set());
      return;
    }
    setSectionsLoading(true);
    try {
      const params = new URLSearchParams({ sections: "1", cropId });
      if (varietyId && varietyId !== "none") params.set("varietyId", varietyId);
      const response = await fetch(withCompany(`/api/crop-care-schemes?${params.toString()}`), {
        headers: await authHeaders(),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить участки");
      setSections(payload.sections || []);
      setIncludedSectionIds(new Set((payload.sections || []).map((section: StructureSection) => section.crop_structure_id)));
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось загрузить участки", variant: "destructive" });
    } finally {
      setSectionsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.company_id]);

  useEffect(() => {
    if (!selectedSchemeId && data?.schemes[0]?.id) {
      setSelectedSchemeId(data.schemes[0].id);
    }
  }, [data?.schemes, selectedSchemeId]);

  useEffect(() => {
    if (!newScheme.crop_id) return;
    void loadSections(newScheme.crop_id, newScheme.variety_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newScheme.crop_id, newScheme.variety_id]);

  async function submitCreateScheme() {
    if (!newScheme.name.trim() || !newScheme.crop_id) {
      toast({ title: "Не заполнено", description: "Укажите название и культуру.", variant: "destructive" });
      return;
    }
    if (!includedSectionIds.size) {
      toast({ title: "Нет участков", description: "Выберите хотя бы один участок структуры.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/crop-care-schemes", {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({
          companyId: profile?.company_id,
          name: newScheme.name,
          crop_id: newScheme.crop_id,
          variety_id: newScheme.variety_id === "none" ? null : newScheme.variety_id,
          scheme_type: newScheme.scheme_type,
          description: newScheme.description,
          included_crop_structure_ids: Array.from(includedSectionIds),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось создать схему");
      setData(payload);
      setSelectedSchemeId(payload.id);
      setCreateOpen(false);
      setNewScheme({ name: "", crop_id: "", variety_id: "none", scheme_type: "combined", description: "" });
      setSections([]);
      setIncludedSectionIds(new Set());
      setSectionSearch("");
      toast({ title: "Схема создана", description: "Операции пока не создавались." });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать схему", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function updateScheme(path: string, body: Record<string, unknown>, success: string) {
    setSaving(true);
    try {
      const response = await fetch(path, {
        method: path.endsWith("/activate") || path.endsWith("/pause") ? "POST" : "PATCH",
        headers: await authHeaders(true),
        body: JSON.stringify({ companyId: profile?.company_id, ...body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось обновить схему");
      setData(payload);
      toast({ title: success });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось обновить схему", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleSchemeField(field: SchemeField, included: boolean) {
    if (!selectedScheme) return;
    if (selectedSchemeFieldsLocked) {
      toast({
        title: "Участки заблокированы",
        description: "По схеме уже создана операция. Изменение участков доступно только через будущий regenerate/supersede flow.",
        variant: "destructive",
      });
      return;
    }
    const nextFields = selectedScheme.fields.map((item) => ({
      id: item.id,
      included: item.id === field.id ? included : item.included,
      notes: item.notes,
    }));
    await updateScheme(`/api/crop-care-schemes/${selectedScheme.id}`, { fields: nextFields }, "Участки обновлены");
  }

  function addMaterialRow() {
    setMaterials((rows) => [...rows, { ...EMPTY_MATERIAL }]);
  }

  function updateMaterial(index: number, patch: Partial<MaterialDraft>) {
    setMaterials((rows) =>
      rows.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const next = { ...row, ...patch };
        if (patch.product_id) {
          const product = activeProducts.find((item) => item.id === patch.product_id);
          const defaults = materialDefaults(product);
          next.rate_unit = defaults.unit;
          next.rate_basis = defaults.rateBasis;
        }
        if (next.rate_basis === "per_l_water" && next.rate_unit === "pcs") {
          next.rate_unit = "ml";
        }
        return next;
      })
    );
  }

  async function submitStep() {
    if (!selectedScheme) return;
    if (!newStep.title.trim()) {
      toast({ title: "Не заполнено", description: "Укажите название этапа.", variant: "destructive" });
      return;
    }
    if (!newStep.responsible_user_id || newStep.responsible_user_id === "none") {
      toast({ title: "Не заполнено", description: "Назначьте ответственного.", variant: "destructive" });
      return;
    }
    if (stepValidationError) {
      toast({ title: "Не заполнено", description: stepValidationError, variant: "destructive" });
      return;
    }
    const invalid = materials.find((material) => material.rate_basis === "per_l_water" && material.rate_unit === "pcs");
    if (invalid) {
      toast({ title: "Ошибка нормы", description: "Для нормы на литр воды нельзя использовать шт.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/crop-care-schemes/${selectedScheme.id}/steps`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({
          companyId: profile?.company_id,
          ...newStep,
          responsible_user_id: newStep.responsible_user_id === "none" ? null : newStep.responsible_user_id,
          lead_time_days: numeric(newStep.lead_time_days),
          materials: materials
            .filter((material) => material.product_id && material.rate)
            .map((material) => ({
              product_id: material.product_id,
              rate: numeric(material.rate),
              rate_unit: material.rate_unit,
              rate_basis: material.rate_basis,
              water_rate_l_ha: needsSolutionRate ? solutionRateLHa : material.water_rate_l_ha ? numeric(material.water_rate_l_ha) : null,
              total_solution_l_ha: needsSolutionRate ? solutionRateLHa : material.total_solution_l_ha ? numeric(material.total_solution_l_ha) : null,
              target_type: material.target_type,
              notes: material.notes,
            })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось добавить этап");
      setData(payload);
      setNewStep({
        title: "",
        phenological_phase: "",
        planned_date: "",
        window_start_date: "",
        window_end_date: "",
        operation_type: "spraying",
        responsible_user_id: "none",
        lead_time_days: "0",
        solution_rate_l_ha: "",
        notes: "",
      });
      setMaterials([]);
      toast({ title: "Этап добавлен", description: "Операция не создана автоматически." });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось добавить этап", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function generateOperation(step: SchemeStep) {
    if (!selectedScheme) return;
    if (selectedScheme.status !== "active") {
      toast({
        title: "Схема не активна",
        description: "Операции можно создавать только по активной схеме",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/crop-care-schemes/${selectedScheme.id}/steps/${step.id}/generate-operation`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({ companyId: profile?.company_id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось создать операцию");
      setData(payload);
      toast({
        title: payload.created ? "Операция создана" : "Операция уже есть",
        description: payload.operation_id ? `ID: ${payload.operation_id}` : undefined,
      });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать операцию", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const totals = useMemo(() => {
    const schemes = data?.schemes || [];
    return {
      count: schemes.length,
      active: schemes.filter((scheme) => scheme.status === "active").length,
      fields: schemes.reduce((sum, scheme) => sum + scheme.included_field_count, 0),
      area: schemes.reduce((sum, scheme) => sum + scheme.total_area_ha, 0),
    };
  }, [data?.schemes]);

  const summaryCards: Array<{ label: string; value: string | number; Icon: LucideIcon }> = [
    { label: "Схемы", value: totals.count, Icon: ClipboardList },
    { label: "Активные", value: totals.active, Icon: Activity },
    { label: "Участки", value: totals.fields, Icon: Leaf },
    { label: "Площадь", value: formatHa(totals.area), Icon: Sprout },
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Системы защиты и ухода" description="Схемы обработок, питания и фертигации" />
        <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-[#1F2937] bg-[#111827] text-[#9CA3AF]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загрузка схем...
        </div>
      </div>
    );
  }

  if (!data?.season) {
    return (
      <div className="space-y-4">
        <PageHeader title="Системы защиты и ухода" description="Схемы обработок, питания и фертигации" />
        <div className="rounded-lg border border-[#273449] bg-[#111827] p-6">
          <h2 className="text-lg font-semibold text-[#F9FAFB]">Нет активного сезона</h2>
          <p className="mt-2 text-sm text-[#9CA3AF]">Сначала откройте сезон, затем создавайте схемы ухода.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Системы защиты и ухода" description={`Активный сезон ${data.season.year}`}>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={() => void load()} className="border-[#273449] bg-[#0B0F17] text-[#E5E7EB]">
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button disabled={!canEdit} className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]">
                <Plus className="mr-2 h-4 w-4" />
                Создать схему
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-[#273449] bg-[#0B0F17] text-[#F9FAFB]">
              <DialogHeader>
                <DialogTitle>Новая схема ухода</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Название *</Label>
                  <Input value={newScheme.name} onChange={(event) => setNewScheme((value) => ({ ...value, name: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Тип схемы</Label>
                  <Select value={newScheme.scheme_type} onValueChange={(value: SchemeType) => setNewScheme((state) => ({ ...state, scheme_type: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SCHEME_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Культура *</Label>
                  <SearchableSelect
                    value={newScheme.crop_id || "none"}
                    onChange={(value) => setNewScheme((state) => ({ ...state, crop_id: value === "none" ? "" : value, variety_id: "none" }))}
                    options={[{ id: "none", label: "Выберите культуру" }, ...cropOptions]}
                    placeholder="Выберите культуру"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Сорт</Label>
                  <SearchableSelect
                    value={newScheme.variety_id}
                    onChange={(value) => setNewScheme((state) => ({ ...state, variety_id: value }))}
                    options={varietyOptions}
                    placeholder="Все сорта культуры"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Описание</Label>
                <Textarea value={newScheme.description} onChange={(event) => setNewScheme((value) => ({ ...value, description: event.target.value }))} />
              </div>
              <div className="rounded-lg border border-[#273449] bg-[#111827] p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-[#F9FAFB]">Участки из структуры</div>
                    <div className="text-xs text-[#9CA3AF]">Выберите участки текущего сезона</div>
                  </div>
                  {sectionsLoading && <Loader2 className="h-4 w-4 animate-spin text-[#E0B100]" />}
                </div>
                {!newScheme.crop_id ? (
                  <div className="rounded-md border border-dashed border-[#344256] p-4 text-sm text-[#9CA3AF]">Сначала выберите культуру.</div>
                ) : sections.length === 0 && !sectionsLoading ? (
                  <div className="rounded-md border border-dashed border-[#344256] p-4 text-sm text-[#FCA5A5]">В структуре сезона нет участков по выбранной культуре.</div>
                ) : (
                  <div className="space-y-2">
                    <Input
                      value={sectionSearch}
                      onChange={(event) => setSectionSearch(event.target.value)}
                      placeholder="Поиск по полю, культуре или сорту..."
                    />
                    <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                      {filteredSections.map((section) => (
                        <label key={section.crop_structure_id} className="flex gap-3 rounded-md border border-[#273449] bg-[#0B0F17] p-3 text-sm">
                          <Checkbox
                            checked={includedSectionIds.has(section.crop_structure_id)}
                            onCheckedChange={(checked) => {
                              setIncludedSectionIds((current) => {
                                const next = new Set(current);
                                if (checked) next.add(section.crop_structure_id);
                                else next.delete(section.crop_structure_id);
                                return next;
                              });
                            }}
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-[#F9FAFB]">{section.field_name}</span>
                            <span className="block truncate text-[#9CA3AF]">{section.crop_name} / {section.variety_name}</span>
                            <span className="text-[#E0B100]">{formatHa(section.area_ha)}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
                <Button onClick={submitCreateScheme} disabled={saving || !canEdit} className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]">
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Создать
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </PageHeader>

      {data.read_only && (
        <div className="rounded-lg border border-[#7C2D12] bg-[#431407] px-4 py-3 text-sm text-[#FED7AA]">
          {data.read_only_reason || "Сезон доступен только для просмотра."}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {summaryCards.map(({ label, value, Icon }) => (
          <div key={label} className="rounded-lg border border-[#273449] bg-[#111827] p-4">
            <div className="flex items-center justify-between text-sm text-[#9CA3AF]">
              <span>{label}</span>
              <Icon className="h-4 w-4 text-[#E0B100]" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-[#F9FAFB]">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="border-[#273449] bg-[#111827]">
          <CardHeader>
            <CardTitle className="text-[#F9FAFB]">Список схем</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.schemes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#344256] p-4 text-sm text-[#9CA3AF]">Схем пока нет.</div>
            ) : (
              data.schemes.map((scheme) => (
                <button
                  key={scheme.id}
                  onClick={() => setSelectedSchemeId(scheme.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedScheme?.id === scheme.id
                      ? "border-[#E0B100] bg-[#1F2937]"
                      : "border-[#273449] bg-[#0B0F17] hover:border-[#4B5563]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[#F9FAFB]">{scheme.name}</div>
                      <div className="mt-1 truncate text-xs text-[#9CA3AF]">{scheme.crop_name}{scheme.variety_name ? ` / ${scheme.variety_name}` : ""}</div>
                    </div>
                    <Badge className="bg-[#1F2937] text-[#D1D5DB]">{STATUS_LABELS[scheme.status] || scheme.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-[#9CA3AF]">
                    <span>{formatHa(scheme.total_area_ha)}</span>
                    <span>{scheme.steps.length} этапов</span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={scheme.progress_percent} />
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {selectedScheme ? (
          <div className="space-y-4">
            <Card className="border-[#273449] bg-[#111827]">
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-[#F9FAFB]">{selectedScheme.name}</h2>
                      <Badge className="bg-[#E0B100] text-[#111827]">{SCHEME_TYPE_LABELS[selectedScheme.scheme_type]}</Badge>
                      <Badge variant="outline" className="border-[#344256] text-[#D1D5DB]">{STATUS_LABELS[selectedScheme.status] || selectedScheme.status}</Badge>
                    </div>
                    <div className="mt-2 text-sm text-[#9CA3AF]">
                      {selectedScheme.crop_name}{selectedScheme.variety_name ? ` / ${selectedScheme.variety_name}` : ""} · {formatHa(selectedScheme.total_area_ha)}
                    </div>
                    {selectedScheme.description && <div className="mt-2 text-sm text-[#D1D5DB]">{selectedScheme.description}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={!canEdit || saving || selectedScheme.status === "active"}
                      title="Перевести схему в работу. Только активная схема может создавать операции."
                      onClick={() => updateScheme(`/api/crop-care-schemes/${selectedScheme.id}/activate`, {}, "Схема активирована")}
                      className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]"
                    >
                      <PlayCircle className="mr-2 h-4 w-4" />
                      Активировать
                    </Button>
                    <Button
                      disabled={!canEdit || saving || selectedScheme.status !== "active"}
                      variant="outline"
                      title="Поставить активную схему на паузу. Генерация операций будет заблокирована."
                      onClick={() => updateScheme(`/api/crop-care-schemes/${selectedScheme.id}/pause`, {}, "Схема поставлена на паузу")}
                    >
                      <PauseCircle className="mr-2 h-4 w-4" />
                      Пауза
                    </Button>
                    <Button
                      disabled={!canEdit || saving || selectedSchemeFieldsLocked}
                      variant="outline"
                      title="Обновить участки из структуры. Новые найденные участки добавятся выключенными."
                      onClick={() => updateScheme(`/api/crop-care-schemes/${selectedScheme.id}/fields/sync-from-crop-structure`, {}, "Участки обновлены")}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Обновить поля
                    </Button>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-[#273449] bg-[#0B0F17] p-3 text-xs text-[#9CA3AF]">
                  {data?.read_only ? (
                    <span>{data.read_only_reason || "Сезон закрыт. Схемы доступны только для просмотра."}</span>
                  ) : selectedSchemeFieldsLocked ? (
                    <span>По схеме уже создана операция. Участки, sync и сгенерированные этапы заблокированы в V1.</span>
                  ) : (
                    <span>Обновление полей сохранит текущие включения, а новые участки из структуры добавит выключенными.</span>
                  )}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-[#273449] bg-[#0B0F17] p-3">
                    <div className="text-xs text-[#9CA3AF]">Прогресс</div>
                    <div className="mt-1 text-lg font-semibold text-[#F9FAFB]">{selectedScheme.progress_percent}%</div>
                    <div className="mt-2">
                      <ProgressBar value={selectedScheme.progress_percent} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#273449] bg-[#0B0F17] p-3">
                    <div className="text-xs text-[#9CA3AF]">Участки</div>
                    <div className="mt-1 text-lg font-semibold text-[#F9FAFB]">{selectedScheme.included_field_count} / {selectedScheme.field_count}</div>
                  </div>
                  <div className="rounded-lg border border-[#273449] bg-[#0B0F17] p-3">
                    <div className="text-xs text-[#9CA3AF]">Ревизия</div>
                    <div className="mt-1 text-lg font-semibold text-[#F9FAFB]">v{selectedScheme.revision_no}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#273449] bg-[#111827]">
              <CardHeader>
                <CardTitle className="text-[#F9FAFB]">Участки схемы</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-3">
                  <Input
                    value={schemeFieldSearch}
                    onChange={(event) => setSchemeFieldSearch(event.target.value)}
                    placeholder="Поиск участка..."
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {filteredSchemeFields.map((field) => (
                    <label key={field.id} className={`flex gap-3 rounded-lg border border-[#273449] bg-[#0B0F17] p-3 ${selectedSchemeFieldsLocked ? "opacity-70" : ""}`}>
                      <Checkbox
                        checked={field.included}
                        disabled={!canEdit || saving || selectedSchemeFieldsLocked}
                        onCheckedChange={(checked) => void toggleSchemeField(field, Boolean(checked))}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#F9FAFB]">{field.field_name}</span>
                        <span className="block truncate text-xs text-[#9CA3AF]">{field.variety_name || field.crop_name}</span>
                        <span className="text-xs text-[#E0B100]">{formatHa(field.area_ha)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#273449] bg-[#111827]">
              <CardHeader>
                <CardTitle className="text-[#F9FAFB]">Этапы</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedScheme.steps.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#344256] p-4 text-sm text-[#9CA3AF]">Этапов пока нет.</div>
                ) : (
                  selectedScheme.steps.map((step) => (
                    <div key={step.id} className="rounded-lg border border-[#273449] bg-[#0B0F17] p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="bg-[#1F2937] text-[#D1D5DB]">#{step.step_no}</Badge>
                            <h3 className="font-semibold text-[#F9FAFB]">{step.title}</h3>
                            <Badge variant="outline" className="border-[#344256] text-[#D1D5DB]">{STATUS_LABELS[step.status] || step.status}</Badge>
                            {step.generated_operation_id && (
                              <Badge className="bg-[#3B2D09] text-[#FDE68A]">Заблокировано</Badge>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-[#9CA3AF]">
                            {step.phenological_phase && <span>{step.phenological_phase}</span>}
                            {step.planned_date && <span className="inline-flex items-center"><CalendarDays className="mr-1 h-3 w-3" />{step.planned_date}</span>}
                            <span>{OPERATION_TYPE_OPTIONS.find((item) => item.value === step.operation_type)?.label || step.operation_type}</span>
                          </div>
                        </div>
                        <Button
                          disabled={!canEdit || saving || Boolean(step.generated_operation_id) || selectedScheme.status !== "active"}
                          onClick={() => void generateOperation(step)}
                          className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]"
                        >
                          {step.generated_operation_id ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                          {step.generated_operation_id
                            ? "Операция есть"
                            : selectedScheme.status !== "active"
                              ? "Только active"
                              : "Создать операцию"}
                        </Button>
                      </div>
                      {step.generated_operation_id && (
                        <div className="mt-3 rounded-md border border-[#3B2D09] bg-[#1F1604] p-2 text-xs text-[#FDE68A]">
                          Этап уже связан с операцией. Нормы, вода, дата и материалы заблокированы до отдельного regenerate/supersede flow.
                        </div>
                      )}
                      {step.materials.length > 0 && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {step.materials.map((material) => (
                            <div key={material.id} className="rounded-md border border-[#1F2937] bg-[#111827] p-3">
                              <div className="truncate text-sm font-semibold text-[#F9FAFB]">{material.product_name}</div>
                              <div className="mt-1 text-xs text-[#9CA3AF]">
                                {material.rate} {UNIT_LABELS[normalizeMixUnit(material.rate_unit)]} · {RATE_BASIS_LABELS[material.rate_basis]}
                              </div>
                              <div className="mt-2 text-sm text-[#E0B100]">{formatQuantity(material.planned_quantity, material.planned_unit)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-[#273449] bg-[#111827]">
              <CardHeader>
                <CardTitle className="text-[#F9FAFB]">Добавить этап</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Название этапа *</Label>
                    <Input value={newStep.title} onChange={(event) => setNewStep((state) => ({ ...state, title: event.target.value }))} disabled={!canEdit} />
                  </div>
                  <div className="space-y-2">
                    <Label>Тип операции</Label>
                    <Select value={newStep.operation_type} disabled={!canEdit} onValueChange={(value) => setNewStep((state) => ({ ...state, operation_type: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPERATION_TYPE_OPTIONS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Фаза</Label>
                    <Input value={newStep.phenological_phase} onChange={(event) => setNewStep((state) => ({ ...state, phenological_phase: event.target.value }))} disabled={!canEdit} />
                  </div>
                  <div className="space-y-2">
                    <Label>Ответственный *</Label>
                    <SearchableSelect
                      value={newStep.responsible_user_id}
                      disabled={!canEdit}
                      onChange={(value) => setNewStep((state) => ({ ...state, responsible_user_id: value }))}
                      options={responsibleOptions}
                      placeholder="Выберите ответственного"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Плановая дата</Label>
                    <Input type="date" value={newStep.planned_date} onChange={(event) => setNewStep((state) => ({ ...state, planned_date: event.target.value }))} disabled={!canEdit} />
                  </div>
                  <div className="space-y-2">
                    <Label>Lead time, дней</Label>
                    <Input type="number" value={newStep.lead_time_days} onChange={(event) => setNewStep((state) => ({ ...state, lead_time_days: event.target.value }))} disabled={!canEdit} />
                  </div>
                </div>
                <Textarea
                  placeholder="Комментарий по этапу"
                  value={newStep.notes}
                  onChange={(event) => setNewStep((state) => ({ ...state, notes: event.target.value }))}
                  disabled={!canEdit}
                />
                {needsSolutionRate && (
                  <div className="rounded-lg border border-[#273449] bg-[#0B0F17] p-3">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px] md:items-end">
                      <div>
                        <div className="font-semibold text-[#F9FAFB]">Рабочий раствор</div>
                        <div className="mt-1 text-xs text-[#9CA3AF]">
                          Вода считается автоматически: общий раствор минус жидкие препараты. Сухие материалы учитываются отдельно.
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Раствор, л/га *</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newStep.solution_rate_l_ha}
                          onChange={(event) => setNewStep((state) => ({ ...state, solution_rate_l_ha: event.target.value }))}
                          disabled={!canEdit}
                        />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
                      <div className="rounded-md bg-[#111827] p-2 text-[#D1D5DB]">
                        <div className="text-[#9CA3AF]">Жидкие препараты</div>
                        <div className="mt-1 font-semibold text-[#F9FAFB]">{formatQuantity(stepMix.liquidMaterialsL, "l")}</div>
                      </div>
                      <div className="rounded-md bg-[#111827] p-2 text-[#D1D5DB]">
                        <div className="text-[#9CA3AF]">Вода автоматически</div>
                        <div className={cn("mt-1 font-semibold", stepMix.waterL !== null && stepMix.waterL < 0 ? "text-[#FCA5A5]" : "text-[#F9FAFB]")}>
                          {formatQuantity(stepMix.waterL, "l")}
                        </div>
                      </div>
                      <div className="rounded-md bg-[#111827] p-2 text-[#D1D5DB]">
                        <div className="text-[#9CA3AF]">Концентрация</div>
                        <div className="mt-1 font-semibold text-[#F9FAFB]">
                          {stepMix.concentrationPercent === null ? "не рассчитано" : `${stepMix.concentrationPercent}%`}
                        </div>
                      </div>
                      <div className="rounded-md bg-[#111827] p-2 text-[#D1D5DB]">
                        <div className="text-[#9CA3AF]">Готовый раствор</div>
                        <div className="mt-1 font-semibold text-[#F9FAFB]">{formatQuantity(stepMix.totalSolutionL, "l")}</div>
                      </div>
                    </div>
                  </div>
                )}
                <Separator className="bg-[#273449]" />
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-[#F9FAFB]">Материалы этапа</div>
                    <div className="text-xs text-[#9CA3AF]">Расчёт идёт по выбранным участкам: {formatHa(selectedScheme.total_area_ha)}</div>
                  </div>
                  <Button variant="outline" onClick={addMaterialRow} disabled={!canEdit}>
                    <Plus className="mr-2 h-4 w-4" />
                    Материал
                  </Button>
                </div>
                <div className="space-y-3">
                  {materials.map((material, index) => {
                    const preview = calculatePreview(material, selectedScheme.total_area_ha, needsSolutionRate ? solutionRateLHa || null : null);
                    const unitOptions: MaterialDraft["rate_unit"][] =
                      material.rate_basis === "per_l_water" ? ["ml", "g", "l", "kg"] : ["l", "ml", "kg", "g", "pcs"];
                    const selectedProduct = activeProducts.find((product) => product.id === material.product_id);
                    return (
                      <div key={index} className="rounded-lg border border-[#273449] bg-[#0B0F17] p-3">
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_110px_120px_180px_140px_44px]">
                          <SearchableSelect
                            value={material.product_id || "none"}
                            disabled={!canEdit}
                            onChange={(value) => updateMaterial(index, { product_id: value === "none" ? "" : value })}
                            options={[{ id: "none", label: "Выберите препарат" }, ...productOptions]}
                            placeholder="Препарат"
                          />
                          <Input placeholder="Норма" value={material.rate} disabled={!canEdit} onChange={(event) => updateMaterial(index, { rate: event.target.value })} />
                          <Select value={material.rate_unit} disabled={!canEdit} onValueChange={(value: MaterialDraft["rate_unit"]) => updateMaterial(index, { rate_unit: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {unitOptions.map((unit) => (
                                <SelectItem key={unit} value={unit}>{UNIT_LABELS[unit]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={material.rate_basis} disabled={!canEdit} onValueChange={(value: RateBasis) => updateMaterial(index, { rate_basis: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {VISIBLE_RATE_BASIS.map((value) => (
                                <SelectItem key={value} value={value}>{RATE_BASIS_LABELS[value]}</SelectItem>
                              ))}
                              {material.rate_basis === "per_t_solution" && (
                                <SelectItem value="per_t_solution">{RATE_BASIS_LABELS.per_t_solution}</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <Select value={material.target_type} disabled={!canEdit} onValueChange={(value: TargetType) => updateMaterial(index, { target_type: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(TARGET_TYPE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="outline" size="icon" disabled={!canEdit} onClick={() => setMaterials((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {selectedProduct?.manufacturer && (
                          <div className="mt-2 text-xs text-[#9CA3AF]">Производитель: {selectedProduct.manufacturer}</div>
                        )}
                        <div className={`mt-2 text-xs ${preview.error ? "text-[#FCA5A5]" : "text-[#A7F3D0]"}`}>
                          {preview.error ? preview.error : `План: ${formatQuantity(preview.value, preview.unit)}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {stepValidationError && <div className="text-sm text-[#FCA5A5]">{stepValidationError}</div>}
                <div className="flex justify-end">
                  <Button onClick={submitStep} disabled={!canEdit || saving || Boolean(stepValidationError)} className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Добавить этап
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[#344256] bg-[#111827] p-6 text-sm text-[#9CA3AF]">Выберите или создайте схему.</div>
        )}
      </div>
    </div>
  );
}
