"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FieldErrors, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  FERTILIZER_APPLICATION_METHODS,
  OPERATION_SUBTYPE_DEFINITIONS,
  OPERATION_TYPE_DEFINITIONS,
  TANK_MIX_COMPONENT_DEFINITIONS,
  getDefaultUnitForComponent,
  getPurposeDefinitionsForOperation,
  getTechniqueDefinitionsForOperation,
  getTankMixComponentDefinition,
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
          <CommandList>
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
      date: new Date().toISOString().slice(0, 10),
      responsible_user_id: null,
      notes: "",
      materials: [],
    },
  });

  const selectedFieldId = form.watch("field_id");
  const selectedCropStructureId = form.watch("crop_structure_id");
  const selectedApplicationMethod = form.watch("operation_target");
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
  const techniqueOptions = useMemo(() => getTechniqueDefinitionsForOperation(canonicalSlug), [canonicalSlug]);
  const selectedCropStructure = useMemo(
    () => cropStructures.find((item) => item.id === selectedCropStructureId) || null,
    [cropStructures, selectedCropStructureId]
  );
  const selectedFieldCropStructures = useMemo(
    () =>
      cropStructures.filter(
        (item) => !item.archived && selectedFieldId && item.field_id === selectedFieldId
      ),
    [cropStructures, selectedFieldId]
  );
  const selectedCropStructureArea = selectedCropStructure ? Number(selectedCropStructure.area || 0) : null;
  const typeOptions = useMemo(() => {
    const rows = types.filter((item) => !categorySlug || item.category_slug === categorySlug);
    const expectedSubtypeSlugs = new Set(
      OPERATION_SUBTYPE_DEFINITIONS.filter((item) => item.categorySlug === categorySlug).map((item) => item.slug)
    );
    return expectedSubtypeSlugs.size > 0 ? rows.filter((item) => expectedSubtypeSlugs.has(item.slug)) : rows;
  }, [types, categorySlug]);
  const cropStructureOptions = useMemo(
    () =>
      cropStructures
        .filter((item) => !item.archived && (!selectedFieldId || item.field_id === selectedFieldId))
        .map((item) => ({
          id: item.id,
          label: `${item.crop_name || "без культуры"} • ${item.variety_name || "без сорта"} • ${
            item.reproduction_name || "без репр."
          } • ${Number(item.area || 0).toFixed(2)} га`,
        })),
    [cropStructures, selectedFieldId]
  );

  const fieldOptions = useMemo(() => {
    const cropsByField = new Map<string, Set<string>>();
    cropStructures.forEach((item) => {
      if (!cropsByField.has(item.field_id)) cropsByField.set(item.field_id, new Set());
      cropsByField.get(item.field_id)?.add(item.crop_name || "");
    });
    return fields.map((field) => {
      const cropNames = Array.from(cropsByField.get(field.id) || []).filter(Boolean).slice(0, 3);
      const title = getFieldDisplayName(field);
      const cropText = cropNames.length > 0 ? cropNames.join(", ") : "без культуры";
      return {
        id: field.id,
        label: `${title} • ${cropText} • ${Number(field.area || 0).toFixed(0)} га`,
      };
    });
  }, [fields, cropStructures]);

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
  const structureChangeVarietyOptions = useMemo(
    () =>
      varietyCatalog
        .filter((item) => !structureChangeCropId || item.crop_id === structureChangeCropId)
        .map((item) => ({ id: item.id, label: item.name })),
    [structureChangeCropId, varietyCatalog]
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
        supabase.from("crops").select("id,name,name_ru,archived,is_active").order("name"),
        supabase.from("varieties").select("id,name,crop_id,archived,is_active").order("name"),
        supabase.from("seed_reproductions").select("id,name,archived,is_active").order("name"),
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
            .map((row: any) => ({ id: String(row.id), name: String(row.name_ru || row.name || "-") }))
        );
      }
      if (!varietiesRes.error) {
        setVarietyCatalog(
          (varietiesRes.data || [])
            .filter((row: any) => !row.archived && row.is_active !== false)
            .map((row: any) => ({ id: String(row.id), name: String(row.name || "-"), crop_id: String(row.crop_id || "") }))
        );
      }
      if (!reproductionsRes.error) {
        setReproductionCatalog(
          (reproductionsRes.data || [])
            .filter((row: any) => !row.archived && row.is_active !== false)
            .map((row: any) => ({ id: String(row.id), name: String(row.name || "-") }))
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
  }, [form, open, selectedCropStructure]);

  useEffect(() => {
    if (!open || !selectedFieldId) return;
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
    selectedCropStructure,
    selectedCropStructureId,
    selectedFieldCropStructures,
    selectedFieldId,
  ]);

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
      prev.filter((purpose) => purposeOptions.some((definition) => definition.slug === purpose))
    );
  }, [canonicalType, materials.length, open, purposeOptions, typeSlug]);

  useEffect(() => {
    if (
      structureChangeVarietyId !== "none" &&
      !structureChangeVarietyOptions.some((option) => option.id === structureChangeVarietyId)
    ) {
      setStructureChangeVarietyId("none");
    }
  }, [structureChangeVarietyId, structureChangeVarietyOptions]);

  const isSeeding = canonicalType?.slug === "planting";
  const isFertilizing = canonicalType?.slug === "fertilizer_application";
  const isHarvest = canonicalType?.slug === "harvesting";
  const showPurposeEngine = !!canonicalType?.supportsPurposes && purposeOptions.length > 0;
  const showTankMix = !!canonicalType?.supportsTankMix;
  const showMaterials = !!canonicalType?.supportsMaterials && !isHarvest;
  const showMachine = canonicalType ? canonicalType.requiresMachine : !!selectedType?.requires_machine;
  const showTransport = canonicalType?.slug === "harvesting" || canonicalType?.slug === "transport";
  const showTechnique = techniqueOptions.length > 0 && !isFertilizing;
  const showField = canonicalType ? canonicalType.requiresCropStructure : true;
  const cropStructureRequired = canonicalType ? canonicalType.requiresCropStructure : requiresCropStructureForType(selectedType);
  const purposeBlockTitle =
    canonicalType?.slug === "spraying"
      ? "Задача обработки"
      : canonicalType?.slug === "fertilizer_application" || canonicalType?.slug === "fertigation"
        ? "Задача питания"
        : "Задача работы";
  const operationTypeLabel =
    canonicalType?.slug === "planting"
      ? "Шаблон посева / посадки *"
      : canonicalType?.slug === "spraying"
        ? "Шаблон обработки *"
        : canonicalType?.slug === "harvesting"
          ? "Шаблон уборки *"
          : "Работа *";
  const componentOptions = useMemo(() => {
    const allowed = isSeeding
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
  }, [isFertilizing, isSeeding, showTankMix]);

  const addMaterial = () => {
    const componentType = canonicalType?.defaultComponentType || (isSeeding ? "other" : "fertilizer");
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
    if (selectedCropStructureArea != null && selectedCropStructureArea > 0 && Number(data.planned_area_ha || 0) > selectedCropStructureArea) {
      const message = `Площадь не должна превышать ${selectedCropStructureArea.toFixed(2)} га`;
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
    let structureChangePayload: OperationFormData["structure_change"] | undefined;
    if (isSeeding && structureChangeMode !== "none") {
      if (!structureChangeCropId) {
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
      const nextCrop = cropCatalog.find((item) => item.id === structureChangeCropId)?.name || "новая культура";
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
        new_crop_id: structureChangeCropId,
        new_variety_id: structureChangeVarietyId === "none" ? null : structureChangeVarietyId,
        new_reproduction_id: structureChangeReproductionId === "none" ? null : structureChangeReproductionId,
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
          purposes,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать операцию" : "Создать план работы"}</DialogTitle>
          <DialogDescription>
            {sourceLabel || "Сначала поле и план по культуре, затем работа, способ выполнения, площадь и материалы."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit, handleInvalidSubmit)} className="space-y-4">
            {showField ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                <FormField
                  control={form.control}
                  name="crop_structure_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{cropStructureRequired ? "Культура на поле *" : "Культура на поле"}</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onChange={(value) => field.onChange(value || null)}
                          options={cropStructureOptions}
                          placeholder={
                            selectedFieldCropStructures.length === 1
                              ? "Выбрано автоматически"
                              : "Выберите культуру на поле"
                          }
                          emptyLabel="Для поля нет культуры сезона"
                          disabled={lockedContext || (selectedFieldCropStructures.length === 1 && !!field.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormItem>
                <FormLabel>Производственный блок *</FormLabel>
                <Select value={categorySlug} onValueChange={handleCategoryChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите блок работ" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.slug}>
                        {category.name_ru}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>

              <FormItem>
                <FormLabel>{operationTypeLabel}</FormLabel>
                <Select
                  value={typeSlug}
                  onValueChange={handleTypeChange}
                  disabled={!categorySlug}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !categorySlug
                            ? "Сначала выберите блок"
                            : typeOptions.length === 0
                              ? "Типы не найдены"
                              : "Выберите тип"
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {typeOptions.map((type) => (
                      <SelectItem key={type.id} value={type.slug}>
                        {type.name_ru}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.operation_type?.message ? (
                  <div className="mt-1 text-sm font-medium text-destructive">
                    {form.formState.errors.operation_type.message}
                  </div>
                ) : null}
              </FormItem>
            </div>

            {selectedType ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-semibold">{selectedType.name_ru}</div>
                {canonicalType?.description ? (
                  <div className="mt-1 text-xs text-muted-foreground">{canonicalType.description}</div>
                ) : null}
              </div>
            ) : null}

            {isSeeding && selectedCropStructure ? (
              <div className="rounded-lg border p-3">
                <div className="mb-2">
                  <div className="text-sm font-semibold">Культура по плану</div>
                  <div className="text-xs text-slate-500">
                    {selectedCropStructure.crop_name || "Культура"} • {selectedCropStructure.variety_name || "без сорта"} •{" "}
                    {selectedCropStructure.reproduction_name || "без репродукции"} •{" "}
                    {Number(selectedCropStructure.area || 0).toFixed(2)} га
                  </div>
                </div>
                <Select
                  value={structureChangeMode}
                  onValueChange={(value: "none" | "area_split" | "crop_replace") => setStructureChangeMode(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Работать по плану</SelectItem>
                    <SelectItem value="area_split">Выделить часть площади под другую культуру</SelectItem>
                    <SelectItem value="crop_replace">Заменить культуру в плане</SelectItem>
                  </SelectContent>
                </Select>
                {structureChangeMode !== "none" ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="md:col-span-1">
                      <div className="mb-1 text-xs text-slate-500">Новая культура</div>
                      <SearchableSelect
                        value={structureChangeCropId}
                        onChange={setStructureChangeCropId}
                        options={cropCatalogOptions}
                        placeholder="Выберите культуру"
                        emptyLabel="Культуры не найдены"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-slate-500">Сорт</div>
                      <SearchableSelect
                        value={structureChangeVarietyId === "none" ? "" : structureChangeVarietyId}
                        onChange={(value) => setStructureChangeVarietyId(value || "none")}
                        options={structureChangeVarietyOptions}
                        placeholder="Без сорта"
                        emptyLabel="Сорта не найдены"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-slate-500">Репродукция</div>
                      <SearchableSelect
                        value={structureChangeReproductionId === "none" ? "" : structureChangeReproductionId}
                        onChange={(value) => setStructureChangeReproductionId(value || "none")}
                        options={structureChangeReproductionOptions}
                        placeholder="Без репродукции"
                        emptyLabel="Репродукции не найдены"
                      />
                    </div>
                    <div className="md:col-span-3 text-xs text-amber-700">
                      План изменится только после подтверждения. Для разделения используется площадь из поля ниже.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showPurposeEngine ? (
              <div className="rounded-lg border p-3">
                <div className="mb-2">
                  <div className="text-sm font-semibold">{purposeBlockTitle}</div>
                  <div className="text-xs text-slate-500">Для одного прохода можно выбрать несколько целей.</div>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {purposeOptions.map((purpose) => (
                    <label key={purpose.slug} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                      <Checkbox
                        checked={purposes.includes(purpose.slug)}
                        onCheckedChange={(checked) => togglePurpose(purpose.slug, checked === true)}
                      />
                      <span>{purpose.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {showTechnique ? (
              <FormField
                control={form.control}
                name="operation_target"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Способ выполнения</FormLabel>
                    <Select value={field.value || ""} onValueChange={(value) => field.onChange(value || null)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите способ выполнения" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {techniqueOptions.map((technique) => (
                          <SelectItem key={technique.slug} value={technique.slug}>
                            {technique.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {isFertilizing ? (
              <FormField
                control={form.control}
                name="operation_target"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Способ внесения удобрений</FormLabel>
                    <Select value={field.value || ""} onValueChange={(value) => field.onChange(value || null)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите способ внесения" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FERTILIZER_APPLICATION_METHODS.map((method) => (
                          <SelectItem key={method.slug} value={method.slug}>
                            {method.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-slate-500">
                      {FERTILIZER_APPLICATION_METHODS.find((method) => method.slug === selectedApplicationMethod)?.hint ||
                        "Если проход идет через опрыскиватель, выберите тип Опрыскивание."}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {isHarvest ? (
              <div className="rounded-lg border border-dashed p-3 text-sm text-slate-600">
                Уборка по умолчанию создается без материалов. Масса урожая закрывается через весовую и партии, когда будет выбран талон.
              </div>
            ) : null}

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
                        max={selectedCropStructureArea ?? undefined}
                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(clampArea(normalizeNumber(event.target.value), selectedCropStructureArea))
                        }
                      />
                    </FormControl>
                    {selectedCropStructureArea != null && selectedCropStructureArea > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        Максимум по выбранной культуре: {selectedCropStructureArea.toFixed(2)} га
                      </div>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

            {showTankMix ? (
              <div className="rounded-lg border p-3">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Баковая смесь</div>
                    <div className="text-xs text-slate-500">Один проход = одна операция. Внутри можно вести несколько целей и компонентов.</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={tankMixEnabled} onCheckedChange={(checked) => setTankMixEnabled(checked === true)} />
                    <span>Смесь применяется</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Вода, л/га</div>
                    <Input
                      type="number"
                      step="0.01"
                      value={tankMixWaterRate ?? ""}
                      onChange={(event) => setTankMixWaterRate(normalizeNumber(event.target.value))}
                      disabled={!tankMixEnabled}
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
                            disabled={!tankMixEnabled}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ) : null}

            {showMaterials ? (
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      {showTankMix ? "Компоненты баковой смеси" : isSeeding ? "Семена и материалы посадки" : "Материалы плана"}
                    </div>
                    <div className="text-xs text-slate-500">
                      На этом шаге задаётся план. Выдача, фактический расход и возврат закрываются отдельно.
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={addMaterial}>
                    <Plus className="mr-1 h-4 w-4" />
                    {showTankMix ? "Добавить компонент" : "Добавить материал"}
                  </Button>
                </div>

                {productOptions.length === 0 && materials.length === 0 ? (
                  <div className="rounded border border-dashed p-3 text-xs text-slate-500">
                    Нет остатка на складе.
                  </div>
                ) : materials.length === 0 ? (
                  <div className="rounded border border-dashed p-3 text-xs text-slate-500">
                    Материалы не добавлены.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {materials.map((material, index) => (
                      <div key={`material-${index}`} className="rounded border p-2">
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                          <div>
                            <div className="mb-1 text-xs text-slate-500">{showTankMix ? "Компонент" : "Тип"}</div>
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
                                options={productOptions}
                                placeholder="Выберите продукт"
                                emptyLabel="Нет остатка на складе"
                              />
                            ) : (
                              <div className="flex h-8 items-center rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">
                                Без складского продукта
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-slate-500">Плановая норма</div>
                            <Input
                              className="h-8 text-xs"
                              value={material.planned_rate ?? ""}
                              onChange={(event) =>
                                updateMaterial(index, { planned_rate: normalizeNumber(event.target.value) })
                              }
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
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {(!showTankMix && isFertilizing) ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="rate_per_ha"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Норма на га</FormLabel>
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
                <FormField
                  control={form.control}
                  name="spray_volume_per_ha"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Рабочий раствор на га</FormLabel>
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
                    <FormLabel>Ответственный</FormLabel>
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

            <DialogFooter>
              {submitError ? (
                <div className="mr-auto rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
                  {submitError}
                </div>
              ) : null}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={submitting || form.formState.isSubmitting}>
                {submitting || form.formState.isSubmitting
                  ? isEdit
                    ? "Сохраняю..."
                    : "Создаётся план..."
                  : isEdit
                    ? "Сохранить"
                    : "Создать план"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
