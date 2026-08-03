import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
  type ServerActorContext,
  type ServerActorTiming,
} from "@/lib/auth/server-session";
import {
  isUnitAllowedForMaterialRateBasis,
  normalizeMaterialRateBasis,
} from "@/lib/materials/metadata";
import { calculateMaterialPlannedQuantity } from "@/lib/materials/mix-calculations";
import { SeasonGuardError, assertSeasonWritableForMutation } from "@/lib/seasons/season-guard";
import {
  buildExecutionFactModelMetadata,
  buildWarehouseWorkflowMetadata,
  getOperationCropRequirement,
  getTankMixComponentDefinition,
  isCropIndependentFieldOperation,
  normalizeIrrigationType,
  normalizePurposeList,
  resolveCanonicalOperationType,
  toStorageMaterialType,
} from "@/lib/operations/operation-engine";
import { isDateOnly } from "@/lib/dates/date-only";
import {
  isMachineryCompatible,
  machineryCompatibilityMessage,
} from "@/lib/operations/machinery-compatibility";
import {
  calculateSeedRequirementKg,
  isCompleteSeedIdentity,
  seedIdentityKey,
} from "@/lib/operations/seed-material";

const CREATE_ALLOWED_ROLES = ["global_admin", "company_admin", "agronomist"] as const;
type OperationCreateTiming = {
  auth_session_ms: number;
  actor_company_context_ms: number;
  idempotency_lookup_ms: number;
  validation_ms: number;
  crop_structure_read_ms: number;
  operation_insert_ms: number;
  child_rows_insert_ms: number;
  material_request_ms: number;
  fast_path_ms?: number;
  total_ms: number;
  actor_breakdown?: ServerActorTiming;
};

type OperationMaterialInput = {
  component_type?: string | null;
  material_type?: string | null;
  product_id?: string | null;
  batch_id?: string | null;
  planned_rate?: number | null;
  actual_rate?: number | null;
  rate_basis?: string | null;
  planned_quantity?: number | null;
  unit?: string | null;
  notes?: string | null;
  crop_id?: string | null;
  variety_id?: string | null;
  reproduction_id?: string | null;
  identity_label?: string | null;
  rate_display_unit?: "kg_ha" | "t_ha" | null;
};

type CreateOperationBody = {
  companyId?: string | null;
  idempotency_key?: string | null;
  field_id?: string;
  crop_structure_id?: string | null;
  operation_category_slug?: string | null;
  operation_type_slug?: string | null;
  operation_type?: string;
  planned_area_ha?: number | null;
  crop_id?: string | null;
  machine_id?: string | null;
  equipment_id?: string | null;
  transport_id?: string | null;
  operation_target?: string | null;
  rate_per_ha?: number | null;
  spray_volume_per_ha?: number | null;
  row_spacing_m?: number | null;
  seed_spacing_cm?: number | null;
  operation_params?: Record<string, unknown> | null;
  purposes?: unknown;
  tank_mix?: {
    enabled?: boolean | null;
    water_rate_l_ha?: number | null;
    total_solution_l_ha?: number | null;
    components?: OperationMaterialInput[];
  } | null;
  structure_change?: {
    mode?: "area_split" | "crop_replace" | null;
    confirmed?: boolean | null;
    new_crop_id?: string | null;
    new_variety_id?: string | null;
    new_reproduction_id?: string | null;
    area_ha?: number | null;
  } | null;
  materials?: OperationMaterialInput[];
  targets?: Array<{
    field_id?: string | null;
    crop_structure_id?: string | null;
    crop_id?: string | null;
    variety_id?: string | null;
    reproduction_id?: string | null;
    planned_area_ha?: number | null;
    notes?: string | null;
  }>;
  date?: string;
  responsible_user_id?: string | null;
  notes?: string | null;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "idempotency_key")
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function buildRequestFingerprint(body: CreateOperationBody): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

function normalizeIdempotencyKey(request: NextRequest, body: CreateOperationBody): string | null {
  const fromHeader = String(request.headers.get("Idempotency-Key") || "").trim();
  const fromBody = String(body.idempotency_key || "").trim();
  const value = fromHeader || fromBody;
  if (!value) return null;
  return value.slice(0, 160);
}

function shouldIncludeTiming(request: NextRequest): boolean {
  return (
    request.headers.get("X-Debug-Timing") === "1" ||
    request.nextUrl.searchParams.get("debugTiming") === "1"
  );
}

function createTiming(): OperationCreateTiming {
  return {
    auth_session_ms: 0,
    actor_company_context_ms: 0,
    idempotency_lookup_ms: 0,
    validation_ms: 0,
    crop_structure_read_ms: 0,
    operation_insert_ms: 0,
    child_rows_insert_ms: 0,
    material_request_ms: 0,
    total_ms: 0,
  };
}

function withTiming<T extends Record<string, unknown>>(
  payload: T,
  timing: OperationCreateTiming,
  includeTiming: boolean,
  startedAt: number
): T & { debug_timing?: OperationCreateTiming } {
  if (!includeTiming) return payload;
  return {
    ...payload,
    debug_timing: {
      ...timing,
      total_ms: Date.now() - startedAt,
    },
  };
}

function assertCreateActorAccess(actor: ServerActorContext, companyId: string): void {
  if (String(actor.status || "active") !== "active") {
    throw new SessionAuthError("Actor profile is not active", 403);
  }
  if (!CREATE_ALLOWED_ROLES.includes(actor.role as (typeof CREATE_ALLOWED_ROLES)[number])) {
    throw new SessionAuthError("Access denied for current role", 403);
  }
  if (actor.role !== "global_admin" && actor.companyId !== companyId) {
    throw new SessionAuthError("Actor does not belong to the target company", 403);
  }
}

