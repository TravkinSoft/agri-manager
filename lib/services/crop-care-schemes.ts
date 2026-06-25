import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProductDisplayLabel } from "@/lib/catalog/catalog-identity";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import {
  calculateMaterialPlannedQuantity,
  calculateTankMix,
  normalizeMixUnit,
} from "@/lib/materials/mix-calculations";
import { inferMaterialStockUnit, normalizeMaterialRateBasis, type MaterialRateBasis } from "@/lib/materials/metadata";

export type CropCareSchemeStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type CropCareSchemeType = "protection" | "nutrition" | "fertigation" | "combined" | "other";
export type CropCareRateBasis = MaterialRateBasis;
export type CropCareTargetType = "disease" | "pest" | "weed" | "nutrition" | "stress" | "general";

export type CropCareSeason = {
  id: string;
  year: number;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  archived: boolean | null;
};

export type CropCareCrop = {
  id: string;
  name: string;
};

export type CropCareVariety = {
  id: string;
  crop_id: string;
  name: string;
};

export type CropCareProduct = {
  id: string;
  name: string;
  trade_name: string | null;
  normalized_name: string | null;
  company_id: string | null;
  manufacturer: string | null;
  product_type: string | null;
  category: string | null;
  subcategory: string | null;
  unit: string | null;
  base_uom: string | null;
  default_unit: string | null;
  application_unit: string | null;
  stock_unit: string | null;
  default_rate_type: string | null;
  default_rate_unit: string | null;
  default_dosing_type: string | null;
  notes: string | null;
};

export type CropCareResponsible = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type CropCareStructureSection = {
  crop_structure_id: string;
  field_id: string;
  field_name: string;
  field_area_ha: number;
  crop_id: string | null;
  crop_name: string;
  variety_id: string | null;
  variety_name: string;
  reproduction_id: string | null;
  reproduction_name: string;
  area_ha: number;
  irrigation_type: string | null;
  included?: boolean;
};

export type CropCareSchemeField = CropCareStructureSection & {
  id: string;
  included: boolean;
  notes: string | null;
};

export type CropCareStepMaterial = {
  id: string;
  product_id: string;
  product_name: string;
  product_type: string | null;
  rate: number;
  rate_unit: string;
  rate_basis: CropCareRateBasis;
  water_rate_l_ha: number | null;
  total_solution_l_ha: number | null;
  planned_quantity: number | null;
  planned_unit: string | null;
  target_type: CropCareTargetType;
  target_id: string | null;
  notes: string | null;
};

export type CropCareStep = {
  id: string;
  step_no: number;
  title: string;
  phenological_phase: string | null;
  planned_date: string | null;
  window_start_date: string | null;
  window_end_date: string | null;
  operation_type: string;
  responsible_user_id: string | null;
  lead_time_days: number;
  status: string;
  notes: string | null;
  materials: CropCareStepMaterial[];
  generated_operation_id: string | null;
  generated_operation_status: string | null;
};

export type CropCareScheme = {
  id: string;
  season_id: string;
  crop_id: string;
  variety_id: string | null;
  name: string;
  scheme_type: CropCareSchemeType;
  description: string | null;
  status: CropCareSchemeStatus;
  revision_no: number;
  total_area_ha: number;
  field_count: number;
  included_field_count: number;
  progress_percent: number;
  crop_name: string;
  variety_name: string;
  created_at: string;
  updated_at: string;
  fields: CropCareSchemeField[];
  steps: CropCareStep[];
};

export type CropCareBootstrap = {
  season: CropCareSeason | null;
  read_only: boolean;
  read_only_reason: string | null;
  crops: CropCareCrop[];
  varieties: CropCareVariety[];
  products: CropCareProduct[];
  responsible_users: CropCareResponsible[];
  schemes: CropCareScheme[];
};

export type CropCareMaterialInput = {
  product_id: string;
  rate: number;
  rate_unit: string;
  rate_basis: CropCareRateBasis;
  water_rate_l_ha?: number | null;
  total_solution_l_ha?: number | null;
  target_type?: CropCareTargetType;
  target_id?: string | null;
  notes?: string | null;
};

export type CropCareStepInput = {
  step_no?: number | null;
  title: string;
  phenological_phase?: string | null;
  planned_date?: string | null;
  window_start_date?: string | null;
  window_end_date?: string | null;
  operation_type?: string | null;
  responsible_user_id?: string | null;
  lead_time_days?: number | null;
  status?: string | null;
  notes?: string | null;
  materials?: CropCareMaterialInput[];
};

const VALID_TARGET_TYPES = new Set<CropCareTargetType>(["disease", "pest", "weed", "nutrition", "stress", "general"]);

export class CropCareLifecycleError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "CropCareLifecycleError";
    this.status = status;
  }
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function nullableText(value: unknown): string | null {
  const next = text(value);
  return next || null;
}

function numeric(value: unknown, fallback = 0): number {
  const next = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(next) ? next : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(String(value).replace(",", "."));
  return Number.isFinite(next) ? next : null;
}

function toFixedNumber(value: number | null | undefined, precision = 4): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(Number(value).toFixed(precision));
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value ?? null) as T | null;
}

function displayName(row: any): string {
  return localizedName(row, "ru") || brandName(row) || text(row?.name) || "-";
}

function productDisplayName(row: any): string {
  return buildProductDisplayLabel({
    id: String(row?.id || ""),
    name: nullableText(row?.name),
    trade_name: nullableText(row?.trade_name),
    normalized_name: nullableText(row?.normalized_name),
    company_id: nullableText(row?.company_id),
    manufacturer: nullableText(row?.manufacturer),
    product_type: nullableText(row?.product_type),
    type: nullableText(row?.type),
    category: nullableText(row?.category),
    subcategory: nullableText(row?.subcategory),
    pesticide_category: nullableText(row?.pesticide_category),
    fertilizer_type: nullableText(row?.fertilizer_type),
    unit: nullableText(row?.unit),
    stock_unit: nullableText(row?.stock_unit),
    base_uom: nullableText(row?.base_uom),
    default_unit: nullableText(row?.default_unit),
    application_unit: nullableText(row?.application_unit),
    notes: nullableText(row?.notes),
  }) || brandName(row) || text(row?.trade_name) || text(row?.name) || "-";
}

