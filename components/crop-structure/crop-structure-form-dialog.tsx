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
import { cropStructureSchema, CropStructureFormData } from "@/lib/types/crop-structure";
import { Field } from "@/lib/types/field";
import { Season } from "@/lib/types/season";
import { Crop, Variety, SeedReproduction } from "@/lib/types/references";
import { getCrops, getVarietiesByCrop, getSeedReproductions } from "@/lib/services/references";
import { useAuth } from "@/lib/contexts/auth-context";
import { useEffect, useState } from "react";

interface CropStructureFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CropStructureFormData) => Promise<void>;
  defaultValues?: CropStructureFormData;
  isEdit?: boolean;
  fields: Field[];
  seasons: Season[];
  selectedSeasonId?: string;
}

export function CropStructureFormDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  isEdit = false,
  fields,
  seasons,
  selectedSeasonId,
}: CropStructureFormDialogProps) {
  const { profile } = useAuth();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [reproductions, setReproductions] = useState<SeedReproduction[]>([]);
  const [loadingCrops, setLoadingCrops] = useState(false);

  const form = useForm<CropStructureFormData>({
    resolver: zodResolver(cropStructureSchema),
    defaultValues: defaultValues || {
      field_id: "",
      season_id: selectedSeasonId || "",
      land_use_type: "crop",
      crop_id: null,
      variety_id: null,
      reproduction_id: null,
      area: 0,
      seeding_rate: 0,
      expected_yield: 0,
      status: "planned",
      notes: "",
    },
  });

  useEffect(() => {
    if (open) {
      loadReferenceData();
    }
  }, [open]);

  useEffect(() => {
    if (defaultValues) {
      form.reset(defaultValues);
      if (defaultValues.crop_id) {
        loadVarietiesForCrop(defaultValues.crop_id);
      }
    } else {
      form.reset({
        field_id: "",
        season_id: selectedSeasonId || "",
        land_use_type: "crop",
        crop_id: null,
        variety_id: null,
        reproduction_id: null,
        area: 0,
        seeding_rate: 0,
        expected_yield: 0,
        status: "planned",
        notes: "",
      });
    }
  }, [defaultValues, form, open, selectedSeasonId]);

  const loadReferenceData = async () => {
    if (!profile?.company_id) return;
    try {
      setLoadingCrops(true);
      const [cropsData, reproductionsData] = await Promise.all([
        getCrops(profile.company_id),
        getSeedReproductions(profile.company_id),
      ]);
      setCrops(cropsData);
      setReproductions(reproductionsData);
    } catch (error) {
      console.error("Failed to load reference data:", error);
    } finally {
      setLoadingCrops(false);
    }
  };

  const loadVarietiesForCrop = async (cropId: string) => {
    if (!profile?.company_id) return;
    try {
      const varietiesData = await getVarietiesByCrop(profile.company_id, cropId);
      setVarieties(varietiesData);
    } catch (error) {
      console.error("Failed to load varieties:", error);
    }
  };

  const handleCropChange = (cropId: string) => {
    form.setValue("crop_id", cropId);
    form.setValue("variety_id", undefined);
    setVarieties([]);
    if (cropId) {
      loadVarietiesForCrop(cropId);
    }
  };

  const handleSubmit = async (data: CropStructureFormData) => {
    await onSubmit(data);
    form.reset();
  };

  const selectedField = fields.find(f => f.id === form.watch("field_id"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Crop Structure" : "Add Crop Structure"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the crop structure information below."
              : "Enter the crop planting details for a field."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="field_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Field *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a field" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {fields.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} ({f.area.toFixed(2)} ha)
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
                name="season_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Season *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a season" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {seasons.map((season) => (
                          <SelectItem key={season.id} value={season.id}>
                            {season.year} {season.name ? `- ${season.name}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="crop_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Crop *</FormLabel>
                    <Select
                      onValueChange={handleCropChange}
                      value={field.value ?? undefined}
                      disabled={loadingCrops}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={loadingCrops ? "Loading..." : "Select a crop"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {crops.map((crop) => (
                          <SelectItem key={crop.id} value={crop.id}>
                            {crop.name}
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
                name="variety_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Variety</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? undefined}
                      disabled={!form.watch("crop_id") || varieties.length === 0}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={
                            !form.watch("crop_id")
                              ? "Select a crop first"
                              : varieties.length === 0
                              ? "No varieties available"
                              : "Select a variety"
                          } />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {varieties.map((variety) => (
                          <SelectItem key={variety.id} value={variety.id}>
                            {variety.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="reproduction_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Seed Reproduction</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? undefined}
                    disabled={loadingCrops}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={loadingCrops ? "Loading..." : "Select seed reproduction"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {reproductions.map((reproduction) => (
                        <SelectItem key={reproduction.id} value={reproduction.id}>
                          {reproduction.name}
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
                  {selectedField && (
                    <p className="text-sm text-slate-500">
                      Max area for {selectedField.name}: {selectedField.area.toFixed(2)} ha
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="seeding_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Seeding Rate (kg/ha)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 180"
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
                name="expected_yield"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expected Yield (t/ha)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 6.5"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="planted">Planted</SelectItem>
                      <SelectItem value="growing">Growing</SelectItem>
                      <SelectItem value="harvested">Harvested</SelectItem>
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
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional information..."
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
                  ? "Update"
                  : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
