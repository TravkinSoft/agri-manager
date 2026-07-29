"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ChevronDown, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { buildProductDisplayLabel } from "@/lib/catalog/catalog-identity";
import { brandName, localizedName, localizeUnit } from "@/lib/i18n/helpers";
import { inferMaterialStockUnit } from "@/lib/materials/metadata";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import {
  type CatalogFilter,
  type CatalogFormField,
  type GlobalCatalogConfig,
  type GlobalCatalogEntity,
} from "@/lib/platform/global-catalog-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  GlbdComponentDialog,
  type GlbdComponentCardData,
} from "@/components/platform/glbd-component-dialog";
import {
  FullPesticideCardDialog,
  type FullPesticideCardData,
} from "@/components/platform/full-pesticide-card-dialog";

type RowRecord = Record<string, any>;
type Option = { label: string; value: string };
type SearchConflict = { message: string; components: string[] };

const CONSOLE_LABEL_CLASS = "font-mono text-[11px] uppercase tracking-[0.12em] !text-[#42566f]";
const CONSOLE_CONTROL_CLASS =
  "rounded-none border-[#9aa8ba] bg-white !text-[#111827] placeholder:!text-[#69788d] focus-visible:ring-[#163d68]";
const CONSOLE_SELECT_TRIGGER_CLASS =
  "rounded-none border-[#9aa8ba] bg-white !text-[#111827] data-[placeholder]:!text-[#69788d]";
const CONSOLE_MENU_CLASS = "rounded-none border-[#9aa8ba] bg-white !text-[#111827]";
const CONSOLE_TABLE_CELL_CLASS = "border-[#c3ccd8] px-4 py-3 !text-[#1f2937]";

function optionLabel(entity: GlobalCatalogEntity, row: RowRecord): string {
  if (entity === "varieties" || entity === "pesticides" || entity === "fertilizers" || entity === "additives" || entity === "growth_regulators") {
    if (entity === "pesticides" || entity === "fertilizers" || entity === "additives" || entity === "growth_regulators") {
      return buildProductDisplayLabel(row as any) || row.full_name || row.code || row.slug || row.id;
    }
    return brandName(row) || row.full_name || row.code || row.slug || row.id;
  }
  return localizedName(row, "ru") || row.full_name || brandName(row, ["name", "trade_name"]) || row.code || row.slug || row.id;
}

