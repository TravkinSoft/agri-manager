import { z } from "zod";

export const cropStructureSchema = z.object({
  field_id: z.string().uuid("Please select a field"),
  season_id: z.string().uuid("Please select a season"),
  land_use_type: z.enum(["crop", "fallow"]).default("crop"),
  crop_id: z.string().uuid("Please select a crop").nullable(),
  variety_id: z.string().uuid("Please select a variety").nullable().optional(),
  reproduction_id: z.string().uuid("Please select a reproduction").nullable().optional(),
  area: z.number().positive("Area must be greater than 0"),
  seeding_rate: z.number().positive("Seeding rate must be greater than 0").optional().or(z.literal(0)),
  expected_yield: z.number().positive("Expected yield must be greater than 0").optional().or(z.literal(0)),
  irrigation_type: z.enum(["drip", "sprinkler", "dryland", "unknown"]).default("unknown"),
  row_spacing_m: z.number().positive("Row spacing must be greater than 0").nullable().optional(),
  seed_spacing_cm: z.number().positive("In-row spacing must be greater than 0").nullable().optional(),
  status: z.enum(["planned", "planted", "growing", "harvested"]).default("planned"),
  notes: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.land_use_type === "crop" && !value.crop_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["crop_id"], message: "Please select a crop" });
  }
  if (
    value.land_use_type === "fallow" &&
    (value.crop_id != null || value.variety_id != null || value.reproduction_id != null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["land_use_type"],
      message: "Fallow land cannot have crop identity",
    });
  }
});

export type CropStructureFormData = z.infer<typeof cropStructureSchema>;

export interface CropStructure {
  id: string;
  field_id: string;
  season_id: string;
  land_use_type: "crop" | "fallow";
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  area: number;
  seeding_rate: number | null;
  expected_yield: number | null;
  irrigation_type?: "drip" | "sprinkler" | "dryland" | "unknown" | null;
  row_spacing_m?: number | null;
  seed_spacing_cm?: number | null;
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
