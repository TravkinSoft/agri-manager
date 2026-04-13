import { supabase } from "@/lib/supabase/client";
import type { Language } from "@/lib/i18n/translations";
import { localizedName } from "@/lib/i18n/helpers";
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
  AgrochemicalReference,
  PesticideFormData,
  FertilizerFormData,
  VehicleReference,
  VehicleFormData,
} from "@/lib/types/references";

async function assertCurrentUserIsGlobalAdmin(): Promise<void> {
  const { data: authRes, error: authError } = await supabase.auth.getUser();
  if (authError || !authRes?.user?.id) {
    throw new Error("User is not authenticated");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authRes.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("User profile not found");
  }

  if (String((profile as any).role || "").toLowerCase() !== "global_admin") {
    throw new Error("Only global admin can manage global agrochemistry catalog");
  }
}

export async function getCrops(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
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

  return ((data || []) as Crop[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));
}

export async function createCrop(
  companyId: string,
  cropData: CropFormData
): Promise<Crop> {
  const existing = await supabase
    .from("crops")
    .select("id")
    .eq("company_id", companyId)
    .ilike("name", cropData.name.trim())
    .eq("archived", false)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) throw new Error("Культура с таким названием уже существует");

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
  includeArchived = false,
  language: Language = "ru"
): Promise<VarietyWithCrop[]> {
  let query = supabase
    .from("varieties")
    .select(`
      *,
      crops!inner(name, name_ru, name_kz, name_en)
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
    name: localizedName(item, language) || item.name,
    crop_name: localizedName(item.crops, language) || item.crops.name,
  })) as VarietyWithCrop[];
}

export async function getVarietiesByCrop(
  companyId: string,
  cropId: string,
  includeArchived = false,
  language: Language = "ru"
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

  return ((data || []) as Variety[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));
}

export async function createVariety(
  companyId: string,
  varietyData: VarietyFormData
): Promise<Variety> {
  const existing = await supabase
    .from("varieties")
    .select("id")
    .eq("company_id", companyId)
    .eq("crop_id", varietyData.crop_id)
    .ilike("name", varietyData.name.trim())
    .eq("archived", false)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) throw new Error("Такой сорт уже существует для выбранной культуры");

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
  includeArchived = false,
  language: Language = "ru"
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

  return ((data || []) as SeedReproduction[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));
}

export async function createSeedReproduction(
  companyId: string,
  reproductionData: SeedReproductionFormData
): Promise<SeedReproduction> {
  const existing = await supabase
    .from("seed_reproductions")
    .select("id")
    .eq("company_id", companyId)
    .ilike("name", reproductionData.name.trim())
    .eq("archived", false)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) throw new Error("Репродукция с таким названием уже существует");

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
  includeArchived = false,
  language: Language = "ru"
): Promise<MachineReference[]> {
  let query = supabase
    .from("reference_machines")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as MachineReference[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));
}

export async function getVehicleReferences(
  companyId: string,
  includeArchived = false
): Promise<VehicleReference[]> {
  let query = supabase
    .from("reference_vehicles")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as VehicleReference[];
}

export async function createVehicleReference(
  companyId: string,
  userId: string,
  payload: VehicleFormData
): Promise<VehicleReference> {
  const existingByPlate = await supabase
    .from("reference_vehicles")
    .select("id")
    .eq("company_id", companyId)
    .ilike("plate_number", payload.plate_number.trim())
    .eq("archived", false)
    .maybeSingle();
  if (existingByPlate.error) throw new Error(existingByPlate.error.message);
  if (existingByPlate.data?.id) throw new Error("Машина с таким госномером уже существует");

  const { data, error } = await supabase
    .from("reference_vehicles")
    .insert([{ ...payload, company_id: companyId, user_id: userId }])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as VehicleReference;
}

export async function updateVehicleReference(
  id: string,
  payload: Partial<VehicleFormData>
): Promise<VehicleReference> {
  const { data, error } = await supabase
    .from("reference_vehicles")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as VehicleReference;
}

export async function archiveVehicleReference(id: string): Promise<void> {
  const { error } = await supabase
    .from("reference_vehicles")
    .update({ archived: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createMachineReference(
  companyId: string,
  userId: string,
  payload: MachineFormData
): Promise<MachineReference> {
  const existing = await supabase
    .from("reference_machines")
    .select("id")
    .eq("company_id", companyId)
    .ilike("name", payload.name.trim())
    .eq("archived", false)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) throw new Error("Техника с таким названием уже существует");

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
  includeArchived = false,
  language: Language = "ru"
): Promise<EquipmentReference[]> {
  let query = supabase
    .from("reference_equipment")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as EquipmentReference[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));
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
  const existing = await supabase
    .from("reference_specialists")
    .select("id")
    .eq("company_id", companyId)
    .ilike("full_name", payload.full_name.trim())
    .eq("archived", false)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) throw new Error("Специалист с таким ФИО уже существует");

  const normalizedPayload = {
    ...payload,
    machine_id: payload.machine_id || null,
    equipment_id: payload.equipment_id || null,
  };
  const { data, error } = await supabase
    .from("reference_specialists")
    .insert([{ ...normalizedPayload, company_id: companyId, user_id: userId }])
    .select()
    .single();
  if (error) {
    if (error.message?.toLowerCase().includes("machine_id") || error.message?.toLowerCase().includes("equipment_id")) {
      const fallbackPayload = {
        full_name: payload.full_name,
        role: payload.role || null,
        company_id: companyId,
        user_id: userId,
      };
      const fallback = await supabase
        .from("reference_specialists")
        .insert([fallbackPayload])
        .select()
        .single();
      if (fallback.error) throw new Error(fallback.error.message);
      return fallback.data as SpecialistReference;
    }
    throw new Error(error.message);
  }
  return data as SpecialistReference;
}

export async function updateSpecialistReference(
  id: string,
  payload: SpecialistReferenceFormData
): Promise<SpecialistReference> {
  const normalizedPayload = {
    ...payload,
    machine_id: payload.machine_id || null,
    equipment_id: payload.equipment_id || null,
  };
  const { data, error } = await supabase
    .from("reference_specialists")
    .update(normalizedPayload)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (error.message?.toLowerCase().includes("machine_id") || error.message?.toLowerCase().includes("equipment_id")) {
      const fallbackPayload = {
        full_name: payload.full_name,
        role: payload.role || null,
      };
      const fallback = await supabase
        .from("reference_specialists")
        .update(fallbackPayload)
        .eq("id", id)
        .select()
        .single();
      if (fallback.error) throw new Error(fallback.error.message);
      return fallback.data as SpecialistReference;
    }
    throw new Error(error.message);
  }
  return data as SpecialistReference;
}

export async function archiveSpecialistReference(id: string): Promise<void> {
  const { error } = await supabase
    .from("reference_specialists")
    .update({ archived: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

function mapAgrochemicalRow(row: any, language: Language): AgrochemicalReference {
  return {
    ...row,
    name: localizedName(row, language) || row.name,
    trade_name: row.trade_name || null,
    pesticide_category: row.pesticide_category || null,
    pesticide_subcategories: row.pesticide_subcategories || null,
    fertilizer_type: row.fertilizer_type || null,
    active_ingredient: row.active_ingredient || null,
    formulation: row.formulation || null,
    manufacturer: row.manufacturer || null,
    package_size: row.package_size == null ? null : Number(row.package_size),
    package_unit: row.package_unit || null,
    default_unit: row.default_unit || null,
    notes: row.notes || null,
  } as AgrochemicalReference;
}

export async function getPesticides(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  let query = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .eq("type", "pesticide")
    .order("name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => mapAgrochemicalRow(row, language));
}

export async function getFertilizers(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  let query = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .eq("type", "fertilizer")
    .order("name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => mapAgrochemicalRow(row, language));
}

export async function searchAgrochemicalMaster(
  companyId: string,
  type: "pesticide" | "fertilizer",
  queryText = "",
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  const text = queryText.trim().toLowerCase();

  const companyQuery = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .eq("type", type)
    .eq("archived", false)
    .order("name", { ascending: true });

  const globalQuery = supabase
    .from("products")
    .select("*")
    .is("company_id", null)
    .eq("type", type)
    .eq("archived", false)
    .order("name", { ascending: true });

  const [{ data: companyData, error: companyError }, { data: globalData, error: globalError }] = await Promise.all([
    companyQuery,
    globalQuery,
  ]);

  if (companyError) throw new Error(companyError.message);
  if (globalError) throw new Error(globalError.message);

  const companyRows = (companyData || []).map((row: any) => ({
    ...mapAgrochemicalRow(row, language),
    source_scope: "company" as const,
  }));
  const globalRows = (globalData || []).map((row: any) => ({
    ...mapAgrochemicalRow(row, language),
    source_scope: "global" as const,
  }));

  const all = [...companyRows, ...globalRows];
  if (!text) return all;

  return all.filter((item) => {
    const hay = [
      item.name,
      item.trade_name || "",
      item.active_ingredient || "",
      item.manufacturer || "",
      item.formulation || "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(text);
  });
}

export async function addGlobalAgrochemicalToCompany(
  companyId: string,
  userId: string,
  globalProductId: string
): Promise<AgrochemicalReference> {
  const { data: master, error: masterError } = await supabase
    .from("products")
    .select("*")
    .eq("id", globalProductId)
    .is("company_id", null)
    .single();

  if (masterError || !master) {
    throw new Error(masterError?.message || "Global product not found");
  }

  const duplicate = await supabase
    .from("products")
    .select("id")
    .eq("company_id", companyId)
    .eq("type", master.type)
    .eq("name", master.name)
    .eq("archived", false)
    .maybeSingle();

  if (duplicate.error) throw new Error(duplicate.error.message);
  if (duplicate.data?.id) {
    const existing = await supabase.from("products").select("*").eq("id", duplicate.data.id).single();
    if (existing.error) throw new Error(existing.error.message);
    return existing.data as AgrochemicalReference;
  }

  const insertPayload = {
    name: master.name,
    type: master.type,
    trade_name: master.trade_name || null,
    pesticide_category: master.pesticide_category || null,
    pesticide_subcategories: master.pesticide_subcategories || null,
    fertilizer_type: master.fertilizer_type || null,
    active_ingredient: master.active_ingredient || null,
    formulation: master.formulation || null,
    manufacturer: master.manufacturer || null,
    package_size: master.package_size ?? null,
    package_unit: master.package_unit || null,
    default_unit: master.default_unit || master.unit || "kg",
    notes: master.notes || null,
    unit: master.default_unit || master.unit || "kg",
    crop_id: master.crop_id || null,
    product_form: master.product_form || null,
    accounting_mode: master.accounting_mode || "bulk_mass",
    base_uom: master.base_uom || "kg",
    pack_uom: master.pack_uom || null,
    unit_weight_kg: master.unit_weight_kg ?? null,
    units_per_pack: master.units_per_pack ?? null,
    is_seed_material: master.is_seed_material ?? false,
    master_product_id: master.id,
    company_id: companyId,
    user_id: userId,
  };

  const { data, error } = await supabase.from("products").insert([insertPayload]).select().single();
  if (error) throw new Error(error.message);
  return data as AgrochemicalReference;
}

export async function createPesticide(
  companyId: string,
  userId: string,
  payload: PesticideFormData,
  scope: "company" | "global" = "company"
): Promise<AgrochemicalReference> {
  if (scope !== "global") {
    throw new Error("Company users cannot create pesticides directly. Use global master catalog linkage.");
  }
  await assertCurrentUserIsGlobalAdmin();
  const insertPayload = {
    name: payload.name,
    type: "pesticide",
    trade_name: payload.trade_name || null,
    pesticide_category: payload.category,
    pesticide_subcategories:
      payload.category === "adjuvant"
        ? ["water_conditioner", "pH_regulator", "surfactant", "anti_foam"]
        : null,
    fertilizer_type: null,
    active_ingredient: payload.active_ingredient,
    formulation: payload.formulation || null,
    manufacturer: payload.manufacturer || null,
    package_size: payload.package_size ?? null,
    package_unit: payload.package_unit || null,
    default_unit: payload.default_unit || "l",
    notes: payload.notes || null,
    unit: payload.default_unit || "l",
    company_id: scope === "global" ? null : companyId,
    user_id: userId,
  };
  const { data, error } = await supabase.from("products").insert([insertPayload]).select().single();
  if (error) throw new Error(error.message);
  return data as AgrochemicalReference;
}

export async function updatePesticide(
  id: string,
  payload: PesticideFormData
): Promise<AgrochemicalReference> {
  await assertCurrentUserIsGlobalAdmin();
  const existing = await supabase.from("products").select("company_id").eq("id", id).single();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.company_id) {
    throw new Error("Company pesticide identity cannot be modified directly.");
  }
  const updatePayload = {
    name: payload.name,
    trade_name: payload.trade_name || null,
    pesticide_category: payload.category,
    pesticide_subcategories:
      payload.category === "adjuvant"
        ? ["water_conditioner", "pH_regulator", "surfactant", "anti_foam"]
        : null,
    active_ingredient: payload.active_ingredient,
    formulation: payload.formulation || null,
    manufacturer: payload.manufacturer || null,
    package_size: payload.package_size ?? null,
    package_unit: payload.package_unit || null,
    default_unit: payload.default_unit || "l",
    notes: payload.notes || null,
    unit: payload.default_unit || "l",
  };
  const { data, error } = await supabase.from("products").update(updatePayload).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as AgrochemicalReference;
}

export async function createFertilizer(
  companyId: string,
  userId: string,
  payload: FertilizerFormData,
  scope: "company" | "global" = "company"
): Promise<AgrochemicalReference> {
  if (scope !== "global") {
    throw new Error("Company users cannot create fertilizers directly. Use global master catalog linkage.");
  }
  await assertCurrentUserIsGlobalAdmin();
  const insertPayload = {
    name: payload.name,
    type: "fertilizer",
    trade_name: payload.trade_name || null,
    pesticide_category: null,
    fertilizer_type: payload.type,
    active_ingredient: payload.active_ingredient,
    formulation: payload.formulation || null,
    manufacturer: payload.manufacturer || null,
    package_size: payload.package_size ?? null,
    package_unit: payload.package_unit || null,
    default_unit: payload.default_unit || "kg",
    notes: payload.notes || null,
    unit: payload.default_unit || "kg",
    company_id: scope === "global" ? null : companyId,
    user_id: userId,
  };
  const { data, error } = await supabase.from("products").insert([insertPayload]).select().single();
  if (error) throw new Error(error.message);
  return data as AgrochemicalReference;
}

export async function updateFertilizer(
  id: string,
  payload: FertilizerFormData
): Promise<AgrochemicalReference> {
  await assertCurrentUserIsGlobalAdmin();
  const existing = await supabase.from("products").select("company_id").eq("id", id).single();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.company_id) {
    throw new Error("Company fertilizer identity cannot be modified directly.");
  }
  const updatePayload = {
    name: payload.name,
    trade_name: payload.trade_name || null,
    fertilizer_type: payload.type,
    active_ingredient: payload.active_ingredient,
    formulation: payload.formulation || null,
    manufacturer: payload.manufacturer || null,
    package_size: payload.package_size ?? null,
    package_unit: payload.package_unit || null,
    default_unit: payload.default_unit || "kg",
    notes: payload.notes || null,
    unit: payload.default_unit || "kg",
  };
  const { data, error } = await supabase.from("products").update(updatePayload).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as AgrochemicalReference;
}

export async function archiveAgrochemical(id: string): Promise<void> {
  await assertCurrentUserIsGlobalAdmin();
  const { error } = await supabase.from("products").update({ archived: true }).eq("id", id);
  if (error) throw new Error(error.message);
}