function normalizeRateBasis(value: unknown): CropCareRateBasis {
  return normalizeMaterialRateBasis(String(value ?? ""));
}

function normalizeTargetType(value: unknown): CropCareTargetType {
  const next = text(value) as CropCareTargetType;
  return VALID_TARGET_TYPES.has(next) ? next : "general";
}

function normalizeUnit(value: unknown): string {
  return normalizeMixUnit(value);
}

function productUnit(row: any): string | null {
  const explicitStockUnit = nullableText(row?.stock_unit);
  return inferMaterialStockUnit(row, explicitStockUnit || nullableText(row?.unit) || nullableText(row?.base_uom) || nullableText(row?.default_unit) || "kg");
}

export function inferOperationMaterialType(input: {
  product_type?: string | null;
  category?: string | null;
  subcategory?: string | null;
  rate_unit?: string | null;
}): "seed" | "fertilizer" | "pesticide" | "adjuvant" | "ph_corrector" | "defoamer" | "biological" | "fuel" | "organic" | "water" | "other" {
  const merged = [input.product_type, input.category, input.subcategory].map((item) => text(item).toLowerCase()).join(" ");
  if (merged.includes("fertilizer") || merged.includes("nutrition")) return "fertilizer";
  if (merged.includes("pesticide") || merged.includes("herbicide") || merged.includes("fungicide") || merged.includes("insecticide")) return "pesticide";
  if (merged.includes("ph_corrector") || merged.includes("ph_regulator")) return "ph_corrector";
  if (merged.includes("antifoam") || merged.includes("anti_foam") || merged.includes("defoamer")) return "defoamer";
  if (merged.includes("additive") || merged.includes("adjuvant") || merged.includes("sticker") || merged.includes("conditioner")) return "adjuvant";
  if (merged.includes("seed")) return "seed";
  if (merged.includes("water")) return "water";
  const unit = normalizeUnit(input.rate_unit);
  if (unit === "l" || unit === "kg") return "other";
  return "other";
}

export function calculateStepMaterialQuantity(input: {
  rate: number;
  rate_unit: string;
  rate_basis: CropCareRateBasis;
  total_area_ha: number;
  water_rate_l_ha?: number | null;
  total_solution_l_ha?: number | null;
}): { planned_quantity: number | null; planned_unit: string | null; error: string | null } {
  const waterRate = nullableNumber(input.water_rate_l_ha);
  const solutionRate = nullableNumber(input.total_solution_l_ha) ?? waterRate;
  const result = calculateMaterialPlannedQuantity({
    rate: numeric(input.rate),
    rateUnit: input.rate_unit,
    rateBasis: input.rate_basis,
    areaHa: input.total_area_ha,
    solutionRateLHa: solutionRate,
  });
  return {
    planned_quantity: result.plannedQuantity,
    planned_unit: result.plannedUnit,
    error: result.error,
  };
}

export async function getCurrentCareSeason(supabase: SupabaseClient, companyId: string): Promise<CropCareSeason | null> {
  const { data, error } = await supabase
    .from("seasons")
    .select("id,year,name,start_date,end_date,archived")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("year", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data || [])[0] as CropCareSeason | undefined) || null;
}

export function isSeasonReadOnly(season: CropCareSeason | null): { readOnly: boolean; reason: string | null } {
  if (!season?.id) return { readOnly: true, reason: "Нет активного сезона." };
  if (season.archived) return { readOnly: true, reason: "Сезон закрыт." };
  return { readOnly: false, reason: null };
}

export async function getCropStructureSections(params: {
  supabase: SupabaseClient;
  companyId: string;
  seasonId: string;
  cropId?: string | null;
  varietyId?: string | null;
}): Promise<CropCareStructureSection[]> {
  const { supabase, companyId, seasonId, cropId, varietyId } = params;
  let query = supabase
    .from("crop_structure")
    .select(`
      id,field_id,crop_id,variety_id,reproduction_id,area,irrigation_type,
      fields:field_id(id,name,area),
      crops:crop_id(id,name,name_ru,name_kz,name_en),
      varieties:variety_id(id,name,name_ru,name_kz,name_en),
      reproductions:reproduction_id(id,name,name_ru,name_kz,name_en)
    `)
    .eq("company_id", companyId)
    .eq("season_id", seasonId)
    .eq("archived", false)
    .order("field_id", { ascending: true });

  if (cropId) query = query.eq("crop_id", cropId);
  if (varietyId) query = query.eq("variety_id", varietyId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => {
    const field = relationOne(row.fields);
    const crop = relationOne(row.crops);
    const variety = relationOne(row.varieties);
    const reproduction = relationOne(row.reproductions);
    return {
      crop_structure_id: String(row.id),
      field_id: String(row.field_id),
      field_name: text((field as any)?.name) || "-",
      field_area_ha: numeric((field as any)?.area),
      crop_id: nullableText(row.crop_id),
      crop_name: displayName(crop),
      variety_id: nullableText(row.variety_id),
      variety_name: displayName(variety),
      reproduction_id: nullableText(row.reproduction_id),
      reproduction_name: displayName(reproduction),
      area_ha: numeric(row.area),
      irrigation_type: nullableText(row.irrigation_type),
    };
  });
}

export async function getIncludedSchemeArea(supabase: SupabaseClient, schemeId: string, companyId: string): Promise<number> {
  const { data, error } = await supabase
    .from("crop_care_scheme_fields")
    .select("planned_area_ha")
    .eq("crop_care_scheme_id", schemeId)
    .eq("company_id", companyId)
    .eq("included", true);
  if (error) throw new Error(error.message);
  return Number(((data || []) as any[]).reduce((sum, row) => sum + numeric(row.planned_area_ha), 0).toFixed(4));
}

