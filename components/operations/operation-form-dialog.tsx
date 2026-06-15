"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FieldErrors, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  operationSchema,
  OperationFormData,
  OperationMaterialFormData,
  OperationMaterialType,
  SpecialistAssignee,
} from "@/lib/types/operation";
import { Field } from "@/lib/types/field";
import { CropStructureWithDetails } from "@/lib/types/crop-structure";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";
import { getFieldDisplayName } from "@/lib/fields/display";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import {
  OPERATION_SUBTYPE_DEFINITIONS,
  OPERATION_TYPE_DEFINITIONS,
  TANK_MIX_COMPONENT_DEFINITIONS,
  getDefaultUnitForComponent,
  getIrrigationTypeLabel,
  getOperationTemplateAvailability,
  getPurposeDefinitionsForOperation,
  getTankMixComponentDefinition,
  isPotatoCropContext,
  normalizeIrrigationType,
  resolveCanonicalOperationType,
  toStorageMaterialType,
  type CanonicalOperationTypeSlug,
  type OperationPurposeSlug,
  type TankMixComponentType,
} from "@/lib/operations/operation-engine";

interface OperationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: OperationFormData, options?: { idempotencyKey?: string }) => Promise<void>;
  defaultValues?: Partial<OperationFormData>;
  isEdit?: boolean;
  lockedContext?: boolean;
  sourceLabel?: string;
  fields: Field[];
  cropStructures: CropStructureWithDetails[];
  specialists: SpecialistAssignee[];
}

type OperationCategory = {
  id: string;
  slug: string;
  name_ru: string;
  is_active?: boolean;
};

type OperationTypeMaster = {
  id: string;
  slug: string;
  name_ru: string;
  category_slug: string;
  requires_machine: boolean;
  requires_product: boolean;
  requires_field: boolean;
  affects_inventory: boolean;
  affects_field_history: boolean;
  is_active?: boolean;
};

type RefOption = { id: string; name: string };
type ProductOption = {
  id: string;
  name: string;
  type: string | null;
  unit: string | null;
  availableQty: number;
  warehouseNames: string[];
};
type CropCatalogOption = { id: string; name: string; archived?: boolean | null; is_active?: boolean | null };
type VarietyCatalogOption = { id: string; name: string; crop_id: string; archived?: boolean | null; is_active?: boolean | null };
type ReproductionCatalogOption = { id: string; name: string; archived?: boolean | null; is_active?: boolean | null };

type SearchOption = { id: string; label: string; hint?: string };

const FALLBACK_CATEGORIES: OperationCategory[] = OPERATION_TYPE_DEFINITIONS.map((definition) => ({
  id: definition.categorySlug,
  slug: definition.categorySlug,
  name_ru: definition.label,
  is_active: true,
}));

const FALLBACK_TYPES: OperationTypeMaster[] = [
  ...OPERATION_TYPE_DEFINITIONS.map((definition) => ({
    id: definition.slug,
    slug: definition.slug,
    name_ru: definition.label,
    category_slug: definition.categorySlug,
    requires_machine: definition.requiresMachine,
    requires_product: definition.supportsMaterials,
    requires_field: definition.requiresCropStructure,
    affects_inventory: definition.affectsWarehouse,
    affects_field_history: definition.affectsFieldHistory,
    is_active: true,
  })),
  ...OPERATION_SUBTYPE_DEFINITIONS.map((definition) => {
    const parent = OPERATION_TYPE_DEFINITIONS.find((item) => item.slug === definition.categorySlug);
    return {
      id: definition.slug,
      slug: definition.slug,
      name_ru: definition.label,
      category_slug: definition.categorySlug,
      requires_machine: parent?.requiresMachine ?? true,
      requires_product: parent?.supportsMaterials ?? false,
      requires_field: parent?.requiresCropStructure ?? true,
      affects_inventory: parent?.affectsWarehouse ?? false,
      affects_field_history: parent?.affectsFieldHistory ?? true,
      is_active: true,
    } satisfies OperationTypeMaster;
  }),
];

const HIDDEN_PLANTING_SUBTYPE_SLUGS = new Set([
  "seeding_with_fertilizer",
  "seeding_with_microgranules",
]);

const WHOLE_FIELD_ALLOWED_CATEGORIES = new Set([
  "harvesting",
  "service_operation",
  "transport",
  "logistics_operation",
  "post_harvest",
  "post_harvest_operation",
]);

const ADDITIONAL_COMPONENT_TYPES = new Set<TankMixComponentType>([
  "adjuvant",
  "ph_corrector",
  "antifoam",
  "biostimulant",
  "other",
]);

const IMPLIED_PURPOSE_BY_TEMPLATE: Record<string, OperationPurposeSlug> = {
  herbicide_treatment: "weed_control",
  fungicide_treatment: "disease_control",
  insecticide_treatment: "insect_control",
  desiccation_treatment: "desiccation",
  defoliation_treatment: "defoliation",
  growth_regulator: "growth_regulation",
};

function normalizeNumber(value: string): number | null {
  const raw = String(value || "").trim().replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function clampArea(value: number | null, maxArea: number | null): number | null {
  if (value == null) return null;
  if (maxArea != null && maxArea > 0) return Math.min(value, maxArea);
  return value;
}

function createOperationIdempotencyKey(): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `operation-create-${randomPart}`;
}

function inferMaterialTypeByProductType(productType: string | null | undefined): OperationMaterialType {
  const normalized = String(productType || "").trim().toLowerCase();
  if (normalized.includes("seed")) return "seed";
  if (normalized.includes("fertil")) return "fertilizer";
  if (normalized.includes("pesticide")) return "pesticide";
  if (normalized.includes("fuel")) return "fuel";
  if (normalized.includes("organic")) return "organic";
  return "fertilizer";
}

function isPotatoSeedProduct(product: ProductOption | undefined): boolean {
  if (!product) return false;
  const text = `${product.name || ""} ${product.type || ""}`.toLowerCase();
  return (
    text.includes("картоф") ||
    text.includes("potato") ||
    text.includes("семенной картофель") ||
    text.includes("seed potato")
  );
}

function productMatchesComponent(product: ProductOption | undefined, componentType: TankMixComponentType): boolean {
  if (!product) return false;
  const text = `${product.name || ""} ${product.type || ""}`.toLowerCase();
  if (componentType === "water") return false;
  if (componentType === "seed") {
    return text.includes("seed") || text.includes("семен") || text.includes("посев") || text.includes("сорт");
  }
  if (componentType === "fertilizer" || componentType === "micro_fertilizer") {
    return (
      text.includes("fertil") ||
      text.includes("удобр") ||
      text.includes("nitrate") ||
      text.includes("ammonium") ||
      text.includes("npk") ||
      text.includes("кас") ||
      text.includes("жку") ||
      text.includes("аммофос") ||
      text.includes("диаммофос") ||
      text.includes("селитр") ||
      text.includes("карбамид") ||
      text.includes("микро")
    );
  }
  if (componentType === "crop_protection") {
    return (
      text.includes("crop_protection") ||
      text.includes("pesticide") ||
      text.includes("herbicide") ||
      text.includes("fungicide") ||
      text.includes("insecticide") ||
      text.includes("seed_treatment") ||
      text.includes("сзр") ||
      text.includes("гербиц") ||
      text.includes("фунгиц") ||
      text.includes("инсектиц") ||
      text.includes("протрав") ||
      text.includes("актара") ||
      text.includes("ревус") ||
      text.includes("селест")
    );
  }
  if (componentType === "biological") {
    return text.includes("biolog") || text.includes("био");
  }
  if (componentType === "biostimulant") {
    return text.includes("biostim") || text.includes("биостим") || text.includes("black jack") || text.includes("блек джек") || text.includes("технофит");
  }
  if (componentType === "ph_corrector") {
    return text.includes("ph") || text.includes("рн") || text.includes("корректор") || text.includes("кислот");
  }
  if (componentType === "adjuvant") {
    return text.includes("adjuvant") || text.includes("пав") || text.includes("прилип") || text.includes("адъювант") || text.includes("anti-salt") || text.includes("антисоль");
  }
  if (componentType === "antifoam") {
    return text.includes("antifoam") || text.includes("пеногас") || text.includes("foam");
  }
  return (
    text.includes("other") ||
    text.includes("проч") ||
    text.includes("additive") ||
    text.includes("добав") ||
    text.includes("tape") ||
    text.includes("лента")
  );
}

function requiresCropStructureForType(type: OperationTypeMaster | null): boolean {
  if (!type) return false;
  const canonical = resolveCanonicalOperationType({
    categorySlug: type.category_slug,
    typeSlug: type.slug,
    operationType: type.name_ru,
  });
  return canonical ? canonical.requiresCropStructure : type.requires_field !== false && type.affects_field_history !== false;
}

function mergeCanonicalCategories(rows: OperationCategory[]): OperationCategory[] {
  const bySlug = new Map<string, OperationCategory>();
  FALLBACK_CATEGORIES.forEach((item) => bySlug.set(item.slug, item));
  rows.forEach((item) => {
    const canonical = resolveCanonicalOperationType({ categorySlug: item.slug });
    if (canonical) return;
    bySlug.set(item.slug, item);
  });
  return Array.from(bySlug.values());
}

