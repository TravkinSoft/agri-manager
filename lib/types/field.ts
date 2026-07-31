import { z } from "zod";

export const fieldSchema = z.object({
  name: z.string().min(1, "Укажите название поля").max(100, "Название поля слишком длинное"),
  area: z.number().positive("Площадь должна быть больше нуля"),
  soil_type: z.string().optional(),
  notes: z.string().optional(),
});

export type FieldFormData = z.infer<typeof fieldSchema>;

export interface Field {
  id: string;
  name: string;
  display_name?: string | null;
  original_field_key?: string | null;
  technical_key?: string | null;
  area: number;
  soil_type: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
  company_id?: string | null;
}