export async function refreshSchemeMetrics(supabase: SupabaseClient, schemeId: string, companyId: string): Promise<void> {
  const [fieldsRes, stepsRes, operationsRes] = await Promise.all([
    supabase
      .from("crop_care_scheme_fields")
      .select("included,planned_area_ha")
      .eq("company_id", companyId)
      .eq("crop_care_scheme_id", schemeId),
    supabase
      .from("crop_care_scheme_steps")
      .select("id,status")
      .eq("company_id", companyId)
      .eq("crop_care_scheme_id", schemeId),
    supabase
      .from("crop_care_scheme_operations")
      .select("id")
      .eq("company_id", companyId)
      .eq("crop_care_scheme_id", schemeId)
      .eq("status", "active"),
  ]);
  if (fieldsRes.error) throw new Error(fieldsRes.error.message);
  if (stepsRes.error) throw new Error(stepsRes.error.message);
  if (operationsRes.error) throw new Error(operationsRes.error.message);

  const fields = (fieldsRes.data || []) as any[];
  const steps = (stepsRes.data || []) as any[];
  const totalArea = fields.filter((field) => field.included).reduce((sum, row) => sum + numeric(row.planned_area_ha), 0);
  const completedSteps = steps.filter((step) => ["generated", "in_progress", "completed"].includes(text(step.status))).length;
  const generatedCount = (operationsRes.data || []).length;
  const progress = steps.length > 0 ? Math.round((Math.max(completedSteps, generatedCount) / steps.length) * 100) : 0;

  const { error } = await supabase
    .from("crop_care_schemes")
    .update({
      total_area_ha: toFixedNumber(totalArea) || 0,
      field_count: fields.length,
      included_field_count: fields.filter((field) => field.included).length,
      progress_percent: Math.max(0, Math.min(100, progress)),
    })
    .eq("id", schemeId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
}

export async function getCropCareSchemeHeader(
  supabase: SupabaseClient,
  companyId: string,
  schemeId: string
): Promise<{ id: string; season_id: string; status: CropCareSchemeStatus }> {
  const { data, error } = await supabase
    .from("crop_care_schemes")
    .select("id,season_id,status")
    .eq("id", schemeId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new CropCareLifecycleError("Схема не найдена.", 404);
  return {
    id: String(data.id),
    season_id: String((data as any).season_id),
    status: (text((data as any).status) || "draft") as CropCareSchemeStatus,
  };
}

export async function getGeneratedStepIds(
  supabase: SupabaseClient,
  companyId: string,
  schemeId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("crop_care_scheme_operations")
    .select("step_id")
    .eq("company_id", companyId)
    .eq("crop_care_scheme_id", schemeId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return new Set((data || []).map((row: any) => String(row.step_id)));
}

export async function assertNoGeneratedOperations(
  supabase: SupabaseClient,
  companyId: string,
  schemeId: string,
  message = "По схеме уже созданы операции. Изменение участков заблокировано в V1."
): Promise<void> {
  const generatedStepIds = await getGeneratedStepIds(supabase, companyId, schemeId);
  if (generatedStepIds.size > 0) {
    throw new CropCareLifecycleError(message);
  }
}

export async function assertStepNotGenerated(
  supabase: SupabaseClient,
  companyId: string,
  schemeId: string,
  stepId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("crop_care_scheme_operations")
    .select("id")
    .eq("company_id", companyId)
    .eq("crop_care_scheme_id", schemeId)
    .eq("step_id", stepId)
    .eq("status", "active")
    .limit(1);
  if (error) throw new Error(error.message);
  if ((data || []).length > 0) {
    throw new CropCareLifecycleError("Этап уже связан с операцией. Изменение этапа и материалов заблокировано в V1.");
  }
}

export async function recalculateEditableStepMaterials(
  supabase: SupabaseClient,
  companyId: string,
  schemeId: string
): Promise<void> {
  const generatedStepIds = await getGeneratedStepIds(supabase, companyId, schemeId);
  const { data: steps, error: stepsError } = await supabase
    .from("crop_care_scheme_steps")
    .select("id")
    .eq("company_id", companyId)
    .eq("crop_care_scheme_id", schemeId);
  if (stepsError) throw new Error(stepsError.message);

  const editableStepIds = (steps || [])
    .map((row: any) => String(row.id))
    .filter((stepId) => !generatedStepIds.has(stepId));
  if (!editableStepIds.length) return;

  const { data: materials, error: materialsError } = await supabase
    .from("crop_care_scheme_step_materials")
    .select("step_id,product_id,rate,rate_unit,rate_basis,water_rate_l_ha,total_solution_l_ha,target_type,target_id,notes")
    .eq("company_id", companyId)
    .eq("crop_care_scheme_id", schemeId)
    .in("step_id", editableStepIds);
  if (materialsError) throw new Error(materialsError.message);

  const materialsByStep = new Map<string, CropCareMaterialInput[]>();
  (materials || []).forEach((row: any) => {
    const stepId = String(row.step_id);
    const item: CropCareMaterialInput = {
      product_id: String(row.product_id),
      rate: numeric(row.rate),
      rate_unit: normalizeUnit(row.rate_unit),
      rate_basis: normalizeRateBasis(row.rate_basis),
      water_rate_l_ha: nullableNumber(row.water_rate_l_ha),
      total_solution_l_ha: nullableNumber(row.total_solution_l_ha),
      target_type: normalizeTargetType(row.target_type),
      target_id: nullableText(row.target_id),
      notes: nullableText(row.notes),
    };
    materialsByStep.set(stepId, [...(materialsByStep.get(stepId) || []), item]);
  });

  for (const stepId of editableStepIds) {
    const nextMaterials = materialsByStep.get(stepId);
    if (!nextMaterials) continue;
    await replaceStepMaterials({ supabase, companyId, schemeId, stepId, materials: nextMaterials });
  }
}

export async function insertSchemeRevision(params: {
  supabase: SupabaseClient;
  schemeId: string;
  companyId: string;
  changeType: string;
  payload?: Record<string, unknown>;
  actorUserId?: string | null;
}): Promise<void> {
  const { supabase, schemeId, companyId, changeType, payload = {}, actorUserId = null } = params;
  const { data: scheme } = await supabase
    .from("crop_care_schemes")
    .select("revision_no")
    .eq("id", schemeId)
    .eq("company_id", companyId)
    .maybeSingle();
  const revisionNo = numeric((scheme as any)?.revision_no, 1);
  await supabase.from("crop_care_scheme_revisions").insert({
    crop_care_scheme_id: schemeId,
    company_id: companyId,
    revision_no: revisionNo,
    change_type: changeType,
    payload,
    created_by_user_id: actorUserId,
  });
}

export async function syncSchemeFieldsFromCropStructure(params: {
  supabase: SupabaseClient;
  companyId: string;
  schemeId: string;
  includedCropStructureIds?: string[] | null;
}): Promise<CropCareSchemeField[]> {
  const { supabase, companyId, schemeId, includedCropStructureIds } = params;
  const { data: scheme, error: schemeError } = await supabase
    .from("crop_care_schemes")
    .select("id,season_id,crop_id,variety_id")
    .eq("id", schemeId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (schemeError || !scheme?.id) throw new Error(schemeError?.message || "Схема не найдена.");

  const sections = await getCropStructureSections({
    supabase,
    companyId,
    seasonId: String((scheme as any).season_id),
    cropId: String((scheme as any).crop_id),
    varietyId: nullableText((scheme as any).variety_id),
  });
  const explicitSet = includedCropStructureIds ? new Set(includedCropStructureIds.map(String)) : null;
  const { data: existingRows, error: existingError } = await supabase
    .from("crop_care_scheme_fields")
    .select("crop_structure_id,included")
    .eq("company_id", companyId)
    .eq("crop_care_scheme_id", schemeId);
  if (existingError) throw new Error(existingError.message);
  const existingIncludedByStructure = new Map(
    (existingRows || []).map((row: any) => [String(row.crop_structure_id), Boolean(row.included)])
  );

  if (sections.length > 0) {
    const rows = sections.map((section) => ({
      crop_care_scheme_id: schemeId,
      company_id: companyId,
      season_id: String((scheme as any).season_id),
      field_id: section.field_id,
      crop_structure_id: section.crop_structure_id,
      crop_id: section.crop_id,
      variety_id: section.variety_id,
      reproduction_id: section.reproduction_id,
      planned_area_ha: section.area_ha,
      field_name_snapshot: section.field_name,
      crop_label_snapshot: section.crop_name,
      variety_label_snapshot: section.variety_name,
      reproduction_label_snapshot: section.reproduction_name,
      irrigation_type: section.irrigation_type,
      included: explicitSet
        ? explicitSet.has(section.crop_structure_id)
        : existingIncludedByStructure.has(section.crop_structure_id)
          ? Boolean(existingIncludedByStructure.get(section.crop_structure_id))
          : false,
    }));
    const { error: upsertError } = await supabase
      .from("crop_care_scheme_fields")
      .upsert(rows, { onConflict: "crop_care_scheme_id,crop_structure_id" });
    if (upsertError) throw new Error(upsertError.message);
  }

  await recalculateEditableStepMaterials(supabase, companyId, schemeId);
  await refreshSchemeMetrics(supabase, schemeId, companyId);
  return getSchemeFields(supabase, companyId, schemeId);
}

export async function getSchemeFields(supabase: SupabaseClient, companyId: string, schemeId: string): Promise<CropCareSchemeField[]> {
  const { data, error } = await supabase
    .from("crop_care_scheme_fields")
    .select("*")
    .eq("company_id", companyId)
    .eq("crop_care_scheme_id", schemeId)
    .order("field_name_snapshot", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({
    id: String(row.id),
    crop_structure_id: String(row.crop_structure_id),
    field_id: String(row.field_id),
    field_name: text(row.field_name_snapshot) || "-",
    field_area_ha: numeric(row.planned_area_ha),
    crop_id: nullableText(row.crop_id),
    crop_name: text(row.crop_label_snapshot) || "-",
    variety_id: nullableText(row.variety_id),
    variety_name: text(row.variety_label_snapshot) || "-",
    reproduction_id: nullableText(row.reproduction_id),
    reproduction_name: text(row.reproduction_label_snapshot) || "-",
    area_ha: numeric(row.planned_area_ha),
    irrigation_type: nullableText(row.irrigation_type),
    included: Boolean(row.included),
    notes: nullableText(row.notes),
  }));
}

export async function createCropCareScheme(params: {
  supabase: SupabaseClient;
  companyId: string;
  seasonId: string;
  cropId: string;
  varietyId?: string | null;
  name: string;
  schemeType: CropCareSchemeType;
  description?: string | null;
  includedCropStructureIds?: string[] | null;
  actorUserId?: string | null;
}): Promise<string> {
  const { supabase, companyId, seasonId, cropId, varietyId, name, schemeType, description, includedCropStructureIds, actorUserId } = params;
  if (!text(name)) throw new Error("Укажите название схемы.");
  if (!cropId) throw new Error("Выберите культуру.");
  const { data, error } = await supabase
    .from("crop_care_schemes")
    .insert({
      company_id: companyId,
      season_id: seasonId,
      crop_id: cropId,
      variety_id: varietyId || null,
      name: text(name),
      scheme_type: schemeType || "combined",
      description: nullableText(description),
      status: "draft",
      created_by_user_id: actorUserId,
      updated_by_user_id: actorUserId,
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message || "Не удалось создать схему.");
  await syncSchemeFieldsFromCropStructure({ supabase, companyId, schemeId: String(data.id), includedCropStructureIds });
  await insertSchemeRevision({
    supabase,
    schemeId: String(data.id),
    companyId,
    changeType: "created",
    payload: { name, crop_id: cropId, variety_id: varietyId || null },
    actorUserId,
  });
  return String(data.id);
}

export async function updateCropCareScheme(params: {
  supabase: SupabaseClient;
  companyId: string;
  schemeId: string;
  patch: Record<string, unknown>;
  actorUserId?: string | null;
}): Promise<void> {
  const { supabase, companyId, schemeId, patch, actorUserId } = params;
  const allowed: Record<string, unknown> = {};
  ["name", "scheme_type", "description", "status", "variety_id"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key] || null;
  });
  if (Object.keys(allowed).length > 0) {
    allowed.updated_by_user_id = actorUserId || null;
    if (allowed.status === "active") allowed.activated_at = new Date().toISOString();
    if (allowed.status === "paused") allowed.paused_at = new Date().toISOString();
    if (allowed.status === "completed") allowed.completed_at = new Date().toISOString();
    if (allowed.status === "archived") allowed.archived_at = new Date().toISOString();
    const { data: current } = await supabase
      .from("crop_care_schemes")
      .select("revision_no")
      .eq("id", schemeId)
      .eq("company_id", companyId)
      .maybeSingle();
    allowed.revision_no = numeric((current as any)?.revision_no, 1) + 1;
    const { error } = await supabase
      .from("crop_care_schemes")
      .update(allowed)
      .eq("id", schemeId)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    await insertSchemeRevision({ supabase, schemeId, companyId, changeType: "updated", payload: allowed, actorUserId });
  }

  const fields = Array.isArray(patch.fields) ? patch.fields : null;
  if (fields) {
    await assertNoGeneratedOperations(
      supabase,
      companyId,
      schemeId,
      "По схеме уже созданы операции. Изменение участков заблокировано в V1."
    );
    for (const field of fields as any[]) {
      const fieldId = text(field.id);
      if (!fieldId) continue;
      const { error } = await supabase
        .from("crop_care_scheme_fields")
        .update({
          included: Boolean(field.included),
          notes: nullableText(field.notes),
        })
        .eq("id", fieldId)
        .eq("company_id", companyId)
        .eq("crop_care_scheme_id", schemeId);
      if (error) throw new Error(error.message);
    }
    await recalculateEditableStepMaterials(supabase, companyId, schemeId);
    await refreshSchemeMetrics(supabase, schemeId, companyId);
    await insertSchemeRevision({ supabase, schemeId, companyId, changeType: "fields_updated", payload: { fields }, actorUserId });
  }
}

async function loadProductMap(supabase: SupabaseClient, companyId: string, productIds: string[]): Promise<Map<string, any>> {
  if (!productIds.length) return new Map();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .in("id", productIds)
    .or(`company_id.eq.${companyId},company_id.is.null`);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row: any) => [String(row.id), row]));
}

