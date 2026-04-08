import { z } from "zod";

export const fieldSchema = z.object({
  name: z.string().min(1, "Field name is required").max(100, "Field name is too long"),
  area: z.number().positive("Area must be greater than 0"),
  soil_type: z.string().optional(),
  notes: z.string().optional(),
});

export type FieldFormData = z.infer<typeof fieldSchema>;

export interface Field {
  id: string;
  name: string;
  area: number;
  soil_type: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
}
