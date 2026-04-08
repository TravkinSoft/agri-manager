import { z } from "zod";

export const cropStructureSchema = z.object({
  field_id: z.string().uuid("Please select a field"),
  season_id: z.string().uuid("Please select a season"),
  crop_id: z.string().uuid("Please select a crop"),
  variety_id: z.string().uuid("Please select a variety").optional(),
  reproduction_id: z.string().uuid("Please select a reproduction").optional(),
  area: z.number().positive("Area must be greater than 0"),
  seeding_rate: z.number().positive("Seeding rate must be greater than 0").optional().or(z.literal(0)),
  expected_yield: z.number().positive("Expected yield must be greater than 0").optional().or(z.literal(0)),
  status: z.enum(["planned", "planted", "growing", "harvested"]).default("planned"),
  notes: z.string().optional(),
});

export type CropStructureFormData = z.infer<typeof cropStructureSchema>;

export interface CropStructure {
  id: string;
  field_id: string;
  season_id: string;
  crop_id: string;
  variety_id: string | null;
  reproduction_id: string | null;
  area: number;
  seeding_rate: number | null;
  expected_yield: number | null;
  status: "planned" | "planted" | "growing" | "harvested";
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
}

export interface CropStructureWithDetails extends CropStructure {
  field_name: string;
  season_year: number;
  crop_name: string;
  variety_name: string | null;
  reproduction_name: string | null;
}
