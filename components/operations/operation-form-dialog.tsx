"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
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
import { Badge } from "@/components/ui/badge";
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

interface OperationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: OperationFormData) => Promise<void>;
  defaultValues?: Partial<OperationFormData>;
  isEdit?: boolean;
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
type ProductOption = { id: string; name: string; type: string | null; unit: string | null };

type SearchOption = { id: string; label: string; hint?: string };

const MATERIAL_TYPE_LABEL: Record<OperationMaterialType, string> = {
  seed: "Семена",
  fertilizer: "Удобрение",
  pesticide: "СЗР",
  adjuvant: "Прилипатель",
  ph_corrector: "pH-корректор",
  defoamer: "Пеногаситель",
  biological: "Биология",
  fuel: "ГСМ",
  organic: "Органика",
};

const FALLBACK_CATEGORIES: OperationCategory[] = [
  { id: "soil_preparation", slug: "soil_preparation", name_ru: "Подготовка почвы", is_active: true },
  { id: "seeding_planting", slug: "seeding_planting", name_ru: "Посев / посадка", is_active: true },
  { id: "fertilization", slug: "fertilization", name_ru: "Внесение удобрений", is_active: true },
  { id: "plant_protection", slug: "plant_protection", name_ru: "СЗР", is_active: true },
  { id: "harvesting", slug: "harvesting", name_ru: "Уборка", is_active: true },
  { id: "logistics", slug: "logistics", name_ru: "Логистика", is_active: true },
];

const FALLBACK_TYPES: OperationTypeMaster[] = [
  {
    id: "seeding",
    slug: "seeding",
    name_ru: "Посев",
    category_slug: "seeding_planting",
    requires_machine: true,
    requires_product: true,
    requires_field: true,
    affects_inventory: true,
    affects_field_history: true,
  },
  {
    id: "planting",
    slug: "planting",
    name_ru: "Посадка",
    category_slug: "seeding_planting",
    requires_machine: true,
    requires_product: true,
    requires_field: true,
    affects_inventory: true,
    affects_field_history: true,
  },
  {
    id: "spraying",
    slug: "spraying",
    name_ru: "Опрыскивание",
    category_slug: "plant_protection",
    requires_machine: true,
    requires_product: true,
    requires_field: true,
    affects_inventory: true,
    affects_field_history: true,
  },
  {
    id: "fertilizing",
    slug: "fertilizing",
    name_ru: "Внесение удобрений",
    category_slug: "fertilization",
    requires_machine: true,
    requires_product: true,
    requires_field: true,
    affects_inventory: true,
    affects_field_history: true,
  },
  {
    id: "harvesting",
    slug: "harvesting",
    name_ru: "Уборка",
    category_slug: "harvesting",
    requires_machine: true,
    requires_product: false,
    requires_field: true,
    affects_inventory: true,
    affects_field_history: true,
  },
];