const BOOL_KEYS = new Set(["is_active", "is_common_in_kz"]);
const UNIT_KEYS = new Set([
  "unit",
  "uom",
  "base_uom",
  "default_unit",
  "stock_unit",
  "storage_unit",
  "issue_unit",
  "default_rate_unit",
  "rate_unit",
  "application_unit",
]);
const STOCK_UNIT_KEYS = new Set(["unit", "uom", "base_uom", "default_unit", "stock_unit", "storage_unit", "issue_unit"]);
const CODE_KEYS = new Set([
  "status",
  "type",
  "product_type",
  "category",
  "subcategory",
  "pesticide_category",
  "fertilizer_type",
  "default_rate_type",
  "rate_basis",
  "formulation",
  "disease_type",
  "pathogen_type",
  "pest_type",
  "weed_type",
  "confidence",
  "target_type",
  "asset_group",
  "equipment_type",
  "vehicle_type",
  "power_class",
  "source_type",
]);
const CODE_LABELS: Record<string, string> = {
  unknown: "не указано",
  other: "другое",
  master: "общий каталог",
  active: "активно",
  inactive: "неактивно",
  high: "высокая",
  medium: "средняя",
  low: "низкая",
  pesticide: "пестицид",
  fertilizer: "удобрение",
  additive: "добавка",
  adjuvant: "адъювант",
  surfactant: "ПАВ",
  sticker: "прилипатель",
  antifoam: "пеногаситель",
  anti_foam: "пеногаситель",
  water_conditioner: "кондиционер воды",
  anti_salt: "антисоль",
  ph_corrector: "корректор pH",
  ph_regulator: "регулятор pH",
  biostimulant: "биостимулянт",
  growth_regulator: "регулятор роста",
  herbicide: "гербицид",
  fungicide: "фунгицид",
  insecticide: "инсектицид",
  acaricide: "акарицид",
  desiccant: "десикант",
  seed_treatment: "протравитель",
  safener: "сафенер",
  nitrogen: "азотное",
  phosphorus: "фосфорное",
  potassium: "калийное",
  npk: "NPK",
  micronutrient: "микроэлементное",
  foliar: "листовое",
  macro: "макро",
  micro: "микро",
  water_soluble: "водорастворимое",
  organic: "органическое",
  organomineral: "органоминеральное",
  per_ha: "на гектар",
  per_1000_l_solution: "на 1000 л раствора",
  per_l_water: "на литр воды",
  per_t_seed: "на тонну семян",
  per_100kg_seed: "на 100 кг семян",
  per_1000_seeds: "на 1000 семян",
  manual: "вручную",
  liquid: "жидкий",
  solid: "твёрдый",
  annual: "однолетний",
  perennial: "многолетний",
  insect: "насекомое",
  mite: "клещ",
  nematode: "нематода",
  self_propelled_machine: "самоходная техника",
  implement: "агрегат",
  trailer: "прицеп",
  truck: "транспорт",
  tractor: "трактор",
  combine: "комбайн",
  combine_harvester: "комбайн",
  potato_harvester: "картофелеуборочный комбайн",
  self_propelled_sprayer: "самоходный опрыскиватель",
  loader: "погрузчик",
  light_vehicle: "легковой транспорт",
  tractor_unit: "тягач",
  semi_trailer: "полуприцеп",
  bus: "автобус",
  special_vehicle: "спецтранспорт",
  dump_truck: "самосвал",
  fuel_truck: "топливозаправщик",
  crane_truck: "автокран",
  pickup: "пикап",
  seeding: "посевное оборудование",
  potato_cultivator: "картофельный культиватор",
  receiving_hopper: "приёмный бункер",
  potato_harvester_equipment: "картофелеуборочное оборудование",
  potato_digger: "картофелекопалка",
  potato_conveyor: "картофельный транспортер",
  header: "жатка",
  pickup_header: "подборщик",
  grain_handling: "зернопогрузчик / зернометатель",
  conveyor: "транспортер",
  spraying_attached: "навесной/прицепной опрыскиватель",
  precision_agriculture: "точное земледелие",
  loader_attachment: "погрузочное оборудование",
  rotary_harrow: "ротационная борона",
  separator: "сепаратор",
  source_manual: "ручной ввод",
  manufacturer: "производитель",
  official_dealer: "официальный дилер",
  registry: "реестр",
  import_feed: "импорт данных",
  fungus: "гриб",
  bacteria: "бактерия",
  virus: "вирус",
  oomycete: "оомицет",
  physiological: "физиологическое",
};

function formatCodeToken(token: string): string {
  const trimmed = token.trim();
  const normalized = trimmed.toLowerCase();
  const exact = CODE_LABELS[normalized];
  if (exact) return exact;

  const parenthetical = normalized.match(/^([a-z_]+)\s*\(([^)]+)\)$/);
  if (parenthetical) {
    const base = CODE_LABELS[parenthetical[1]] || trimmed.replace(/\s*\([^)]+\)$/, "");
    const note = CODE_LABELS[parenthetical[2]] || parenthetical[2];
    return `${base} (${note})`;
  }

  return trimmed;
}

function formatCodeValue(value: any): string {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return raw || "-";
  return raw
    .split(/(\s*\/\s*|\s*,\s*)/)
    .map((part) => {
      if (!part.trim()) return "";
      if (part.includes("/")) return " / ";
      if (part.includes(",")) return ", ";
      return formatCodeToken(part);
    })
    .join("");
}

function isProductEntity(entity: GlobalCatalogEntity): boolean {
  return entity === "pesticides" || entity === "fertilizers" || entity === "additives" || entity === "growth_regulators";
}

function formatCellValue(value: any, key?: string, row?: RowRecord, entity?: GlobalCatalogEntity): string {
  if (row && entity && isProductEntity(entity) && key === "trade_name") return buildProductDisplayLabel(row as any) || "-";
  if (row && entity && isProductEntity(entity) && key && STOCK_UNIT_KEYS.has(key)) {
    return localizeUnit(inferMaterialStockUnit(row, value), "ru") || "-";
  }
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return key && CODE_KEYS.has(key) ? value.map(formatCodeToken).join(", ") : value.join(", ");
  if (value == null || value === "") return "-";
  if (typeof value === "string" && value.trim().toLowerCase() === "unknown") return "не указано";
  if (key && UNIT_KEYS.has(key)) return localizeUnit(value, "ru") || "-";
  if (key && CODE_KEYS.has(key)) return formatCodeValue(value);
  return String(value);
}