export async function replaceStepMaterials(params: {
  supabase: SupabaseClient;
  companyId: string;
  schemeId: string;
  stepId: string;
  materials: CropCareMaterialInput[];
}): Promise<void> {
  const { supabase, companyId, schemeId, stepId, materials } = params;
  await assertStepNotGenerated(supabase, companyId, schemeId, stepId);
  const usableMaterials = materials.filter((item) => text(item.product_id));
  if (!usableMaterials.length) {
    throw new CropCareLifecycleError("Добавьте хотя бы один материал в этап.", 400);
  }
  if (usableMaterials.some((item) => numeric(item.rate) <= 0)) {
    throw new CropCareLifecycleError("Укажите норму для каждого материала.", 400);
  }
  const { data: stepRow, error: stepError } = await supabase
    .from("crop_care_scheme_steps")
    .select("operation_type")
    .eq("id", stepId)
    .eq("company_id", companyId)
    .eq("crop_care_scheme_id", schemeId)
    .maybeSingle();
  if (stepError) throw new Error(stepError.message);
  const operationType = text((stepRow as any)?.operation_type).toLowerCase();
  const requiresSolutionRate = operationType === "spraying" || operationType === "fertigation";
  const solutionRate =
    usableMaterials
      .map((item) => nullableNumber(item.total_solution_l_ha) ?? nullableNumber(item.water_rate_l_ha))
      .find((value) => value !== null && value > 0) ?? null;
  if (requiresSolutionRate && !solutionRate) {
    throw new CropCareLifecycleError("Укажите норму рабочего раствора л/га для опрыскивания или фертигации.", 400);
  }
  const totalArea = await getIncludedSchemeArea(supabase, schemeId, companyId);
  const productIds = Array.from(new Set(usableMaterials.map((item) => text(item.product_id)).filter(Boolean)));
  const productMap = await loadProductMap(supabase, companyId, productIds);
  const mix = calculateTankMix({
    areaHa: totalArea,
    solutionRateLHa: solutionRate,
    materials: usableMaterials.map((item) => ({
      productId: item.product_id,
      rate: numeric(item.rate),
      rateUnit: item.rate_unit,
      rateBasis: item.rate_basis,
    })),
  });
  if (mix.error) {
    throw new CropCareLifecycleError(mix.error, 400);
  }

  const rows = usableMaterials.map((item) => {
    const productId = text(item.product_id);
    const product = productMap.get(productId);
    if (!product) throw new Error("Выбранный материал не найден в справочнике.");
    const rateBasis = normalizeRateBasis(item.rate_basis);
    const rateUnit = normalizeUnit(item.rate_unit || productUnit(product) || "kg");
    const calc = calculateStepMaterialQuantity({
      rate: numeric(item.rate),
      rate_unit: rateUnit,
      rate_basis: rateBasis,
      total_area_ha: totalArea,
      water_rate_l_ha: item.water_rate_l_ha,
      total_solution_l_ha: item.total_solution_l_ha,
    });
    if (calc.error) throw new Error(calc.error);
    return {
      crop_care_scheme_id: schemeId,
      step_id: stepId,
      company_id: companyId,
      product_id: productId,
      product_name_snapshot: productDisplayName(product),
      product_type: nullableText(product.product_type) || nullableText(product.type) || nullableText(product.category),
      rate: numeric(item.rate),
      rate_unit: rateUnit,
      rate_basis: rateBasis,
      water_rate_l_ha: nullableNumber(item.water_rate_l_ha),
      total_solution_l_ha: nullableNumber(item.total_solution_l_ha),
      planned_quantity: calc.planned_quantity,
      planned_unit: calc.planned_unit,
      target_type: normalizeTargetType(item.target_type),
      target_id: nullableText(item.target_id),
      notes: nullableText(item.notes),
    };
  });

  const { error: deleteError } = await supabase
    .from("crop_care_scheme_step_materials")
    .delete()
    .eq("company_id", companyId)
    .eq("step_id", stepId);
  if (deleteError) throw new Error(deleteError.message);

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("crop_care_scheme_step_materials").insert(rows);
    if (insertError) throw new Error(insertError.message);
  }
}

