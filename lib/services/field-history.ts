import { supabase } from "@/lib/supabase/client";

export interface FieldHistoryRecord {
  id: string;
  fieldName: string;
  seasonYear: number;
  cropName: string;
  varietyName: string | null;
  area: number;
  expectedYield: number | null;
  status: string;
}

export interface FieldWithLatestCrop {
  fieldId: string;
  fieldName: string;
  latestSeasonYear: number | null;
  latestCropName: string | null;
  totalArea: number;
}

export interface CropRotationEntry {
  year: number;
  cropName: string;
}

export async function getAllFieldHistory(fieldId?: string): Promise<FieldHistoryRecord[]> {
  let query = supabase
    .from("crop_structure")
    .select(`
      id,
      area,
      expected_yield,
      status,
      fields (
        name
      ),
      seasons (
        year
      ),
      crops (
        name
      ),
      varieties (
        name
      )
    `)
    .eq("archived", false);

  if (fieldId && fieldId !== "all") {
    query = query.eq("field_id", fieldId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching field history:", error);
    return [];
  }

  const records = data?.map((record: any) => ({
    id: record.id,
    fieldName: record.fields?.name || "Unknown",
    seasonYear: record.seasons?.year || 0,
    cropName: record.crops?.name || "Unknown",
    varietyName: record.varieties?.name || null,
    area: Number(record.area),
    expectedYield: record.expected_yield ? Number(record.expected_yield) : null,
    status: record.status,
  })) || [];

  return records.sort((a, b) => b.seasonYear - a.seasonYear);
}

export async function getFieldHistory(fieldId: string): Promise<FieldHistoryRecord[]> {
  return getAllFieldHistory(fieldId);
}

export async function getAllFieldsWithLatestCrop(): Promise<FieldWithLatestCrop[]> {
  const { data: fields, error: fieldsError } = await supabase
    .from("fields")
    .select("id, name, area")
    .eq("archived", false)
    .order("name");

  if (fieldsError) {
    console.error("Error fetching fields:", fieldsError);
    return [];
  }

  const fieldsWithCrops = await Promise.all(
    fields?.map(async (field) => {
      const { data: cropData } = await supabase
        .from("crop_structure")
        .select(`
          seasons (
            year
          ),
          crops (
            name
          )
        `)
        .eq("field_id", field.id)
        .eq("archived", false)
        .order("seasons(year)", { ascending: false })
        .limit(1)
        .maybeSingle();

      const seasonData = cropData?.seasons as any;
      const cropDataName = cropData?.crops as any;

      return {
        fieldId: field.id,
        fieldName: field.name,
        latestSeasonYear: seasonData?.year || null,
        latestCropName: cropDataName?.name || null,
        totalArea: Number(field.area),
      };
    }) || []
  );

  return fieldsWithCrops;
}

export async function getCropRotation(fieldId: string): Promise<CropRotationEntry[]> {
  const { data, error } = await supabase
    .from("crop_structure")
    .select(`
      seasons (
        year
      ),
      crops (
        name
      )
    `)
    .eq("field_id", fieldId)
    .eq("archived", false)
    .order("seasons(year)", { ascending: false });

  if (error) {
    console.error("Error fetching crop rotation:", error);
    return [];
  }

  return data?.map((record: any) => ({
    year: record.seasons?.year || 0,
    cropName: record.crops?.name || "Unknown",
  })) || [];
}

export function detectRotationIssues(rotation: CropRotationEntry[]): boolean {
  for (let i = 0; i < rotation.length - 1; i++) {
    if (rotation[i].cropName === rotation[i + 1].cropName) {
      return true;
    }
  }
  return false;
}