function getInitialValue(field: CatalogFormField): any {
  if (field.type === "checkbox") return true;
  if (field.type === "number") return "";
  if (field.type === "multiselect") return [];
  return "";
}

function toArrayValue(value: any): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function GlobalCatalogManager({ config }: { config: GlobalCatalogConfig }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pesticideIdFromUrl = config.entity === "pesticides" ? searchParams.get("pesticide") : null;

  const [rows, setRows] = useState<RowRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<RowRecord | null>(null);
  const [formState, setFormState] = useState<Record<string, any>>({});
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [remoteOptions, setRemoteOptions] = useState<Record<string, Option[]>>({});
  const [searchConflict, setSearchConflict] = useState<SearchConflict | null>(null);
  const [componentOpen, setComponentOpen] = useState(false);
  const [componentLoading, setComponentLoading] = useState(false);
  const [componentError, setComponentError] = useState<string | null>(null);
  const [componentDetail, setComponentDetail] = useState<GlbdComponentCardData | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [pesticideCardOpen, setPesticideCardOpen] = useState(false);
  const [pesticideCardLoading, setPesticideCardLoading] = useState(false);
  const [pesticideCardError, setPesticideCardError] = useState<string | null>(null);
  const [pesticideCard, setPesticideCard] = useState<FullPesticideCardData | null>(null);
  const [selectedPesticideId, setSelectedPesticideId] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return config.formFields.every((field) => {
      if (!field.required) return true;
      const value = formState[field.key];
      if (field.type === "checkbox") return true;
      if (field.type === "multiselect") return Array.isArray(value) && value.length > 0;
      return String(value ?? "").trim().length > 0;
    });
  }, [config.formFields, formState]);

  const effectiveFilterOptions = useMemo(() => {
    const result: Record<string, Option[]> = {};
    for (const filter of config.filters) {
      if (filter.optionsEntity) {
        const remote = remoteOptions[`filter:${filter.key}`] || [];
        result[filter.key] = remote.some((o) => o.value === "all")
          ? remote
          : [{ label: "Все", value: "all" }, ...remote];
        continue;
      }

      const base = [...filter.options];
      if (!base.some((option) => option.value === "all")) {
        base.unshift({ label: "Все", value: "all" });
      }

      if (BOOL_KEYS.has(filter.key)) {
        result[filter.key] = base;
        continue;
      }

      const dynamicValues = new Set<string>();
      for (const row of rows) {
        const raw = row[filter.key];
        if (raw == null || raw === "") continue;
        if (Array.isArray(raw)) {
          raw.forEach((value) => {
            const v = String(value || "").trim();
            if (v) dynamicValues.add(v);
          });
        } else {
          dynamicValues.add(String(raw));
        }
      }

      for (const value of Array.from(dynamicValues)) {
        if (!base.some((option) => option.value === value)) base.push({ label: value, value });
      }

      result[filter.key] = base;
    }
    return result;
  }, [config.filters, rows, remoteOptions]);

  const loadRows = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ userId: user.id });
      if (search.trim()) params.set("search", search.trim());

      Object.entries(filters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          const prepared = value.filter(Boolean);
          if (prepared.length) params.set(key, prepared.join(","));
          return;
        }
        if (value && value !== "all") params.set(key, value);
      });

      const headers = await buildClientAuthHeaders();
      const response = await fetch(`/api/global-admin/catalog/${config.entity}?${params.toString()}`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить каталог");
      setRows(Array.isArray(payload?.rows) ? payload.rows : []);
      setSearchConflict(payload?.searchConflict || null);
    } catch (error: any) {
      setSearchConflict(null);
      toast({ title: "Ошибка", description: error?.message || "Не удалось загрузить каталог", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadRemoteOptions = async () => {
    if (!user?.id) return;

    const fieldTargets = config.formFields
      .filter((field) => field.optionsEntity)
      .map((field) => ({ targetKey: field.key, entity: field.optionsEntity as GlobalCatalogEntity }));
    const filterTargets = config.filters
      .filter((filter) => filter.optionsEntity)
      .map((filter) => ({ targetKey: `filter:${filter.key}`, entity: filter.optionsEntity as GlobalCatalogEntity }));
    const targets = [...fieldTargets, ...filterTargets];
    if (!targets.length) return;

    const headers = await buildClientAuthHeaders().catch(() => null);
    if (!headers) {
      setRemoteOptions({});
      return;
    }

    const entries = await Promise.all(
      targets.map(async (target) => {
        try {
          const params = new URLSearchParams({ userId: user.id });
          const response = await fetch(`/api/global-admin/catalog/${target.entity}?${params.toString()}`, {
            headers,
            cache: "no-store",
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) return [target.targetKey, []] as const;

          const options: Option[] = (payload?.rows || []).map((row: any) => ({
            label: optionLabel(target.entity, row),
            value: row.id,
          }));
          return [target.targetKey, options] as const;
        } catch {
          return [target.targetKey, []] as const;
        }
      })
    );

    setRemoteOptions(Object.fromEntries(entries));
  };

  useEffect(() => {
    const defaults = Object.fromEntries(
      config.filters.map((filter) => [filter.key, filter.multi ? [] : filter.options.find((o) => o.value === "all")?.value || "all"])
    );
    setFilters(defaults);
  }, [config.entity]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadRows();
  }, [config.entity, user?.id, search, JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadRemoteOptions();
  }, [config.entity, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadComponentCard = async (componentId: string) => {
    if (!user?.id || !componentId) return;
    setSelectedComponentId(componentId);
    setComponentOpen(true);
    setComponentLoading(true);
    setComponentError(null);
    setComponentDetail(null);
    try {
      const params = new URLSearchParams({ userId: user.id, componentId });
      const headers = await buildClientAuthHeaders();
      const response = await fetch(`/api/global-admin/catalog/active_ingredients?${params.toString()}`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить карточку компонента");
      setComponentDetail(payload?.component || null);
    } catch (error: any) {
      setComponentError(error?.message || "Не удалось загрузить карточку компонента");
    } finally {
      setComponentLoading(false);
    }
  };

  const loadPesticideCard = async (productId: string) => {
    if (!user?.id || !productId) return;
    setSelectedPesticideId(productId);
    setPesticideCardOpen(true);
    setPesticideCardLoading(true);
    setPesticideCardError(null);
    setPesticideCard(null);
    try {
      const headers = await buildClientAuthHeaders();
      const response = await fetch(`/api/global-admin/pesticide-card/${productId}`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить полную карточку");
      setPesticideCard(payload as FullPesticideCardData);
    } catch (error: any) {
      setPesticideCardError(error?.message || "Не удалось загрузить полную карточку");
    } finally {
      setPesticideCardLoading(false);
    }
  };

  const retryPesticideCard = () => {
    if (selectedPesticideId) void loadPesticideCard(selectedPesticideId);
  };

  const openPesticideCard = (productId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pesticide", productId);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handlePesticideCardOpenChange = (open: boolean) => {
    if (open) {
      setPesticideCardOpen(true);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pesticide");
    setPesticideCardOpen(false);
    setSelectedPesticideId(null);
    setPesticideCard(null);
    router.push(params.size ? `${pathname}?${params.toString()}` : pathname);
  };

  useEffect(() => {
    if (config.entity !== "pesticides" || !user?.id) return;
    if (!pesticideIdFromUrl) {
      setPesticideCardOpen(false);
      setSelectedPesticideId(null);
      setPesticideCard(null);
      return;
    }
    if (selectedPesticideId === pesticideIdFromUrl && pesticideCardOpen) return;
    void loadPesticideCard(pesticideIdFromUrl);
  }, [config.entity, user?.id, pesticideIdFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryComponentCard = () => {
    if (selectedComponentId) void loadComponentCard(selectedComponentId);
  };

  const openCreate = () => {
    const initial = Object.fromEntries(config.formFields.map((field) => [field.key, getInitialValue(field)]));
    setFormState(initial);
    setEditingRow(null);
    setCreateOpen(true);
  };

  const openEdit = (row: RowRecord) => {
    const initial = Object.fromEntries(
      config.formFields.map((field) => {
        const value = row[field.key];
        if (field.type === "checkbox") return [field.key, value !== false];
        if (field.type === "multiselect") return [field.key, toArrayValue(value)];
        return [field.key, value ?? ""];
      })
    );
    setEditingRow(row);
    setFormState(initial);
    setEditOpen(true);
  };

  const submitCreate = async () => {
    if (!user?.id || !canSubmit || saving) return;
    setSaving(true);
    try {
      const headers = await buildClientAuthHeaders("json");
      const response = await fetch(`/api/global-admin/catalog/${config.entity}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: user.id, payload: formState }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось создать запись");

      setCreateOpen(false);
      await loadRows();
      toast({ title: "Готово", description: "Запись успешно создана." });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать запись", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!user?.id || !editingRow?.id || saving) return;
    setSaving(true);
    try {
      const headers = await buildClientAuthHeaders("json");
      const response = await fetch(`/api/global-admin/catalog/${config.entity}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ userId: user.id, id: editingRow.id, payload: formState }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось обновить запись");

      setEditOpen(false);
      setEditingRow(null);
      await loadRows();
      toast({ title: "Готово", description: "Изменения сохранены." });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось обновить запись", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const archiveRow = async (rowId: string) => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      const headers = await buildClientAuthHeaders("json");
      const response = await fetch(`/api/global-admin/catalog/${config.entity}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ userId: user.id, id: rowId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось деактивировать запись");

      await loadRows();
      toast({ title: "Готово", description: "Запись деактивирована." });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось деактивировать запись", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const renderMultiSelect = (
    label: string,
    selectedValues: string[],
    options: Option[],
    onToggle: (value: string) => void
  ) => {
    const selectedSet = new Set(selectedValues);
    const selectedLabels = options.filter((o) => selectedSet.has(o.value)).map((o) => o.label);
    const triggerLabel = selectedLabels.length ? `Выбрано: ${selectedLabels.length}` : "Выберите значения";

    return (
      <div className="space-y-2">
        <Label className={CONSOLE_LABEL_CLASS}>{label}</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between rounded-none border-[#9aa8ba] bg-white font-normal !text-[#111827] hover:bg-[#eef1f5]">
              <span className="truncate">{triggerLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={`max-h-72 w-[320px] overflow-y-auto ${CONSOLE_MENU_CLASS}`}>
            {options.map((option) => (
              <DropdownMenuCheckboxItem
                key={`${label}-${option.value}`}
                checked={selectedSet.has(option.value)}
                onCheckedChange={() => onToggle(option.value)}
                className="rounded-none !text-[#111827] focus:bg-[#dfe7f1] focus:!text-[#0c2544]"
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedLabels.length ? (
          <div className="flex flex-wrap gap-1">
            {selectedLabels.slice(0, 6).map((name) => (
              <Badge key={name} variant="secondary" className="rounded-none border border-[#9aa8ba] bg-[#eef1f5] font-normal !text-[#16324f]">{name}</Badge>
            ))}
            {selectedLabels.length > 6 ? (
              <Badge variant="secondary" className="rounded-none border border-[#9aa8ba] bg-[#eef1f5] !text-[#16324f]">
                +{selectedLabels.length - 6}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderField = (field: CatalogFormField) => {
    const value = formState[field.key];
    const options = field.optionsEntity ? remoteOptions[field.key] || [] : field.options || [];

    if (field.type === "checkbox") {
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={field.key}
            checked={Boolean(value)}
            onCheckedChange={(checked) => setFormState((prev) => ({ ...prev, [field.key]: Boolean(checked) }))}
          />
          <Label htmlFor={field.key} className="!text-[#1f2937]">{field.label}</Label>
        </div>
      );
    }

    if (field.type === "multiselect") {
      const selected = toArrayValue(value);
      return renderMultiSelect(
        `${field.label}${field.required ? " *" : ""}`,
        selected,
        options,
        (itemValue) => {
          setFormState((prev) => {
            const current = new Set(toArrayValue(prev[field.key]));
            if (current.has(itemValue)) current.delete(itemValue);
            else current.add(itemValue);
            return { ...prev, [field.key]: Array.from(current) };
          });
        }
      );
    }

    if (field.type === "select") {
      return (
        <div className="space-y-2">
          <Label className={CONSOLE_LABEL_CLASS}>{field.label}{field.required ? " *" : ""}</Label>
          <Select
            value={String(value || "")}
            onValueChange={(next) => setFormState((prev) => ({ ...prev, [field.key]: next }))}
          >
            <SelectTrigger className={CONSOLE_SELECT_TRIGGER_CLASS}>
              <SelectValue placeholder={field.placeholder || "Выберите значение"} />
            </SelectTrigger>
            <SelectContent className={CONSOLE_MENU_CLASS}>
              {options.map((option) => (
                <SelectItem key={`${field.key}-${option.value}`} value={option.value} className="rounded-none !text-[#111827] focus:bg-[#dfe7f1] focus:!text-[#0c2544]">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <Label className={CONSOLE_LABEL_CLASS}>{field.label}{field.required ? " *" : ""}</Label>
        <Input
          type={field.type === "number" ? "number" : "text"}
          value={value ?? ""}
          placeholder={field.placeholder || ""}
          className={CONSOLE_CONTROL_CLASS}
          onChange={(event) => setFormState((prev) => ({ ...prev, [field.key]: event.target.value }))}
        />
      </div>
    );
  };

  const renderFilter = (filter: CatalogFilter) => {
    const options = effectiveFilterOptions[filter.key] || filter.options;

    if (filter.multi) {
      const selected = toArrayValue(filters[filter.key]);
      return (
        <div className="space-y-2 min-w-[240px]">
          {renderMultiSelect(filter.label, selected, options.filter((o) => o.value !== "all"), (itemValue) => {
            setFilters((prev) => {
              const current = new Set(toArrayValue(prev[filter.key]));
              if (current.has(itemValue)) current.delete(itemValue);
              else current.add(itemValue);
              return { ...prev, [filter.key]: Array.from(current) };
            });
          })}
        </div>
      );
    }

    const selected = String(filters[filter.key] || "all");
    return (
      <div className="space-y-2 min-w-[180px]">
        <Label className={CONSOLE_LABEL_CLASS}>{filter.label}</Label>
        <Select value={selected} onValueChange={(value) => setFilters((prev) => ({ ...prev, [filter.key]: value }))}>
          <SelectTrigger className={CONSOLE_SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={CONSOLE_MENU_CLASS}>
            {options.map((option) => (
              <SelectItem key={`${filter.key}-${option.value}`} value={option.value} className="rounded-none !text-[#111827] focus:bg-[#dfe7f1] focus:!text-[#0c2544]">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const renderCatalogCell = (row: RowRecord, key: string) => {
    if (config.entity === "active_ingredients" && key === "name_ru" && row.glbd_component_id) {
      return (
        <div className="min-w-[190px]">
          <button
            type="button"
            onClick={() => void loadComponentCard(row.glbd_component_id)}
            className="inline-flex items-center gap-1.5 text-left font-medium text-[#174f84] underline-offset-4 hover:underline"
            title="Открыть карточку компонента"
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            {row.name_ru || row.canonical_name || "Компонент"}
          </button>
          {row.matched_alias ? (
            <div className="mt-1 text-xs text-[#68788d]">Найдено по варианту: «{row.matched_alias}»</div>
          ) : null}
        </div>
      );
    }

    if (isProductEntity(config.entity) && key === "active_ingredients" && Array.isArray(row.active_ingredient_components)) {
      if (!row.active_ingredient_components.length) return formatCellValue(row[key], key, row, config.entity);
      return (
        <div className="flex min-w-[210px] flex-wrap gap-1.5">
          {row.active_ingredient_components.map((component: any) => (
            <button
              type="button"
              key={component.id}
              onClick={() => void loadComponentCard(component.id)}
              className="inline-flex items-center gap-1 border border-[#9aa8ba] bg-[#f6f8fb] px-2 py-1 text-left text-xs font-medium text-[#174f84] hover:bg-[#e8edf3]"
              title={`Открыть карточку: ${component.displayName}`}
            >
              <BookOpen className="h-3 w-3 shrink-0" />
              {component.displayName}
            </button>
          ))}
        </div>
      );
    }

    return formatCellValue(row[key], key, row, config.entity);
  };

  return (
    <div className="w-full space-y-3 text-[#111827]">
      <Card className="w-full rounded-none border-[#9aa8ba] bg-white !text-[#111827] shadow-[1px_1px_0_rgba(255,255,255,0.9)_inset]">
        <CardHeader className="gap-3 border-b border-[#9aa8ba] bg-[#d7dde6]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="font-mono text-[15px] uppercase tracking-[0.12em] text-[#16324f]">{config.title}</CardTitle>
              <CardDescription className="text-[12px] text-[#536276]">{config.description}</CardDescription>
            </div>
            <Button onClick={openCreate} className="h-8 rounded-none bg-[#15395f] px-3 text-[12px] text-white hover:bg-[#0f2946]">
              <Plus className="mr-2 h-4 w-4" />
              {config.createLabel}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <div className="space-y-2 md:col-span-2 xl:col-span-2">
              <Label className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#42566f]">Поиск</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#69788d]" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={`${CONSOLE_CONTROL_CLASS} pl-9`}
                  placeholder={config.searchPlaceholder}
                />
              </div>
            </div>
            {config.filters.map(renderFilter)}
          </div>
          {searchConflict ? (
            <div className="border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <div className="font-medium">{searchConflict.message}</div>
              <div className="mt-1 text-xs">Совпадения: {searchConflict.components.join(", ")}</div>
            </div>
          ) : null}
        </CardHeader>
      </Card>

      <Card className="w-full rounded-none border-[#9aa8ba] bg-white !text-[#111827] shadow-[1px_1px_0_rgba(255,255,255,0.9)_inset]">
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-330px)] min-h-[320px] w-full overflow-auto">
            <Table className="min-w-[1200px] !text-[#111827]">
              <TableHeader className="sticky top-0 z-20 bg-[#eef1f5] shadow-[0_1px_0_#9aa8ba]">
                <TableRow className="border-[#9aa8ba] hover:bg-[#eef1f5]">
                  {config.columns.map((column) => (
                    <TableHead key={column.key} className="border-[#c3ccd8] bg-[#eef1f5] px-4 py-2 font-semibold !text-[#536276]">
                      {column.label}
                    </TableHead>
                  ))}
                  <TableHead className="w-[150px] border-[#c3ccd8] px-4 py-2 text-right font-semibold !text-[#536276]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow className="border-[#c3ccd8] hover:bg-[#f6f8fb]">
                    <TableCell colSpan={config.columns.length + 1} className="px-4 py-6 text-center !text-[#536276]">Загрузка...</TableCell>
                  </TableRow>
                ) : null}
                {!loading && rows.length === 0 ? (
                  <TableRow className="border-[#c3ccd8] hover:bg-[#f6f8fb]">
                    <TableCell colSpan={config.columns.length + 1} className="px-4 py-6 text-center !text-[#536276]">Записей нет.</TableCell>
                  </TableRow>
                ) : null}
                {!loading && rows.map((row) => (
                  <TableRow key={row.id} className="border-[#c3ccd8] bg-white hover:bg-[#f6f8fb]">
                    {config.columns.map((column) => (
                      <TableCell key={`${row.id}-${column.key}`} className={CONSOLE_TABLE_CELL_CLASS}>
                        {renderCatalogCell(row, column.key)}
                      </TableCell>
                    ))}
                    <TableCell className={CONSOLE_TABLE_CELL_CLASS}>
                      <div className="flex items-center justify-end gap-2">
                        {config.entity === "pesticides" ? (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => openPesticideCard(row.id)}
                            className="rounded-none border-[#9aa8ba] bg-white !text-[#16324f] hover:bg-[#eef1f5]"
                            title="Открыть полную карточку"
                            aria-label="Открыть полную карточку"
                          >
                            <BookOpen className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <Button variant="outline" size="icon" onClick={() => openEdit(row)} className="rounded-none border-[#9aa8ba] bg-white !text-[#16324f] hover:bg-[#eef1f5]">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => archiveRow(row.id)} disabled={saving} className="rounded-none border-[#9aa8ba] bg-white !text-[#9f1239] hover:bg-[#fff1f2]">
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => !saving && setCreateOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{config.createLabel}</DialogTitle>
            <DialogDescription>Заполните поля новой записи.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {config.formFields.map((field) => (
              <div key={`create-${field.key}`} className={field.type === "checkbox" ? "md:col-span-2" : ""}>
                {renderField(field)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Отмена</Button>
            <Button onClick={submitCreate} disabled={!canSubmit || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => !saving && setEditOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Редактирование записи</DialogTitle>
            <DialogDescription>Измените поля и сохраните.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {config.formFields.map((field) => (
              <div key={`edit-${field.key}`} className={field.type === "checkbox" ? "md:col-span-2" : ""}>
                {renderField(field)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Отмена</Button>
            <Button onClick={submitEdit} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GlbdComponentDialog
        open={componentOpen}
        onOpenChange={setComponentOpen}
        loading={componentLoading}
        error={componentError}
        component={componentDetail}
        onRetry={retryComponentCard}
      />

      <FullPesticideCardDialog
        open={pesticideCardOpen}
        onOpenChange={handlePesticideCardOpenChange}
        loading={pesticideCardLoading}
        error={pesticideCardError}
        card={pesticideCard}
        onRetry={retryPesticideCard}
      />
    </div>
  );
}
