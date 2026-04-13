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
  type: z.enum(["combine", "seeder", "sprayer", "cultivator", "tractor", "other"]).default("other"),
  model: z.string().max(150, "Model is too long").optional().or(z.literal("")),
  status: z.enum(["free", "working", "maintenance"]).default("free"),
  is_active: z.boolean().default(true),
});

export const equipmentSchema = z.object({
  name: z.string().min(1, "Equipment name is required").max(150, "Equipment name is too long"),
  category: z.string().optional(),
});

export const vehicleSchema = z.object({
  name: z.string().min(1, "Vehicle name is required").max(150, "Vehicle name is too long"),
  vehicle_type: z
    .enum(["truck", "grain_truck", "dump_truck", "tractor_trailer"])
    .default("truck"),
  plate_number: z.string().min(1, "Plate number is required").max(32, "Plate number is too long"),
  capacity_kg: z.coerce.number().positive("Capacity must be greater than zero"),
  body_volume_m3: z.coerce.number().positive("Body volume must be greater than zero").optional().nullable(),
  status: z
    .enum(["free", "in_trip", "loading", "unloading", "drying"])
    .default("free"),
  is_active: z.boolean().default(true),
});

export const specialistReferenceSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(150, "Name is too long"),
  role: z.string().optional(),
  machine_id: z.string().uuid().optional().or(z.literal("")),
  equipment_id: z.string().uuid().optional().or(z.literal("")),
});

export const pesticideCategoryValues = [
  "herbicide",
  "fungicide",
  "insecticide",
  "seed_treatment",
  "desiccant",
  "growth_regulator",
  "adjuvant",
  "biological",
  "surfactant",
  "water_conditioner",
  "pH_regulator",
  "drift_reduction_agent",
  "anti_foam",
] as const;

export const fertilizerTypeValues = [
  "nitrogen",
  "phosphorus",
  "potassium",
  "npk",
  "micronutrient",
  "foliar",
  "organic",
] as const;

export const agrochemicalBaseSchema = z.object({
  name: z.string().min(1, "Name is required").max(150, "Name is too long"),
  active_ingredient: z.string().min(1, "Active ingredient is required").max(200, "Active ingredient is too long"),
  trade_name: z.string().max(150, "Trade name is too long").optional().or(z.literal("")),
  formulation: z.string().max(32, "Formulation is too long").optional().or(z.literal("")),
  manufacturer: z.string().max(150, "Manufacturer is too long").optional().or(z.literal("")),
  package_size: z.coerce.number().positive("Package size must be positive").optional(),
  package_unit: z.string().max(16, "Package unit is too long").optional().or(z.literal("")),
  default_unit: z.string().min(1, "Default unit is required").max(16, "Default unit is too long").default("l"),
  notes: z.string().max(1000, "Notes is too long").optional().or(z.literal("")),
});

export const pesticideSchema = agrochemicalBaseSchema.extend({
  category: z.enum(pesticideCategoryValues),
});

export const fertilizerSchema = agrochemicalBaseSchema.extend({
  type: z.enum(fertilizerTypeValues),
});

export type CropFormData = z.infer<typeof cropSchema>;
export type VarietyFormData = z.infer<typeof varietySchema>;
export type SeedReproductionFormData = z.infer<typeof seedReproductionSchema>;
export type MachineFormData = z.infer<typeof machineSchema>;
export type EquipmentFormData = z.infer<typeof equipmentSchema>;
export type SpecialistReferenceFormData = z.infer<typeof specialistReferenceSchema>;
export type VehicleFormData = z.infer<typeof vehicleSchema>;
export type PesticideFormData = z.infer<typeof pesticideSchema>;
export type FertilizerFormData = z.infer<typeof fertilizerSchema>;
export type PesticideCategory = (typeof pesticideCategoryValues)[number];
export type FertilizerType = (typeof fertilizerTypeValues)[number];

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
  type: "combine" | "seeder" | "sprayer" | "cultivator" | "tractor" | "other";
  model: string | null;
  status: "free" | "working" | "maintenance";
  is_active: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id: string | null;
}

export interface VehicleReference {
  id: string;
  name: string;
  vehicle_type: "truck" | "grain_truck" | "dump_truck" | "tractor_trailer";
  plate_number: string;
  capacity_kg: number;
  body_volume_m3: number | null;
  status: "free" | "in_trip" | "loading" | "unloading" | "drying";
  is_active: boolean;
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
  machine_id?: string | null;
  equipment_id?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id: string;
}

export interface AgrochemicalReference {
  id: string;
  name: string;
  trade_name: string | null;
  type: "pesticide" | "fertilizer";
  pesticide_category: PesticideCategory | null;
  pesticide_subcategories: string[] | null;
  fertilizer_type: FertilizerType | null;
  active_ingredient: string | null;
  formulation: string | null;
  manufacturer: string | null;
  package_size: number | null;
  package_unit: string | null;
  default_unit: string | null;
  notes: string | null;
  archived: boolean;
  company_id: string;
  master_product_id?: string | null;
  source_scope?: "company" | "global";
  user_id: string;
  created_at: string;
  updated_at: string;
}