export async function createCropCareStep(params: {
  supabase: SupabaseClient;
  companyId: string;
  schemeId: string;
  input: CropCareStepInput;
  actorUserId?: string | null;
}): Promise<string> {
  const { supabase, companyId, schemeId, input, actorUserId } = params;
  const title = text(input.title);
  if (!title) throw new Error("Укажите название этапа.");
  if (!Array.isArray(input.materials) || !input.materials.some((item) => text(item.product_id))) {
    throw new CropCareLifecycleError("Добавьте хотя бы один материал в этап.", 400);
  }
  const { data: existingSteps } = await supabase
    .from("crop_care_scheme_steps")
    .select("step_no")
    .eq("company_id", companyId)
    .eq("crop_care_scheme_id", schemeId)
    .order("step_no", { ascending: false })
    .limit(1);
  const nextStepNo = input.step_no && input.step_no > 0 ? input.step_no : numeric((existingSteps || [])[0]?.step_no, 0) + 1;
  const { data, error } = await supabase
    .from("crop_care_scheme_steps")
    .insert({
      crop_care_scheme_id: schemeId,
      company_id: companyId,
      step_no: nextStepNo,
      title,
      phenological_phase: nullableText(input.phenological_phase),
      planned_date: nullableText(input.planned_date),
      window_start_date: nullableText(input.window_start_date),
      window_end_date: nullableText(input.window_end_date),
      operation_type: nullableText(input.operation_type) || "spraying",
      responsible_user_id: nullableText(input.responsible_user_id),
      lead_time_days: numeric(input.lead_time_days, 0),
      status: nullableText(input.status) || "planned",
      notes: nullableText(input.notes),
      created_by_user_id: actorUserId,
      updated_by_user_id: actorUserId,
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message || "Не удалось создать этап.");
  await replaceStepMaterials({
    supabase,
    companyId,
    schemeId,
    stepId: String(data.id),
    materials: input.materials || [],
  });
  await refreshSchemeMetrics(supabase, schemeId, companyId);
  await insertSchemeRevision({ supabase, schemeId, companyId, changeType: "step_created", payload: { title }, actorUserId });
  return String(data.id);
}

export async function updateCropCareStep(params: {
  supabase: SupabaseClient;
  companyId: string;
  schemeId: string;
  stepId: string;
  input: Partial<CropCareStepInput>;
  actorUserId?: string | null;
}): Promise<void> {
  const { supabase, companyId, schemeId, stepId, input, actorUserId } = params;
  await assertStepNotGenerated(supabase, companyId, schemeId, stepId);
  const patch: Record<string, unknown> = {};
  [
    "step_no",
    "title",
    "phenological_phase",
    "planned_date",
    "window_start_date",
    "window_end_date",
    "operation_type",
    "responsible_user_id",
    "lead_time_days",
    "status",
    "notes",
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = (input as any)[key] || null;
  });
  if (Object.keys(patch).length > 0) {
    patch.updated_by_user_id = actorUserId || null;
    const { error } = await supabase
      .from("crop_care_scheme_steps")
      .update(patch)
      .eq("id", stepId)
      .eq("company_id", companyId)
      .eq("crop_care_scheme_id", schemeId);
    if (error) throw new Error(error.message);
  }
  if (Array.isArray(input.materials)) {
    await replaceStepMaterials({ supabase, companyId, schemeId, stepId, materials: input.materials });
  }
  await refreshSchemeMetrics(supabase, schemeId, companyId);
  await insertSchemeRevision({ supabase, schemeId, companyId, changeType: "step_updated", payload: { step_id: stepId }, actorUserId });
}