function toNullableUuid(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toNullableText(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toPlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

const MATERIAL_TYPES = new Set([
  "seed",
  "fertilizer",
  "pesticide",
  "adjuvant",
  "ph_corrector",
  "defoamer",
  "biological",
  "fuel",
  "organic",
  "water",
  "other",
]);

const MATERIAL_UNITS = new Set(["kg", "l", "ml", "g", "pcs"]);

type OperationMaterialUnitValue = "kg" | "l" | "ml" | "g" | "pcs";
type OperationMaterialStorageUnitValue = "kg" | "l" | "pcs";

function inferUnitByMaterialType(materialType: string): OperationMaterialUnitValue {
  if (
    materialType === "pesticide" ||
    materialType === "adjuvant" ||
    materialType === "ph_corrector" ||
    materialType === "defoamer" ||
    materialType === "water"
  ) {
    return "l";
  }
  if (materialType === "seed" || materialType === "fertilizer" || materialType === "organic" || materialType === "biological") {
    return "kg";
  }
  return "kg";
}

function normalizeOperationMaterialStorage(
  quantity: number | null,
  unit: OperationMaterialUnitValue
): {
  quantity: number | null;
  unit: OperationMaterialStorageUnitValue;
  rateUnit: OperationMaterialUnitValue | null;
} {
  if (unit === "ml") {
    return {
      quantity: quantity !== null && quantity > 0 ? Number((quantity / 1000).toFixed(4)) : quantity,
      unit: "l",
      rateUnit: "ml",
    };
  }

  if (unit === "g") {
    return {
      quantity: quantity !== null && quantity > 0 ? Number((quantity / 1000).toFixed(4)) : quantity,
      unit: "kg",
      rateUnit: "g",
    };
  }

  return {
    quantity,
    unit,
    rateUnit: null,
  };
}

function allowsDefaultOperationLine(categorySlug: string | null, typeSlug: string | null, operationType: string): boolean {
  if (isCropIndependentFieldOperation({ categorySlug, typeSlug })) return true;
  if (String(typeSlug || "").trim().toLowerCase() === "haulm_topping") return true;
  const canonical = resolveCanonicalOperationType({ categorySlug, typeSlug, operationType });
  if (canonical?.requiresCropStructure) return true;
  const category = String(categorySlug || "").trim().toLowerCase();
  const merged = `${category} ${String(typeSlug || "").toLowerCase()} ${operationType.toLowerCase()}`;
  return ["seed", "sow", "plant", "harvest", "\u043f\u043e\u0441\u0435\u0432", "\u043f\u043e\u0441\u0430\u0434", "\u0443\u0431\u043e\u0440\u043a"].some((token) => merged.includes(token));
}

function requiresCropStructure(categorySlug: string | null, typeSlug: string | null, operationType: string): boolean {
  if (isCropIndependentFieldOperation({ categorySlug, typeSlug })) return false;
  if (String(typeSlug || "").trim().toLowerCase() === "haulm_topping") return true;
  const canonical = resolveCanonicalOperationType({ categorySlug, typeSlug, operationType });
  if (canonical) return canonical.requiresCropStructure;

  const category = String(categorySlug || "").trim().toLowerCase();
  const type = String(typeSlug || "").trim().toLowerCase();
  const label = operationType.trim().toLowerCase();
  const merged = `${category} ${type} ${label}`;

  if (["logistics", "service", "service_operations", "post_harvest", "processing"].includes(category)) {
    return false;
  }

  return [
    "soil_preparation",
    "seeding_planting",
    "fertilization",
    "plant_protection",
    "crop_care",
    "irrigation",
    "harvesting",
    "spray",
    "seed",
    "sow",
    "plant",
    "fertiliz",
    "harvest",
    "полив",
    "посев",
    "посад",
    "удобрен",
    "опрыск",
    "уборк",
    "уход",
  ].some((token) => merged.includes(token));
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const includeTiming = shouldIncludeTiming(request);
  const timing = createTiming();
  try {
    const body = (await request.json().catch(() => ({}))) as CreateOperationBody;
    const actorTiming: ServerActorTiming = {};
    const authStarted = Date.now();
    const actor = await getServerActorFromSession(request, { timing: actorTiming });
    timing.auth_session_ms = Date.now() - authStarted;
    timing.actor_breakdown = actorTiming;

    const contextStarted = Date.now();
    const companyId = resolveCompanyForActor(actor, toNullableText(body.companyId));
    const supabase = await getUserScopedClientFromRequest(request);
    const idempotencyKey = normalizeIdempotencyKey(request, body);
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    }
    const requestFingerprint = buildRequestFingerprint(body);
    assertCreateActorAccess(actor, companyId);
    timing.actor_company_context_ms = Date.now() - contextStarted;

    const validationStarted = Date.now();
    const fieldId = toNullableUuid(body.field_id);

    const operationType = String(body.operation_type || "").trim();
    if (!operationType) return NextResponse.json({ error: "operation_type is required" }, { status: 400 });

    const dateRaw = String(body.date || "").trim();
    if (!dateRaw) return NextResponse.json({ error: "date is required" }, { status: 400 });
    if (!isDateOnly(dateRaw)) {
      return NextResponse.json({ error: "date must use YYYY-MM-DD" }, { status: 400 });
    }
    const operationDate = dateRaw;

    const plannedArea = toNullableNumber(body.planned_area_ha);
    if (plannedArea != null && plannedArea < 0) {
      return NextResponse.json({ error: "planned_area_ha must be >= 0" }, { status: 400 });
    }
    const rowSpacingM = toNullableNumber(body.row_spacing_m);
    if (rowSpacingM != null && rowSpacingM <= 0) {
      return NextResponse.json({ error: "row_spacing_m must be > 0" }, { status: 400 });
    }
    const seedSpacingCm = toNullableNumber(body.seed_spacing_cm);
    if (seedSpacingCm != null && seedSpacingCm <= 0) {
      return NextResponse.json({ error: "seed_spacing_cm must be > 0" }, { status: 400 });
    }
    const requestedOperationParams = toPlainRecord(body.operation_params);

    let cropStructureId = toNullableUuid(body.crop_structure_id);
    const responsibleUserId = toNullableUuid(body.responsible_user_id);
    if (!responsibleUserId) {
      return NextResponse.json({ error: "responsible_user_id is required" }, { status: 400 });
    }

    const operationCategorySlug = toNullableText(body.operation_category_slug);
    const requestedTypeSlug = toNullableText(body.operation_type_slug);
    const canonicalType = resolveCanonicalOperationType({
      categorySlug: operationCategorySlug,
      typeSlug: requestedTypeSlug,
      operationType,
    });
    const operationTypeSlug = requestedTypeSlug || canonicalType?.slug || null;
    const canonicalCategorySlug = canonicalType?.categorySlug || operationCategorySlug;
    const isWholeFieldScope = requestedOperationParams.scope === "whole_field";
    const cropRequirement = getOperationCropRequirement({
      categorySlug: canonicalCategorySlug,
      typeSlug: operationTypeSlug,
    });
    const cropIndependent = cropRequirement === "crop_not_required";
    const wholeFieldAllowed = cropIndependent;
    let purposes = normalizePurposeList(body.purposes);
    let operationTemplate: string | null =
      requestedTypeSlug && requestedTypeSlug !== canonicalType?.slug ? requestedTypeSlug : null;
    let storageOperationType = operationType;
    let storageOperationTypeSlug = operationTypeSlug;
    if (canonicalCategorySlug === "spraying" && operationTypeSlug === "desiccation_treatment") {
      operationTemplate = "desiccation";
      storageOperationType = "Spraying";
      storageOperationTypeSlug = "spraying";
      purposes = Array.from(new Set([...purposes, "desiccation" as const]));
    }
    const cropStructureRequired = requiresCropStructure(canonicalCategorySlug, operationTypeSlug, operationType) && !(isWholeFieldScope && wholeFieldAllowed);
    if (cropIndependent && !fieldId) {
      return NextResponse.json({ error: "field_id is required for plowing and snow retention" }, { status: 400 });
    }
    if (cropIndependent && !isWholeFieldScope && !cropStructureId) {
      return NextResponse.json({ error: "A fallow crop_structure_id is required for structure-line scope" }, { status: 400 });
    }
    if (cropStructureRequired && !fieldId) {
      return NextResponse.json({ error: "field_id is required for production operations" }, { status: 400 });
    }
    if (cropStructureRequired && !cropStructureId) {
      return NextResponse.json(
        { error: "crop_structure_id is required for production operations" },
        { status: 400 }
      );
    }
    if (isWholeFieldScope && !wholeFieldAllowed) {
      return NextResponse.json(
        { error: "whole field scope is not allowed for the selected operation" },
        { status: 400 }
      );
    }
    let resolvedCropId = toNullableUuid(body.crop_id);
    let resolvedVarietyId: string | null = null;
    let resolvedReproductionId: string | null = null;
    let resolvedLandUseType: "crop" | "crop_mix" | "fallow" | null = null;
    let resolvedStructureArea: number | null = null;
    let resolvedSeasonId: string | null = null;
    let resolvedSeasonYear: number | null = null;
    let resolvedIrrigationType = normalizeIrrigationType(requestedOperationParams.irrigation_type as string | null | undefined);
    let resolvedRowSpacingM = rowSpacingM;
    let resolvedSeedSpacingCm = seedSpacingCm;
    let pendingStructureChangeEvent: Record<string, unknown> | null = null;
    timing.validation_ms += Date.now() - validationStarted;

    const rawMaterials = Array.isArray(body.materials) ? body.materials : [];
    const rawTankComponents = Array.isArray(body.tank_mix?.components) ? body.tank_mix?.components || [] : [];
    const operationComponents = [...rawMaterials, ...rawTankComponents].filter(
      (item, index, source) =>
        index ===
        source.findIndex(
          (candidate) =>
            String(candidate?.product_id || "") === String(item?.product_id || "") &&
            String(candidate?.component_type || candidate?.material_type || "") === String(item?.component_type || item?.material_type || "") &&
            String(candidate?.planned_rate ?? "") === String(item?.planned_rate ?? "") &&
            String(candidate?.rate_basis ?? "") === String(item?.rate_basis ?? "")
        )
    );
    if (cropIndependent && operationComponents.length > 0) {
      return NextResponse.json({ error: "Plowing and snow retention do not create material requests" }, { status: 400 });
    }
    // The structure row is authoritative for crop, fallow and crop-mix identity.
    // Always read it before mutation so a crop-mix cannot enter the single-crop fast path.
    const deferCropStructureReadForFastPath = false;

    if (cropStructureId && !deferCropStructureReadForFastPath) {
      const cropStructureStarted = Date.now();
      let { data: structureRow, error: structureError } = await supabase
        .from("crop_structure")
        .select("*,seasons:season_id(year)")
        .eq("id", cropStructureId)
        .eq("company_id", companyId)
        .maybeSingle();
      timing.crop_structure_read_ms += Date.now() - cropStructureStarted;
      if (structureError) {
        return NextResponse.json({ error: structureError.message }, { status: 400 });
      }
      if (!structureRow?.id) {
        return NextResponse.json({ error: "crop_structure_id does not belong to this company" }, { status: 400 });
      }
      if (fieldId && String((structureRow as any).field_id || "") !== fieldId) {
        return NextResponse.json({ error: "crop_structure_id must belong to selected field" }, { status: 400 });
      }
      const structureChange = body.structure_change;
      const structureChangeMode = structureChange?.mode || null;
      if (structureChangeMode && canonicalType?.slug !== "planting") {
        return NextResponse.json({ error: "Structure changes are only supported for planting operations" }, { status: 400 });
      }
      if (structureChangeMode && !structureChange?.confirmed) {
        return NextResponse.json({ error: "Structure change requires explicit confirmation" }, { status: 409 });
      }
      if (structureRow && structureChangeMode === "area_split") {
        const currentArea = Number((structureRow as any).area || 0);
        const splitArea = toNullableNumber(structureChange?.area_ha ?? plannedArea);
        const newCropId = toNullableUuid(structureChange?.new_crop_id);
        if (!newCropId || !splitArea || splitArea <= 0 || splitArea >= currentArea) {
          return NextResponse.json({ error: "Invalid area split request" }, { status: 400 });
        }
        const remainingArea = Number((currentArea - splitArea).toFixed(2));
        const newStructureId = crypto.randomUUID();
        const newStructureRow = {
          id: newStructureId,
          company_id: companyId,
          field_id: (structureRow as any).field_id,
          season_id: (structureRow as any).season_id,
          land_use_type: "crop",
          crop_id: newCropId,
          variety_id: toNullableUuid(structureChange?.new_variety_id),
          reproduction_id: toNullableUuid(structureChange?.new_reproduction_id),
          area: splitArea,
          seasons: (structureRow as any).seasons,
        };
        pendingStructureChangeEvent = {
          mode: "area_split",
          source_id: cropStructureId,
          source_before: {
            area: currentArea,
            crop_id: toNullableUuid((structureRow as any).crop_id),
            variety_id: toNullableUuid((structureRow as any).variety_id),
            reproduction_id: toNullableUuid((structureRow as any).reproduction_id),
          },
          source_after: { area: remainingArea },
          target_after: newStructureRow,
        };
        cropStructureId = newStructureId;
        structureRow = newStructureRow as any;
      } else if (structureRow && structureChangeMode === "crop_replace") {
        const currentArea = Number((structureRow as any).area || 0);
        const newCropId = toNullableUuid(structureChange?.new_crop_id);
        if (!newCropId) {
          return NextResponse.json({ error: "new_crop_id is required for crop replacement" }, { status: 400 });
        }
        const updatedStructureRow = {
          ...(structureRow as any),
          crop_id: newCropId,
          variety_id: toNullableUuid(structureChange?.new_variety_id),
          reproduction_id: toNullableUuid(structureChange?.new_reproduction_id),
        };
        pendingStructureChangeEvent = {
          mode: "crop_replace",
          source_id: cropStructureId,
          source_before: {
            area: currentArea,
            crop_id: toNullableUuid((structureRow as any).crop_id),
            variety_id: toNullableUuid((structureRow as any).variety_id),
            reproduction_id: toNullableUuid((structureRow as any).reproduction_id),
          },
          source_after: { area: currentArea },
          target_after: {
            id: cropStructureId,
            area: currentArea,
            crop_id: newCropId,
            variety_id: toNullableUuid(structureChange?.new_variety_id),
            reproduction_id: toNullableUuid(structureChange?.new_reproduction_id),
          },
        };
        structureRow = updatedStructureRow as any;
      }
      if (structureRow) {
        resolvedLandUseType =
          (structureRow as any).land_use_type === "fallow"
            ? "fallow"
            : (structureRow as any).land_use_type === "crop_mix"
              ? "crop_mix"
              : "crop";
        resolvedCropId = toNullableUuid((structureRow as any).crop_id);
        resolvedVarietyId = toNullableUuid((structureRow as any).variety_id);
        resolvedReproductionId = toNullableUuid((structureRow as any).reproduction_id);
        resolvedSeasonId = toNullableUuid((structureRow as any).season_id);
        const seasonPayload = Array.isArray((structureRow as any).seasons)
          ? (structureRow as any).seasons[0]
          : (structureRow as any).seasons;
        const seasonYear = Number(seasonPayload?.year || 0);
        resolvedSeasonYear = Number.isFinite(seasonYear) && seasonYear > 0 ? seasonYear : null;
        const structureArea = Number((structureRow as any).area || 0);
        resolvedStructureArea = Number.isFinite(structureArea) && structureArea > 0 ? structureArea : null;
        resolvedIrrigationType = normalizeIrrigationType((structureRow as any).irrigation_type || resolvedIrrigationType);
        resolvedRowSpacingM = resolvedRowSpacingM ?? toNullableNumber((structureRow as any).row_spacing_m);
        resolvedSeedSpacingCm = resolvedSeedSpacingCm ?? toNullableNumber((structureRow as any).seed_spacing_cm);
      }
    }

    if (cropIndependent && cropStructureId && resolvedLandUseType !== "fallow") {
      return NextResponse.json(
        { error: "Plowing and snow retention may target only the whole field or a fallow structure line" },
        { status: 409 }
      );
    }
    if (!cropIndependent && resolvedLandUseType === "fallow") {
      return NextResponse.json({ error: "The selected operation requires a crop structure line" }, { status: 409 });
    }
    if (!cropIndependent && cropStructureRequired && !resolvedCropId && resolvedLandUseType !== "crop_mix") {
      return NextResponse.json({ error: "The selected operation requires crop identity" }, { status: 409 });
    }

    if (
      (canonicalCategorySlug === "harvesting" || operationTypeSlug === "harvesting") &&
      resolvedLandUseType !== "crop_mix" &&
      (!resolvedCropId || !resolvedVarietyId || !resolvedReproductionId)
    ) {
      return NextResponse.json(
        {
          error:
            "Для уборки заполните культуру, сорт и репродукцию в структуре посевов",
          code: "CROP_IDENTITY_REVIEW_REQUIRED",
        },
        { status: 409 }
      );
    }

    const rawTargets = Array.isArray(body.targets) ? body.targets : [];
    const requestedTargets = rawTargets.map((target) => ({
      field_id: toNullableUuid(target?.field_id),
      crop_structure_id: toNullableUuid(target?.crop_structure_id),
      crop_id: toNullableUuid(target?.crop_id),
      variety_id: toNullableUuid(target?.variety_id),
      reproduction_id: toNullableUuid(target?.reproduction_id),
      planned_area_ha: toNullableNumber(target?.planned_area_ha),
      notes: toNullableText(target?.notes),
    }));
    if (
      requestedTargets.some(
        (target) =>
          !target.field_id ||
          !target.crop_structure_id ||
          target.planned_area_ha == null ||
          target.planned_area_ha <= 0
      )
    ) {
      return NextResponse.json(
        { error: "Each target requires an explicit field, crop structure and positive area" },
        { status: 400 }
      );
    }
    const requestedTargetIds = requestedTargets.map((target) => String(target.crop_structure_id));
    if (new Set(requestedTargetIds).size !== requestedTargetIds.length) {
      return NextResponse.json({ error: "Duplicate operation target is not allowed" }, { status: 409 });
    }
    const targetStructureIds = Array.from(
      new Set(requestedTargets.map((target) => target.crop_structure_id).filter(Boolean) as string[])
    );
    const targetStructuresById = new Map<string, any>();
    if (targetStructureIds.length > 0) {
      const targetReadStarted = Date.now();
      const { data: targetStructureRows, error: targetStructureError } = await supabase
        .from("crop_structure")
        .select("id,field_id,land_use_type,crop_id,variety_id,reproduction_id,area,season_id,seasons:season_id(year)")
        .eq("company_id", companyId)
        .in("id", targetStructureIds);
      timing.crop_structure_read_ms += Date.now() - targetReadStarted;
      if (targetStructureError) {
        return NextResponse.json({ error: targetStructureError.message }, { status: 400 });
      }
      (targetStructureRows || []).forEach((row: any) => targetStructuresById.set(String(row.id), row));
      const missingTargetId = targetStructureIds.find((id) => !targetStructuresById.has(id));
      if (missingTargetId) {
        return NextResponse.json({ error: "target crop_structure_id does not belong to this company" }, { status: 400 });
      }
    }
    const mismatchedTarget = requestedTargets.find((target) => {
      const structure = target.crop_structure_id ? targetStructuresById.get(target.crop_structure_id) : null;
      return structure?.field_id && target.field_id && String(structure.field_id) !== target.field_id;
    });
    if (mismatchedTarget) {
      return NextResponse.json({ error: "target crop_structure_id must belong to target field_id" }, { status: 400 });
    }
    const fallowTarget = requestedTargets.find((target) => {
      const structure = target.crop_structure_id ? targetStructuresById.get(target.crop_structure_id) : null;
      return structure?.land_use_type === "fallow";
    });
    if (fallowTarget && !cropIndependent) {
      return NextResponse.json({ error: "Crop operations cannot target fallow land" }, { status: 409 });
    }
    const oversizedTarget = requestedTargets.find((target) => {
      const structure = target.crop_structure_id ? targetStructuresById.get(target.crop_structure_id) : null;
      return structure && Number(target.planned_area_ha || 0) > Number(structure.area || 0) + 0.0001;
    });
    if (oversizedTarget) {
      return NextResponse.json({ error: "target planned area exceeds crop structure area" }, { status: 400 });
    }
    const normalizedTargets = requestedTargets.map((target) => {
      const structure = target.crop_structure_id ? targetStructuresById.get(target.crop_structure_id) : null;
      const area = Number(target.planned_area_ha || 0);
      return {
        field_id: structure?.field_id ? String(structure.field_id) : target.field_id,
        crop_structure_id: target.crop_structure_id,
        crop_id: structure?.crop_id ? toNullableUuid(structure.crop_id) : target.crop_id,
        variety_id: structure?.variety_id ? toNullableUuid(structure.variety_id) : target.variety_id,
        reproduction_id: structure?.reproduction_id ? toNullableUuid(structure.reproduction_id) : target.reproduction_id,
        planned_area_ha: Number(area.toFixed(4)),
        notes: target.notes || (target.crop_structure_id ? `crop_structure:${target.crop_structure_id}` : null),
      };
    });
    const targetsPlannedArea = normalizedTargets.reduce((sum, target) => sum + Number(target.planned_area_ha || 0), 0);
    const effectivePlannedArea =
      targetsPlannedArea > 0 ? Number(targetsPlannedArea.toFixed(4)) : plannedArea && plannedArea > 0 ? plannedArea : resolvedStructureArea;
    const isOrdinarySeedPlanting = canonicalCategorySlug === "planting" && resolvedLandUseType !== "crop_mix";
    if (isOrdinarySeedPlanting) {
      const rootIdentity = {
        cropId: resolvedCropId,
        varietyId: resolvedVarietyId,
        reproductionId: resolvedReproductionId,
      };
      if (!isCompleteSeedIdentity(rootIdentity)) {
        return NextResponse.json(
          { error: "Для посева или посадки в структуре должны быть указаны культура, сорт и репродукция." },
          { status: 409 }
        );
      }
      const rootKey = seedIdentityKey(rootIdentity);
      const mismatchedIdentity = normalizedTargets.some((target) => seedIdentityKey({
        cropId: target.crop_id,
        varietyId: target.variety_id,
        reproductionId: target.reproduction_id,
      }) !== rootKey);
      if (mismatchedIdentity) {
        return NextResponse.json(
          { error: "Выбранные участки имеют разные культуры, сорта или репродукции. Создайте отдельные планы." },
          { status: 409 }
        );
      }
    }

    let resolvedFieldArea: number | null = null;
    if (fieldId) {
      const { data: fieldRow, error: fieldError } = await supabase
        .from("fields")
        .select("id,area")
        .eq("id", fieldId)
        .eq("company_id", companyId)
        .eq("archived", false)
        .maybeSingle();
      if (fieldError) return NextResponse.json({ error: fieldError.message }, { status: 400 });
      if (!fieldRow?.id) return NextResponse.json({ error: "field_id does not belong to this company" }, { status: 400 });
      const fieldArea = Number(fieldRow.area || 0);
      resolvedFieldArea = Number.isFinite(fieldArea) && fieldArea > 0 ? fieldArea : null;
    }

    if (!resolvedSeasonId) {
      const requestedSeasonId = toNullableUuid(requestedOperationParams.season_id);
      let seasonQuery = supabase
        .from("seasons")
        .select("id,year,archived")
        .eq("company_id", companyId);
      seasonQuery = requestedSeasonId
        ? seasonQuery.eq("id", requestedSeasonId)
        : seasonQuery.eq("year", Number(operationDate.slice(0, 4))).order("year", { ascending: false }).limit(1);
      const { data: seasonRows, error: seasonError } = await seasonQuery;
      if (seasonError) return NextResponse.json({ error: seasonError.message }, { status: 400 });
      const seasonRow = Array.isArray(seasonRows) ? seasonRows[0] : seasonRows;
      if (!seasonRow?.id) {
        return NextResponse.json({ error: "An active season is required for a whole-field operation" }, { status: 409 });
      }
      resolvedSeasonId = String(seasonRow.id);
      resolvedSeasonYear = Number(seasonRow.year || 0) || null;
    }

    if (cropStructureId && resolvedStructureArea && effectivePlannedArea && effectivePlannedArea > resolvedStructureArea + 0.0001) {
      return NextResponse.json({ error: "planned area exceeds crop structure area" }, { status: 400 });
    }
    if (isWholeFieldScope && resolvedFieldArea && effectivePlannedArea && effectivePlannedArea > resolvedFieldArea + 0.0001) {
      return NextResponse.json({ error: "planned area exceeds field area" }, { status: 400 });
    }
    if (cropIndependent) {
      resolvedCropId = null;
      resolvedVarietyId = null;
      resolvedReproductionId = null;
    }

    const machineId = toNullableUuid(body.machine_id);
    const equipmentId = toNullableUuid(body.equipment_id);
    if (machineId) {
      const { data: machine, error: machineError } = await supabase
        .from("reference_machines")
        .select("id,type,category,machine_category,machinery_type,global_model:global_machine_model_id(category)")
        .eq("id", machineId)
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_active", true)
        .maybeSingle();
      if (machineError || !machine?.id) {
        return NextResponse.json({ error: "Selected machine is unavailable" }, { status: 400 });
      }
      if (
        !isMachineryCompatible({
          operationCategory: canonicalCategorySlug,
          operationType: operationTypeSlug,
          assetKind: "machine",
          asset: machine,
        })
      ) {
        return NextResponse.json({ error: machineryCompatibilityMessage("machine") }, { status: 409 });
      }
    }
    if (equipmentId) {
      const { data: equipmentRow, error: equipmentError } = await supabase
        .from("reference_equipment")
        .select("id,category,equipment_category,global_model:global_equipment_model_id(category,equipment_type)")
        .eq("id", equipmentId)
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_active", true)
        .maybeSingle();
      if (equipmentError || !equipmentRow?.id) {
        return NextResponse.json({ error: "Selected equipment is unavailable" }, { status: 400 });
      }
      if (
        !isMachineryCompatible({
          operationCategory: canonicalCategorySlug,
          operationType: operationTypeSlug,
          assetKind: "equipment",
          asset: equipmentRow,
        })
      ) {
        return NextResponse.json({ error: machineryCompatibilityMessage("equipment") }, { status: 409 });
      }
    }
    const isPotatoPlantingTemplate = operationTemplate === "potato_planting";
    const seedRateKgHa = toNullableNumber(body.rate_per_ha);
    if (isPotatoPlantingTemplate && (!resolvedSeedSpacingCm || resolvedSeedSpacingCm <= 0)) {
      return NextResponse.json({ error: "seed_spacing_cm is required for potato planting" }, { status: 400 });
    }
    if (isPotatoPlantingTemplate && (!seedRateKgHa || seedRateKgHa <= 0)) {
      return NextResponse.json({ error: "seed planting rate kg/ha is required for potato planting" }, { status: 400 });
    }
    const solutionRateLHa = toNullableNumber(body.tank_mix?.total_solution_l_ha ?? body.spray_volume_per_ha);
    const tankMixComponents = operationComponents.map((item) => {
      const componentType = String(item?.component_type || item?.material_type || "other").trim().toLowerCase();
      const definition = getTankMixComponentDefinition(componentType);
      const requestedUnit = String(item?.unit || "").trim().toLowerCase();
      const unit = (MATERIAL_UNITS.has(requestedUnit) ? requestedUnit : definition.defaultUnit) as OperationMaterialUnitValue;
      const plannedRate = toNullableNumber(item?.planned_rate);
      const rateBasis = normalizeMaterialRateBasis(toNullableText(item?.rate_basis));
      const requestedPlannedQuantity = toNullableNumber(item?.planned_quantity);
      const calculatedPlannedQuantity =
        requestedPlannedQuantity && requestedPlannedQuantity > 0
          ? requestedPlannedQuantity
          : plannedRate && plannedRate > 0 && effectivePlannedArea && effectivePlannedArea > 0
            ? calculateMaterialPlannedQuantity({
                rate: plannedRate,
                rateUnit: unit,
                rateBasis,
                areaHa: effectivePlannedArea,
                solutionRateLHa,
              }).plannedQuantity
            : null;
      return {
        component_type: definition.slug,
        storage_material_type: definition.storageMaterialType,
        product_id: toNullableUuid(item?.product_id),
        batch_id: toNullableUuid(item?.batch_id),
        planned_rate: plannedRate,
        actual_rate: toNullableNumber(item?.actual_rate),
        rate_basis: rateBasis,
        planned_quantity: calculatedPlannedQuantity && calculatedPlannedQuantity > 0 ? calculatedPlannedQuantity : null,
        unit,
        notes: toNullableText(item?.notes),
        crop_id: toNullableUuid(item?.crop_id),
        variety_id: toNullableUuid(item?.variety_id),
        reproduction_id: toNullableUuid(item?.reproduction_id),
        identity_label: toNullableText(item?.identity_label),
        rate_display_unit: item?.rate_display_unit === "t_ha" ? "t_ha" : "kg_ha",
        product_required: definition.productRequired,
      };
    });
    const invalidPerWaterUnit = tankMixComponents.find((item) => !isUnitAllowedForMaterialRateBasis(item.unit, item.rate_basis));
    if (invalidPerWaterUnit) {
      return NextResponse.json(
        { error: "Selected unit is not allowed for this material rate basis." },
        { status: 400 }
      );
    }
    const missingSafePlannedQuantity = tankMixComponents.find(
      (item) => item.product_id && (!item.planned_quantity || item.planned_quantity <= 0)
    );
    if (missingSafePlannedQuantity) {
      return NextResponse.json(
        {
          error:
            "Cannot safely calculate material requirement. Check rate, rate basis, area and solution rate.",
          product_id: missingSafePlannedQuantity.product_id,
          rate_basis: missingSafePlannedQuantity.rate_basis,
        },
        { status: 400 }
      );
    }
    const calculatedPlantsPerHa =
      resolvedRowSpacingM && resolvedSeedSpacingCm && resolvedRowSpacingM > 0 && resolvedSeedSpacingCm > 0
        ? Math.round(10000 / (resolvedRowSpacingM * (resolvedSeedSpacingCm / 100)))
        : null;
    const calculatedTotalPlants =
      calculatedPlantsPerHa && effectivePlannedArea && effectivePlannedArea > 0
        ? Math.round(calculatedPlantsPerHa * effectivePlannedArea)
        : null;
    const seedRateTHa = seedRateKgHa && seedRateKgHa > 0 ? seedRateKgHa / 1000 : null;
    const seedRequirementKg =
      seedRateKgHa && seedRateKgHa > 0 && effectivePlannedArea && effectivePlannedArea > 0
        ? seedRateKgHa * effectivePlannedArea
        : null;
    const seedRequirementT = seedRequirementKg && seedRequirementKg > 0 ? seedRequirementKg / 1000 : null;
    const primarySeedComponent = isOrdinarySeedPlanting
      ? tankMixComponents.find((item) => item.component_type === "seed") || null
      : null;
    if (isOrdinarySeedPlanting) {
      if (!primarySeedComponent || primarySeedComponent.product_id) {
        return NextResponse.json(
          { error: "Основной семенной материал должен автоматически браться из структуры посевов." },
          { status: 409 }
        );
      }
      if (!primarySeedComponent.planned_rate || primarySeedComponent.planned_rate <= 0) {
        return NextResponse.json({ error: "Укажите норму семенного или посадочного материала." }, { status: 400 });
      }
    }
    const canonicalSeedRateKgHa = isOrdinarySeedPlanting ? Number(primarySeedComponent?.planned_rate || 0) : seedRateKgHa;
    const canonicalSeedRequirementKg = isOrdinarySeedPlanting
      ? calculateSeedRequirementKg(effectivePlannedArea, canonicalSeedRateKgHa, "kg_ha")
      : seedRequirementKg;

    const operationConfig = {
      operation_engine_type: canonicalType?.slug || operationTypeSlug || null,
      operation_engine_label: canonicalType?.label || operationType,
      operation_template: operationTemplate,
      operation_params: {
        ...requestedOperationParams,
        scope: isWholeFieldScope ? "whole_field" : "structure_line",
        target_scope: isWholeFieldScope ? "field" : "structure_line",
        crop_requirement: cropRequirement,
        land_use_type: resolvedLandUseType,
        season_id: resolvedSeasonId,
        irrigation_type: resolvedIrrigationType,
        row_spacing_m: resolvedRowSpacingM,
        seed_spacing_cm: resolvedSeedSpacingCm,
        seed_rate_kg_ha: isOrdinarySeedPlanting ? canonicalSeedRateKgHa : isPotatoPlantingTemplate ? seedRateKgHa : requestedOperationParams.seed_rate_kg_ha,
        seed_rate_t_ha: isOrdinarySeedPlanting ? Number(canonicalSeedRateKgHa || 0) / 1000 : isPotatoPlantingTemplate ? seedRateTHa : requestedOperationParams.seed_rate_t_ha,
        seed_rate_display_unit: isOrdinarySeedPlanting ? primarySeedComponent?.rate_display_unit : requestedOperationParams.seed_rate_display_unit,
        seed_requirement_kg: isOrdinarySeedPlanting ? canonicalSeedRequirementKg : isPotatoPlantingTemplate ? seedRequirementKg : requestedOperationParams.seed_requirement_kg,
        seed_requirement_t: isOrdinarySeedPlanting && canonicalSeedRequirementKg ? canonicalSeedRequirementKg / 1000 : isPotatoPlantingTemplate ? seedRequirementT : requestedOperationParams.seed_requirement_t,
        calculated_plants_per_ha: calculatedPlantsPerHa,
        calculated_total_plants: calculatedTotalPlants,
        calculated_tubers_per_ha: isPotatoPlantingTemplate ? calculatedPlantsPerHa : requestedOperationParams.calculated_tubers_per_ha,
        calculated_total_tubers: isPotatoPlantingTemplate ? calculatedTotalPlants : requestedOperationParams.calculated_total_tubers,
        expected_density_plants_per_ha: isPotatoPlantingTemplate ? calculatedPlantsPerHa : requestedOperationParams.expected_density_plants_per_ha,
        seed_material_context: isOrdinarySeedPlanting
          ? {
              crop_id: resolvedCropId,
              variety_id: resolvedVarietyId,
              reproduction_id: resolvedReproductionId,
              area_ha: effectivePlannedArea,
            }
          : requestedOperationParams.seed_material_context,
      },
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      purposes,
      tank_mix: {
        enabled: Boolean(body.tank_mix?.enabled || canonicalType?.supportsTankMix),
        water_rate_l_ha: toNullableNumber(body.tank_mix?.water_rate_l_ha),
        total_solution_l_ha: solutionRateLHa,
        components: tankMixComponents,
      },
      warehouse_workflow: buildWarehouseWorkflowMetadata(),
      execution_fact_model: buildExecutionFactModelMetadata(),
      planned_area_ha: effectivePlannedArea,
      targets: normalizedTargets.length > 0 ? normalizedTargets : undefined,
      target_count: normalizedTargets.length > 0 ? normalizedTargets.length : undefined,
      crop_id: resolvedCropId,
      variety_id: resolvedVarietyId,
      reproduction_id: resolvedReproductionId,
      season_id: resolvedSeasonId,
      season_year: resolvedSeasonYear,
    };

    const cropMixOperationType =
      resolvedLandUseType === "crop_mix" && canonicalCategorySlug === "planting"
        ? "Посев зерносмеси"
        : resolvedLandUseType === "crop_mix" && canonicalCategorySlug === "harvesting"
          ? "Уборка зерносмеси"
          : storageOperationType;

    const operationPayload = {
      company_id: companyId,
      field_id: fieldId,
      crop_structure_id: cropStructureId,
      operation_category_slug: canonicalCategorySlug,
      operation_type_slug: storageOperationTypeSlug,
      operation_type: cropMixOperationType,
      machine_id: machineId,
      equipment_id: equipmentId,
      transport_id: toNullableUuid(body.transport_id),
      operation_target: toNullableText(body.operation_target),
      rate_per_ha: toNullableNumber(body.rate_per_ha),
      spray_volume_per_ha: toNullableNumber(body.spray_volume_per_ha),
      operation_config: operationConfig,
      date: operationDate,
      responsible_user_id: responsibleUserId,
      notes: toNullableText(body.notes),
      status: "planned",
      work_status: "active",
      user_id: actor.authUserId,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      ...(requestFingerprint ? { request_fingerprint: requestFingerprint } : {}),
    };

    await assertSeasonWritableForMutation(supabase, {
      companyId,
      seasonId: resolvedSeasonId,
      actionLabel: "Создание операции",
    });
    let resolvedExecutionArea = effectivePlannedArea ?? plannedArea ?? resolvedStructureArea;
    if (
      allowsDefaultOperationLine(canonicalCategorySlug, operationTypeSlug, operationType) &&
      (!resolvedExecutionArea || resolvedExecutionArea <= 0) &&
      fieldId
    ) {
      const { data: fieldRow, error: fieldError } = await supabase
        .from("fields")
        .select("area")
        .eq("id", fieldId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (fieldError) return NextResponse.json({ error: fieldError.message }, { status: 400 });
      const fieldArea = Number((fieldRow as any)?.area || 0);
      resolvedExecutionArea = Number.isFinite(fieldArea) && fieldArea > 0 ? fieldArea : null;
    }

    const materialRows = tankMixComponents
      .map((item) => {
        const componentType = String(item.component_type || "other").trim().toLowerCase();
        const materialType = toStorageMaterialType(item.storage_material_type || componentType);
        const productId = item.product_id;
        if (!MATERIAL_TYPES.has(materialType) || !productId) return null;
        const storage = normalizeOperationMaterialStorage(item.planned_quantity, item.unit);
        const materialNotes = [
          item.notes,
          item.rate_basis ? `rate_basis:${item.rate_basis}` : null,
          storage.rateUnit ? `rate_unit:${storage.rateUnit}` : null,
        ]
          .filter(Boolean)
          .join("; ");
        return {
          operation_line_id: null,
          product_id: productId,
          batch_id: item.batch_id,
          material_type: materialType,
          unit: storage.unit,
          planned_rate: item.planned_rate,
          actual_rate: item.actual_rate,
          planned_quantity: storage.quantity,
          notes: materialNotes || `component:${componentType}`,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;
    if (isOrdinarySeedPlanting && primarySeedComponent && canonicalSeedRequirementKg) {
      materialRows.unshift({
        operation_line_id: null,
        product_id: null,
        batch_id: null,
        material_type: "seed",
        unit: "kg",
        planned_rate: canonicalSeedRateKgHa,
        actual_rate: null,
        planned_quantity: canonicalSeedRequirementKg,
        crop_id: resolvedCropId,
        variety_id: resolvedVarietyId,
        reproduction_id: resolvedReproductionId,
        identity_label: primarySeedComponent.identity_label,
        notes: `rate_display_unit:${primarySeedComponent.rate_display_unit}`,
      });
    }

    const lineRows = normalizedTargets.length > 0
      ? normalizedTargets.map((target) => ({
        field_id: target.field_id,
        crop_id: target.crop_id,
        variety_id: target.variety_id,
        reproduction_id: target.reproduction_id,
        planned_area_ha: target.planned_area_ha,
        actual_area_ha: null,
        row_spacing_m: resolvedRowSpacingM,
        seed_spacing_cm: resolvedSeedSpacingCm,
        calculated_plants_per_ha: calculatedPlantsPerHa,
        calculated_total_plants:
          calculatedPlantsPerHa && target.planned_area_ha > 0 ? Math.round(calculatedPlantsPerHa * target.planned_area_ha) : null,
        notes: [target.notes, target.crop_structure_id ? `crop_structure:${target.crop_structure_id}` : null, "Multi-target operation line"]
          .filter(Boolean)
          .join("; "),
      }))
      : allowsDefaultOperationLine(canonicalCategorySlug, operationTypeSlug, operationType)
        ? [{
          field_id: fieldId,
          crop_id: resolvedCropId,
          variety_id: resolvedVarietyId,
          reproduction_id: resolvedReproductionId,
          planned_area_ha: resolvedExecutionArea,
          actual_area_ha: null,
          row_spacing_m: resolvedRowSpacingM,
          seed_spacing_cm: resolvedSeedSpacingCm,
          calculated_plants_per_ha: calculatedPlantsPerHa,
          calculated_total_plants: calculatedTotalPlants,
          notes: cropStructureId ? "Auto-created from operation crop structure" : "Auto-created from operation",
        }]
        : [];

    if (lineRows.some((line) => !line.planned_area_ha || Number(line.planned_area_ha) <= 0)) {
      return NextResponse.json({ error: "A positive planned area is required for every operation line" }, { status: 400 });
    }

    const mutationStarted = Date.now();
    const isCropMixPlanting = resolvedLandUseType === "crop_mix" && canonicalCategorySlug === "planting";
    const mutation = isCropMixPlanting
      ? await supabase.rpc("create_crop_mix_operation_plan_atomic_v1", {
          p_company_id: companyId,
          p_actor_profile_id: actor.id,
          p_operation: {
            ...operationPayload,
            planned_area_ha: resolvedExecutionArea,
            crop_id: null,
            variety_id: null,
            reproduction_id: null,
          },
          p_idempotency_key: idempotencyKey,
          p_request_fingerprint: requestFingerprint,
        })
      : isOrdinarySeedPlanting
        ? await supabase.rpc("create_seed_planting_operation_plan_atomic_v1", {
            p_company_id: companyId,
            p_actor_profile_id: actor.id,
            p_operation: {
              ...operationPayload,
              crop_id: resolvedCropId,
              variety_id: resolvedVarietyId,
              reproduction_id: resolvedReproductionId,
            },
            p_lines: lineRows,
            p_materials: materialRows,
            p_structure_change: pendingStructureChangeEvent || {},
            p_idempotency_key: idempotencyKey,
            p_request_fingerprint: requestFingerprint,
          })
        : await supabase.rpc("create_operation_plan_atomic_v12", {
          p_company_id: companyId,
          p_actor_profile_id: actor.id,
          p_operation: {
            ...operationPayload,
            crop_id: resolvedCropId,
            variety_id: resolvedVarietyId,
            reproduction_id: resolvedReproductionId,
          },
          p_lines: lineRows,
          p_materials: materialRows,
          p_structure_change: pendingStructureChangeEvent || {},
          p_idempotency_key: idempotencyKey,
          p_request_fingerprint: requestFingerprint,
        });
    const { data: mutationResult, error: mutationError } = mutation;
    timing.operation_insert_ms += Date.now() - mutationStarted;

    if (mutationError || !mutationResult) {
      const code = String((mutationError as any)?.code || "");
      const status = code === "42501" ? 403 : code === "23505" || code === "40001" ? 409 : 400;
      return NextResponse.json(
        withTiming(
          { error: mutationError?.message || "Operation plan was not created" },
          timing,
          includeTiming,
          startedAt
        ),
        { status }
      );
    }

    const response = mutationResult as Record<string, unknown>;
    return NextResponse.json(withTiming(response, timing, includeTiming, startedAt));
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SeasonGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
