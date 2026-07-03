import { z } from "zod";
import {
  ADDITIVE_SUBCATEGORIES,
  FERTILIZER_SUBCATEGORIES,
  MATERIAL_PRODUCT_TYPES,
  PESTICIDE_SUBCATEGORIES,
  type MaterialProductType,
  type MaterialSubcategory,
} from "@/lib/materials/classification";

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
  global_brand_id: z.string().uuid().optional().nullable(),
  global_model_id: z.string().uuid().optional().nullable(),
  custom_name: z.string().max(150, "Custom name is too long").optional().or(z.literal("")),
  inventory_number: z.string().max(64, "Inventory number is too long").optional().or(z.literal("")),
  vehicle_type: z
    .enum(["truck", "tractor", "combine", "trailer", "loader", "sprayer", "seeder", "other", "grain_truck", "dump_truck", "tractor_trailer"])
    .default("truck"),
  plate_number: z.string().min(1, "Plate number is required").max(32, "Plate number is too long"),
  capacity_kg: z.coerce.number().nonnegative("Capacity must be zero or greater"),
  body_volume_m3: z.coerce.number().positive("Body volume must be greater than zero").optional().nullable(),
  primary_responsible_personnel_id: z.string().uuid().optional().nullable(),
  status: z
    .enum(["free", "in_trip", "loading", "unloading", "drying"])
    .default("free"),
  is_active: z.boolean().default(true),
});

export const specialistReferenceSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(150, "Name is too long"),
  role: z.string().optional(),
  personnel_type: z.enum(["driver", "machine_operator"]).default("driver"),
  phone: z.string().max(32, "Phone is too long").optional().or(z.literal("")),
  status: z.enum(["active", "inactive"]).default("active"),
  note: z.string().max(500, "Note is too long").optional().or(z.literal("")),
  assigned_vehicle_ids: z.array(z.string().uuid()).optional().default([]),
  machine_id: z.string().uuid().optional().or(z.literal("")),
  equipment_id: z.string().uuid().optional().or(z.literal("")),
});

export const companyPersonRoleValues = [
  "driver",
  "machine_operator",
  "worker",
  "cook",
  "office",
  "guard",
  "manager",
  "other",
] as const;

export const companyPersonEmploymentValues = [
  "permanent",
  "temporary",
  "seasonal",
  "contractor",
  "unknown",
] as const;

export const companyPersonStatusValues = ["active", "inactive", "archived"] as const;

export const companyPersonSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(150, "Name is too long"),
  short_name: z.string().max(80, "Short name is too long").optional().or(z.literal("")),
  role_type: z.enum(companyPersonRoleValues).default("worker"),
  employment_type: z.enum(companyPersonEmploymentValues).default("unknown"),
  phone: z.string().max(32, "Phone is too long").optional().or(z.literal("")),
  iin: z.string().max(16, "IIN is too long").optional().or(z.literal("")),
  status: z.enum(companyPersonStatusValues).default("active"),
  notes: z.string().max(1000, "Notes are too long").optional().or(z.literal("")),
  user_id: z.string().uuid().optional().nullable(),
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

export const materialProductTypeValues = MATERIAL_PRODUCT_TYPES;
export const pesticideSubcategoryValues = PESTICIDE_SUBCATEGORIES;
export const fertilizerSubcategoryValues = FERTILIZER_SUBCATEGORIES;
export const additiveSubcategoryValues = ADDITIVE_SUBCATEGORIES;

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

export type CropFormData = z.input<typeof cropSchema>;
export type VarietyFormData = z.input<typeof varietySchema>;
export type SeedReproductionFormData = z.input<typeof seedReproductionSchema>;
export type MachineFormData = z.input<typeof machineSchema>;
export type EquipmentFormData = z.input<typeof equipmentSchema>;
export type SpecialistReferenceFormData = z.input<typeof specialistReferenceSchema>;
export type CompanyPersonFormData = z.input<typeof companyPersonSchema>;
export type CompanyPersonRoleType = (typeof companyPersonRoleValues)[number];
export type CompanyPersonEmploymentType = (typeof companyPersonEmploymentValues)[number];
export type CompanyPersonStatus = (typeof companyPersonStatusValues)[number];
export type VehicleFormData = z.input<typeof vehicleSchema>;
export type PesticideFormData = z.input<typeof pesticideSchema>;
export type FertilizerFormData = z.input<typeof fertilizerSchema>;
export type PesticideCategory = (typeof pesticideCategoryValues)[number];
export type FertilizerType = (typeof fertilizerTypeValues)[number];
export type { MaterialProductType, MaterialSubcategory };

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
  display_name?: string;
  display_type?: string;
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
  display_name?: string;
  display_type?: string;
  global_brand_id?: string | null;
  global_model_id?: string | null;
  custom_name?: string | null;
  inventory_number?: string | null;
  primary_responsible_personnel_id?: string | null;
  vehicle_type: "truck" | "tractor" | "combine" | "trailer" | "loader" | "sprayer" | "seeder" | "other" | "grain_truck" | "dump_truck" | "tractor_trailer";
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
  display_name?: string;
  display_type?: string;
  category: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id: string;
}

export interface SpecialistReference {
  id: string;
  person_id?: string | null;
  full_name: string;
  role: string | null;
  personnel_type?: "driver" | "machine_operator" | null;
  phone?: string | null;
  status?: "active" | "inactive";
  note?: string | null;
  assigned_vehicle_ids?: string[];
  machine_id?: string | null;
  equipment_id?: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id: string;
}

export interface CompanyPerson {
  id: string;
  company_id: string;
  user_id?: string | null;
  full_name: string;
  short_name?: string | null;
  role_type: CompanyPersonRoleType;
  employment_type: CompanyPersonEmploymentType;
  phone?: string | null;
  iin?: string | null;
  status: CompanyPersonStatus;
  notes?: string | null;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface GlobalVehicleBrand {
  id: string;
  name: string;
  category: string | null;
  country: string | null;
  is_active: boolean;
}

export interface GlobalVehicleModel {
  id: string;
  brand_id: string;
  name: string;
  model_type: "truck" | "tractor" | "combine" | "trailer" | "loader" | "sprayer" | "seeder" | "other";
  default_capacity_kg: number | null;
  is_active: boolean;
}

export interface AgrochemicalReference {
  id: string;
  name: string;
  trade_name: string | null;
  type: "pesticide" | "fertilizer" | "additive" | string;
  product_type?: MaterialProductType | "growth_regulator" | "adjuvant" | string | null;
  category?: string | null;
  subcategory?: MaterialSubcategory | string | null;
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