export async function loadCropCareBootstrap(supabase: SupabaseClient, companyId: string): Promise<CropCareBootstrap> {
  const season = await getCurrentCareSeason(supabase, companyId);
  const readOnly = isSeasonReadOnly(season);
  const [cropsRes, varietiesRes, productsRes, responsibleRes] = await Promise.all([
    supabase
      .from("crops")
      .select("id,name,name_ru,name_kz,name_en")
      .is("company_id", null)
      .eq("archived", false)
      .eq("is_active", true)
      .order("name_ru", { ascending: true }),
    supabase
      .from("varieties")
      .select("id,crop_id,name,name_ru,name_kz,name_en")
      .is("company_id", null)
      .eq("archived", false)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("products")
      .select("*")
      .eq("archived", false)
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order("name", { ascending: true })
      .limit(1500),
    supabase
      .from("profiles")
      .select("id,full_name,email,role,status")
      .eq("company_id", companyId)
      .eq("status", "active")
      .in("role", ["agronomist", "specialist", "brigadier", "company_admin", "director"])
      .order("full_name", { ascending: true }),
  ]);
  if (cropsRes.error) throw new Error(cropsRes.error.message);
  if (varietiesRes.error) throw new Error(varietiesRes.error.message);
  if (productsRes.error) throw new Error(productsRes.error.message);
  if (responsibleRes.error) throw new Error(responsibleRes.error.message);

  const schemes = season?.id ? await loadCropCareSchemes(supabase, companyId, season.id) : [];
  return {
    season,
    read_only: readOnly.readOnly,
    read_only_reason: readOnly.reason,
    crops: (cropsRes.data || []).map((row: any) => ({ id: String(row.id), name: displayName(row) })),
    varieties: (varietiesRes.data || []).map((row: any) => ({
      id: String(row.id),
      crop_id: String(row.crop_id),
      name: displayName(row),
    })),
    products: (productsRes.data || []).map((row: any) => ({
      id: String(row.id),
      name: productDisplayName(row),
      trade_name: nullableText(row.trade_name),
      normalized_name: nullableText(row.normalized_name),
      company_id: nullableText(row.company_id),
      manufacturer: nullableText(row.manufacturer),
      product_type: nullableText(row.product_type) || nullableText(row.type),
      category: nullableText(row.category) || nullableText(row.pesticide_category) || nullableText(row.fertilizer_type),
      subcategory: nullableText(row.subcategory),
      unit: normalizeUnit(productUnit(row) || row.unit || "kg"),
      base_uom: nullableText(row.base_uom),
      default_unit: nullableText(row.default_unit),
      application_unit: nullableText(row.application_unit),
      stock_unit: nullableText(row.stock_unit),
      default_rate_type: nullableText(row.default_rate_type),
      default_rate_unit: nullableText(row.default_rate_unit),
      default_dosing_type: nullableText(row.default_rate_type) || nullableText(row.default_dosing_type),
      notes: nullableText(row.notes),
    })),
    responsible_users: (responsibleRes.data || []).map((row: any) => ({
      id: String(row.id),
      name: text(row.full_name) || text(row.email) || "-",
      email: text(row.email),
      role: text(row.role),
    })),
    schemes,
  };
}

