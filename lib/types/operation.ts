import { z } from "zod";

export interface Operation {
  id: string;
  field_id: string;
  crop_structure_id: string | null;
  operation_type: string;
  date: string;
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
}

export const operationSchema = z.object({
  field_id: z.string().uuid("Please select a field"),
  crop_structure_id: z.string().uuid("Please select a crop structure").nullable().optional(),
  operation_type: z.string().min(1, "Operation type is required"),
  date: z.string().min(1, "Date is required"),
  responsible_user_id: z.string().uuid("Please select specialist").nullable().optional(),
  notes: z.string().optional(),
});

export type OperationFormData = z.infer<typeof operationSchema>;

export interface SpecialistAssignee {
  id: string;
  email: string;
  role: string;
}
