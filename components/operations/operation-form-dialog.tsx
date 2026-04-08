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
import { operationSchema, OperationFormData } from "@/lib/types/operation";
import { useEffect, useState } from "react";
import { Field } from "@/lib/types/field";
import { CropStructureWithDetails } from "@/lib/types/crop-structure";
import { SpecialistAssignee } from "@/lib/types/operation";

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
  const [selectedFieldId, setSelectedFieldId] = useState<string>("");
  const [filteredCropStructures, setFilteredCropStructures] = useState<CropStructureWithDetails[]>([]);

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

  useEffect(() => {
    if (defaultValues) {
      form.reset(defaultValues);
      if (defaultValues.field_id) {
        setSelectedFieldId(defaultValues.field_id);
      }
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
  }, [defaultValues, form, open]);

  useEffect(() => {
    if (selectedFieldId) {
      const filtered = cropStructures.filter(
        (cs) => cs.field_id === selectedFieldId && !cs.archived
      );
      setFilteredCropStructures(filtered);
    } else {
      setFilteredCropStructures([]);
    }
  }, [selectedFieldId, cropStructures]);

  const handleFieldChange = (fieldId: string) => {
    setSelectedFieldId(fieldId);
    form.setValue("field_id", fieldId);
    form.setValue("crop_structure_id", null);
  };

  const handleSubmit = async (data: OperationFormData) => {
    await onSubmit(data);
    form.reset();
    setSelectedFieldId("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Operation" : "Add Operation"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the operation details below."
              : "Log a new agronomic operation performed on your field."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="field_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Field *</FormLabel>
                  <Select
                    onValueChange={handleFieldChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a field" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {fields.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name} ({f.area} ha)
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
                  <FormLabel>Crop Structure</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                    value={field.value || "none"}
                    disabled={!selectedFieldId || filteredCropStructures.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={
                          !selectedFieldId
                            ? "Select a field first"
                            : filteredCropStructures.length === 0
                            ? "No crop structures available"
                            : "Select a crop structure"
                        } />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {filteredCropStructures.map((cs) => (
                        <SelectItem key={cs.id} value={cs.id}>
                          {cs.crop_name} - {cs.variety_name} ({cs.area} ha)
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
              name="responsible_user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Responsible specialist</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                    value={field.value || "none"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Assign specialist" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Not assigned</SelectItem>
                      {specialists.map((specialist) => (
                        <SelectItem key={specialist.id} value={specialist.id}>
                          {specialist.email} ({specialist.role})
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
              name="operation_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Operation Type *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Planting, Fertilizing, Harvesting"
                      {...field}
                    />
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
                      placeholder="Additional details about this operation..."
                      className="min-h-[100px]"
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
                  ? "Update"
                  : "Add Operation"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