export async function loadCropCareSchemes(
  supabase: SupabaseClient,
  companyId: string,
  seasonId: string
): Promise<CropCareScheme[]> {
  const { data: schemesData, error: schemesError } = await supabase
    .from("crop_care_schemes")
    .select("*,crops:crop_id(id,name,name_ru,name_kz,name_en),varieties:variety_id(id,name,name_ru,name_kz,name_en)")
    .eq("company_id", companyId)
    .eq("season_id", seasonId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });
  if (schemesError) throw new Error(schemesError.message);
  const schemesRaw = (schemesData || []) as any[];
  const schemeIds = schemesRaw.map((row) => String(row.id));
  if (!schemeIds.length) return [];

  const [fieldsRes, stepsRes, materialsRes, linksRes] = await Promise.all([
    supabase.from("crop_care_scheme_fields").select("*").eq("company_id", companyId).in("crop_care_scheme_id", schemeIds),
    supabase.from("crop_care_scheme_steps").select("*").eq("company_id", companyId).in("crop_care_scheme_id", schemeIds).order("step_no", { ascending: true }),
    supabase.from("crop_care_scheme_step_materials").select("*").eq("company_id", companyId).in("crop_care_scheme_id", schemeIds),
    supabase
      .from("crop_care_scheme_operations")
      .select("id,crop_care_scheme_id,step_id,operation_id,status,operations:operation_id(id,status,work_status)")
      .eq("company_id", companyId)
      .in("crop_care_scheme_id", schemeIds)
      .eq("status", "active"),
  ]);
  if (fieldsRes.error) throw new Error(fieldsRes.error.message);
  if (stepsRes.error) throw new Error(stepsRes.error.message);
  if (materialsRes.error) throw new Error(materialsRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);

  const materialProductIds = Array.from(
    new Set((materialsRes.data || []).map((row: any) => text(row.product_id)).filter(Boolean))
  );
  const materialProductMap = await loadProductMap(supabase, companyId, materialProductIds);

  const fieldsByScheme = new Map<string, CropCareSchemeField[]>();
  (fieldsRes.data || []).forEach((row: any) => {
    const item: CropCareSchemeField = {
      id: String(row.id),
      crop_structure_id: String(row.crop_structure_id),
      field_id: String(row.field_id),
      field_name: text(row.field_name_snapshot) || "-",
      field_area_ha: numeric(row.planned_area_ha),
      crop_id: nullableText(row.crop_id),
      crop_name: text(row.crop_label_snapshot) || "-",
      variety_id: nullableText(row.variety_id),
      variety_name: text(row.variety_label_snapshot) || "-",
      reproduction_id: nullableText(row.reproduction_id),
      reproduction_name: text(row.reproduction_label_snapshot) || "-",
      area_ha: numeric(row.planned_area_ha),
      irrigation_type: nullableText(row.irrigation_type),
      included: Boolean(row.included),
      notes: nullableText(row.notes),
    };
    fieldsByScheme.set(String(row.crop_care_scheme_id), [...(fieldsByScheme.get(String(row.crop_care_scheme_id)) || []), item]);
  });

  const materialsByStep = new Map<string, CropCareStepMaterial[]>();
  (materialsRes.data || []).forEach((row: any) => {
    const product = materialProductMap.get(String(row.product_id));
    const item: CropCareStepMaterial = {
      id: String(row.id),
      product_id: String(row.product_id),
      product_name: product ? productDisplayName(product) : text(row.product_name_snapshot) || "-",
      product_type: nullableText(row.product_type),
      rate: numeric(row.rate),
      rate_unit: normalizeUnit(row.rate_unit),
      rate_basis: normalizeRateBasis(row.rate_basis),
      water_rate_l_ha: nullableNumber(row.water_rate_l_ha),
      total_solution_l_ha: nullableNumber(row.total_solution_l_ha),
      planned_quantity: nullableNumber(row.planned_quantity),
      planned_unit: nullableText(row.planned_unit),
      target_type: normalizeTargetType(row.target_type),
      target_id: nullableText(row.target_id),
      notes: nullableText(row.notes),
    };
    materialsByStep.set(String(row.step_id), [...(materialsByStep.get(String(row.step_id)) || []), item]);
  });

  const operationByStep = new Map<string, { operation_id: string; status: string | null }>();
  (linksRes.data || []).forEach((row: any) => {
    const operation = relationOne(row.operations);
    operationByStep.set(String(row.step_id), {
      operation_id: String(row.operation_id),
      status: text((operation as any)?.work_status) || text((operation as any)?.status) || text(row.status) || null,
    });
  });

  const stepsByScheme = new Map<string, CropCareStep[]>();
  (stepsRes.data || []).forEach((row: any) => {
    const generated = operationByStep.get(String(row.id)) || null;
    const item: CropCareStep = {
      id: String(row.id),
      step_no: numeric(row.step_no),
      title: text(row.title),
      phenological_phase: nullableText(row.phenological_phase),
      planned_date: nullableText(row.planned_date),
      window_start_date: nullableText(row.window_start_date),
      window_end_date: nullableText(row.window_end_date),
      operation_type: text(row.operation_type) || "spraying",
      responsible_user_id: nullableText(row.responsible_user_id),
      lead_time_days: numeric(row.lead_time_days),
      status: text(row.status) || "planned",
      notes: nullableText(row.notes),
      materials: materialsByStep.get(String(row.id)) || [],
      generated_operation_id: generated?.operation_id || null,
      generated_operation_status: generated?.status || null,
    };
    stepsByScheme.set(String(row.crop_care_scheme_id), [...(stepsByScheme.get(String(row.crop_care_scheme_id)) || []), item]);
  });

  return schemesRaw.map((row: any) => {
    const crop = relationOne(row.crops);
    const variety = relationOne(row.varieties);
    return {
      id: String(row.id),
      season_id: String(row.season_id),
      crop_id: String(row.crop_id),
      variety_id: nullableText(row.variety_id),
      name: text(row.name),
      scheme_type: (text(row.scheme_type) || "combined") as CropCareSchemeType,
      description: nullableText(row.description),
      status: (text(row.status) || "draft") as CropCareSchemeStatus,
      revision_no: numeric(row.revision_no, 1),
      total_area_ha: numeric(row.total_area_ha),
      field_count: numeric(row.field_count),
      included_field_count: numeric(row.included_field_count),
      progress_percent: numeric(row.progress_percent),
      crop_name: displayName(crop),
      variety_name: displayName(variety),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      fields: fieldsByScheme.get(String(row.id)) || [],
      steps: stepsByScheme.get(String(row.id)) || [],
    };
  });
}