function mergeCanonicalTypes(rows: OperationTypeMaster[]): OperationTypeMaster[] {
  const bySlug = new Map<string, OperationTypeMaster>();
  FALLBACK_TYPES.forEach((item) => bySlug.set(item.slug, item));
  rows.forEach((item) => {
    const canonical = resolveCanonicalOperationType({
      categorySlug: item.category_slug,
      typeSlug: item.slug,
      operationType: item.name_ru,
    });
    if (canonical && item.category_slug !== canonical.categorySlug) return;
    if (canonical && item.slug === canonical.slug) return;
    bySlug.set(item.slug, item);
  });
  return Array.from(bySlug.values());
}

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
                  value={`${option.label} ${option.hint || ""}`}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", option.id === value ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0">
                    <div className="truncate">{option.label}</div>
                    {option.hint ? <div className="truncate text-xs text-slate-500">{option.hint}</div> : null}
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

export function OperationFormDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  isEdit = false,
  lockedContext = false,
  sourceLabel,
  fields,
  cropStructures,
  specialists,
}: OperationFormDialogProps) {
  const { profile } = useAuth();
  const [categories, setCategories] = useState<OperationCategory[]>(FALLBACK_CATEGORIES);
  const [types, setTypes] = useState<OperationTypeMaster[]>(FALLBACK_TYPES);
  const [categorySlug, setCategorySlug] = useState("");
  const [typeSlug, setTypeSlug] = useState("");
  const [machines, setMachines] = useState<RefOption[]>([]);
  const [equipment, setEquipment] = useState<RefOption[]>([]);
  const [transports, setTransports] = useState<RefOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [cropCatalog, setCropCatalog] = useState<CropCatalogOption[]>([]);
  const [varietyCatalog, setVarietyCatalog] = useState<VarietyCatalogOption[]>([]);
  const [reproductionCatalog, setReproductionCatalog] = useState<ReproductionCatalogOption[]>([]);
  const [materials, setMaterials] = useState<OperationMaterialFormData[]>([]);
  const [purposes, setPurposes] = useState<OperationPurposeSlug[]>([]);
  const [tankMixEnabled, setTankMixEnabled] = useState(false);
  const [tankMixWaterRate, setTankMixWaterRate] = useState<number | null>(null);
  const [operationParams, setOperationParams] = useState<Record<string, unknown>>({});
  const [structureChangeMode, setStructureChangeMode] = useState<"none" | "area_split" | "crop_replace">("none");
  const [structureChangeCropId, setStructureChangeCropId] = useState("");
  const [structureChangeVarietyId, setStructureChangeVarietyId] = useState("none");
  const [structureChangeReproductionId, setStructureChangeReproductionId] = useState("none");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);
  const submitIdempotencyKeyRef = useRef(createOperationIdempotencyKey());

  const form = useForm<OperationFormData>({
    resolver: zodResolver(operationSchema),
    defaultValues: {
      field_id: "",
      crop_structure_id: null,
      operation_category_slug: "",
      operation_type_slug: "",
      operation_type: "",
      planned_area_ha: null,
      crop_id: null,
      machine_id: null,
      equipment_id: null,
      transport_id: null,
      operation_target: null,
      rate_per_ha: null,
      spray_volume_per_ha: null,
      row_spacing_m: null,
      seed_spacing_cm: null,
      operation_params: null,
      date: new Date().toISOString().slice(0, 10),
      responsible_user_id: null,
      notes: "",
      materials: [],
    },
  });

  const selectedFieldId = form.watch("field_id");
  const selectedCropStructureId = form.watch("crop_structure_id");
  const selectedType = useMemo(() => types.find((item) => item.slug === typeSlug) || null, [types, typeSlug]);
  const canonicalType = useMemo(
    () =>
      resolveCanonicalOperationType({
        categorySlug: selectedType?.category_slug || categorySlug,
        typeSlug,
        operationType: selectedType?.name_ru || form.getValues("operation_type"),
      }),
    [categorySlug, form, selectedType, typeSlug]
  );
  const canonicalSlug = canonicalType?.slug as CanonicalOperationTypeSlug | undefined;
  const purposeOptions = useMemo(() => getPurposeDefinitionsForOperation(canonicalSlug), [canonicalSlug]);
  const impliedPurpose = typeSlug ? IMPLIED_PURPOSE_BY_TEMPLATE[typeSlug] || null : null;
  const visiblePurposeOptions = useMemo(
    () => purposeOptions.filter((purpose) => purpose.slug !== "seed_treatment" && purpose.slug !== impliedPurpose),
    [impliedPurpose, purposeOptions]
  );
  const selectedCropStructure = useMemo(
    () => cropStructures.find((item) => item.id === selectedCropStructureId) || null,
    [cropStructures, selectedCropStructureId]
  );
  const selectedField = useMemo(
    () => fields.find((item) => item.id === selectedFieldId) || null,
    [fields, selectedFieldId]
  );
  const isWholeFieldScope = operationParams.scope === "whole_field" || (lockedContext && !!selectedFieldId && !selectedCropStructureId);
  const selectedIrrigationType = normalizeIrrigationType((selectedCropStructure as any)?.irrigation_type);
  const hasExplicitIrrigationType = selectedIrrigationType !== "unknown";
  const selectedIsPotato = isPotatoCropContext(
    selectedCropStructure?.crop_name,
    selectedCropStructure?.variety_name
  );
  const availabilityContext = useMemo(
    () => ({
      cropName: selectedCropStructure?.crop_name || null,
      varietyName: selectedCropStructure?.variety_name || null,
      irrigationType: selectedIrrigationType,
      hasCropStructure: Boolean(selectedCropStructure),
    }),
    [selectedCropStructure, selectedIrrigationType]
  );
  const selectedFieldCropStructures = useMemo(
    () =>
      cropStructures.filter(
        (item) => !item.archived && selectedFieldId && item.field_id === selectedFieldId
      ),
    [cropStructures, selectedFieldId]
  );
  const selectedCropStructureArea = selectedCropStructure ? Number(selectedCropStructure.area || 0) : null;
  const availableCategories = useMemo(() => {
    return categories.filter((category) => {
      if (isWholeFieldScope && !WHOLE_FIELD_ALLOWED_CATEGORIES.has(category.slug)) return false;
      const expectedSubtypeSlugs = new Set(
        OPERATION_SUBTYPE_DEFINITIONS.filter((item) => item.categorySlug === category.slug).map((item) => item.slug)
      );
      const rows = types.filter((item) => {
        if (item.category_slug !== category.slug) return false;
        if (expectedSubtypeSlugs.size > 0 && !expectedSubtypeSlugs.has(item.slug)) return false;
        return getOperationTemplateAvailability({
          ...availabilityContext,
          categorySlug: item.category_slug,
          typeSlug: item.slug,
          operationType: item.name_ru,
        }).allowed;
      });
      return rows.length > 0;
    });
  }, [availabilityContext, categories, isWholeFieldScope, types]);
  const typeOptions = useMemo(() => {
    const rows = types.filter((item) => !categorySlug || item.category_slug === categorySlug);
    const expectedSubtypeSlugs = new Set(
      OPERATION_SUBTYPE_DEFINITIONS.filter((item) => item.categorySlug === categorySlug).map((item) => item.slug)
    );
    const subtypeRows = expectedSubtypeSlugs.size > 0 ? rows.filter((item) => expectedSubtypeSlugs.has(item.slug)) : rows;
    return subtypeRows.filter((item) => {
      if (isWholeFieldScope && !WHOLE_FIELD_ALLOWED_CATEGORIES.has(item.category_slug)) return false;
      if (item.category_slug === "planting" && HIDDEN_PLANTING_SUBTYPE_SLUGS.has(item.slug)) return false;
      return getOperationTemplateAvailability({
        ...availabilityContext,
        categorySlug: item.category_slug,
        typeSlug: item.slug,
        operationType: item.name_ru,
      }).allowed;
    });
  }, [availabilityContext, types, categorySlug, isWholeFieldScope]);
  const cropStructureOptions = useMemo(
    () =>
      cropStructures
        .filter((item) => !item.archived && (!selectedFieldId || item.field_id === selectedFieldId))
        .map((item) => ({
          id: item.id,
          label: `${item.crop_name || "без культуры"} / ${item.variety_name || "без сорта"} / ${
            item.reproduction_name || "без репр."
          } — ${Number(item.area || 0).toFixed(2)} га`,
        })),
    [cropStructures, selectedFieldId]
  );

  const fieldLabelWithArea = (field: Field) => {
    const title = getFieldDisplayName(field).trim();
    const prefixedTitle = title.toLowerCase().startsWith("поле") ? title : `Поле ${title}`;
    return `${prefixedTitle} — ${Number(field.area || 0).toFixed(0)} га`;
  };

  const fieldOptions = useMemo(() => {
    return fields.map((field) => {
      return {
        id: field.id,
        label: fieldLabelWithArea(field),
      };
    });
  }, [fields]);

  const specialistOptions = useMemo(
    () =>
      specialists.map((specialist) => ({
        id: specialist.id,
        label: String(specialist.full_name || specialist.email),
        hint: specialist.role,
      })),
    [specialists]
  );

  const machineOptions = useMemo(() => machines.map((item) => ({ id: item.id, label: item.name })), [machines]);
  const equipmentOptions = useMemo(() => equipment.map((item) => ({ id: item.id, label: item.name })), [equipment]);
  const transportOptions = useMemo(() => transports.map((item) => ({ id: item.id, label: item.name })), [transports]);
  const productOptions = useMemo(
    () =>
      products.map((item) => ({
        id: item.id,
        label: item.name,
        hint: `${Number(item.availableQty || 0).toLocaleString("ru-RU")} ${item.unit || ""}${
          item.warehouseNames.length > 0 ? ` • ${item.warehouseNames.slice(0, 2).join(", ")}` : ""
        }`,
      })),
    [products]
  );
  const cropCatalogOptions = useMemo(
    () => cropCatalog.map((item) => ({ id: item.id, label: item.name })),
    [cropCatalog]
  );
  const structureEditorCropId = structureChangeCropId || selectedCropStructure?.crop_id || "";
  const structureEditorVarietyId =
    structureChangeVarietyId !== "none"
      ? structureChangeVarietyId
      : selectedCropStructure?.variety_id || "none";
  const structureEditorReproductionId =
    structureChangeReproductionId !== "none"
      ? structureChangeReproductionId
      : selectedCropStructure?.reproduction_id || "none";
  const operationCropName =
    cropCatalog.find((item) => item.id === structureEditorCropId)?.name || selectedCropStructure?.crop_name || null;
  const operationVarietyName =
    varietyCatalog.find((item) => item.id === structureEditorVarietyId)?.name || selectedCropStructure?.variety_name || null;
  const operationReproductionName =
    reproductionCatalog.find((item) => item.id === structureEditorReproductionId)?.name || selectedCropStructure?.reproduction_name || null;
  const operationIsPotato = isPotatoCropContext(operationCropName, operationVarietyName);
  const structureChangeActive = Boolean(
    selectedCropStructure &&
      ((structureEditorCropId || "") !== (selectedCropStructure.crop_id || "") ||
        structureEditorVarietyId !== (selectedCropStructure.variety_id || "none") ||
        structureEditorReproductionId !== (selectedCropStructure.reproduction_id || "none"))
  );
  const structureChangeVarietyOptions = useMemo(
    () =>
      varietyCatalog
        .filter((item) => !structureEditorCropId || item.crop_id === structureEditorCropId)
        .map((item) => ({ id: item.id, label: item.name })),
    [structureEditorCropId, varietyCatalog]
  );
  const structureChangeReproductionOptions = useMemo(
    () => reproductionCatalog.map((item) => ({ id: item.id, label: item.name })),
    [reproductionCatalog]
  );

  useEffect(() => {
    form.setValue("materials", materials);
  }, [materials, form]);

  useEffect(() => {
    if (!open) return;
    submitInFlightRef.current = false;
    submitIdempotencyKeyRef.current = createOperationIdempotencyKey();
    setSubmitting(false);
    setSubmitError(null);
    form.clearErrors();
  }, [open]);

  useEffect(() => {
    if (!open || !profile?.company_id) return;
    (async () => {
      const [catRes, typeRes, machinesRes, equipmentRes, transportRes, stockRes, cropsRes, varietiesRes, reproductionsRes] = await Promise.all([
        supabase.from("operation_categories").select("id,slug,name_ru,is_active").eq("is_active", true).order("name_ru"),
        supabase
          .from("operation_types")
          .select("id,slug,name_ru,category_slug,requires_machine,requires_product,requires_field,affects_inventory,affects_field_history,is_active")
          .eq("is_active", true)
          .order("name_ru"),
        supabase.from("reference_machines").select("id,name").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("reference_equipment").select("id,name").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("reference_vehicles").select("id,name").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase
          .from("v_stock_balance_identity")
          .select("product_id,warehouse_id,quantity")
          .eq("company_id", profile.company_id)
          .gt("quantity", 0),
        supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug,archived,is_active").order("name"),
        supabase.from("varieties").select("id,name,crop_id,archived,is_active").order("name"),
        supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code,archived,is_active").order("name"),
      ]);

      if (!catRes.error) setCategories(mergeCanonicalCategories((catRes.data || []) as OperationCategory[]));
      if (!typeRes.error) setTypes(mergeCanonicalTypes((typeRes.data || []) as OperationTypeMaster[]));
      if (!machinesRes.error) setMachines((machinesRes.data || []).map((row: any) => ({ id: String(row.id), name: String(row.name || "-") })));
      if (!equipmentRes.error) setEquipment((equipmentRes.data || []).map((row: any) => ({ id: String(row.id), name: String(row.name || "-") })));
      if (!transportRes.error) setTransports((transportRes.data || []).map((row: any) => ({ id: String(row.id), name: String(row.name || "-") })));
      if (!cropsRes.error) {
        setCropCatalog(
          (cropsRes.data || [])
            .filter((row: any) => !row.archived && row.is_active !== false)
            .map((row: any) => ({ id: String(row.id), name: localizedName(row, "ru") || "-" }))
        );
      }
      if (!varietiesRes.error) {
        setVarietyCatalog(
          (varietiesRes.data || [])
            .filter((row: any) => !row.archived && row.is_active !== false)
            .map((row: any) => ({ id: String(row.id), name: brandName(row) || "-", crop_id: String(row.crop_id || "") }))
        );
      }
      if (!reproductionsRes.error) {
        setReproductionCatalog(
          (reproductionsRes.data || [])
            .filter((row: any) => !row.archived && row.is_active !== false)
            .map((row: any) => ({ id: String(row.id), name: localizedName(row, "ru", ["name", "code"]) || "-" }))
        );
      }
      if (!stockRes.error) {
        const stockRows = (stockRes.data || []).filter((row: any) => row.product_id);
        const productIds = Array.from(new Set(stockRows.map((row: any) => String(row.product_id))));
        const warehouseIds = Array.from(new Set(stockRows.map((row: any) => String(row.warehouse_id || "")).filter(Boolean)));

        if (productIds.length === 0) {
          setProducts([]);
        } else {
          const [productMetaRes, warehouseMetaRes] = await Promise.all([
            supabase
              .from("products")
              .select("id,name,trade_name,type,unit")
              .or(`company_id.eq.${profile.company_id},company_id.is.null`)
              .eq("archived", false)
              .eq("is_active", true)
              .in("id", productIds)
              .order("name"),
            warehouseIds.length > 0
              ? supabase
                  .from("warehouses")
                  .select("id,name,warehouse_type,description,archived,is_archived")
                  .eq("company_id", profile.company_id)
                  .in("id", warehouseIds)
              : Promise.resolve({ data: [], error: null } as any),
          ]);

          const productMetaById = new Map<string, { name: string; type: string | null; unit: string | null }>(
            (productMetaRes.data || []).map((row: any) => [
              String(row.id),
              {
                name: String(row.trade_name || row.name || "-"),
                type: row.type ? String(row.type) : null,
                unit: row.unit ? String(row.unit) : null,
              },
            ])
          );
          const warehouseNameById = new Map<string, string>(
            (warehouseMetaRes.data || []).map((row: any) => [String(row.id), String(row.name || "-")])
          );
          const productionWarehouseIds = new Set(
            (warehouseMetaRes.data || [])
              .filter((row: any) => !row.archived && !row.is_archived)
              .filter((row: any) => !hasQaDataMarker(`${row.name || ""} ${row.warehouse_type || ""} ${row.description || ""}`))
              .map((row: any) => String(row.id))
          );
          const grouped = new Map<string, ProductOption>();

          stockRows.forEach((row: any) => {
            if (!productionWarehouseIds.has(String(row.warehouse_id || ""))) return;
            const productId = String(row.product_id);
            const meta = productMetaById.get(productId);
            if (!meta) return;
            const current =
              grouped.get(productId) ||
              ({
                id: productId,
                name: meta.name,
                type: meta.type,
                unit: meta.unit,
                availableQty: 0,
                warehouseNames: [],
              } satisfies ProductOption);
            current.availableQty += Number(row.quantity || 0);
            const warehouseName = warehouseNameById.get(String(row.warehouse_id || ""));
            if (warehouseName && !current.warehouseNames.includes(warehouseName)) {
              current.warehouseNames.push(warehouseName);
            }
            grouped.set(productId, current);
          });

          setProducts(Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name, "ru")));
        }
      }
    })();
  }, [open, profile?.company_id]);

  useEffect(() => {
    if (!open) return;
    const initial = defaultValues || {};
    const initialCanonical = resolveCanonicalOperationType({
      categorySlug: initial.operation_category_slug,
      typeSlug: initial.operation_type_slug,
      operationType: initial.operation_type,
    });
    const initialCategory = initialCanonical?.categorySlug || String(initial.operation_category_slug || "").trim();
    const initialType = String(initial.operation_type_slug || initialCanonical?.slug || "").trim();
    const initialMaterials = Array.isArray(initial.materials)
      ? (initial.materials as OperationMaterialFormData[]).map((item) => {
          const component = getTankMixComponentDefinition(item.component_type || item.material_type);
          return {
            ...item,
            component_type: component.slug,
            material_type: toStorageMaterialType(component.slug),
            product_id: item.product_id || "",
            unit: item.unit || getDefaultUnitForComponent(component.slug),
          };
        })
      : [];
    const initialTankMix = initial.tank_mix || null;
    form.reset({
      field_id: String(initial.field_id || ""),
      crop_structure_id: initial.crop_structure_id || null,
      operation_category_slug: initialCategory,
      operation_type_slug: initialType,
      operation_type: String(initial.operation_type || initialCanonical?.label || ""),
      planned_area_ha: initial.planned_area_ha ?? null,
      crop_id: initial.crop_id || null,
      machine_id: initial.machine_id || null,
      equipment_id: initial.equipment_id || null,
      transport_id: initial.transport_id || null,
      operation_target: initial.operation_target || null,
      rate_per_ha: initial.rate_per_ha ?? null,
      spray_volume_per_ha: initial.spray_volume_per_ha ?? null,
      row_spacing_m: initial.row_spacing_m ?? null,
      seed_spacing_cm: initial.seed_spacing_cm ?? null,
      operation_params: initial.operation_params || null,
      date: String(initial.date || new Date().toISOString().slice(0, 10)),
      responsible_user_id: initial.responsible_user_id || null,
      notes: String(initial.notes || ""),
      purposes: Array.isArray(initial.purposes) ? initial.purposes : [],
      tank_mix: initialTankMix || undefined,
      materials: initialMaterials,
    });

    setCategorySlug(initialCategory);
    setTypeSlug(initialType);
    setPurposes((Array.isArray(initial.purposes) ? initial.purposes : []) as OperationPurposeSlug[]);
    setTankMixEnabled(Boolean(initialTankMix?.enabled));
    setTankMixWaterRate(initialTankMix?.water_rate_l_ha ?? null);
    setOperationParams(
      initial.operation_params && typeof initial.operation_params === "object" && !Array.isArray(initial.operation_params)
        ? initial.operation_params
        : {}
    );
    setMaterials(initialMaterials);
    setStructureChangeMode("none");
    setStructureChangeCropId("");
    setStructureChangeVarietyId("none");
    setStructureChangeReproductionId("none");
  }, [defaultValues, form, open]);

  useEffect(() => {
    if (!open || !selectedCropStructure) return;
    form.setValue("field_id", selectedCropStructure.field_id);
    form.setValue("crop_id", selectedCropStructure.crop_id);
    form.setValue("planned_area_ha", Number(selectedCropStructure.area || 0));
    const structureRowSpacing = Number((selectedCropStructure as any).row_spacing_m || 0);
    const structureSeedSpacing = Number((selectedCropStructure as any).seed_spacing_cm || 0);
    const nextRowSpacing = structureRowSpacing > 0 ? structureRowSpacing : selectedIsPotato ? 0.75 : null;
    const nextSeedSpacing = structureSeedSpacing > 0 ? structureSeedSpacing : selectedIsPotato ? 32 : null;
    if (!form.getValues("row_spacing_m") && nextRowSpacing) {
      form.setValue("row_spacing_m", nextRowSpacing);
    }
    if (!form.getValues("seed_spacing_cm") && nextSeedSpacing) {
      form.setValue("seed_spacing_cm", nextSeedSpacing);
    }
    setOperationParams((prev) => ({
      ...prev,
      irrigation_type: selectedIrrigationType,
      crop_context: {
        crop: selectedCropStructure.crop_name || null,
        variety: selectedCropStructure.variety_name || null,
        reproduction: selectedCropStructure.reproduction_name || null,
        area_ha: Number(selectedCropStructure.area || 0),
      },
    }));
  }, [form, open, selectedCropStructure, selectedIrrigationType, selectedIsPotato]);

  useEffect(() => {
    if (!open || !selectedFieldId || isWholeFieldScope) return;
    if (selectedCropStructure && selectedCropStructure.field_id === selectedFieldId) return;
    if (selectedFieldCropStructures.length === 1) {
      const onlyStructure = selectedFieldCropStructures[0];
      form.setValue("crop_structure_id", onlyStructure.id);
      form.setValue("crop_id", onlyStructure.crop_id);
      form.setValue("planned_area_ha", Number(onlyStructure.area || 0));
      return;
    }
    if (selectedCropStructureId && selectedCropStructure?.field_id !== selectedFieldId) {
      form.setValue("crop_structure_id", null);
      form.setValue("crop_id", null);
      form.setValue("planned_area_ha", null);
    }
  }, [
    form,
    open,
    isWholeFieldScope,
    selectedCropStructure,
    selectedCropStructureId,
    selectedFieldCropStructures,
    selectedFieldId,
  ]);

  useEffect(() => {
    if (!open || categorySlug !== "planting" || !operationIsPotato) return;
    if (!form.getValues("row_spacing_m")) {
      form.setValue("row_spacing_m", 0.75);
    }
    if (!form.getValues("seed_spacing_cm")) {
      form.setValue("seed_spacing_cm", 32);
    }
  }, [categorySlug, form, open, operationIsPotato]);

  useEffect(() => {
    if (!open) return;
    if (categorySlug && !availableCategories.some((category) => category.slug === categorySlug)) {
      setCategorySlug("");
      setTypeSlug("");
      form.setValue("operation_category_slug", "");
      form.setValue("operation_type_slug", "");
      form.setValue("operation_type", "");
      return;
    }
    if (typeSlug && !typeOptions.some((item) => item.slug === typeSlug)) {
      setTypeSlug("");
      form.setValue("operation_type_slug", "");
      form.setValue("operation_type", "");
    }
  }, [availableCategories, categorySlug, form, open, typeOptions, typeSlug]);

  useEffect(() => {
    if (!open) return;
    if (typeSlug) return;
    const operationTypeName = String(form.getValues("operation_type") || "").trim().toLowerCase();
    if (!operationTypeName) return;
    const inferred = types.find((item) => String(item.name_ru || "").trim().toLowerCase() === operationTypeName);
    if (!inferred) return;
    setCategorySlug(inferred.category_slug);
    setTypeSlug(inferred.slug);
    form.setValue("operation_category_slug", inferred.category_slug);
    form.setValue("operation_type_slug", inferred.slug);
  }, [form, open, typeSlug, types]);

  useEffect(() => {
    if (!open) return;
    if (!categorySlug || typeSlug) return;
    if (typeOptions.length !== 1) return;
    const singleType = typeOptions[0];
    const canonical = resolveCanonicalOperationType({
      categorySlug: singleType.category_slug,
      typeSlug: singleType.slug,
      operationType: singleType.name_ru,
    });
    setCategorySlug(canonical?.categorySlug || singleType.category_slug);
    setTypeSlug(singleType.slug);
    form.setValue("operation_category_slug", canonical?.categorySlug || singleType.category_slug);
    form.setValue("operation_type_slug", singleType.slug);
    form.setValue("operation_type", singleType.name_ru);
  }, [categorySlug, form, open, typeOptions, typeSlug]);

  useEffect(() => {
    if (!open) return;
    if (categorySlug !== "planting" || typeSlug || !selectedCropStructure) return;
    const desiredSlug = operationIsPotato ? "potato_planting" : "seeding";
    const desiredType = typeOptions.find((item) => item.slug === desiredSlug);
    if (!desiredType) return;
    setTypeSlug(desiredType.slug);
    form.setValue("operation_type_slug", desiredType.slug);
    form.setValue("operation_type", desiredType.name_ru);
  }, [categorySlug, form, open, operationIsPotato, selectedCropStructure, typeOptions, typeSlug]);

  useEffect(() => {
    if (!open || categorySlug !== "planting" || !selectedCropStructure) return;
    const desiredSlug = operationIsPotato ? "potato_planting" : "seeding";
    if (typeSlug === desiredSlug) return;
    if (typeSlug !== "potato_planting" && typeSlug !== "seeding") return;
    const desiredType = typeOptions.find((item) => item.slug === desiredSlug);
    if (!desiredType) return;
    setTypeSlug(desiredType.slug);
    form.setValue("operation_type_slug", desiredType.slug);
    form.setValue("operation_type", desiredType.name_ru);
  }, [categorySlug, form, open, operationIsPotato, selectedCropStructure, typeOptions, typeSlug]);

  useEffect(() => {
    if (!open) return;
    if (!canonicalType) {
      setPurposes([]);
      setTankMixEnabled(false);
      setTankMixWaterRate(null);
      return;
    }
    if (!canonicalType.supportsTankMix) {
      setTankMixEnabled(false);
      setTankMixWaterRate(null);
    } else if (typeSlug && materials.length === 0) {
      setTankMixEnabled(true);
    }
    setPurposes((prev) =>
      prev.filter((purpose) => visiblePurposeOptions.some((definition) => definition.slug === purpose))
    );
  }, [canonicalType, materials.length, open, visiblePurposeOptions, typeSlug]);

  useEffect(() => {
    if (
      structureChangeVarietyId !== "none" &&
      !structureChangeVarietyOptions.some((option) => option.id === structureChangeVarietyId)
    ) {
      setStructureChangeVarietyId("none");
    }
  }, [structureChangeVarietyId, structureChangeVarietyOptions]);

  useEffect(() => {
    if (!structureChangeActive && structureChangeMode !== "none") {
      setStructureChangeMode("none");
    }
  }, [structureChangeActive, structureChangeMode]);

  const isSeeding = canonicalType?.slug === "planting";
  const isFertilizing = canonicalType?.slug === "fertilizer_application";
  const isHarvest = canonicalType?.slug === "harvesting";
  const isFertigation = canonicalType?.slug === "fertigation";
  const isIrrigation = canonicalType?.slug === "irrigation";
  const isPotatoPlanting = operationIsPotato && typeSlug === "potato_planting";
  const compactAutoPlantingType =
    categorySlug === "planting" &&
    !!selectedCropStructure &&
    (typeSlug === "potato_planting" || typeSlug === "seeding");
  const isDripTapeRidge = typeSlug === "ridge_forming_with_drip_tape";
  const isDripTapeCollection = typeSlug === "drip_tape_collection" || typeSlug === "tape_residue_collection";
  const showPurposeEngine = !!canonicalType?.supportsPurposes && visiblePurposeOptions.length > 0;
  const showTankMix = !!canonicalType?.supportsTankMix;
  const showMaterials = (!!canonicalType?.supportsMaterials || isDripTapeRidge) && !isHarvest;
  const showMachine = canonicalType ? canonicalType.requiresMachine || isDripTapeCollection || typeSlug === "haulm_topping" : !!selectedType?.requires_machine;
  const showTransport = canonicalType?.slug === "harvesting" || canonicalType?.slug === "transport";
  const showField = canonicalType ? canonicalType.requiresCropStructure : true;
  const cropStructureRequired = isWholeFieldScope ? false : canonicalType ? canonicalType.requiresCropStructure : requiresCropStructureForType(selectedType);
  const maxOperationArea = selectedCropStructureArea ?? (isWholeFieldScope && selectedField ? Number(selectedField.area || 0) : null);

  useEffect(() => {
    if (!open || !isPotatoPlanting) return;
    setMaterials((prev) => {
      const next = prev.filter((material) => {
        const component = getTankMixComponentDefinition(material.component_type || material.material_type);
        const product = products.find((item) => item.id === material.product_id);
        return component.slug !== "seed" && !isPotatoSeedProduct(product);
      });
      return next.length === prev.length ? prev : next;
    });
  }, [isPotatoPlanting, open, products]);

  const componentOptions = useMemo(() => {
    const allowed = isDripTapeRidge
      ? new Set<TankMixComponentType>(["other"])
      : isPotatoPlanting
      ? new Set<TankMixComponentType>([
          "fertilizer",
          "micro_fertilizer",
          "crop_protection",
          "biological",
          "biostimulant",
          "adjuvant",
          "ph_corrector",
          "antifoam",
          "other",
        ])
      : isSeeding
      ? new Set<TankMixComponentType>(["seed", "fertilizer", "micro_fertilizer", "crop_protection", "biological", "biostimulant", "other"])
      : showTankMix
        ? new Set<TankMixComponentType>([
            "crop_protection",
            "fertilizer",
            "micro_fertilizer",
            "biological",
            "biostimulant",
            "adjuvant",
            "ph_corrector",
            "antifoam",
            "water",
            "other",
          ])
        : isFertilizing
          ? new Set<TankMixComponentType>(["fertilizer", "micro_fertilizer", "biological", "biostimulant", "other"])
          : new Set<TankMixComponentType>(TANK_MIX_COMPONENT_DEFINITIONS.map((item) => item.slug));
    return TANK_MIX_COMPONENT_DEFINITIONS.filter((item) => allowed.has(item.slug));
  }, [isDripTapeRidge, isFertilizing, isPotatoPlanting, isSeeding, showTankMix]);
  const rowSpacingM = form.watch("row_spacing_m");
  const seedSpacingCm = form.watch("seed_spacing_cm");
  const plannedAreaHa = form.watch("planned_area_ha");
  const seedRateKgHa = form.watch("rate_per_ha");
  const plantsPerHa =
    rowSpacingM && seedSpacingCm && rowSpacingM > 0 && seedSpacingCm > 0
      ? Math.round(10000 / (rowSpacingM * (seedSpacingCm / 100)))
      : null;
  const totalPlants =
    plantsPerHa && plannedAreaHa && plannedAreaHa > 0
      ? Math.round(plantsPerHa * plannedAreaHa)
      : null;
  const seedRateTHa = seedRateKgHa && seedRateKgHa > 0 ? seedRateKgHa / 1000 : null;
  const totalSeedKg =
    seedRateKgHa && seedRateKgHa > 0 && plannedAreaHa && plannedAreaHa > 0
      ? seedRateKgHa * plannedAreaHa
      : null;
  const totalSeedT = totalSeedKg && totalSeedKg > 0 ? totalSeedKg / 1000 : null;

  const updateOperationParam = (key: string, value: unknown) => {
    setOperationParams((prev) => ({
      ...prev,
      [key]: value === "" ? null : value,
    }));
  };

  const getOperationParam = (key: string): string | number | readonly string[] | undefined => {
    const value = operationParams[key];
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return value;
    return String(value);
  };

  const isAdditionalComponent = (componentType: TankMixComponentType) => {
    if (isDripTapeRidge) return false;
    if (isPotatoPlanting) {
      return componentType !== "fertilizer" && componentType !== "micro_fertilizer";
    }
    return ADDITIONAL_COMPONENT_TYPES.has(componentType);
  };

  const defaultMaterialComponent = (group: "main" | "additional"): TankMixComponentType => {
    const allowed = new Set(componentOptions.map((component) => component.slug));
    if (group === "additional") {
      if (isPotatoPlanting) {
        return (["crop_protection", "biostimulant", "biological", "ph_corrector", "adjuvant", "antifoam", "other"] as TankMixComponentType[])
          .find((slug) => allowed.has(slug)) || componentOptions[0]?.slug || "other";
      }
      return (["ph_corrector", "adjuvant", "antifoam", "biostimulant", "other"] as TankMixComponentType[])
        .find((slug) => allowed.has(slug)) || componentOptions[0]?.slug || "other";
    }
    const preferred = isDripTapeRidge
      ? "other"
      : isPotatoPlanting
        ? "fertilizer"
        : canonicalType?.defaultComponentType || (isSeeding ? "seed" : "fertilizer");
    if (allowed.has(preferred)) return preferred;
    return componentOptions.find((component) => !isAdditionalComponent(component.slug))?.slug || componentOptions[0]?.slug || "fertilizer";
  };

  const addMaterial = (group: "main" | "additional" = "main") => {
    const componentType = defaultMaterialComponent(group);
    setMaterials((prev) => [
      ...prev,
      {
        component_type: componentType,
        material_type: toStorageMaterialType(componentType),
        product_id: "",
        batch_id: null,
        planned_rate: null,
        actual_rate: null,
        unit: getDefaultUnitForComponent(componentType),
        notes: null,
      },
    ]);
  };

  const updateMaterial = (index: number, patch: Partial<OperationMaterialFormData>) => {
    setMaterials((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const removeMaterial = (index: number) => {
    setMaterials((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  const materialRows = materials.map((material, index) => ({
    material,
    index,
    component: getTankMixComponentDefinition(material.component_type || material.material_type),
  }));
  const mainMaterialRows = materialRows.filter((row) => !isAdditionalComponent(row.component.slug));
  const additionalMaterialRows = materialRows.filter((row) => isAdditionalComponent(row.component.slug));

  const productOptionsForMaterial = (material: OperationMaterialFormData) => {
    const component = getTankMixComponentDefinition(material.component_type || material.material_type);
    if (component.slug === "seed" && isPotatoPlanting) return [];
    return productOptions.filter((option) => {
      const product = products.find((item) => item.id === option.id);
      if (isPotatoPlanting && isPotatoSeedProduct(product)) return false;
      return productMatchesComponent(product, component.slug);
    });
  };

  const renderMaterialRow = (material: OperationMaterialFormData, index: number) => (
    <div key={`material-${index}`} className="rounded border p-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        <div>
          <div className="mb-1 text-xs text-slate-500">Тип</div>
          <Select
            value={material.component_type || getTankMixComponentDefinition(material.material_type).slug}
            onValueChange={(value) => {
              const component = getTankMixComponentDefinition(value);
              updateMaterial(index, {
                component_type: component.slug,
                material_type: toStorageMaterialType(component.slug),
                unit: getDefaultUnitForComponent(component.slug),
                product_id: component.productRequired ? material.product_id || "" : null,
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {componentOptions.map((component) => (
                <SelectItem key={component.slug} value={component.slug}>
                  {component.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <div className="mb-1 text-xs text-slate-500">Продукт</div>
          {getTankMixComponentDefinition(material.component_type || material.material_type).productRequired ? (
            <SearchableSelect
              value={material.product_id || ""}
              onChange={(productId) => {
                const product = products.find((item) => item.id === productId);
                const inferredType = inferMaterialTypeByProductType(product?.type);
                const inferredComponent = getTankMixComponentDefinition(material.component_type || inferredType);
                updateMaterial(index, {
                  product_id: productId,
                  component_type: inferredComponent.slug,
                  material_type: toStorageMaterialType(inferredComponent.slug),
                  unit: (product?.unit === "kg" || product?.unit === "l" || product?.unit === "pcs")
                    ? (product.unit as "kg" | "l" | "pcs")
                    : getDefaultUnitForComponent(inferredComponent.slug),
                });
              }}
              options={productOptionsForMaterial(material)}
              placeholder={isPotatoPlanting ? "Выберите удобрение или препарат" : "Выберите продукт"}
              emptyLabel="Нет остатка на складе"
            />
          ) : (
            <div className="flex h-8 items-center rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">
              Без складского продукта
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-500">Норма</div>
          <Input
            className="h-8 text-xs"
            value={material.planned_rate ?? ""}
            onChange={(event) => updateMaterial(index, { planned_rate: normalizeNumber(event.target.value) })}
            placeholder="кг/га или л/га"
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-500">Ед.</div>
          <div className="flex items-center gap-1">
            <Select
              value={material.unit}
              onValueChange={(value) =>
                updateMaterial(index, {
                  unit: (value as "kg" | "l" | "pcs"),
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">кг</SelectItem>
                <SelectItem value="l">л</SelectItem>
                <SelectItem value="pcs">шт</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-red-600"
              onClick={() => removeMaterial(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  const togglePurpose = (slug: OperationPurposeSlug, checked: boolean) => {
    setPurposes((prev) => {
      if (checked) return Array.from(new Set([...prev, slug]));
      return prev.filter((item) => item !== slug);
    });
  };

  const handleCategoryChange = (slug: string) => {
    const canonical = resolveCanonicalOperationType({ categorySlug: slug });
    const nextCategory = canonical?.categorySlug || slug;
    setSubmitError(null);
    setCategorySlug(nextCategory);
    form.setValue("operation_category_slug", nextCategory);
    setTypeSlug("");
    form.setValue("operation_type_slug", "");
    form.setValue("operation_type", "");
    form.setValue("transport_id", null);
    form.clearErrors(["operation_type", "operation_type_slug"]);
  };

  const handleTypeChange = (slug: string) => {
    const type = types.find((item) => item.slug === slug);
    const canonical = resolveCanonicalOperationType({
      categorySlug: type?.category_slug || categorySlug,
      typeSlug: slug,
      operationType: type?.name_ru || "",
    });
    const nextCategory = canonical?.categorySlug || type?.category_slug || categorySlug;
    const nextType = type?.slug || slug;
    setSubmitError(null);
    setCategorySlug(nextCategory);
    setTypeSlug(nextType);
    form.setValue("operation_category_slug", nextCategory);
    form.setValue("operation_type_slug", nextType);
    form.setValue("operation_type", type?.name_ru || canonical?.label || "");
    form.clearErrors(["operation_type", "operation_type_slug"]);
  };

  const handleInvalidSubmit = (errors: FieldErrors<OperationFormData>) => {
    submitInFlightRef.current = false;
    setSubmitting(false);
    const hasOperationTypeError = Boolean(errors.operation_type || errors.operation_type_slug);
    if (hasOperationTypeError) {
      const message = "Выберите производственный блок и работу.";
      form.setError("operation_type", { message });
      setSubmitError(message);
      return;
    }
    const firstError = Object.values(errors)[0] as { message?: string } | undefined;
    setSubmitError(firstError?.message || "Проверьте обязательные поля формы.");
  };

  const submit = async (data: OperationFormData) => {
    if (submitInFlightRef.current) return;
    setSubmitError(null);
    if (!selectedType) {
      const message = "Выберите производственный блок и работу.";
      form.setError("operation_type", { message });
      setSubmitError(message);
      return;
    }
    if (isWholeFieldScope && !WHOLE_FIELD_ALLOWED_CATEGORIES.has(canonicalType?.categorySlug || selectedType.category_slug)) {
      const message = "Для всего поля доступны только уборка, логистика, сервис и послеуборочные работы.";
      form.setError("operation_type", { message });
      setSubmitError(message);
      return;
    }
    if (maxOperationArea != null && maxOperationArea > 0 && Number(data.planned_area_ha || 0) > maxOperationArea) {
      const message = `Площадь не должна превышать ${maxOperationArea.toFixed(2)} га`;
      form.setError("planned_area_ha", { message });
      setSubmitError(message);
      return;
    }
    if (cropStructureRequired && !data.crop_structure_id) {
      const message = "Выберите культуру на поле.";
      form.setError("crop_structure_id", { message });
      setSubmitError(message);
      return;
    }
    if (!data.responsible_user_id) {
      const message = "Выберите ответственного специалиста.";
      form.setError("responsible_user_id", { message });
      setSubmitError(message);
      return;
    }
    if (isPotatoPlanting && (!data.seed_spacing_cm || data.seed_spacing_cm <= 0)) {
      const message = "Укажите межклубневое расстояние для посадки картофеля.";
      form.setError("seed_spacing_cm", { message });
      setSubmitError(message);
      return;
    }
    if (isPotatoPlanting && (!data.rate_per_ha || data.rate_per_ha <= 0)) {
      const message = "Укажите норму посадки картофеля в кг/га.";
      form.setError("rate_per_ha", { message });
      setSubmitError(message);
      return;
    }
    if ((isIrrigation || isFertigation) && !operationParams.water_norm_mm && !operationParams.water_volume_m3) {
      const message = "Укажите норму воды или общий объём воды.";
      setSubmitError(message);
      return;
    }
    const normalizedMaterials = materials.map((item) => {
      const component = getTankMixComponentDefinition(item.component_type || item.material_type);
      return {
        component_type: component.slug,
        material_type: toStorageMaterialType(component.slug),
        product_id: item.product_id || null,
        batch_id: item.batch_id || null,
        planned_rate: item.planned_rate ?? null,
        actual_rate: item.actual_rate ?? null,
        unit: item.unit || getDefaultUnitForComponent(component.slug),
        notes: item.notes || null,
      };
    });
    const materialsForSubmit = normalizedMaterials.filter((item) => {
      const component = getTankMixComponentDefinition(item.component_type);
      return component.productRequired ? String(item.product_id || "").trim().length > 0 : true;
    });
    const inferredPurposesForSubmit = Array.from(
      new Set<OperationPurposeSlug>([
        ...purposes,
        ...(impliedPurpose ? ([impliedPurpose] as OperationPurposeSlug[]) : []),
        ...(isPotatoPlanting && materialsForSubmit.some((item) => item.component_type === "crop_protection")
          ? (["seed_treatment"] as OperationPurposeSlug[])
          : []),
      ])
    );
    if (isDripTapeRidge && materialsForSubmit.length === 0 && !operationParams.drip_tape_rolls && !operationParams.drip_tape_roll_length_m) {
      const message = "Для укладки ленты добавьте материал или укажите бухты/длину ленты.";
      setSubmitError(message);
      return;
    }
    const operationParamsForSubmit: Record<string, unknown> = {
      ...operationParams,
      irrigation_type: selectedIrrigationType,
      operation_template: typeSlug || null,
      row_spacing_m: data.row_spacing_m ?? null,
      seed_spacing_cm: data.seed_spacing_cm ?? null,
      seed_rate_kg_ha: isPotatoPlanting ? data.rate_per_ha ?? null : undefined,
      seed_rate_t_ha: isPotatoPlanting ? seedRateTHa : undefined,
      seed_requirement_kg: isPotatoPlanting ? totalSeedKg : undefined,
      seed_requirement_t: isPotatoPlanting ? totalSeedT : undefined,
      calculated_plants_per_ha: plantsPerHa,
      calculated_total_plants: totalPlants,
      calculated_tubers_per_ha: isPotatoPlanting ? plantsPerHa : undefined,
      calculated_total_tubers: isPotatoPlanting ? totalPlants : undefined,
      expected_density_plants_per_ha: isPotatoPlanting ? plantsPerHa : undefined,
      seed_material_context: isPotatoPlanting
        ? {
            crop: operationCropName || "Картофель",
            variety: operationVarietyName || null,
            reproduction: operationReproductionName || null,
            area_ha: data.planned_area_ha ?? null,
          }
        : undefined,
      tape_is_consumable_material: isDripTapeRidge || isDripTapeCollection ? true : undefined,
    };
    let structureChangePayload: OperationFormData["structure_change"] | undefined;
    if (isSeeding && structureChangeActive && structureChangeMode === "none") {
      const message = "План структуры отличается от операции. Выберите: заменить участок или выделить часть площади.";
      setSubmitError(message);
      return;
    }
    if (isSeeding && structureChangeMode !== "none") {
      if (!structureEditorCropId) {
        form.setError("operation_type", { message: "Выберите культуру для изменения плана" });
        return;
      }
      const requestedArea = Number(data.planned_area_ha || 0);
      const sourceArea = Number(selectedCropStructureArea || 0);
      if (structureChangeMode === "area_split" && (requestedArea <= 0 || requestedArea >= sourceArea)) {
        const message = `Для разделения укажите площадь больше 0 и меньше ${sourceArea.toFixed(2)} га`;
        form.setError("planned_area_ha", {
          message,
        });
        setSubmitError(message);
        return;
      }
      const sourceCrop = selectedCropStructure?.crop_name || "текущей культурой";
      const nextCrop = cropCatalog.find((item) => item.id === structureEditorCropId)?.name || "новая культура";
      const confirmed =
        structureChangeMode === "area_split"
          ? window.confirm(
              `По плану поле занято культурой ${sourceCrop} — ${sourceArea.toFixed(2)} га.\n` +
                `Вы хотите выделить ${requestedArea.toFixed(2)} га под ${nextCrop}?\n` +
                `Будет создано изменение структуры: ${sourceCrop} — ${(sourceArea - requestedArea).toFixed(2)} га, ${nextCrop} — ${requestedArea.toFixed(2)} га.`
            )
          : window.confirm(
              `Заменить культуру в плане?\n${sourceCrop} — ${sourceArea.toFixed(2)} га → ${nextCrop} — ${sourceArea.toFixed(2)} га.`
            );
      if (!confirmed) return;
      structureChangePayload = {
        mode: structureChangeMode,
        confirmed: true,
        new_crop_id: structureEditorCropId,
        new_variety_id: structureEditorVarietyId === "none" ? null : structureEditorVarietyId,
        new_reproduction_id: structureEditorReproductionId === "none" ? null : structureEditorReproductionId,
        area_ha: structureChangeMode === "area_split" ? requestedArea : sourceArea,
      };
    }
    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit(
        {
          ...data,
          operation_category_slug: canonicalType?.categorySlug || categorySlug,
          operation_type_slug: typeSlug,
          operation_type: selectedType.name_ru,
          operation_params: operationParamsForSubmit,
          purposes: inferredPurposesForSubmit,
          tank_mix: showTankMix
            ? {
                enabled: tankMixEnabled,
                water_rate_l_ha: tankMixWaterRate,
                total_solution_l_ha: data.spray_volume_per_ha ?? tankMixWaterRate,
                components: materialsForSubmit,
              }
            : undefined,
          materials: materialsForSubmit,
          structure_change: structureChangePayload,
          notes: String(data.notes || "").trim(),
        },
        { idempotencyKey: submitIdempotencyKeyRef.current }
      );
      onOpenChange(false);
    } catch (error) {
      submitInFlightRef.current = false;
      setSubmitting(false);
      setSubmitError(error instanceof Error ? error.message : "Не удалось создать план работы.");
    }
  };

  const responsibleUserId = form.watch("responsible_user_id");
  const actionIssues = [
    showField && !selectedFieldId ? "поле" : null,
    cropStructureRequired && !selectedCropStructureId ? "участок" : null,
    !categorySlug ? "тип работы" : null,
    !selectedType ? "работа" : null,
    !responsibleUserId ? "ответственный" : null,
    isPotatoPlanting && (!seedSpacingCm || seedSpacingCm <= 0) ? "межклубневое расстояние" : null,
    isPotatoPlanting && (!seedRateKgHa || seedRateKgHa <= 0) ? "норма посадки" : null,
    (isIrrigation || isFertigation) && !operationParams.water_norm_mm && !operationParams.water_volume_m3 ? "норма воды" : null,
  ].filter(Boolean) as string[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden border-slate-800 bg-[#0b1017] p-0 text-slate-100 shadow-2xl shadow-black/60 sm:max-w-[1120px]">
        <DialogHeader className="border-b border-slate-800 px-5 py-4">
          <DialogTitle>{isEdit ? "Редактировать операцию" : "Создать план работы"}</DialogTitle>
          <DialogDescription>
            {sourceLabel || "Выберите поле, участок структуры и работу. Остальное заполняется только по необходимости."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit, handleInvalidSubmit)} className="flex max-h-[calc(92vh-2px)] flex-col">
            <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="space-y-4 border-b border-slate-800 bg-[#0f1724] p-4 lg:border-b-0 lg:border-r">
            {showField ? (
              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="field_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Поле *</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onChange={(value) => {
                            field.onChange(value);
                            form.setValue("crop_structure_id", null);
                            form.setValue("crop_id", null);
                            form.setValue("planned_area_ha", null);
                          }}
                          options={fieldOptions}
                          placeholder="Выберите поле"
                          disabled={lockedContext}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {!isWholeFieldScope ? (
                  <FormField
                    control={form.control}
                    name="crop_structure_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{cropStructureRequired ? "Участок *" : "Участок"}</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || ""}
                            onChange={(value) => field.onChange(value || null)}
                            options={cropStructureOptions}
                            placeholder={
                              selectedFieldCropStructures.length === 1
                                ? "Выбрано автоматически"
                                : "Выберите участок"
                            }
                            emptyLabel="Для поля нет участков"
                            disabled={lockedContext || (selectedFieldCropStructures.length === 1 && !!field.value)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </div>
            ) : null}

            {selectedCropStructure ? (
              <div className="rounded-lg border border-slate-700 bg-[#111827] p-3 text-sm text-slate-100">
                <div className="font-semibold">
                  {fields.find((field) => field.id === selectedCropStructure.field_id)
                    ? fieldLabelWithArea(fields.find((field) => field.id === selectedCropStructure.field_id) as Field)
                    : `Поле ${selectedCropStructure.field_name || "-"}`}
                </div>
                <div className="mt-2 text-slate-300">
                  <span className="text-slate-500">Участок:</span>{" "}
                  <span className="font-medium text-slate-100">
                    {Number(selectedCropStructure.area || 0).toFixed(2)} га
                  </span>
                </div>
                {hasExplicitIrrigationType ? (
                  <div className="mt-1 text-slate-400">{getIrrigationTypeLabel(selectedIrrigationType)}</div>
                ) : null}
              </div>
            ) : isWholeFieldScope && selectedField ? (
              <div className="rounded-lg border border-slate-700 bg-[#111827] p-3 text-sm text-slate-100">
                <div className="font-semibold">{fieldLabelWithArea(selectedField)}</div>
                <div className="mt-2 text-slate-300">
                  <span className="text-slate-500">Объект:</span>{" "}
                  <span className="font-medium text-slate-100">Всё поле — {Number(selectedField.area || 0).toFixed(2)} га</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Доступны только уборка, логистика, сервис и послеуборочные работы.
                </div>
              </div>
            ) : null}

              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
                <div className="font-semibold uppercase tracking-[0.16em] text-slate-500">Логика плана</div>
                <div className="mt-2 space-y-1.5">
                  <div>1. Выберите участок.</div>
                  <div>2. Выберите работу.</div>
                  <div>3. Назначьте ответственного.</div>
                </div>
              </div>
              </aside>

              <main className="min-h-0 space-y-4 overflow-y-auto p-5 [scrollbar-width:thin] [scrollbar-color:#334155_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">

            {selectedCropStructure && categorySlug === "planting" ? (
              <div className="rounded-lg border border-slate-700 bg-[#111827] p-3">
                <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-400">Культура</div>
                    <SearchableSelect
                      value={structureEditorCropId}
                      onChange={(value) => {
                        setStructureChangeCropId(value);
                        setStructureChangeVarietyId("none");
                      }}
                      options={cropCatalogOptions}
                      placeholder="Выберите культуру"
                      emptyLabel="Культуры не найдены"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-400">Сорт</div>
                    <SearchableSelect
                      value={structureEditorVarietyId}
                      onChange={(value) => {
                        if (!structureChangeCropId && selectedCropStructure.crop_id) {
                          setStructureChangeCropId(selectedCropStructure.crop_id);
                        }
                        setStructureChangeVarietyId(value);
                      }}
                      options={[{ id: "none", label: "Без сорта" }, ...structureChangeVarietyOptions]}
                      placeholder="Выберите сорт"
                      emptyLabel="Сорта не найдены"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-400">Репродукция</div>
                    <SearchableSelect
                      value={structureEditorReproductionId}
                      onChange={(value) => {
                        if (!structureChangeCropId && selectedCropStructure.crop_id) {
                          setStructureChangeCropId(selectedCropStructure.crop_id);
                        }
                        setStructureChangeReproductionId(value);
                      }}
                      options={[{ id: "none", label: "Без репродукции" }, ...structureChangeReproductionOptions]}
                      placeholder="Выберите репродукцию"
                      emptyLabel="Репродукции не найдены"
                    />
                  </div>
                </div>
                {structureChangeActive ? (
                  <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
                    <div className="font-semibold">План структуры отличается от операции. Что сделать?</div>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <Button
                        type="button"
                        variant={structureChangeMode === "crop_replace" ? "default" : "outline"}
                        onClick={() => setStructureChangeMode("crop_replace")}
                      >
                        Заменить культуру на участке
                      </Button>
                      <Button
                        type="button"
                        variant={structureChangeMode === "area_split" ? "default" : "outline"}
                        onClick={() => setStructureChangeMode("area_split")}
                      >
                        Выделить часть площади
                      </Button>
                    </div>
                    {structureChangeMode === "area_split" ? (
                      <div className="mt-2 text-xs text-yellow-100/80">
                        Укажите площадь ниже. Она станет новым участком, остаток останется за текущей культурой.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <section className="rounded-2xl border border-slate-800 bg-[#111827] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">1. Работа</div>
                  <div className="text-xs text-slate-500">Сначала производственный блок, затем конкретная работа.</div>
                </div>
                {selectedType ? (
                  <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-3 py-1 text-xs font-semibold text-yellow-200">
                    {selectedType.name_ru}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {availableCategories.map((category) => {
                  const active = categorySlug === category.slug;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      className={cn(
                        "min-h-[58px] rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
                        active
                          ? "border-yellow-400 bg-yellow-400 text-slate-950 shadow-[0_0_0_1px_rgba(250,204,21,0.35)]"
                          : "border-slate-800 bg-slate-950/45 text-slate-200 hover:border-slate-600 hover:bg-slate-900"
                      )}
                      onClick={() => handleCategoryChange(category.slug)}
                    >
                      <span className="line-clamp-2">{category.name_ru}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Конкретная работа</div>
                {compactAutoPlantingType && selectedType ? (
                  <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-3 text-sm font-semibold text-emerald-100">
                    {selectedType.name_ru}
                  </div>
                ) : !categorySlug ? (
                  <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
                    Выберите блок выше, и здесь появятся доступные работы.
                  </div>
                ) : typeOptions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
                    Для выбранного участка нет доступных работ этого блока.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {typeOptions.map((type) => {
                      const active = typeSlug === type.slug;
                      return (
                        <button
                          key={type.id}
                          type="button"
                          className={cn(
                            "rounded-xl border px-3 py-2 text-left text-sm transition",
                            active
                              ? "border-yellow-400 bg-yellow-400/15 text-yellow-100"
                              : "border-slate-800 bg-slate-950/45 text-slate-300 hover:border-slate-600"
                          )}
                          onClick={() => handleTypeChange(type.slug)}
                        >
                          <span className="font-semibold">{type.name_ru}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {form.formState.errors.operation_type?.message ? (
                  <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {form.formState.errors.operation_type.message}
                  </div>
                ) : null}
              </div>

              {showPurposeEngine ? (
                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/35 p-3">
                  <div className="mb-2 text-sm font-semibold text-slate-100">Цели обработки</div>
                  <div className="flex flex-wrap gap-2">
                    {visiblePurposeOptions.map((purpose) => {
                      const active = purposes.includes(purpose.slug);
                      return (
                        <button
                          key={purpose.slug}
                          type="button"
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            active
                              ? "border-emerald-400 bg-emerald-400/15 text-emerald-100"
                              : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                          )}
                          onClick={() => togglePurpose(purpose.slug, !active)}
                        >
                          {purpose.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="planned_area_ha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Площадь, га</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        max={maxOperationArea ?? undefined}
                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(clampArea(normalizeNumber(event.target.value), maxOperationArea))
                        }
                      />
                    </FormControl>
                    {maxOperationArea != null && maxOperationArea > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        Максимум: {maxOperationArea.toFixed(2)} га
                      </div>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {isPotatoPlanting ? (
              <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/20 p-3">
                <div className="mb-3">
                  <div className="text-sm font-semibold uppercase tracking-wide text-emerald-100">Семенной материал</div>
                  <div className="text-xs text-emerald-200/75">
                    Семенной картофель задаётся сортом, репродукцией, схемой посадки и нормой. В обычные материалы он не добавляется.
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-emerald-900/70 bg-slate-950/35 p-3 text-sm md:grid-cols-4">
                  <div>
                    <div className="text-xs text-slate-400">Культура</div>
                    <div className="font-medium text-slate-100">{operationCropName || "Картофель"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Сорт</div>
                    <div className="font-medium text-slate-100">{operationVarietyName || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Репродукция</div>
                    <div className="font-medium text-slate-100">{operationReproductionName || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Площадь</div>
                    <div className="font-medium text-slate-100">
                      {plannedAreaHa && plannedAreaHa > 0 ? `${plannedAreaHa.toFixed(2)} га` : "-"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="row_spacing_m"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Междурядье, м</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            value={field.value ?? ""}
                            onChange={(event) => field.onChange(normalizeNumber(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="seed_spacing_cm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Межклубневое, см *</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.1"
                            value={field.value ?? ""}
                            onChange={(event) => field.onChange(normalizeNumber(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="rate_per_ha"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Норма посадки, кг/га *</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            value={field.value ?? ""}
                            onChange={(event) => field.onChange(normalizeNumber(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Глубина посадки, см</div>
                    <Input
                      type="number"
                      step="0.1"
                      value={getOperationParam("planting_depth_cm")}
                      onChange={(event) => updateOperationParam("planting_depth_cm", normalizeNumber(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Фракция семян</div>
                    <Input
                      value={getOperationParam("seed_fraction")}
                      onChange={(event) => updateOperationParam("seed_fraction", event.target.value)}
                      placeholder="например 35-55 мм"
                    />
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                    <div>Клубней/га: <b>{plantsPerHa ? plantsPerHa.toLocaleString("ru-RU") : "-"}</b></div>
                    <div>Растений/га: <b>{plantsPerHa ? plantsPerHa.toLocaleString("ru-RU") : "-"}</b></div>
                    <div>Всего клубней: <b>{totalPlants ? totalPlants.toLocaleString("ru-RU") : "-"}</b></div>
                    <div>Семян всего: <b>{totalSeedKg ? `${Math.round(totalSeedKg).toLocaleString("ru-RU")} кг` : "-"}</b></div>
                    <div>Ожидаемая густота: <b>{plantsPerHa ? `${plantsPerHa.toLocaleString("ru-RU")} растений/га` : "-"}</b></div>
                  </div>
                </div>
              </div>
            ) : null}

            {isDripTapeRidge ? (
              <div className="rounded-lg border p-3">
                <div className="mb-3">
                  <div className="text-sm font-semibold">Гребнеобразование + укладка ленты</div>
                  <div className="text-xs text-slate-500">
                    Один проход техники: гребни и лента создаются одной операцией.
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="row_spacing_m"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Междурядье, м</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            value={field.value ?? ""}
                            onChange={(event) => field.onChange(normalizeNumber(event.target.value))}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Количество рядов</div>
                    <Input
                      type="number"
                      step="1"
                      value={getOperationParam("row_count")}
                      onChange={(event) => updateOperationParam("row_count", normalizeNumber(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Тип капельной ленты</div>
                    <Input
                      value={getOperationParam("drip_tape_type")}
                      onChange={(event) => updateOperationParam("drip_tape_type", event.target.value)}
                      placeholder="марка / диаметр / стенка"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Длина бухты, м</div>
                    <Input
                      type="number"
                      step="1"
                      value={getOperationParam("drip_tape_roll_length_m")}
                      onChange={(event) => updateOperationParam("drip_tape_roll_length_m", normalizeNumber(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Количество бухт</div>
                    <Input
                      type="number"
                      step="1"
                      value={getOperationParam("drip_tape_rolls")}
                      onChange={(event) => updateOperationParam("drip_tape_rolls", normalizeNumber(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Шаг эмиттера, см</div>
                    <Input
                      type="number"
                      step="0.1"
                      value={getOperationParam("emitter_spacing_cm")}
                      onChange={(event) => updateOperationParam("emitter_spacing_cm", normalizeNumber(event.target.value))}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {isIrrigation || isFertigation ? (
              <div className="rounded-lg border p-3">
                <div className="mb-3">
                  <div className="text-sm font-semibold">{isFertigation ? "Фертигация" : "Полив"}</div>
                  <div className="text-xs text-slate-500">
                    Операция фиксирует конкретный полив/внесение, а не сезонную программу.
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Норма воды, мм</div>
                    <Input
                      type="number"
                      step="0.1"
                      value={getOperationParam("water_norm_mm")}
                      onChange={(event) => updateOperationParam("water_norm_mm", normalizeNumber(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Объём воды, м³</div>
                    <Input
                      type="number"
                      step="0.1"
                      value={getOperationParam("water_volume_m3")}
                      onChange={(event) => updateOperationParam("water_volume_m3", normalizeNumber(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Зона полива</div>
                    <Input
                      value={getOperationParam("irrigation_zone")}
                      onChange={(event) => updateOperationParam("irrigation_zone", event.target.value)}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Длительность, ч</div>
                    <Input
                      type="number"
                      step="0.1"
                      value={getOperationParam("duration_hours")}
                      onChange={(event) => updateOperationParam("duration_hours", normalizeNumber(event.target.value))}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {showMachine ? (
              <div className={cn("grid grid-cols-1 gap-4", showTransport ? "md:grid-cols-3" : "md:grid-cols-2")}>
                <FormField
                  control={form.control}
                  name="machine_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{canonicalType?.slug === "soil_operation" ? "Трактор / машина" : "Машина"}</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onChange={(value) => field.onChange(value || null)}
                          options={machineOptions}
                          placeholder="Выберите машину"
                          emptyLabel="Машины не найдены"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="equipment_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{canonicalType?.slug === "soil_operation" ? "Орудие / агрегат" : "Оборудование"}</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onChange={(value) => field.onChange(value || null)}
                          options={equipmentOptions}
                          placeholder="Выберите оборудование"
                          emptyLabel="Оборудование не найдено"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {showTransport ? (
                  <FormField
                    control={form.control}
                    name="transport_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Транспорт</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || ""}
                            onChange={(value) => field.onChange(value || null)}
                            options={transportOptions}
                            placeholder="Выберите транспорт"
                            emptyLabel="Транспорт не найден"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </div>
            ) : null}

            {showMaterials ? (
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Основные материалы</div>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => addMaterial("main")}>
                    <Plus className="mr-1 h-4 w-4" />
                    Добавить
                  </Button>
                </div>

                {showTankMix ? (
                  <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs text-slate-500">Вода, л/га</div>
                      <Input
                        type="number"
                        step="0.01"
                        value={tankMixWaterRate ?? ""}
                        onChange={(event) => setTankMixWaterRate(normalizeNumber(event.target.value))}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="spray_volume_per_ha"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Рабочий раствор, л/га</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              value={field.value ?? ""}
                              onChange={(event) => field.onChange(normalizeNumber(event.target.value))}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                ) : null}

                {productOptions.length === 0 && materials.length === 0 ? (
                  <div className="rounded border border-dashed p-3 text-xs text-slate-500">
                    Нет остатка на складе.
                  </div>
                ) : mainMaterialRows.length === 0 ? (
                  <div className="rounded border border-dashed p-3 text-xs text-slate-500">
                    Основные материалы не добавлены.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mainMaterialRows.map((row) => renderMaterialRow(row.material, row.index))}
                  </div>
                )}

                <div className="mt-4 border-t pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold">Дополнительные материалы</div>
                    <Button type="button" size="sm" variant="outline" onClick={() => addMaterial("additional")}>
                      <Plus className="mr-1 h-4 w-4" />
                      Добавить
                    </Button>
                  </div>
                  {additionalMaterialRows.length === 0 ? (
                    <div className="rounded border border-dashed p-3 text-xs text-slate-500">
                      Дополнительные материалы не добавлены.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {additionalMaterialRows.map((row) => renderMaterialRow(row.material, row.index))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Дата *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="responsible_user_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ответственный *</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value || ""}
                        onChange={(value) => field.onChange(value)}
                        options={specialistOptions}
                        placeholder="Выберите ответственного"
                        emptyLabel="Специалисты не найдены"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Комментарий</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Только человеческий комментарий: погода, перенос, остановка."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

              </main>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-800 bg-[#0b1017]/95 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {submitError ? (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {submitError}
                  </div>
                ) : actionIssues.length > 0 ? (
                  <div className="text-sm text-slate-400">
                    Не заполнено: <span className="font-semibold text-yellow-200">{actionIssues.join(", ")}</span>
                  </div>
                ) : (
                  <div className="text-sm text-emerald-200">План готов к созданию.</div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-900" onClick={() => onOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" className="bg-yellow-400 font-semibold text-slate-950 hover:bg-yellow-300" disabled={submitting || form.formState.isSubmitting}>
                  {submitting || form.formState.isSubmitting
                    ? isEdit
                      ? "Сохраняю..."
                      : "Создаётся план..."
                    : isEdit
                      ? "Сохранить"
                      : "Создать план"}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
