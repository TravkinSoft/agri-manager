import { supabase } from "@/lib/supabase/client";
import { Season, SeasonFormData } from "@/lib/types/season";

export async function getSeasons(
  companyId: string,
  includeArchived = false
): Promise<Season[]> {
  let query = supabase
    .from("seasons")
    .select("*")
    .eq("company_id", companyId)
    .order("year", { ascending: false });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as Season[];
}

export async function getSeason(seasonId: string): Promise<Season | null> {
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .eq("id", seasonId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Season | null;
}

export async function createSeason(
  companyId: string,
  seasonData: SeasonFormData
): Promise<Season> {
  const { data, error } = await supabase
    .from("seasons")
    .insert([
      {
        ...seasonData,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating season:", error);
    throw new Error(`Failed to create season: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as Season;
}

export async function updateSeason(
  seasonId: string,
  seasonData: Partial<SeasonFormData>
): Promise<Season> {
  const { data, error } = await supabase
    .from("seasons")
    .update(seasonData)
    .eq("id", seasonId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Season;
}

export async function archiveSeason(seasonId: string): Promise<void> {
  const { error } = await supabase
    .from("seasons")
    .update({ archived: true })
    .eq("id", seasonId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function unarchiveSeason(seasonId: string): Promise<void> {
  const { error } = await supabase
    .from("seasons")
    .update({ archived: false })
    .eq("id", seasonId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function cloneSeasonWithCropStructures(
  companyId: string,
  sourceSeasonId: string,
  newYear: number,
  newSeasonName?: string
): Promise<Season> {
  const newSeason = await createSeason(companyId, {
    year: newYear,
    name: newSeasonName,
  });

  const { data: cropStructures, error: fetchError } = await supabase
    .from("crop_structure")
    .select("*")
    .eq("company_id", companyId)
    .eq("season_id", sourceSeasonId)
    .eq("archived", false);

  if (fetchError) {
    throw new Error(`Failed to fetch crop structures: ${fetchError.message}`);
  }

  if (cropStructures && cropStructures.length > 0) {
    const clonedStructures = cropStructures.map((structure) => ({
      field_id: structure.field_id,
      season_id: newSeason.id,
      crop_id: structure.crop_id,
      variety_id: structure.variety_id,
      reproduction_id: structure.reproduction_id,
      area: structure.area,
      seeding_rate: structure.seeding_rate,
      expected_yield: structure.expected_yield,
      status: "planned" as const,
      notes: structure.notes,
      company_id: companyId,
    }));

    const { error: insertError } = await supabase
      .from("crop_structure")
      .insert(clonedStructures);

    if (insertError) {
      await supabase.from("seasons").delete().eq("id", newSeason.id);
      throw new Error(`Failed to clone crop structures: ${insertError.message}`);
    }
  }

  return newSeason;
}
