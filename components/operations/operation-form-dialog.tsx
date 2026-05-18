"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { operationSchema, OperationFormData, SpecialistAssignee } from "@/lib/types/operation";
import { Field } from "@/lib/types/field";
import { CropStructureWithDetails } from "@/lib/types/crop-structure";
import { useAuth } from "@/lib/contexts/auth-context";
import { supabase } from "@/lib/supabase/client";

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
};

type ProductOption = { id: string; name: string };
type RefOption = { id: string; name: string };
type ExtraState = {
  machine_id: string;
  equipment_id: string;
  product_id: string;
  additional_product_id: string;
  rate_per_ha: string;
  spray_volume_per_ha: string;
  transport_id: string;
  shift: string;
  target: string;
};

const FALLBACK_CATEGORIES: OperationCategory[] = [
  { id: "soil_preparation", slug: "soil_preparation", name_ru: "Подготовка почвы", is_active: true },
  { id: "seeding_planting", slug: "seeding_planting", name_ru: "Посев и посадка", is_active: true },
  { id: "fertilization", slug: "fertilization", name_ru: "Внесение удобрений", is_active: true },
  { id: "crop_care", slug: "crop_care", name_ru: "Уход за посевами", is_active: true },
  { id: "plant_protection", slug: "plant_protection", name_ru: "Защита растений", is_active: true },
  { id: "harvesting", slug: "harvesting", name_ru: "Уборка", is_active: true },
  { id: "logistics", slug: "logistics", name_ru: "Логистика", is_active: true },
  { id: "post_harvest", slug: "post_harvest", name_ru: "Послеуборочные", is_active: true },
  { id: "specialized", slug: "specialized", name_ru: "Специализированные", is_active: true },
];

const FALLBACK_TYPES: OperationTypeMaster[] = [
  { id: "plowing", slug: "plowing", name_ru: "Вспашка", category_slug: "soil_preparation", requires_machine: true, requires_product: false, requires_field: true, affects_inventory: false, affects_field_history: true },
  { id: "discing", slug: "discing", name_ru: "Дискование", category_slug: "soil_preparation", requires_machine: true, requires_product: false, requires_field: true, affects_inventory: false, affects_field_history: true },
  { id: "seeding", slug: "seeding", name_ru: "Посев", category_slug: "seeding_planting", requires_machine: true, requires_product: true, requires_field: true, affects_inventory: true, affects_field_history: true },
  { id: "fertilizing", slug: "fertilizing", name_ru: "Внесение удобрений", category_slug: "fertilization", requires_machine: true, requires_product: true, requires_field: true, affects_inventory: true, affects_field_history: true },
  { id: "spraying", slug: "spraying", name_ru: "Опрыскивание", category_slug: "plant_protection", requires_machine: true, requires_product: true, requires_field: true, affects_inventory: true, affects_field_history: true },
  { id: "harvesting", slug: "harvesting", name_ru: "Уборка урожая", category_slug: "harvesting", requires_machine: true, requires_product: false, requires_field: true, affects_inventory: true, affects_field_history: true },
  { id: "field_transfer", slug: "field_transfer", name_ru: "Перевозка с поля", category_slug: "logistics", requires_machine: false, requires_product: false, requires_field: true, affects_inventory: true, affects_field_history: false },
];

