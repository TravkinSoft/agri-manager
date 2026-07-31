"use client";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { fieldSchema, FieldFormData } from "@/lib/types/field";
import { useLanguage } from "@/lib/contexts/language-context";
import { useEffect } from "react";

interface FieldFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: FieldFormData) => Promise<void>;
  defaultValues?: FieldFormData;
  isEdit?: boolean;
  existingFields?: Array<{
    id: string;
    name: string;
    area: number;
    archived?: boolean;
  }>;
  editingFieldId?: string | null;
}

function normalizeFieldName(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

const formText = {
  ru: {
    addTitle: "Добавить поле",
    editTitle: "Редактировать поле",
    addDescription: "Укажите данные нового поля.",
    editDescription: "Измените данные поля.",
    fieldName: "Название поля",
    fieldNamePlaceholder: "Например, Платина",
    area: "Площадь, га",
    areaPlaceholder: "Например, 25,5",
    soilType: "Тип почвы",
    soilTypePlaceholder: "Например, суглинок",
    notes: "Комментарий",
    notesPlaceholder: "Дополнительная информация о поле",
    cancel: "Отмена",
    saving: "Сохранение...",
    update: "Сохранить",
    add: "Добавить поле",
  },
  kz: {
    addTitle: "Алқап қосу",
    editTitle: "Алқапты өңдеу",
    addDescription: "Жаңа алқаптың деректерін көрсетіңіз.",
    editDescription: "Алқап деректерін өзгертіңіз.",
    fieldName: "Алқап атауы",
    fieldNamePlaceholder: "Мысалы, Платина",
    area: "Ауданы, га",
    areaPlaceholder: "Мысалы, 25,5",
    soilType: "Топырақ түрі",
    soilTypePlaceholder: "Мысалы, саздақ",
    notes: "Түсініктеме",
    notesPlaceholder: "Алқап туралы қосымша ақпарат",
    cancel: "Болдырмау",
    saving: "Сақталуда...",
    update: "Сақтау",
    add: "Алқап қосу",
  },
  en: {
    addTitle: "Add field",
    editTitle: "Edit field",
    addDescription: "Enter the new field details.",
    editDescription: "Update the field details.",
    fieldName: "Field name",
    fieldNamePlaceholder: "For example, North Field",
    area: "Area, ha",
    areaPlaceholder: "For example, 25.5",
    soilType: "Soil type",
    soilTypePlaceholder: "For example, clay loam",
    notes: "Notes",
    notesPlaceholder: "Additional field information",
    cancel: "Cancel",
    saving: "Saving...",
    update: "Save",
    add: "Add field",
  },
} as const;

export function FieldFormDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  isEdit = false,
  existingFields = [],
  editingFieldId = null,
}: FieldFormDialogProps) {
  const { language } = useLanguage();
  const text = formText[language];
  const form = useForm<FieldFormData>({
    resolver: zodResolver(fieldSchema),
    defaultValues: defaultValues || {
      name: "",
      area: 0,
      soil_type: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (defaultValues) {
      form.reset(defaultValues);
    } else {
      form.reset({
        name: "",
        area: 0,
        soil_type: "",
        notes: "",
      });
    }
  }, [defaultValues, form, open]);

  const handleSubmit = async (data: FieldFormData) => {
    await onSubmit(data);
    form.reset();
  };
  const watchedName = form.watch("name");
  const watchedArea = Number(form.watch("area") || 0);
  const duplicateField = existingFields.find((field) => {
    if (field.id === editingFieldId || field.archived) return false;
    return (
      normalizeFieldName(field.name) === normalizeFieldName(watchedName || "")
    );
  });
  const closeAreaMatch =
    duplicateField != null &&
    Math.abs(Number(duplicateField.area || 0) - watchedArea) <=
      Math.max(Number(duplicateField.area || 0) * 0.02, 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? text.editTitle : text.addTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? text.editDescription : text.addDescription}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{text.fieldName} *</FormLabel>
                  <FormControl>
                    <Input placeholder={text.fieldNamePlaceholder} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {duplicateField ? (
              <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                В компании уже есть активное поле с таким названием
                {closeAreaMatch
                  ? ` и близкой площадью (${duplicateField.area.toFixed(2)} га)`
                  : ""}
                . Продолжайте только если это действительно другое поле.
              </div>
            ) : null}
            <FormField
              control={form.control}
              name="area"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{text.area} *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={text.areaPlaceholder}
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="soil_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{text.soilType}</FormLabel>
                  <FormControl>
                    <Input placeholder={text.soilTypePlaceholder} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{text.notes}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={text.notesPlaceholder}
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {text.cancel}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? text.saving
                  : isEdit
                  ? text.update
                  : text.add}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
