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
  GlobalMachineModel,
  GlobalEquipmentModel,
  GlobalTransportModel,
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
    query = query.eq("archived", false).eq("is_active", true);
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

  if (!includeArchived) query = query.eq("archived", false).eq("is_active", true);
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
    query = query.eq("archived", false).eq("is_active", true);
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

function cleanImportedAssetDisplayName(value: unknown): string {
  return String(value || "")
    .replace(/\s*\[[^\]]+\]\s*$/u, "")
    .replace(/\s+#\d+\s*$/u, "")
    .trim();
}

function firstCleanAssetName(...values: unknown[]): string {
  for (const value of values) {
    const clean = cleanImportedAssetDisplayName(value);
    const normalized = clean.toLowerCase();
    if (
      clean &&
      normalized !== "other" &&
      normalized !== "potato equipment" &&
      normalized !== "картофельное оборудование" &&
      normalized !== "оборудование" &&
      normalized !== "другое" &&
      !normalized.endsWith(" other")
    ) {
      return clean;
    }
  }
  return "—";
}

export const machineAssetTypeLabels: Record<string, string> = {
  tractor: "Трактор",
  combine: "Комбайн",
  combine_harvester: "Комбайн",
  forage_harvester: "Кормоуборочный комбайн",
  potato_harvester: "Картофелеуборочный комбайн",
  self_propelled_sprayer: "Самоходный опрыскиватель",
  self_propelled_seeder: "Самоходная сеялка",
  self_propelled_spreader: "Самоходный разбрасыватель",
  self_propelled_windrower: "Самоходный валкоукладчик",
  self_propelled_mower: "Самоходная косилка",
  loader: "Погрузчик",
  telehandler: "Телескопический погрузчик",
  sprayer: "Опрыскиватель",
  trailed_sprayer: "Прицепной опрыскиватель",
  mounted_sprayer: "Навесной опрыскиватель",
  seeder: "Сеялка",
  planter: "Сажалка",
  cultivator: "Культиватор",
  plow: "Плуг",
  disc_harrow: "Дисковая борона",
  fertilizer_spreader: "Разбрасыватель удобрений",
  drone: "Агродрон",
  aerial_application: "Агродрон",
  uav: "Агродрон",
  spraying_drone: "Дрон-опрыскиватель",
  spreading_drone: "Дрон-разбрасыватель",
  spraying_spreading_drone: "Дрон-опрыскиватель / разбрасыватель",
  mapping_drone: "Дрон мониторинга",
  multispectral_drone: "Мультиспектральный дрон",
  cargo_drone: "Грузовой дрон",
  scout_drone: "Дрон разведки",
  truck: "Грузовой транспорт",
  other: "Другое",
};

export const equipmentAssetTypeLabels: Record<string, string> = {
  seeding: "Посевное оборудование",
  planting: "Посадочное оборудование",
  seeder: "Посевное оборудование",
  tillage_primary: "Основная обработка почвы",
  tillage_secondary: "Поверхностная обработка почвы",
  potato: "Картофельное оборудование",
  potato_cultivator: "Гребнеобразователь / картофельный культиватор",
  potato_planter: "Картофелесажалка",
  potato_conveyor: "Картофельный транспортер",
  potato_harvester_equipment: "Прицепной картофелеуборочный комбайн",
  potato_digger: "Картофелекопалка",
  receiving_hopper: "Приёмный бункер",
  header: "Жатка",
  pickup_header: "Подборщик",
  grain_storage: "Зернооборудование",
  grain_handling: "Зернопогрузчик / зернометатель",
  conveyor: "Транспортер",
  separator: "Сепаратор",
  precision_agriculture: "Точное земледелие",
  mowing: "Косилка / сенозаготовка",
  rake: "Валкоукладчик",
  spraying: "Опрыскиватель",
  spraying_attached: "Навесной/прицепной опрыскиватель",
  loader: "Погрузчик",
  loader_attachment: "Погрузочное оборудование",
  tractor: "Трактор",
  cultivator: "Культиватор",
  plow: "Плуг",
  harrow: "Борона",
  rotary_harrow: "Ротационная борона",
  baler: "Пресс-подборщик",
  trailer: "Прицеп",
  implement: "Агрегат",
  equipment: "Оборудование",
  other_equipment: "Другое оборудование",
  other: "Другое",
};

