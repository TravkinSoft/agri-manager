import { z } from "zod";

export interface Operation {
  id: string;
  company_id?: string;
  field_id: string;
  crop_structure_id: string | null;
  operation_type: string;
  operation_category_slug?: string | null;
  operation_type_slug?: string | null;
  planned_area_ha?: number | null;
  crop_id?: string | null;
  status?: string | null;
  assigned_to?: string | null;
  date: string;
  machine_id?: string | null;
  equipment_id?: string | null;
  transport_id?: string | null;
  operation_target?: string | null;
  rate_per_ha?: number | null;
  spray_volume_per_ha?: number | null;
  operation_config?: Record<string, unknown> | null;
  notes: string | null;
  responsible_user_id: string | null;
  work_status: "active" | "in_progress" | "completed";
  accepted_at: string | null;
  completed_at: string | null;
  specialist_comment: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  user_id: string;
}

export interface OperationWithDetails extends Operation {
  field_name?: string;
  crop_name?: string;
  variety_name?: string;
  reproduction_name?: string;
  responsible_email?: string;
  responsible_role?: string;
  draft_target?: string;
  draft_main_product?: string;
  draft_additional_products?: string;
  draft_rate_per_ha?: string;
  draft_mixture_volume_per_ha?: string;
  draft_equipment?: string;
  draft_responsible?: string;
  draft_comments?: string;
  materials?: OperationMaterial[];
}

export type OperationMaterialType =
  | "seed"
  | "fertilizer"
  | "pesticide"
  | "adjuvant"
  | "ph_corrector"
  | "defoamer"
  | "biological"
  | "fuel"
  | "organic"
  | "water"
  | "other";

export type OperationMaterialUnit = "kg" | "l" | "pcs";

export interface OperationMaterial {
  id: string;
  company_id: string;
  operation_id: string;
  operation_line_id: string | null;
  product_id: string;
  batch_id: string | null;
  material_type: OperationMaterialType;
  unit: OperationMaterialUnit;
  planned_rate: number | null;
  actual_rate: number | null;
  planned_quantity: number | null;
  issued_quantity: number;
  consumed_quantity: number | null;
  returned_quantity: number | null;
  notes: string | null;
  product_name?: string | null;
}

export interface OperationLine {
  id: string;
  company_id: string;
  operation_id: string;
  field_id: string | null;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  planned_area_ha: number;
  actual_area_ha: number | null;
  row_count: number | null;
  row_spacing_m: number | null;
  seed_spacing_cm: number | null;
  calculated_plants_per_ha: number | null;
  calculated_total_plants: number | null;
  completed_by: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  field_name?: string;
  crop_name?: string;
  variety_name?: string;
  reproduction_name?: string;
}

export interface OperationMaterialFormData {
  id?: string;
  material_type: OperationMaterialType;
  product_id: string;
  batch_id?: string | null;
  planned_rate?: number | null;
  actual_rate?: number | null;
  unit: OperationMaterialUnit;
  notes?: string | null;
}

export const operationLineSchema = z.object({
  field_id: z.string().uuid().nullable().optional(),
  crop_id: z.string().uuid().nullable().optional(),
  variety_id: z.string().uuid().nullable().optional(),
  reproduction_id: z.string().uuid().nullable().optional(),
  planned_area_ha: z.number().min(0, "planned_area_ha must be >= 0"),
  actual_area_ha: z.number().min(0, "actual_area_ha must be >= 0").nullable().optional(),
  row_count: z.number().int().min(0, "row_count must be >= 0").nullable().optional(),
  row_spacing_m: z.number().positive("row_spacing_m must be > 0").nullable().optional(),
  seed_spacing_cm: z.number().positive("seed_spacing_cm must be > 0").nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type OperationLineFormData = z.infer<typeof operationLineSchema>;

export const operationSchema = z.object({
  field_id: z.string().uuid("Please select a field"),
  crop_structure_id: z.string().uuid("Please select a crop structure").nullable().optional(),
  operation_category_slug: z.string().optional(),
  operation_type_slug: z.string().optional(),
  operation_type: z.string().min(1, "Operation type is required"),
  planned_area_ha: z.number().min(0, "Planned area must be >= 0").nullable().optional(),
  crop_id: z.string().uuid().nullable().optional(),
  machine_id: z.string().uuid().nullable().optional(),
  equipment_id: z.string().uuid().nullable().optional(),
  transport_id: z.string().uuid().nullable().optional(),
  operation_target: z.string().nullable().optional(),
  rate_per_ha: z.number().min(0).nullable().optional(),
  spray_volume_per_ha: z.number().min(0).nullable().optional(),
  materials: z
    .array(
      z.object({
        material_type: z.enum([
          "seed",
          "fertilizer",
          "pesticide",
          "adjuvant",
          "ph_corrector",
          "defoamer",
          "biological",
          "fuel",
          "organic",
          "water",
          "other",
        ]),
        product_id: z.string().uuid("Product is required"),
        batch_id: z.string().uuid().nullable().optional(),
        planned_rate: z.number().min(0).nullable().optional(),
        actual_rate: z.number().min(0).nullable().optional(),
        unit: z.enum(["kg", "l", "pcs"]),
        notes: z.string().nullable().optional(),
      })
    )
    .optional(),
  date: z.string().min(1, "Date is required"),
  responsible_user_id: z.string().uuid("Please select specialist").nullable().optional(),
  notes: z.string().optional(),
});

export type OperationFormData = z.infer<typeof operationSchema>;

export interface PotatoMaterialConsumptionRow {
  operation_id: string;
  operation_line_id: string;
  operation_date: string | null;
  field_name: string;
  crop_name: string;
  variety_name: string | null;
  reproduction_name: string | null;
  planned_area_ha: number;
  actual_area_ha: number | null;
  completion_pct: number | null;
  material_name: string;
  material_category: string | null;
  issued_qty_kg: number;
  fact_qty_per_ha: number | null;
  planned_norm_per_ha: number | null;
  planned_need_kg: number | null;
  remaining_need_kg: number | null;
  deviation_per_ha: number | null;
  linkage_scope:
    | "line"
    | "operation_single_line"
    | "operation_identity_fallback"
    | "operation_first_line_fallback"
    | "none";
}

export interface SpecialistAssignee {
  id: string;
  full_name?: string | null;
  email: string;
  role: string;
}