export function mapSchemeOperationType(value: string): {
  categorySlug: string;
  typeSlug: string;
  label: string;
} {
  const key = text(value).toLowerCase();
  if (key.includes("fertigation") || key.includes("фертиг")) {
    return { categorySlug: "fertigation", typeSlug: "fertigation", label: "Фертигация" };
  }
  if (key.includes("fertil") || key.includes("удобр")) {
    return { categorySlug: "fertilizing", typeSlug: "fertilizing", label: "Внесение удобрений" };
  }
  if (key.includes("irrig") || key.includes("полив")) {
    return { categorySlug: "irrigation", typeSlug: "irrigation", label: "Полив" };
  }
  return { categorySlug: "spraying", typeSlug: "spraying", label: "Опрыскивание" };
}

export function buildOperationPayloadFromScheme(input: {
  companyId: string;
  scheme: any;
  fields: CropCareSchemeField[];
  step: any;
  materials: CropCareStepMaterial[];
}) {
  const includedFields = input.fields.filter((field) => field.included);
  if (!includedFields.length) throw new Error("В схеме нет выбранных участков.");
  if (!input.materials.length) throw new Error("В этапе нет материалов. Операция по схеме не создана.");
  const operationType = mapSchemeOperationType(String(input.step.operation_type || ""));
  const totalArea = includedFields.reduce((sum, field) => sum + numeric(field.area_ha), 0);
  const first = includedFields[0];
  const totalSolution = input.materials.find((material) => material.total_solution_l_ha || material.water_rate_l_ha);
  const components = input.materials.map((material) => ({
    component_type: inferOperationMaterialType({
      product_type: material.product_type,
      category: material.product_type,
      rate_unit: material.rate_unit,
    }),
    material_type: inferOperationMaterialType({
      product_type: material.product_type,
      category: material.product_type,
      rate_unit: material.rate_unit,
    }),
    product_id: material.product_id,
    planned_rate: material.rate,
    rate_basis: material.rate_basis,
    planned_quantity: material.planned_quantity,
    unit: normalizeUnit(material.planned_unit || material.rate_unit || "kg"),
    notes: [
      `target_type:${material.target_type}`,
      material.target_id ? `target_id:${material.target_id}` : null,
      material.notes,
    ]
      .filter(Boolean)
      .join("; "),
  }));

  return {
    companyId: input.companyId,
    field_id: first.field_id,
    crop_structure_id: first.crop_structure_id,
    operation_category_slug: operationType.categorySlug,
    operation_type_slug: operationType.typeSlug,
    operation_type: text(input.step.title) || operationType.label,
    planned_area_ha: toFixedNumber(totalArea),
    crop_id: input.scheme.crop_id,
    targets: includedFields.map((field) => ({
      field_id: field.field_id,
      crop_structure_id: field.crop_structure_id,
      crop_id: field.crop_id,
      variety_id: field.variety_id,
      reproduction_id: field.reproduction_id,
      planned_area_ha: field.area_ha,
      notes: `crop_care_scheme:${input.scheme.id}; step:${input.step.id}`,
    })),
    date: text(input.step.planned_date) || new Date().toISOString().slice(0, 10),
    responsible_user_id: nullableText(input.step.responsible_user_id),
    notes: [
      `Схема защиты и ухода: ${input.scheme.name}`,
      `Этап ${input.step.step_no}: ${input.step.title}`,
      input.step.phenological_phase ? `Фаза: ${input.step.phenological_phase}` : null,
      input.step.notes,
    ]
      .filter(Boolean)
      .join("\n"),
    materials: components,
    tank_mix: {
      enabled: components.length > 0,
      water_rate_l_ha: totalSolution?.water_rate_l_ha || null,
      total_solution_l_ha: totalSolution?.total_solution_l_ha || totalSolution?.water_rate_l_ha || null,
      components,
    },
    operation_params: {
      source: "crop_care_scheme",
      crop_care_scheme_id: input.scheme.id,
      crop_care_scheme_step_id: input.step.id,
    },
  };
}