export const transportAssetTypeLabels: Record<string, string> = {
  light_vehicle: "Легковой транспорт",
  car: "Легковой транспорт",
  truck: "Грузовой транспорт",
  tractor_unit: "Тягач",
  trailer: "Прицеп",
  semi_trailer: "Полуприцеп",
  bus: "Автобус / микроавтобус",
  special_vehicle: "Спецтранспорт",
  grain_truck: "Зерновоз",
  dump_truck: "Самосвал",
  fuel_truck: "Топливозаправщик",
  crane_truck: "Автокран",
  pickup: "Пикап",
  tractor_trailer: "Прицеп",
  other: "Другое",
};

export function labelByMap(map: Record<string, string>, ...values: unknown[]): string {
  for (const value of values) {
    const key = String(value || "").trim();
    if (key && map[key]) return map[key];
  }
  const fallback = values.map((value) => String(value || "").trim()).find(Boolean);
  return fallback ? "Другое" : "—";
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

type CompanyAssetReferences = {
  machines: MachineReference[];
  equipment: EquipmentReference[];
  vehicles: VehicleReference[];
};

type CompanyAssetReferencesPayload = {
  companyId: string;
  machines: any[];
  equipment: any[];
  vehicles: any[];
};

const companyAssetReferenceRequests = new Map<string, Promise<CompanyAssetReferencesPayload>>();

async function getSessionAuthorizationHeader(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error("User is not authenticated");
  }
  return { Authorization: `Bearer ${token}` };
}

async function fetchCompanyAssetReferencesPayload(companyId: string): Promise<CompanyAssetReferencesPayload> {
  const key = String(companyId || "").trim();
  if (!key) {
    throw new Error("Company context is required");
  }

  const pending = companyAssetReferenceRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const headers = await getSessionAuthorizationHeader();
    const params = new URLSearchParams({ companyId: key });
    const response = await fetch(`/api/references/company-assets?${params.toString()}`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load company assets");
    }
    return {
      companyId: String(payload?.companyId || key),
      machines: Array.isArray(payload?.machines) ? payload.machines : [],
      equipment: Array.isArray(payload?.equipment) ? payload.equipment : [],
      vehicles: Array.isArray(payload?.vehicles) ? payload.vehicles : [],
    };
  })().finally(() => {
    companyAssetReferenceRequests.delete(key);
  });

  companyAssetReferenceRequests.set(key, request);
  return request;
}

function mapMachineReference(row: any, language: Language): MachineReference {
  return {
    ...row,
    name: localizedName(row, language) || row.name,
    display_name: firstCleanAssetName(row.global_model?.full_name, row.full_name, localizedName(row, language), row.name),
    display_type: labelByMap(
      machineAssetTypeLabels,
      row.machinery_type,
      row.machine_type,
      row.machine_category,
      row.type,
      row.category,
      row.global_model?.category
    ),
  } as MachineReference;
}

function mapEquipmentReference(row: any, language: Language): EquipmentReference {
  return {
    ...row,
    name: localizedName(row, language) || row.name,
    display_name: firstCleanAssetName(
      row.global_model?.full_name,
      row.global_model?.name,
      row.full_name,
      localizedName(row, language),
      row.name
    ),
    display_type: labelByMap(
      equipmentAssetTypeLabels,
      row.equipment_category,
      row.category,
      row.global_model?.category,
      row.global_model?.equipment_type
    ),
  } as EquipmentReference;
}

function mapVehicleReference(row: any): VehicleReference {
  return {
    ...row,
    name: row.custom_name || row.name,
    display_name: firstCleanAssetName(
      row.transport_model?.full_name,
      row.global_vehicle_brands?.name && row.global_vehicle_models?.name
        ? `${row.global_vehicle_brands.name} ${row.global_vehicle_models.name}`
        : null,
      row.full_name,
      row.custom_name,
      row.name
    ),
    display_type: labelByMap(transportAssetTypeLabels, row.fleet_type, row.type, row.vehicle_type, row.transport_model?.category),
  } as VehicleReference;
}

export async function getCompanyAssetReferences(
  companyId: string,
  language: Language = "ru"
): Promise<CompanyAssetReferences> {
  const payload = await fetchCompanyAssetReferencesPayload(companyId);
  return {
    machines: payload.machines
      .filter((row: any) => !isLegacySeededMachineReference(row))
      .map((row: any) => mapMachineReference(row, language)),
    equipment: payload.equipment
      .filter((row: any) => !isLegacySeededEquipmentReference(row))
      .map((row: any) => mapEquipmentReference(row, language)),
    vehicles: payload.vehicles.map((row: any) => mapVehicleReference(row)),
  };
}

