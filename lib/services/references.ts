import { supabase } from "@/lib/supabase/client";
import {
  Crop,
  CropFormData,
  Variety,
  VarietyFormData,
  VarietyWithCrop,
  SeedReproduction,
  SeedReproductionFormData,
  MachineReference,
  MachineFormData,
  EquipmentReference,
  EquipmentFormData,
  SpecialistReference,
  SpecialistReferenceFormData,
} from "@/lib/types/references";

export async function getCrops(
  companyId: string,
  includeArchived = false
): Promise<Crop[]> {
  let query = supabase
    .from("crops")
    .select("*")
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as Crop[];
}

export async function createCrop(
  companyId: string,
  cropData: CropFormData
): Promise<Crop> {
  const { data, error } = await supabase
    .from("crops")
    .insert([
      {
        ...cropData,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating crop:", error);
    throw new Error(`Failed to create crop: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as Crop;
}

export async function updateCrop(
  cropId: string,
  cropData: CropFormData
): Promise<Crop> {
  const { data, error } = await supabase
    .from("crops")
    .update(cropData)
    .eq("id", cropId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Crop;
}

export async function archiveCrop(cropId: string): Promise<void> {
  const { error } = await supabase
    .from("crops")
    .update({ archived: true })
    .eq("id", cropId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getVarieties(
  companyId: string,
  includeArchived = false
): Promise<VarietyWithCrop[]> {
  let query = supabase
    .from("varieties")
    .select(`
      *,
      crops!inner(name)
    `)
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((item: any) => ({
    ...item,
    crop_name: item.crops.name,
  })) as VarietyWithCrop[];
}

export async function getVarietiesByCrop(
  companyId: string,
  cropId: string,
  includeArchived = false
): Promise<Variety[]> {
  let query = supabase
    .from("varieties")
    .select("*")
    .eq("company_id", companyId)
    .eq("crop_id", cropId)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as Variety[];
}

export async function createVariety(
  companyId: string,
  varietyData: VarietyFormData
): Promise<Variety> {
  const { data, error } = await supabase
    .from("varieties")
    .insert([
      {
        ...varietyData,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating variety:", error);
    throw new Error(`Failed to create variety: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as Variety;
}

export async function updateVariety(
  varietyId: string,
  varietyData: VarietyFormData
): Promise<Variety> {
  const { data, error } = await supabase
    .from("varieties")
    .update(varietyData)
    .eq("id", varietyId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Variety;
}

export async function archiveVariety(varietyId: string): Promise<void> {
  const { error } = await supabase
    .from("varieties")
    .update({ archived: true })
    .eq("id", varietyId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getSeedReproductions(
  companyId: string,
  includeArchived = false
): Promise<SeedReproduction[]> {
  let query = supabase
    .from("seed_reproductions")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as SeedReproduction[];
}

export async function createSeedReproduction(
  companyId: string,
  reproductionData: SeedReproductionFormData
): Promise<SeedReproduction> {
  const { data, error } = await supabase
    .from("seed_reproductions")
    .insert([
      {
        ...reproductionData,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating seed reproduction:", error);
    throw new Error(`Failed to create seed reproduction: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as SeedReproduction;
}

export async function updateSeedReproduction(
  reproductionId: string,
  reproductionData: SeedReproductionFormData
): Promise<SeedReproduction> {
  const { data, error } = await supabase
    .from("seed_reproductions")
    .update(reproductionData)
    .eq("id", reproductionId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SeedReproduction;
}

export async function archiveSeedReproduction(reproductionId: string): Promise<void> {
  const { error } = await supabase
    .from("seed_reproductions")
    .update({ archived: true })
    .eq("id", reproductionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getMachineReferences(
  companyId: string,
  includeArchived = false
): Promise<MachineReference[]> {
  let query = supabase
    .from("reference_machines")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as MachineReference[];
}

export async function createMachineReference(
  companyId: string,
  userId: string,
  payload: MachineFormData
): Promise<MachineReference> {
  const { data, error } = await supabase
    .from("reference_machines")
    .insert([{ ...payload, company_id: companyId, user_id: userId }])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as MachineReference;
}

export async function updateMachineReference(
  id: string,
  payload: MachineFormData
): Promise<MachineReference> {
  const { data, error } = await supabase
    .from("reference_machines")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as MachineReference;
}

export async function archiveMachineReference(id: string): Promise<void> {
  const { error } = await supabase
    .from("reference_machines")
    .update({ archived: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getEquipmentReferences(
  companyId: string,
  includeArchived = false
): Promise<EquipmentReference[]> {
  let query = supabase
    .from("reference_equipment")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as EquipmentReference[];
}

export async function createEquipmentReference(
  companyId: string,
  userId: string,
  payload: EquipmentFormData
): Promise<EquipmentReference> {
  const { data, error } = await supabase
    .from("reference_equipment")
    .insert([{ ...payload, company_id: companyId, user_id: userId }])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as EquipmentReference;
}

export async function updateEquipmentReference(
  id: string,
  payload: EquipmentFormData
): Promise<EquipmentReference> {
  const { data, error } = await supabase
    .from("reference_equipment")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as EquipmentReference;
}

export async function archiveEquipmentReference(id: string): Promise<void> {
  const { error } = await supabase
    .from("reference_equipment")
    .update({ archived: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getSpecialistReferences(
  companyId: string,
  includeArchived = false
): Promise<SpecialistReference[]> {
  let query = supabase
    .from("reference_specialists")
    .select("*")
    .eq("company_id", companyId)
    .order("full_name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as SpecialistReference[];
}

export async function createSpecialistReference(
  companyId: string,
  userId: string,
  payload: SpecialistReferenceFormData
): Promise<SpecialistReference> {
  const { data, error } = await supabase
    .from("reference_specialists")
    .insert([{ ...payload, company_id: companyId, user_id: userId }])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as SpecialistReference;
}

export async function updateSpecialistReference(
  id: string,
  payload: SpecialistReferenceFormData
): Promise<SpecialistReference> {
  const { data, error } = await supabase
    .from("reference_specialists")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as SpecialistReference;
}

export async function archiveSpecialistReference(id: string): Promise<void> {
  const { error } = await supabase
    .from("reference_specialists")
    .update({ archived: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