function normalizeNumber(value: string): number | null {
  const raw = String(value || "").trim().replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function defaultUnitByMaterialType(type: OperationMaterialType): "kg" | "l" | "pcs" {
  if (type === "pesticide" || type === "adjuvant" || type === "ph_corrector" || type === "defoamer") return "l";
  if (type === "fuel") return "l";
  return "kg";
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

function isRowCropByCategory(categorySlug: string): boolean {
  return categorySlug === "seeding_planting" || categorySlug === "harvesting";
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
  const [materials, setMaterials] = useState<OperationMaterialFormData[]>([]);

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
  const selectedType = useMemo(() => types.find((item) => item.slug === typeSlug) || null, [types, typeSlug]);
  const typeOptions = useMemo(
    () => types.filter((item) => !categorySlug || item.category_slug === categorySlug),
    [types, categorySlug]
  );
  const cropStructureOptions = useMemo(
    () =>
      cropStructures
        .filter((item) => !item.archived && (!selectedFieldId || item.field_id === selectedFieldId))
        .map((item) => ({
          id: item.id,
          label: `${item.crop_name} • ${item.variety_name || "без сорта"} • ${item.reproduction_name || "без репр."}`,
          hint: `${item.area.toFixed(2)} га`,
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
        hint: item.type || "",
      })),
    [products]
  );

  useEffect(() => {
    form.setValue("materials", materials);
  }, [materials, form]);

  useEffect(() => {
    if (!open || !profile?.company_id) return;
    (async () => {
      const [catRes, typeRes, machinesRes, equipmentRes, transportRes, productRes] = await Promise.all([
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
          .from("products")
          .select("id,name,trade_name,type,unit")
          .or(`company_id.eq.${profile.company_id},company_id.is.null`)
          .eq("archived", false)
          .eq("is_active", true)
          .order("name"),
      ]);

      if (!catRes.error && (catRes.data || []).length > 0) setCategories(catRes.data as OperationCategory[]);
      if (!typeRes.error && (typeRes.data || []).length > 0) setTypes(typeRes.data as OperationTypeMaster[]);
      if (!machinesRes.error) setMachines((machinesRes.data || []).map((row: any) => ({ id: String(row.id), name: String(row.name || "-") })));
      if (!equipmentRes.error) setEquipment((equipmentRes.data || []).map((row: any) => ({ id: String(row.id), name: String(row.name || "-") })));
      if (!transportRes.error) setTransports((transportRes.data || []).map((row: any) => ({ id: String(row.id), name: String(row.name || "-") })));
      if (!productRes.error) {
        setProducts(
          (productRes.data || []).map((row: any) => ({
            id: String(row.id),
            name: String(row.trade_name || row.name || "-"),
            type: row.type ? String(row.type) : null,
            unit: row.unit ? String(row.unit) : null,
          }))
        );
      }
    })();
  }, [open, profile?.company_id]);

  useEffect(() => {
    if (!open) return;
    const initial = defaultValues || {};
    form.reset({
      field_id: String(initial.field_id || ""),
      crop_structure_id: initial.crop_structure_id || null,
      operation_category_slug: String(initial.operation_category_slug || ""),
      operation_type_slug: String(initial.operation_type_slug || ""),
      operation_type: String(initial.operation_type || ""),
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
      materials: Array.isArray(initial.materials) ? initial.materials : [],
    });

    const initialCategory = String(initial.operation_category_slug || "").trim();
    const initialType = String(initial.operation_type_slug || "").trim();
    setCategorySlug(initialCategory);
    setTypeSlug(initialType);
    setMaterials(Array.isArray(initial.materials) ? (initial.materials as OperationMaterialFormData[]) : []);
  }, [defaultValues, form, open]);

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
    setTypeSlug(singleType.slug);
    form.setValue("operation_type_slug", singleType.slug);
    form.setValue("operation_type", singleType.name_ru);
  }, [categorySlug, form, open, typeOptions, typeSlug]);

  const isSeeding = selectedType?.category_slug === "seeding_planting";
  const isPlantProtection = selectedType?.category_slug === "plant_protection";
  const isFertilizing = selectedType?.category_slug === "fertilization";
  const isHarvest = selectedType?.category_slug === "harvesting";
  const showOperationLinesHint = isRowCropByCategory(selectedType?.category_slug || "");
  const showMachine = !!selectedType?.requires_machine;
  const showField = selectedType?.requires_field !== false;

  const addMaterial = () => {
    setMaterials((prev) => [
      ...prev,
      {
        material_type: isSeeding ? "seed" : isPlantProtection ? "pesticide" : isFertilizing ? "fertilizer" : "fertilizer",
        product_id: "",
        batch_id: null,
        planned_rate: null,
        actual_rate: null,
        unit: isPlantProtection ? "l" : "kg",
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

  const handleCategoryChange = (slug: string) => {
    setCategorySlug(slug);
    form.setValue("operation_category_slug", slug);
    setTypeSlug("");
    form.setValue("operation_type_slug", "");
    form.setValue("operation_type", "");
  };

  const handleTypeChange = (slug: string) => {
    setTypeSlug(slug);
    form.setValue("operation_type_slug", slug);
    const type = types.find((item) => item.slug === slug);
    form.setValue("operation_type", type?.name_ru || "");
  };

  const submit = async (data: OperationFormData) => {
    if (!selectedType) return;
    await onSubmit({
      ...data,
      operation_category_slug: categorySlug,
      operation_type_slug: typeSlug,
      operation_type: selectedType.name_ru,
      materials: materials
        .filter((item) => String(item.product_id || "").trim().length > 0)
        .map((item) => ({
          material_type: item.material_type,
          product_id: item.product_id,
          batch_id: item.batch_id || null,
          planned_rate: item.planned_rate ?? null,
          actual_rate: item.actual_rate ?? null,
          unit: item.unit,
          notes: item.notes || null,
        })),
      notes: String(data.notes || "").trim(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать операцию" : "Создать операцию"}</DialogTitle>
          <DialogDescription>
            Форма управляется типом операции: посев/посадка, СЗР, удобрения, уборка.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormItem>
                <FormLabel>Категория *</FormLabel>
                <Select value={categorySlug} onValueChange={handleCategoryChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите категорию" />
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
                <FormLabel>Тип операции *</FormLabel>
                <Select
                  value={typeSlug}
                  onValueChange={handleTypeChange}
                  disabled={!categorySlug || typeOptions.length === 1}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !categorySlug
                            ? "Сначала выберите категорию"
                            : typeOptions.length === 1
                              ? typeOptions[0].name_ru
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
              </FormItem>
            </div>

            {selectedType ? (
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{selectedType.affects_inventory ? "Влияет на склад" : "Без складского движения"}</Badge>
                <Badge variant="outline">{selectedType.affects_field_history ? "Идет в историю поля" : "Не влияет на историю поля"}</Badge>
                {showOperationLinesHint ? <Badge className="bg-amber-100 text-amber-900">Operation lines включены</Badge> : null}
                {!showOperationLinesHint ? <Badge variant="outline">Без operation lines</Badge> : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                name="planned_area_ha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>План, га</FormLabel>
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
                name="responsible_user_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ответственный специалист</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value || ""}
                        onChange={(value) => field.onChange(value)}
                        options={specialistOptions}
                        placeholder="Выберите специалиста"
                        emptyLabel="Специалисты не найдены"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                          value={field.value}
                          onChange={(value) => {
                            field.onChange(value);
                            form.setValue("crop_structure_id", null);
                          }}
                          options={fieldOptions}
                          placeholder="Выберите поле"
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
                      <FormLabel>Строка структуры (опционально)</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onChange={(value) => field.onChange(value || null)}
                          options={cropStructureOptions}
                          placeholder="Выберите строку структуры"
                          emptyLabel="Строки структуры не найдены"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

            {showMachine ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="machine_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Машина</FormLabel>
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
                      <FormLabel>Оборудование (опционально)</FormLabel>
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
              </div>
            ) : null}

            {(isPlantProtection || isFertilizing || isSeeding || isHarvest) ? (
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Материалы операции</div>
                    <div className="text-xs text-slate-500">Один основной и дополнительные материалы. Без text-blob в комментариях.</div>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={addMaterial}>
                    <Plus className="mr-1 h-4 w-4" />
                    Добавить материал
                  </Button>
                </div>

                {materials.length === 0 ? (
                  <div className="rounded border border-dashed p-3 text-xs text-slate-500">
                    Материалы не добавлены.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {materials.map((material, index) => (
                      <div key={`material-${index}`} className="rounded border p-2">
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                          <div>
                            <div className="mb-1 text-xs text-slate-500">Тип</div>
                            <Select
                              value={material.material_type}
                              onValueChange={(value) => {
                                const nextType = value as OperationMaterialType;
                                updateMaterial(index, {
                                  material_type: nextType,
                                  unit: defaultUnitByMaterialType(nextType),
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(MATERIAL_TYPE_LABEL).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="md:col-span-2">
                            <div className="mb-1 text-xs text-slate-500">Продукт</div>
                            <SearchableSelect
                              value={material.product_id}
                              onChange={(productId) => {
                                const product = products.find((item) => item.id === productId);
                                const inferredType = inferMaterialTypeByProductType(product?.type);
                                updateMaterial(index, {
                                  product_id: productId,
                                  material_type: material.material_type || inferredType,
                                  unit: (product?.unit === "kg" || product?.unit === "l" || product?.unit === "pcs")
                                    ? (product.unit as "kg" | "l" | "pcs")
                                    : defaultUnitByMaterialType(material.material_type || inferredType),
                                });
                              }}
                              options={productOptions}
                              placeholder="Выберите продукт"
                              emptyLabel="Продукты не найдены"
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-slate-500">План норма</div>
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
                            <div className="mb-1 text-xs text-slate-500">Факт норма</div>
                            <Input
                              className="h-8 text-xs"
                              value={material.actual_rate ?? ""}
                              onChange={(event) =>
                                updateMaterial(index, { actual_rate: normalizeNumber(event.target.value) })
                              }
                              placeholder="опционально"
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

            {(isPlantProtection || isFertilizing) ? (
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

            {showOperationLinesHint ? (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Для этого типа операции используйте Operation lines (сорта, репродукции, рядки, междурядье, межсеменное расстояние) после создания операции.
              </div>
            ) : null}

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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={!selectedType}>
                {isEdit ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
