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

export function FieldFormDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  isEdit = false,
  existingFields = [],
  editingFieldId = null,
}: FieldFormDialogProps) {
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
          <DialogTitle>{isEdit ? "Edit Field" : "Add New Field"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the field information below."
              : "Enter the details for the new field."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Field Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., North Field" {...field} />
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
                  <FormLabel>Area (hectares) *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="e.g., 25.5"
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
                  <FormLabel>Soil Type</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Clay loam" {...field} />
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
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional information about this field..."
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
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? "Saving..."
                  : isEdit
                  ? "Update Field"
                  : "Add Field"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
