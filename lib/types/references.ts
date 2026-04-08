import { z } from "zod";

export const cropSchema = z.object({
  name: z.string().min(1, "Crop name is required").max(100, "Crop name is too long"),
});

export const varietySchema = z.object({
  crop_id: z.string().uuid("Please select a crop"),
  name: z.string().min(1, "Variety name is required").max(100, "Variety name is too long"),
});

export const seedReproductionSchema = z.object({
  name: z.string().min(1, "Reproduction name is required").max(100, "Reproduction name is too long"),
});

export const machineSchema = z.object({
  name: z.string().min(1, "Machine name is required").max(150, "Machine name is too long"),
  type: z.enum(["tractor", "machine", "drone"]).default("machine"),
});

export const equipmentSchema = z.object({
  name: z.string().min(1, "Equipment name is required").max(150, "Equipment name is too long"),
  category: z.string().optional(),
});

export const specialistReferenceSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(150, "Name is too long"),
  role: z.string().optional(),
});

export type CropFormData = z.infer<typeof cropSchema>;
export type VarietyFormData = z.infer<typeof varietySchema>;
export type SeedReproductionFormData = z.infer<typeof seedReproductionSchema>;
export type MachineFormData = z.infer<typeof machineSchema>;
export type EquipmentFormData = z.infer<typeof equipmentSchema>;
export type SpecialistReferenceFormData = z.infer<typeof specialistReferenceSchema>;

export interface Crop {
  id: string;
  name: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
}

export interface Variety {
  id: string;
  crop_id: string;
  name: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
}

export interface VarietyWithCrop extends Variety {
  crop_name: string;
}

export interface SeedReproduction {
  id: string;
  name: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
}

export interface MachineReference {
  id: string;
  name: string;
  type: "tractor" | "machine" | "drone";
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id: string;
}

export interface EquipmentReference {
  id: string;
  name: string;
  category: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id: string;
}

export interface SpecialistReference {
  id: string;
  full_name: string;
  role: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id: string;
}
