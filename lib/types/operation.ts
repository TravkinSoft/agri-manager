import { z } from "zod";
import { MATERIAL_RATE_BASIS, type MaterialRateBasis } from "@/lib/materials/metadata";
import type { TankMixComponentType } from "@/lib/operations/operation-engine";

export interface Operation {
  id: string;
  company_id?: string;
  field_id: string | null;
  crop_structure_id: string | null;
  operation_type: string;
  operation_category_slug?: string | null;
  operation_type_slug?: string | null;
  planned_area_ha?: number | null;
  crop_id?: string | null;
  status?: string | null;
  operation_status?: string | null;
  specialist_task_status?: string | null;
  completed_area_ha?: number | null;
  remaining_area_ha?: number | null;
  progress_percent?: number | null;
  last_progress_at?: string | null;
  last_stop_reason?: string | null;
  started_at?: string | null;
  assigned_to?: string | null;
  date: string;
  machine_id?: string | null;
  equipment_id?: string | null;
  transport_id?: string | null;
  operation_target?: string | null;
  rate_per_ha?: number | null;
  spray_volume_per_ha?: number | null;
  row_spacing_m?: number | null;
  seed_spacing_cm?: number | null;
  operation_params?: Record<string, unknown> | null;
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
  operation_engine_type?: string | null;
  operation_engine_label?: string | null;
  operation_purposes?: string[];
  tank_mix?: OperationTankMixFormData | null;
  responsible_email?: string;
  responsible_role?: string;
  responsible_name?: string | null;
  machine_name?: string | null;
  equipment_name?: string | null;
  transport_name?: string | null;
  draft_target?: string;
  draft_main_product?: string;
  draft_additional_products?: string;
  draft_rate_per_ha?: string;
  draft_mixture_volume_per_ha?: string;
  draft_equipment?: string;
  draft_responsible?: string;
  draft_comments?: string;
  materials?: OperationMaterial[];
  operation_lines?: OperationLine[];
  progress_reports?: OperationProgressReport[];
  completion_requests?: OperationCompletionRequest[];
}

export interface OperationProgressReport {
  id: string;
  operation_id: string;
  company_id: string;
  reported_by: string | null;
  reported_at: string;
  completed_area_ha: number;
  remaining_area_ha: number;
  progress_percent: number;
  status_after_report: string;
  stop_reason: string | null;
  comment: string | null;
  weather_note: string | null;
  reporter_name?: string | null;
}

export interface OperationCompletionRequest {
  id: string;
  operation_id: string;
  company_id: string;
  requested_by: string;
  planned_area_ha: number;
  actual_area_ha: number;
  deviation_area_ha: number;
  variance_reason: string;
  specialist_comment: string | null;
  material_facts: Array<Record<string, unknown>>;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  review_comment: string | null;
  requested_at: string;
  reviewed_at: string | null;
  requester_name?: string | null;
  reviewer_name?: string | null;
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

export type OperationMaterialUnit = "kg" | "l" | "ml" | "g" | "pcs";
export type OperationMaterialRateBasis = MaterialRateBasis;

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
  rate_basis?: OperationMaterialRateBasis | null;
  planned_quantity: number | null;
  issued_quantity: number;
  consumed_quantity: number | null;
  returned_quantity: number | null;
  loss_quantity?: number | null;
  notes: string | null;
  product_name?: string | null;
  master_product_id?: string | null;
  product_type?: string | null;
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
  component_type?: TankMixComponentType;
  material_type: OperationMaterialType;
  product_id?: string | null;
  batch_id?: string | null;
  planned_rate?: number | null;
  actual_rate?: number | null;
  rate_basis?: OperationMaterialRateBasis | null;
  planned_quantity?: number | null;
  unit: OperationMaterialUnit;
  notes?: string | null;
}

export interface OperationTankMixFormData {
  enabled?: boolean;
  water_rate_l_ha?: number | null;
  total_solution_l_ha?: number | null;
  components?: OperationMaterialFormData[];
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

export const operationTargetSchema = z.object({
  field_id: z.string().uuid(),
  crop_structure_id: z.string().uuid().nullable().optional(),
  crop_id: z.string().uuid().nullable().optional(),
  variety_id: z.string().uuid().nullable().optional(),
  reproduction_id: z.string().uuid().nullable().optional(),
  planned_area_ha: z.number().min(0, "planned_area_ha must be >= 0"),
  notes: z.string().nullable().optional(),
});

export type OperationTargetFormData = z.infer<typeof operationTargetSchema>;

export const operationSchema = z.object({
  field_id: z.string().optional(),
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
  row_spacing_m: z.number().positive("row_spacing_m must be > 0").nullable().optional(),
  seed_spacing_cm: z.number().positive("seed_spacing_cm must be > 0").nullable().optional(),
  operation_params: z.record(z.unknown()).nullable().optional(),
  purposes: z.array(z.string()).optional(),
  targets: z.array(operationTargetSchema).optional(),
  tank_mix: z
    .object({
      enabled: z.boolean().optional(),
      water_rate_l_ha: z.number().min(0).nullable().optional(),
      total_solution_l_ha: z.number().min(0).nullable().optional(),
      components: z.array(z.any()).optional(),
    })
    .optional(),
  materials: z
    .array(
      z.object({
        component_type: z.string().nullable().optional(),
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
        product_id: z.string().uuid("Product is required").nullable().optional(),
        batch_id: z.string().uuid().nullable().optional(),
        planned_rate: z.number().min(0).nullable().optional(),
        actual_rate: z.number().min(0).nullable().optional(),
        rate_basis: z
          .enum(MATERIAL_RATE_BASIS)
          .nullable()
          .optional(),
        planned_quantity: z.number().min(0).nullable().optional(),
        unit: z.enum(["kg", "l", "ml", "g", "pcs"]),
        notes: z.string().nullable().optional(),
      })
    )
    .optional(),
  structure_change: z
    .object({
      mode: z.enum(["area_split", "crop_replace"]),
      confirmed: z.boolean().optional(),
      new_crop_id: z.string().uuid().nullable().optional(),
      new_variety_id: z.string().uuid().nullable().optional(),
      new_reproduction_id: z.string().uuid().nullable().optional(),
      area_ha: z.number().min(0).nullable().optional(),
    })
    .optional(),
  date: z.string().min(1, "Date is required"),
  responsible_user_id: z
    .string()
    .uuid("Выберите ответственного специалиста")
    .nullable()
    .optional()
    .refine((value) => Boolean(value), "Выберите ответственного специалиста"),
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
