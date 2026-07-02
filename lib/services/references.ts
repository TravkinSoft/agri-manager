import { supabase } from "@/lib/supabase/client";
import type { Language } from "@/lib/i18n/translations";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { getMaterialProductTypeFromProduct, type MaterialProductType } from "@/lib/materials/classification";
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
  CompanyPerson,
  CompanyPersonFormData,
  CompanyPersonRoleType,
  AgrochemicalReference,
  PesticideFormData,
  FertilizerFormData,
  VehicleReference,
  VehicleFormData,
  GlobalVehicleBrand,
  GlobalVehicleModel,
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

function normalizeReferenceDisplayKey(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/\u0401/g, "\u0435")
    .replace(/\s+/g, " ");
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

  const rows = ((data || []) as Crop[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));

  const map = new Map<string, Crop & { company_id?: string | null }>();
  rows.forEach((row: any) => {
    const key = normalizeReferenceDisplayKey(row.name || localizedName(row, language) || row.slug);
    if (!key) return;
    const existing = map.get(key);
    if (!existing || (existing.company_id == null && row.company_id != null)) {
      map.set(key, row);
    }
  });

  return Array.from(map.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
}

export async function createCrop(
  companyId: string,
  cropData: CropFormData
): Promise<Crop> {
  throw new Error("Локальное создание культур отключено: используйте глобальный каталог и привязку к компании.");
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
    .select("*")
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order("name", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const varietyRows = data || [];
  const cropIds = Array.from(new Set(varietyRows.map((row: any) => row.crop_id).filter(Boolean)));
  const cropsMap = new Map<string, any>();
  if (cropIds.length > 0) {
    const { data: cropsData, error: cropsError } = await supabase
      .from("crops")
      .select("id,name,name_ru,name_kz,name_en")
      .in("id", cropIds);
    if (cropsError) throw new Error(cropsError.message);
    (cropsData || []).forEach((crop: any) => cropsMap.set(String(crop.id), crop));
  }

  const map = new Map<string, any>();
  varietyRows.forEach((row: any) => {
    const key = `${row.crop_id}|${String(row.name || "").trim().toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || (existing.company_id == null && row.company_id != null)) {
      map.set(key, row);
    }
  });

  return Array.from(map.values()).map((item: any) => {
    const crop = cropsMap.get(String(item.crop_id));
    return {
      ...item,
      name: brandName(item) || item.name,
      crop_name: localizedName(crop, language) || crop?.name || "-",
    };
  }) as VarietyWithCrop[];
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
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .eq("crop_id", cropId)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data || []) as Variety[];
  const map = new Map<string, any>();
  rows.forEach((row: any) => {
    const key = String(row.name || "").trim().toLowerCase();
    const existing = map.get(key);
    if (!existing || (existing.company_id == null && row.company_id != null)) {
      map.set(key, row);
    }
  });
  return Array.from(map.values()).map((row: any) => ({
    ...row,
    name: brandName(row) || row.name,
  }));
}

export async function createVariety(
  companyId: string,
  varietyData: VarietyFormData
): Promise<Variety> {
  throw new Error("Локальное создание сортов отключено: используйте глобальный каталог и привязку к компании.");
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
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data || []) as SeedReproduction[]).map((row: any) => ({
    ...row,
    name: localizedName(row, language) || row.name,
  }));

  const map = new Map<string, any>();
  rows.forEach((row: any) => {
    const key = String(row.name || "").trim().toLowerCase();
    const existing = map.get(key);
    if (!existing || (existing.company_id == null && row.company_id != null)) {
      map.set(key, row);
    }
  });

  return Array.from(map.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
}

export async function createSeedReproduction(
  companyId: string,
  reproductionData: SeedReproductionFormData
): Promise<SeedReproduction> {
  throw new Error("Локальное создание репродукций отключено: используйте глобальный каталог.");
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

const LEGACY_SEEDED_MACHINE_NAMES = new Set([
  "amazone sprayer",
  "claas lexion 770",
  "dji t50",
  "john deere",
  "john deere 2",
  "john deere seeder",
  "john deere сеялка",
  "amazone опрыскиватель",
]);

function normalizeReferenceAuditText(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isLegacySeededMachineReference(row: { name?: unknown; created_at?: unknown; company_id?: unknown }): boolean {
  const name = normalizeReferenceAuditText(row.name);
  if (!LEGACY_SEEDED_MACHINE_NAMES.has(name)) return false;

  const createdAt = String(row.created_at || "");
  return (
    createdAt.startsWith("2026-04-07") ||
    createdAt.startsWith("2026-04-10")
  );
}

function isLegacySeededEquipmentReference(row: { created_at?: unknown; brand?: unknown; model?: unknown; company_id?: unknown }): boolean {
  const createdAt = String(row.created_at || "");
  const isKnownGlobalCatalogSpillover =
    createdAt.startsWith("2026-04-19T00:22:13") ||
    createdAt.startsWith("2026-04-19T00:27:02") ||
    createdAt.startsWith("2026-07-01T21:33:22");

  return isKnownGlobalCatalogSpillover && Boolean(String(row.brand || "").trim() || String(row.model || "").trim());
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
  return ((data || []) as MachineReference[])
    .filter((row: any) => !isLegacySeededMachineReference(row))
    .map((row: any) => ({
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
    .select(`
      *,
      global_vehicle_brands:global_brand_id(id,name),
      global_vehicle_models:global_model_id(id,name,model_type,default_capacity_kg),
      primary_responsible:primary_responsible_personnel_id(id,full_name,personnel_type,status)
    `)
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as any[]).map((row) => ({
    ...row,
    name:
      row.global_vehicle_brands?.name && row.global_vehicle_models?.name
        ? `${row.global_vehicle_brands.name} ${row.global_vehicle_models.name}${row.plate_number ? ` — ${row.plate_number}` : ""}`
        : row.custom_name || row.name,
  })) as VehicleReference[];
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

  const insertPayload: any = {
    ...payload,
    custom_name: payload.custom_name || null,
    inventory_number: payload.inventory_number || null,
    global_brand_id: payload.global_brand_id || null,
    global_model_id: payload.global_model_id || null,
    primary_responsible_personnel_id: payload.primary_responsible_personnel_id || null,
    company_id: companyId,
    user_id: userId,
  };
  const { data, error } = await supabase
    .from("reference_vehicles")
    .insert([insertPayload])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as VehicleReference;
}

export async function updateVehicleReference(
  id: string,
  payload: Partial<VehicleFormData>
): Promise<VehicleReference> {
  const normalized: any = {
    ...payload,
  };
  if ("custom_name" in normalized) normalized.custom_name = normalized.custom_name || null;
  if ("inventory_number" in normalized) normalized.inventory_number = normalized.inventory_number || null;
  if ("global_brand_id" in normalized) normalized.global_brand_id = normalized.global_brand_id || null;
  if ("global_model_id" in normalized) normalized.global_model_id = normalized.global_model_id || null;
  if ("primary_responsible_personnel_id" in normalized) {
    normalized.primary_responsible_personnel_id = normalized.primary_responsible_personnel_id || null;
  }
  const { data, error } = await supabase
    .from("reference_vehicles")
    .update(normalized)
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
  return ((data || []) as EquipmentReference[])
    .filter((row: any) => !isLegacySeededEquipmentReference(row))
    .map((row: any) => ({
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

function isCompanyPeopleSchemaMissing(error: any): boolean {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("company_people") && (
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("not found")
  );
}

function roleTypeToSpecialistType(roleType?: CompanyPersonRoleType | null): "driver" | "machine_operator" | null {
  if (roleType === "driver") return "driver";
  if (roleType === "machine_operator") return "machine_operator";
  return null;
}

function normalizeCompanyPersonPayload(payload: CompanyPersonFormData) {
  return {
    full_name: payload.full_name.trim(),
    short_name: payload.short_name?.trim() || null,
    role_type: payload.role_type || "worker",
    employment_type: payload.employment_type || "unknown",
    phone: payload.phone?.trim() || null,
    iin: payload.iin?.trim() || null,
    status: payload.status || "active",
    notes: payload.notes?.trim() || null,
    user_id: payload.user_id || null,
  };
}

async function syncPersonToSpecialistReference(person: CompanyPerson, actorUserId?: string): Promise<void> {
  const specialistType = roleTypeToSpecialistType(person.role_type);
  const shouldBeActive = specialistType && person.status !== "archived" && !person.deleted_at;

  const { data: byPerson, error: byPersonError } = await supabase
    .from("reference_specialists")
    .select("id")
    .eq("company_id", person.company_id)
    .eq("person_id", person.id)
    .maybeSingle();

  if (byPersonError) {
    const message = String(byPersonError.message || "").toLowerCase();
    if (!message.includes("person_id") && !message.includes("schema cache")) throw new Error(byPersonError.message);
    return;
  }

  if (!shouldBeActive) {
    if (byPerson?.id) {
      const { error } = await supabase
        .from("reference_specialists")
        .update({ status: "inactive", archived: true })
        .eq("id", byPerson.id);
      if (error) throw new Error(error.message);
    }
    return;
  }

  const specialistPayload = {
    person_id: person.id,
    full_name: person.full_name,
    role: person.role_type,
    personnel_type: specialistType,
    phone: person.phone || null,
    status: person.status === "active" ? "active" : "inactive",
    note: person.notes || null,
    archived: false,
  };

  if (byPerson?.id) {
    const { error } = await supabase
      .from("reference_specialists")
      .update(specialistPayload)
      .eq("id", byPerson.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { data: byName, error: byNameError } = await supabase
    .from("reference_specialists")
    .select("id")
    .eq("company_id", person.company_id)
    .ilike("full_name", person.full_name)
    .eq("personnel_type", specialistType)
    .eq("archived", false)
    .maybeSingle();

  if (byNameError) throw new Error(byNameError.message);

  if (byName?.id) {
    const { error } = await supabase
      .from("reference_specialists")
      .update(specialistPayload)
      .eq("id", byName.id);
    if (error) throw new Error(error.message);
    return;
  }

  if (!actorUserId) return;
  const { error } = await supabase
    .from("reference_specialists")
    .insert([{ ...specialistPayload, company_id: person.company_id, user_id: actorUserId }]);
  if (error) throw new Error(error.message);
}

async function ensureCompanyPersonForSpecialist(
  companyId: string,
  userId: string,
  payload: SpecialistReferenceFormData
): Promise<string | null> {
  const roleType = (payload.personnel_type || "driver") as CompanyPersonRoleType;

  const { data: existing, error: existingError } = await supabase
    .from("company_people")
    .select("id")
    .eq("company_id", companyId)
    .eq("role_type", roleType)
    .ilike("full_name", payload.full_name.trim())
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    if (isCompanyPeopleSchemaMissing(existingError)) return null;
    throw new Error(existingError.message);
  }
  if (existing?.id) return String(existing.id);

  const personPayload = {
    company_id: companyId,
    created_by_user_id: userId,
    updated_by_user_id: userId,
    ...normalizeCompanyPersonPayload({
      full_name: payload.full_name,
      role_type: roleType,
      employment_type: "unknown",
      phone: payload.phone || "",
      status: payload.status === "inactive" ? "inactive" : "active",
      notes: payload.note || "",
      user_id: null,
    }),
  };

  const { data, error } = await supabase
    .from("company_people")
    .insert([personPayload])
    .select("id")
    .single();

  if (error) {
    if (isCompanyPeopleSchemaMissing(error)) return null;
    throw new Error(error.message);
  }
  return data?.id ? String(data.id) : null;
}

export async function getCompanyPeople(
  companyId: string,
  includeArchived = false
): Promise<CompanyPerson[]> {
  let query = supabase
    .from("company_people")
    .select("*")
    .eq("company_id", companyId)
    .order("full_name", { ascending: true });

  if (!includeArchived) query = query.neq("status", "archived").is("deleted_at", null);

  const { data, error } = await query;
  if (error) {
    if (isCompanyPeopleSchemaMissing(error)) return [];
    throw new Error(error.message);
  }
  return (data || []) as CompanyPerson[];
}

export async function createCompanyPerson(
  companyId: string,
  userId: string,
  payload: CompanyPersonFormData
): Promise<CompanyPerson> {
  const normalizedPayload = normalizeCompanyPersonPayload(payload);

  const { data: existing, error: existingError } = await supabase
    .from("company_people")
    .select("id")
    .eq("company_id", companyId)
    .eq("role_type", normalizedPayload.role_type)
    .ilike("full_name", normalizedPayload.full_name)
    .is("deleted_at", null)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.id) throw new Error("Работник с таким ФИО и ролью уже существует");

  const { data, error } = await supabase
    .from("company_people")
    .insert([{
      ...normalizedPayload,
      company_id: companyId,
      created_by_user_id: userId,
      updated_by_user_id: userId,
    }])
    .select()
    .single();

  if (error) throw new Error(error.message);
  const person = data as CompanyPerson;
  await syncPersonToSpecialistReference(person, userId);
  return person;
}

export async function updateCompanyPerson(
  companyId: string,
  personId: string,
  userId: string,
  payload: CompanyPersonFormData
): Promise<CompanyPerson> {
  const normalizedPayload = normalizeCompanyPersonPayload(payload);

  const { data: existing, error: existingError } = await supabase
    .from("company_people")
    .select("id")
    .eq("company_id", companyId)
    .eq("role_type", normalizedPayload.role_type)
    .ilike("full_name", normalizedPayload.full_name)
    .is("deleted_at", null)
    .neq("id", personId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.id) throw new Error("Другой работник с таким ФИО и ролью уже существует");

  const { data, error } = await supabase
    .from("company_people")
    .update({ ...normalizedPayload, updated_by_user_id: userId })
    .eq("company_id", companyId)
    .eq("id", personId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  const person = data as CompanyPerson;
  await syncPersonToSpecialistReference(person, userId);
  return person;
}

export async function archiveCompanyPerson(
  companyId: string,
  personId: string,
  userId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("company_people")
    .update({ status: "archived", deleted_at: new Date().toISOString(), updated_by_user_id: userId })
    .eq("company_id", companyId)
    .eq("id", personId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  await syncPersonToSpecialistReference(data as CompanyPerson, userId);
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
  const specialists = (data || []) as SpecialistReference[];
  if (!specialists.length) return specialists;

  const specialistIds = specialists.map((x) => x.id);
  const { data: assignedRows, error: assignedError } = await supabase
    .from("reference_vehicles")
    .select("id,primary_responsible_personnel_id")
    .eq("company_id", companyId)
    .in("primary_responsible_personnel_id", specialistIds)
    .eq("archived", false);
  if (assignedError) throw new Error(assignedError.message);

  const bySpecialist = new Map<string, string[]>();
  (assignedRows || []).forEach((row: any) => {
    const key = String(row.primary_responsible_personnel_id || "");
    if (!key) return;
    const list = bySpecialist.get(key) || [];
    list.push(String(row.id));
    bySpecialist.set(key, list);
  });

  return specialists.map((s) => ({
    ...s,
    assigned_vehicle_ids: bySpecialist.get(String(s.id)) || [],
  }));
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

  const linkedPersonId = await ensureCompanyPersonForSpecialist(companyId, userId, payload);
  const normalizedPayload: Record<string, any> = {
    ...payload,
    personnel_type: payload.personnel_type || "driver",
    phone: payload.phone || null,
    status: payload.status || "active",
    note: payload.note || null,
    machine_id: payload.machine_id || null,
    equipment_id: payload.equipment_id || null,
  };
  if (linkedPersonId) normalizedPayload.person_id = linkedPersonId;
  const { data, error } = await supabase
    .from("reference_specialists")
    .insert([{ ...normalizedPayload, company_id: companyId, user_id: userId }])
    .select()
    .single();
  if (error) {
    const lowerMessage = error.message?.toLowerCase() || "";
    if (
      lowerMessage.includes("machine_id") ||
      lowerMessage.includes("equipment_id") ||
      lowerMessage.includes("person_id") ||
      lowerMessage.includes("schema cache")
    ) {
      const fallbackPayload = {
        full_name: payload.full_name,
        role: payload.role || null,
        personnel_type: payload.personnel_type || "driver",
        phone: payload.phone || null,
        status: payload.status || "active",
        note: payload.note || null,
        company_id: companyId,
        user_id: userId,
      };
      if (linkedPersonId && !lowerMessage.includes("person_id") && !lowerMessage.includes("schema cache")) {
        (fallbackPayload as any).person_id = linkedPersonId;
      }
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
  if ((payload.assigned_vehicle_ids || []).length > 0) {
    const assignedVehicleIds = payload.assigned_vehicle_ids || [];
    const { error: assignError } = await supabase
      .from("reference_vehicles")
      .update({ primary_responsible_personnel_id: (data as any).id })
      .eq("company_id", companyId)
      .in("id", assignedVehicleIds);
    if (assignError) throw new Error(assignError.message);
  }
  return data as SpecialistReference;
}

export async function updateSpecialistReference(
  id: string,
  payload: SpecialistReferenceFormData
): Promise<SpecialistReference> {
  const normalizedPayload = {
    ...payload,
    personnel_type: payload.personnel_type || "driver",
    phone: payload.phone || null,
    status: payload.status || "active",
    note: payload.note || null,
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
  const updated = data as SpecialistReference;
  if ((updated as any).person_id) {
    const roleType = (updated.personnel_type || "driver") as CompanyPersonRoleType;
    const { error: personUpdateError } = await supabase
      .from("company_people")
      .update({
        full_name: updated.full_name,
        role_type: roleType,
        phone: updated.phone || null,
        status: updated.status === "inactive" ? "inactive" : "active",
        notes: updated.note || null,
        updated_by_user_id: (updated as any).user_id || null,
      })
      .eq("id", (updated as any).person_id);
    if (personUpdateError && !isCompanyPeopleSchemaMissing(personUpdateError)) {
      throw new Error(personUpdateError.message);
    }
  }
  if (Array.isArray(payload.assigned_vehicle_ids)) {
    const { data: specialistRow, error: specialistRowError } = await supabase
      .from("reference_specialists")
      .select("company_id")
      .eq("id", id)
      .single();
    if (specialistRowError) throw new Error(specialistRowError.message);
    const companyId = String((specialistRow as any).company_id);
    const selected = payload.assigned_vehicle_ids || [];
    const { data: currentRows, error: currentRowsError } = await supabase
      .from("reference_vehicles")
      .select("id")
      .eq("company_id", companyId)
      .eq("primary_responsible_personnel_id", id)
      .eq("archived", false);
    if (currentRowsError) throw new Error(currentRowsError.message);

    const toClear = (currentRows || [])
      .map((r: any) => String(r.id))
      .filter((vid) => !selected.includes(vid));
    if (toClear.length > 0) {
      const { error: clearError } = await supabase
        .from("reference_vehicles")
        .update({ primary_responsible_personnel_id: null })
        .eq("company_id", companyId)
        .in("id", toClear);
      if (clearError) throw new Error(clearError.message);
    }

    const { error: clearOtherError } = await supabase
      .from("reference_vehicles")
      .update({ primary_responsible_personnel_id: null })
      .eq("company_id", companyId)
      .neq("primary_responsible_personnel_id", id)
      .in("id", selected);
    if (clearOtherError) throw new Error(clearOtherError.message);

    if (selected.length > 0) {
      const { error: assignError } = await supabase
        .from("reference_vehicles")
        .update({ primary_responsible_personnel_id: id })
        .eq("company_id", companyId)
        .in("id", selected);
      if (assignError) throw new Error(assignError.message);
    }
  }
  return updated;
}

export async function getGlobalVehicleBrands(): Promise<GlobalVehicleBrand[]> {
  const { data, error } = await supabase
    .from("global_vehicle_brands")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data || []) as GlobalVehicleBrand[];
}

export async function getGlobalVehicleModels(brandId?: string, modelType?: string): Promise<GlobalVehicleModel[]> {
  let query = supabase
    .from("global_vehicle_models")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (brandId) query = query.eq("brand_id", brandId);
  if (modelType) query = query.eq("model_type", modelType);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as GlobalVehicleModel[];
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
    name: brandName(row) || row.name,
    trade_name: row.trade_name || null,
    product_type: row.product_type || null,
    category: row.category || null,
    subcategory: row.subcategory || null,
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

export type SeasonAgronomyUsageRow = {
  season_id: string | null;
  season_year: number | null;
  crop_id: string | null;
  crop_name: string;
  variety_id: string | null;
  variety_name: string | null;
  reproduction_id: string | null;
  reproduction_name: string | null;
  area_ha: number;
  field_count: number;
  field_names: string[];
};

export async function getSeasonAgronomyUsage(
  companyId: string,
  language: Language = "ru"
): Promise<SeasonAgronomyUsageRow[]> {
  const { data: seasonRows, error: seasonError } = await supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("year", { ascending: false })
    .limit(1);
  if (seasonError) throw new Error(seasonError.message);

  const season = (seasonRows || [])[0] as { id?: string; year?: number | null } | undefined;
  if (!season?.id) return [];

  const { data: structureRows, error: structureError } = await supabase
    .from("crop_structure")
    .select("id,field_id,crop_id,variety_id,reproduction_id,area")
    .eq("company_id", companyId)
    .eq("season_id", season.id)
    .eq("archived", false);
  if (structureError) throw new Error(structureError.message);

  const rows = (structureRows || []) as any[];
  if (!rows.length) return [];

  const fieldIds = Array.from(new Set(rows.map((row) => String(row.field_id || "")).filter(Boolean)));
  const cropIds = Array.from(new Set(rows.map((row) => String(row.crop_id || "")).filter(Boolean)));
  const varietyIds = Array.from(new Set(rows.map((row) => String(row.variety_id || "")).filter(Boolean)));
  const reproductionIds = Array.from(new Set(rows.map((row) => String(row.reproduction_id || "")).filter(Boolean)));

  const [fieldsRes, cropsRes, varietiesRes, reproductionsRes] = await Promise.all([
    fieldIds.length
      ? supabase.from("fields").select("id,name").eq("company_id", companyId).in("id", fieldIds)
      : Promise.resolve({ data: [], error: null } as any),
    cropIds.length
      ? supabase.from("crops").select("id,name,name_ru,name_kz,name_en,slug").in("id", cropIds)
      : Promise.resolve({ data: [], error: null } as any),
    varietyIds.length
      ? supabase.from("varieties").select("id,name,name_ru,name_kz,name_en").in("id", varietyIds)
      : Promise.resolve({ data: [], error: null } as any),
    reproductionIds.length
      ? supabase.from("seed_reproductions").select("id,name,name_ru,name_kz,name_en,code").in("id", reproductionIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (fieldsRes.error) throw new Error(fieldsRes.error.message);
  if (cropsRes.error) throw new Error(cropsRes.error.message);
  if (varietiesRes.error) throw new Error(varietiesRes.error.message);
  if (reproductionsRes.error) throw new Error(reproductionsRes.error.message);

  const fieldNameById = new Map<string, string>(
    (fieldsRes.data || []).map((row: any) => [String(row.id), String(row.name || "-")])
  );
  const cropNameById = new Map<string, string>(
    (cropsRes.data || []).map((row: any) => [String(row.id), String(localizedName(row, language) || row.name || "-")])
  );
  const varietyNameById = new Map<string, string>(
    (varietiesRes.data || []).map((row: any) => [
      String(row.id),
      String(brandName(row) || localizedName(row, language) || row.name || "-"),
    ])
  );
  const reproductionNameById = new Map<string, string>(
    (reproductionsRes.data || []).map((row: any) => [
      String(row.id),
      String(localizedName(row, language, ["name", "code"]) || row.name || row.code || "-"),
    ])
  );

  const grouped = new Map<
    string,
    SeasonAgronomyUsageRow & { fieldIds: Set<string> }
  >();

  for (const row of rows) {
    const cropId = row.crop_id ? String(row.crop_id) : null;
    const varietyId = row.variety_id ? String(row.variety_id) : null;
    const reproductionId = row.reproduction_id ? String(row.reproduction_id) : null;
    const groupKey = [cropId || "none", varietyId || "none", reproductionId || "none"].join("|");
    const current =
      grouped.get(groupKey) ||
      ({
        season_id: String(season.id),
        season_year: season.year == null ? null : Number(season.year),
        crop_id: cropId,
        crop_name: cropId ? cropNameById.get(cropId) || "-" : "Не указано",
        variety_id: varietyId,
        variety_name: varietyId ? varietyNameById.get(varietyId) || null : null,
        reproduction_id: reproductionId,
        reproduction_name: reproductionId ? reproductionNameById.get(reproductionId) || null : null,
        area_ha: 0,
        field_count: 0,
        field_names: [],
        fieldIds: new Set<string>(),
      } satisfies SeasonAgronomyUsageRow & { fieldIds: Set<string> });

    current.area_ha += Number(row.area || 0);
    const fieldId = row.field_id ? String(row.field_id) : "";
    if (fieldId && !current.fieldIds.has(fieldId)) {
      current.fieldIds.add(fieldId);
      const fieldName = fieldNameById.get(fieldId);
      if (fieldName) current.field_names.push(fieldName);
    }
    current.field_count = current.fieldIds.size;
    grouped.set(groupKey, current);
  }

  return Array.from(grouped.values())
    .map(({ fieldIds: _fieldIds, ...row }) => ({
      ...row,
      area_ha: Number(row.area_ha.toFixed(4)),
      field_names: row.field_names.sort((a, b) => a.localeCompare(b, "ru")),
    }))
    .sort((a, b) => b.area_ha - a.area_ha || a.crop_name.localeCompare(b.crop_name, "ru"));
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
    .order("name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || [])
    .filter((row: any) => getMaterialProductTypeFromProduct(row) === "pesticide")
    .map((row: any) => mapAgrochemicalRow(row, language));
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
    .order("name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || [])
    .filter((row: any) => getMaterialProductTypeFromProduct(row) === "fertilizer")
    .map((row: any) => mapAgrochemicalRow(row, language));
}

export async function getAdditives(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  let query = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || [])
    .filter((row: any) => getMaterialProductTypeFromProduct(row) === "additive")
    .map((row: any) => mapAgrochemicalRow(row, language));
}

export async function searchAgrochemicalMaster(
  companyId: string,
  type: MaterialProductType,
  queryText = "",
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  const text = queryText.trim().toLowerCase();
  if (text.length < 2) return [];

  const pattern = `%${text.replace(/[%_]/g, " ").replace(/,/g, " ")}%`;
  const searchableColumns = [
    `name.ilike.${pattern}`,
    `trade_name.ilike.${pattern}`,
    `normalized_name.ilike.${pattern}`,
    `manufacturer.ilike.${pattern}`,
    `active_ingredient.ilike.${pattern}`,
  ].join(",");

  const companyQuery = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .eq("archived", false)
    .or(searchableColumns)
    .order("name", { ascending: true })
    .limit(50);

  const globalQuery = supabase
    .from("products")
    .select("*")
    .is("company_id", null)
    .eq("archived", false)
    .or(searchableColumns)
    .order("name", { ascending: true })
    .limit(50);

  const [{ data: companyData, error: companyError }, { data: globalData, error: globalError }] = await Promise.all([
    companyQuery,
    globalQuery,
  ]);

  if (companyError) throw new Error(companyError.message);
  if (globalError) throw new Error(globalError.message);

  const companyRows = (companyData || [])
    .filter((row: any) => getMaterialProductTypeFromProduct(row) === type)
    .map((row: any) => ({
      ...mapAgrochemicalRow(row, language),
      source_scope: "company" as const,
    }));
  const globalRows = (globalData || [])
    .filter((row: any) => getMaterialProductTypeFromProduct(row) === type)
    .map((row: any) => ({
      ...mapAgrochemicalRow(row, language),
      source_scope: "global" as const,
    }));

  const keyFor = (item: AgrochemicalReference) =>
    [
      String((item as any).normalized_name || item.trade_name || item.name || "").trim().toLowerCase(),
      String(item.manufacturer || "").trim().toLowerCase(),
      String(item.product_type || item.type || "").trim().toLowerCase(),
    ].join("|");
  const companyKeys = new Set(companyRows.map(keyFor));
  const filteredGlobalRows = globalRows.filter((item) => !companyKeys.has(keyFor(item)));
  return [...companyRows, ...filteredGlobalRows].slice(0, 80);
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
    product_type: master.product_type || getMaterialProductTypeFromProduct(master) || null,
    category: master.category || null,
    subcategory: master.subcategory || null,
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
    product_type: "pesticide",
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
    product_type: "fertilizer",
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
