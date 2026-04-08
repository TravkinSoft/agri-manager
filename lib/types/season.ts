import { z } from "zod";

export const seasonSchema = z.object({
  year: z.number().int().min(2000, "Year must be 2000 or later").max(2100, "Year must be 2100 or earlier"),
  name: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export type SeasonFormData = z.infer<typeof seasonSchema>;

export interface Season {
  id: string;
  year: number;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
}