const EMPTY_EXTRA: ExtraState = {
  machine_id: "none",
  equipment_id: "none",
  product_id: "none",
  additional_product_id: "none",
  rate_per_ha: "",
  spray_volume_per_ha: "",
  transport_id: "none",
  shift: "",
  target: "",
};

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
  const [selectedFieldId, setSelectedFieldId] = useState<string>("");
  const [filteredCropStructures, setFilteredCropStructures] = useState<CropStructureWithDetails[]>([]);
  const [categories, setCategories] = useState<OperationCategory[]>(FALLBACK_CATEGORIES);
  const [types, setTypes] = useState<OperationTypeMaster[]>(FALLBACK_TYPES);
  const [categorySlug, setCategorySlug] = useState("");
  const [typeSlug, setTypeSlug] = useState("");
  const [machines, setMachines] = useState<RefOption[]>([]);
  const [equipment, setEquipment] = useState<RefOption[]>([]);
  const [transports, setTransports] = useState<RefOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [extra, setExtra] = useState<ExtraState>(EMPTY_EXTRA);

  const form = useForm<OperationFormData>({
    resolver: zodResolver(operationSchema),
    defaultValues: defaultValues || {
      field_id: "",
      crop_structure_id: null,
      operation_type: "",
      date: new Date().toISOString().split("T")[0],
      responsible_user_id: null,
      notes: "",
    },
  });

  const typeOptions = useMemo(
    () =>
      types
        .filter((t) => !categorySlug || t.category_slug === categorySlug)
        .sort((a, b) => a.name_ru.localeCompare(b.name_ru, "ru")),
    [types, categorySlug]
  );
  const selectedType = useMemo(() => typeOptions.find((x) => x.slug === typeSlug) || null, [typeOptions, typeSlug]);

  const showField = selectedType?.requires_field !== false;
  const showMachine = !!selectedType?.requires_machine;
  const showProduct = !!selectedType?.requires_product;
  const showTransport = selectedType?.category_slug === "harvesting" || selectedType?.category_slug === "logistics";
  const showShift = selectedType?.category_slug === "harvesting";

  useEffect(() => {
    if (defaultValues) {
      form.reset(defaultValues as OperationFormData);
      if (defaultValues.field_id) setSelectedFieldId(defaultValues.field_id);
    } else {
      form.reset({
        field_id: "",
        crop_structure_id: null,
        operation_type: "",
        date: new Date().toISOString().split("T")[0],
        responsible_user_id: null,
        notes: "",
      });
      setSelectedFieldId("");
    }
    setExtra(EMPTY_EXTRA);
    setCategorySlug("");
    setTypeSlug("");
  }, [defaultValues, form, open]);

  useEffect(() => {
    if (selectedFieldId) {
      setFilteredCropStructures(
        cropStructures.filter((cs) => cs.field_id === selectedFieldId && !cs.archived)
      );
    } else {
      setFilteredCropStructures([]);
    }
  }, [selectedFieldId, cropStructures]);

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
        supabase.from("products").select("id,name,trade_name").or(`company_id.eq.${profile.company_id},company_id.is.null`).eq("archived", false).eq("is_active", true).order("name"),
      ]);

      if (!catRes.error && (catRes.data || []).length > 0) setCategories(catRes.data as any);
      if (!typeRes.error && (typeRes.data || []).length > 0) setTypes(typeRes.data as any);
      if (!machinesRes.error) setMachines((machinesRes.data || []).map((x: any) => ({ id: x.id, name: x.name || "-" })));
      if (!equipmentRes.error) setEquipment((equipmentRes.data || []).map((x: any) => ({ id: x.id, name: x.name || "-" })));
      if (!transportRes.error) setTransports((transportRes.data || []).map((x: any) => ({ id: x.id, name: x.name || "-" })));
      if (!productRes.error) {
        const dedup = new Map<string, ProductOption>();
        (productRes.data || []).forEach((x: any) => {
          const key = String(x.id);
          dedup.set(key, { id: key, name: String(x.trade_name || x.name || "-") });
        });
        setProducts(Array.from(dedup.values()));
      }
    })();
  }, [open, profile?.company_id]);

  const handleFieldChange = (fieldId: string) => {
    setSelectedFieldId(fieldId);
    form.setValue("field_id", fieldId);
    form.setValue("crop_structure_id", null);
  };

  const handleTypeChange = (slug: string) => {
    setTypeSlug(slug);
    const t = typeOptions.find((x) => x.slug === slug);
    form.setValue("operation_type", t?.name_ru || "");
  };

  const updateExtra = (key: keyof ExtraState, value: string) => setExtra((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (data: OperationFormData) => {
    if (!selectedType) return;
    const lines: string[] = [];
    lines.push(`- Category: ${categories.find((c) => c.slug === categorySlug)?.name_ru || categorySlug || "-"}`);
    lines.push(`- Operation type code: ${selectedType.slug}`);
    if (showMachine) {
      lines.push(`- Machine: ${extra.machine_id !== "none" ? machines.find((m) => m.id === extra.machine_id)?.name || "-" : "-"}`);
      lines.push(`- Equipment: ${extra.equipment_id !== "none" ? equipment.find((e) => e.id === extra.equipment_id)?.name || "-" : "-"}`);
    }
    if (showProduct) {
      lines.push(`- Product: ${extra.product_id !== "none" ? products.find((p) => p.id === extra.product_id)?.name || "-" : "-"}`);
      lines.push(`- Additional products: ${extra.additional_product_id !== "none" ? products.find((p) => p.id === extra.additional_product_id)?.name || "-" : "-"}`);
      lines.push(`- Rate per ha: ${extra.rate_per_ha || "-"}`);
      lines.push(`- Spray volume per ha: ${extra.spray_volume_per_ha || "-"}`);
      lines.push(`- Target: ${extra.target || "-"}`);
    }
    if (showTransport) lines.push(`- Transport: ${extra.transport_id !== "none" ? transports.find((t) => t.id === extra.transport_id)?.name || "-" : "-"}`);
    if (showShift) lines.push(`- Shift: ${extra.shift || "-"}`);

    const composedNotes = [data.notes?.trim() || "", "", "Draft details:", ...lines].join("\n").trim();
    await onSubmit({
      ...data,
      operation_type: selectedType.name_ru,
      notes: composedNotes,
    });
    form.reset();
    setSelectedFieldId("");
    setExtra(EMPTY_EXTRA);
    setCategorySlug("");
    setTypeSlug("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать операцию" : "Создать операцию"}</DialogTitle>
          <DialogDescription>Категория → Тип операции → поля формы по выбранному типу.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel>Категория операции *</FormLabel>
                <Select value={categorySlug} onValueChange={(v) => { setCategorySlug(v); setTypeSlug(""); form.setValue("operation_type", ""); }}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите категорию" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.slug}>{c.name_ru}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
              <FormItem>
                <FormLabel>Тип операции *</FormLabel>
                <Select value={typeSlug} onValueChange={handleTypeChange} disabled={!categorySlug}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={categorySlug ? "Выберите тип операции" : "Сначала выберите категорию"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {typeOptions.map((t) => (
                      <SelectItem key={t.id} value={t.slug}>{t.name_ru}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!selectedType ? <p className="text-xs text-red-600 mt-1">Выберите тип операции</p> : null}
              </FormItem>
            </div>

            {selectedType ? (
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{selectedType.requires_field ? "Требует поле" : "Без поля"}</Badge>
                <Badge variant="outline">{selectedType.requires_machine ? "Требует технику" : "Без техники"}</Badge>
                <Badge variant="outline">{selectedType.requires_product ? "Требует продукт" : "Без продукта"}</Badge>
                <Badge variant="outline">{selectedType.affects_inventory ? "Влияет на склад" : "Без влияния на склад"}</Badge>
                <Badge variant="outline">{selectedType.affects_field_history ? "В историю поля" : "Без записи в историю"}</Badge>
              </div>
            ) : null}

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

            {showField ? (
              <>
                <FormField
                  control={form.control}
                  name="field_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Поле *</FormLabel>
                      <Select onValueChange={handleFieldChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите поле" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {fields.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name} ({f.area} га)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="crop_structure_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Структура посева</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                        value={field.value || "none"}
                        disabled={!selectedFieldId || filteredCropStructures.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={!selectedFieldId ? "Сначала выберите поле" : "Выберите структуру (опционально)"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Не выбрано</SelectItem>
                          {filteredCropStructures.map((cs) => (
                            <SelectItem key={cs.id} value={cs.id}>
                              {cs.crop_name} - {cs.variety_name} ({cs.area} га)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            {showMachine ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormItem>
                  <FormLabel>Машина</FormLabel>
                  <Select value={extra.machine_id} onValueChange={(v) => updateExtra("machine_id", v)}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Выберите машину" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Не выбрано</SelectItem>
                      {machines.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
                <FormItem>
                  <FormLabel>Оборудование</FormLabel>
                  <Select value={extra.equipment_id} onValueChange={(v) => updateExtra("equipment_id", v)}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Выберите оборудование" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Не выбрано</SelectItem>
                      {equipment.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              </div>
            ) : null}

            {showProduct ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormItem>
                    <FormLabel>Продукт</FormLabel>
                    <Select value={extra.product_id} onValueChange={(v) => updateExtra("product_id", v)}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Выберите продукт" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Не выбрано</SelectItem>
                        {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                  <FormItem>
                    <FormLabel>Дополнительный продукт</FormLabel>
                    <Select value={extra.additional_product_id} onValueChange={(v) => updateExtra("additional_product_id", v)}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Опционально" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Не выбрано</SelectItem>
                        {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <FormItem>
                    <FormLabel>Норма на га</FormLabel>
                    <Input value={extra.rate_per_ha} onChange={(e) => updateExtra("rate_per_ha", e.target.value)} placeholder="напр. 0.3 л/га" />
                  </FormItem>
                  <FormItem>
                    <FormLabel>Норма вылива</FormLabel>
                    <Input value={extra.spray_volume_per_ha} onChange={(e) => updateExtra("spray_volume_per_ha", e.target.value)} placeholder="напр. 200 л/га" />
                  </FormItem>
                  <FormItem>
                    <FormLabel>Цель</FormLabel>
                    <Input value={extra.target} onChange={(e) => updateExtra("target", e.target.value)} placeholder="напр. сорняки / фитофтора" />
                  </FormItem>
                </div>
              </div>
            ) : null}

            {showTransport || showShift ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {showTransport ? (
                  <FormItem>
                    <FormLabel>Транспорт</FormLabel>
                    <Select value={extra.transport_id} onValueChange={(v) => updateExtra("transport_id", v)}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Выберите транспорт" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Не выбрано</SelectItem>
                        {transports.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                ) : null}
                {showShift ? (
                  <FormItem>
                    <FormLabel>Смена</FormLabel>
                    <Input value={extra.shift} onChange={(e) => updateExtra("shift", e.target.value)} placeholder="напр. Дневная 08:00-20:00" />
                  </FormItem>
                ) : null}
              </div>
            ) : null}

            <FormField
              control={form.control}
              name="responsible_user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ответственный специалист</FormLabel>
                  <Select onValueChange={(value) => field.onChange(value === "none" ? null : value)} value={field.value || "none"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Назначить специалиста" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Не назначен</SelectItem>
                      {specialists.map((specialist) => (
                        <SelectItem key={specialist.id} value={specialist.id}>
                          {(specialist.full_name || specialist.email) as string} ({specialist.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Комментарий</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Дополнительные детали..." className="min-h-[90px]" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
              <Button type="submit" disabled={form.formState.isSubmitting || !selectedType || (showField && !form.getValues("field_id"))}>
                {form.formState.isSubmitting ? "Сохранение..." : isEdit ? "Обновить" : "Создать операцию"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