export async function getMachineReferences(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<MachineReference[]> {
  let query = supabase
    .from("reference_machines")
    .select(`
      *,
      global_model:global_machine_model_id(id,full_name,category,brand,series,model)
    `)
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as MachineReference[])
    .filter((row: any) => !isLegacySeededMachineReference(row))
    .map((row: any) => mapMachineReference(row, language));
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
      transport_model:transport_model_id(id,full_name,category,brand,series,model),
      primary_responsible:primary_responsible_personnel_id(id,full_name,personnel_type,status,archived,person:person_id(full_name,company_id,role_type,status,deleted_at))
    `)
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as any[]).map((row) => mapVehicleReference(row));
}

const duplicateVehiclePlateMessage = "Машина с таким госномером уже существует";

function normalizeVehiclePlate(value: unknown): string {
  const plateNumber = String(value || "").trim();
  if (!plateNumber) throw new Error("Укажите госномер");
  return plateNumber;
}

function isVehiclePlateUniqueViolation(error: any): boolean {
  return String(error?.code || "") === "23505";
}

export async function createVehicleReference(
  companyId: string,
  userId: string,
  payload: VehicleFormData
): Promise<VehicleReference> {
  const plateNumber = normalizeVehiclePlate(payload.plate_number);
  const existingByPlate = await supabase
    .from("reference_vehicles")
    .select("id")
    .eq("company_id", companyId)
    .ilike("plate_number", plateNumber)
    .eq("archived", false)
    .maybeSingle();
  if (existingByPlate.error) throw new Error(existingByPlate.error.message);
  if (existingByPlate.data?.id) throw new Error(duplicateVehiclePlateMessage);

  const insertPayload: any = {
    ...payload,
    plate_number: plateNumber,
    license_plate: plateNumber,
    fleet_type: String(payload.fleet_type || payload.type || "other").trim(),
    custom_name: payload.custom_name || null,
    inventory_number: String(payload.inventory_number || "").trim() || null,
    global_brand_id: payload.global_brand_id || null,
    global_model_id: payload.global_model_id || null,
    transport_model_id: payload.transport_model_id || null,
    primary_responsible_personnel_id: payload.primary_responsible_personnel_id || null,
    company_id: companyId,
    user_id: userId,
  };
  const { data, error } = await supabase
    .from("reference_vehicles")
    .insert([insertPayload])
    .select()
    .single();
  if (isVehiclePlateUniqueViolation(error)) throw new Error(duplicateVehiclePlateMessage);
  if (error) throw new Error(error.message);
  return data as VehicleReference;
}

export async function getGlobalMachineModels(): Promise<GlobalMachineModel[]> {
  const { data, error } = await supabase
    .from("agricultural_machine_models")
    .select("id,full_name,category,brand,series,model,is_active")
    .eq("is_active", true)
    .eq("archived", false)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data || []) as GlobalMachineModel[];
}

export async function getGlobalEquipmentModels(): Promise<GlobalEquipmentModel[]> {
  const { data, error } = await supabase
    .from("equipment_models")
    .select("id,name,full_name,category,equipment_type,brand,series,model,is_active")
    .eq("is_active", true)
    .eq("archived", false)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data || []) as GlobalEquipmentModel[];
}

export async function getGlobalTransportModels(): Promise<GlobalTransportModel[]> {
  const { data, error } = await supabase
    .from("transport_models")
    .select("id,full_name,category,brand,series,model,is_active")
    .eq("is_active", true)
    .eq("archived", false)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data || []) as GlobalTransportModel[];
}

type VehicleAdminUpdatePayload = {
  plate_number: string;
  inventory_number?: string | null;
  manufacture_year?: number | null;
  is_active: boolean;
};

export async function updateVehicleReference(
  companyId: string,
  id: string,
  payload: VehicleAdminUpdatePayload
): Promise<VehicleReference> {
  const plateNumber = normalizeVehiclePlate(payload.plate_number);
  const normalized = {
    plate_number: plateNumber,
    license_plate: plateNumber,
    inventory_number: String(payload.inventory_number || "").trim() || null,
    manufacture_year: payload.manufacture_year ?? null,
    is_active: payload.is_active,
  };
  const { data, error } = await supabase
    .from("reference_vehicles")
    .update(normalized)
    .eq("id", id)
    .eq("company_id", companyId)
    .select()
    .single();
  if (isVehiclePlateUniqueViolation(error)) throw new Error(duplicateVehiclePlateMessage);
  if (error) throw new Error(error.message);
  return data as VehicleReference;
}

export async function archiveVehicleReference(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("reference_vehicles")
    .update({ archived: true })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id")
    .single();
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
    .select(`
      *,
      global_model:global_equipment_model_id(id,name,full_name,category,brand,series,model,equipment_type)
    `)
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as EquipmentReference[])
    .filter((row: any) => !isLegacySeededEquipmentReference(row))
    .map((row: any) => mapEquipmentReference(row, language));
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

function roleTypeToSpecialistType(roleType?: CompanyPersonRoleType | "machine_operator" | null): "driver" | "machine_operator" | null {
  if (roleType === "driver") return "driver";
  if (roleType === "mechanic_operator" || roleType === "machine_operator") return "machine_operator";
  return null;
}

function cleanAssetPart(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\[?\?+\]?$/u.test(raw)) return "";
  if (/^OSV-ROW-/iu.test(raw)) return "";
  return raw.replace(/\s+/g, " ");
}

function cleanAssetIdentifier(value: unknown): string {
  const clean = cleanAssetPart(value);
  const normalized = clean.toLowerCase();
  if (
    normalized === "авто" ||
    normalized === "комбайн" ||
    normalized === "трактор" ||
    normalized === "прицеп" ||
    normalized === "гусеничный" ||
    normalized === "сеялка"
  ) {
    return "";
  }
  return clean;
}

function firstCleanAssetPart(...values: unknown[]): string {
  for (const value of values) {
    const clean = cleanAssetPart(value);
    if (clean) return clean;
  }
  return "";
}

function firstCleanAssetIdentifier(...values: unknown[]): string {
  for (const value of values) {
    const clean = cleanAssetIdentifier(value);
    if (clean) return clean;
  }
  return "";
}

export function displayVehiclePlate(value: unknown): string {
  const clean = cleanAssetPart(value);
  return clean || "Госномер не указан";
}

function assetBrand(row: any): string {
  return firstCleanAssetPart(row.global_model?.brand, row.transport_model?.brand, row.brand, row.global_vehicle_brands?.name);
}

function assetModel(row: any): string {
  return firstCleanAssetPart(row.global_model?.model, row.transport_model?.model, row.model, row.global_vehicle_models?.name);
}

function assetYear(row: any): string {
  const year = Number(row.manufacture_year || 0);
  return year > 1900 ? String(year) : "";
}

export function buildAssetSelectorLabel(row: any, kind: "machine" | "equipment" | "vehicle"): string {
  const name = firstCleanAssetName(
    row.display_name,
    row.global_model?.full_name,
    row.global_model?.name,
    row.transport_model?.full_name,
    row.full_name,
    localizedName(row, "ru"),
    row.name
  );
  const type =
    row.display_type ||
    (kind === "machine"
      ? labelByMap(machineAssetTypeLabels, row.machinery_type, row.machine_type, row.machine_category, row.type, row.category, row.global_model?.category)
      : kind === "equipment"
        ? labelByMap(equipmentAssetTypeLabels, row.equipment_category, row.category, row.global_model?.category, row.global_model?.equipment_type)
        : labelByMap(transportAssetTypeLabels, row.fleet_type, row.type, row.vehicle_type, row.transport_model?.category));
  const identifier =
    kind === "vehicle"
      ? displayVehiclePlate(row.plate_number || row.license_plate)
      : firstCleanAssetIdentifier(row.license_plate, row.inventory_number);

  return [name, type, identifier].filter((part) => part && part !== "—").join(" — ");
}

export function buildAssetSelectorHint(row: any): string {
  const parts = [
    assetBrand(row) ? `Бренд: ${assetBrand(row)}` : "",
    assetModel(row) ? `Модель: ${assetModel(row)}` : "",
    assetYear(row) ? `Год: ${assetYear(row)}` : "",
    cleanAssetIdentifier(row.inventory_number) ? `Инв. №: ${cleanAssetIdentifier(row.inventory_number)}` : "",
  ].filter(Boolean);
  return parts.join(" • ");
}

function specialistTypeToRoleType(personnelType?: "driver" | "machine_operator" | null): CompanyPersonRoleType {
  return personnelType === "machine_operator" ? "mechanic_operator" : "driver";
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
    status: person.status === "active" ? "active" : "inactive",
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
  const roleType = specialistTypeToRoleType(payload.personnel_type || "driver");

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
    .update({
      ...normalizedPayload,
      deleted_at: normalizedPayload.status === "archived" ? new Date().toISOString() : null,
      updated_by_user_id: userId,
    })
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
    full_name: payload.full_name,
    role: payload.role || null,
    personnel_type: payload.personnel_type || "driver",
    status: payload.status || "active",
  };
  if (linkedPersonId) normalizedPayload.person_id = linkedPersonId;
  const { data, error } = await supabase
    .from("reference_specialists")
    .insert([{ ...normalizedPayload, company_id: companyId, user_id: userId }])
    .select()
    .single();
  if (error) throw new Error(error.message);
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
    full_name: payload.full_name,
    role: payload.role || null,
    personnel_type: payload.personnel_type || "driver",
    status: payload.status || "active",
  };
  const { data, error } = await supabase
    .from("reference_specialists")
    .update(normalizedPayload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  const updated = data as SpecialistReference;
  if ((updated as any).person_id) {
    const roleType = specialistTypeToRoleType(updated.personnel_type || "driver");
    const { error: personUpdateError } = await supabase
      .from("company_people")
      .update({
        full_name: updated.full_name,
        role_type: roleType,
        phone: payload.phone || null,
        status: updated.status === "inactive" ? "inactive" : "active",
        notes: payload.note || null,
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
  const headers = await getSessionAuthorizationHeader();
  const params = new URLSearchParams({ companyId, language });
  const response = await fetch(`/api/references/agronomy?${params.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Failed to load season agronomy");
  return Array.isArray(payload?.rows) ? payload.rows : [];
}

export async function getPesticides(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  const rows = await getCompanyAgrochemicalMaterials(companyId, includeArchived, language);
  return rows.filter((row: any) => ["pesticide", "growth_regulator"].includes(String(row.product_type || row.type || "")));
}

export async function getFertilizers(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  const rows = await getCompanyAgrochemicalMaterials(companyId, includeArchived, language);
  return rows.filter((row: any) => String(row.product_type || row.type || "") === "fertilizer");
}

export async function getAdditives(
  companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  const rows = await getCompanyAgrochemicalMaterials(companyId, includeArchived, language);
  return rows.filter((row: any) => ["additive", "adjuvant"].includes(String(row.product_type || row.type || "")));
}

export async function getCompanyAgrochemicalMaterials(
  _companyId: string,
  includeArchived = false,
  language: Language = "ru"
): Promise<AgrochemicalReference[]> {
  const headers = await getSessionAuthorizationHeader();
  const response = await fetch("/api/references/materials", { headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Failed to load company materials");
  return (Array.isArray(payload?.rows) ? payload.rows : [])
    .filter((row: any) => includeArchived || !row.archived)
    .map((row: any) => ({
      ...mapAgrochemicalRow(row, language),
      canonical_product_id: row.canonical_product_id,
      source_scope: row.source_scope,
      reference_statuses: Array.isArray(row.reference_statuses) ? row.reference_statuses : [],
      available_quantities: Array.isArray(row.available_quantities) ? row.available_quantities : [],
    }));
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

  const aliasQuery = supabase
    .from("global_product_aliases")
    .select("product_id")
    .ilike("alias", pattern)
    .limit(50);

  const [
    { data: companyData, error: companyError },
    { data: globalData, error: globalError },
    { data: aliasData, error: aliasError },
  ] = await Promise.all([companyQuery, globalQuery, aliasQuery]);

  if (companyError) throw new Error(companyError.message);
  if (globalError) throw new Error(globalError.message);
  if (aliasError) throw new Error(aliasError.message);

  const aliasProductIds = Array.from(
    new Set((aliasData || []).map((row: any) => String(row.product_id || "")).filter(Boolean))
  );
  const { data: aliasProducts, error: aliasProductsError } = aliasProductIds.length
    ? await supabase
        .from("products")
        .select("*")
        .in("id", aliasProductIds)
        .is("company_id", null)
        .eq("archived", false)
    : { data: [], error: null };
  if (aliasProductsError) throw new Error(aliasProductsError.message);

  const globalRowsById = new Map<string, any>();
  for (const row of [...(globalData || []), ...(aliasProducts || [])]) {
    globalRowsById.set(String(row.id), row);
  }

  const companyRows = (companyData || [])
    .filter((row: any) => getMaterialProductTypeFromProduct(row) === type)
    .map((row: any) => ({
      ...mapAgrochemicalRow(row, language),
      source_scope: "company" as const,
    }));
  const globalRows = Array.from(globalRowsById.values())
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
  _companyId: string,
  _userId: string,
  globalProductId: string
): Promise<AgrochemicalReference> {
  const headers = await getSessionAuthorizationHeader();
  const response = await fetch("/api/references/materials", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ global_product_id: globalProductId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Failed to link global product");
  const { data, error } = await supabase.from("products").select("*").eq("id", globalProductId).single();
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
