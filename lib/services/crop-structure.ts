import { supabase } from "@/lib/supabase/client";
import { CropStructure, CropStructureFormData, CropStructureWithDetails } from "@/lib/types/crop-structure";
import { getFieldDisplayName } from "@/lib/fields/display";

export async function getCropStructures(
  companyId: string,
  includeArchived = false
): Promise<CropStructureWithDetails[]> {
  let query = supabase
    .from("crop_structure")
    .select(`
      *,
      fields!inner(name,notes),
      seasons!inner(year),
      crops!inner(name),
      varieties(name),
      seed_reproductions(name)
    `)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((item: any) => ({
    ...item,
    field_name: getFieldDisplayName(item.fields),
    season_year: item.seasons.year,
    crop_name: item.crops.name,
    variety_name: item.varieties?.name || null,
    reproduction_name: item.seed_reproductions?.name || null,
  })) as CropStructureWithDetails[];
}

export async function getCropStructuresBySeasonId(
  companyId: string,
  seasonId: string,
  includeArchived = false
): Promise<CropStructureWithDetails[]> {
  let query = supabase
    .from("crop_structure")
    .select(`
      *,
      fields!inner(name,notes),
      seasons!inner(year),
      crops!inner(name),
      varieties(name),
      seed_reproductions(name)
    `)
    .eq("company_id", companyId)
    .eq("season_id", seasonId)
    .order("created_at", { ascending: false });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((item: any) => ({
    ...item,
    field_name: getFieldDisplayName(item.fields),
    season_year: item.seasons.year,
    crop_name: item.crops.name,
    variety_name: item.varieties?.name || null,
    reproduction_name: item.seed_reproductions?.name || null,
  })) as CropStructureWithDetails[];
}

export async function createCropStructure(
  companyId: string,
  cropStructureData: CropStructureFormData
): Promise<CropStructure> {
  const { data, error } = await supabase
    .from("crop_structure")
    .insert([
      {
        ...cropStructureData,
        seeding_rate: cropStructureData.seeding_rate || null,
        expected_yield: cropStructureData.expected_yield || null,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating crop structure:", error);
    throw new Error(`Failed to create crop structure: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as CropStructure;
}

export async function updateCropStructure(
  cropStructureId: string,
  cropStructureData: CropStructureFormData
): Promise<CropStructure> {
  const { data, error } = await supabase
    .from("crop_structure")
    .update({
      ...cropStructureData,
      seeding_rate: cropStructureData.seeding_rate || null,
      expected_yield: cropStructureData.expected_yield || null,
    })
    .eq("id", cropStructureId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as CropStructure;
}

export async function archiveCropStructure(cropStructureId: string): Promise<void> {
  const { error } = await supabase
    .from("crop_structure")
    .update({ archived: true })
    .eq("id", cropStructureId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function unarchiveCropStructure(cropStructureId: string): Promise<void> {
  const { error } = await supabase
    .from("crop_structure")
    .update({ archived: false })
    .eq("id", cropStructureId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getCropStructuresByField(
  companyId: string,
  fieldId: string
): Promise<CropStructure[]> {
  const { data, error } = await supabase
    .from("crop_structure")
    .select("*")
    .eq("company_id", companyId)
    .eq("field_id", fieldId)
    .eq("archived", false)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data as CropStructure[];
}
