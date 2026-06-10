import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServiceClient } from "@/lib/supabase/service";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
  type ServerActorContext,
  type ServerActorTiming,
} from "@/lib/auth/server-session";
import { ensureMaterialRequestForOperation } from "@/app/api/operations/_material-request-helper";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import {
  buildExecutionFactModelMetadata,
  buildWarehouseWorkflowMetadata,
  getTankMixComponentDefinition,
  normalizeIrrigationType,
  normalizePurposeList,
  resolveCanonicalOperationType,
  toStorageMaterialType,
} from "@/lib/operations/operation-engine";

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
    components?: Array<{
      component_type?: string | null;
      material_type?: string | null;
      product_id?: string | null;
      batch_id?: string | null;
      planned_rate?: number | null;
      actual_rate?: number | null;
      unit?: string | null;
      notes?: string | null;
    }>;
  } | null;
  structure_change?: {
    mode?: "area_split" | "crop_replace" | null;
    confirmed?: boolean | null;
    new_crop_id?: string | null;
    new_variety_id?: string | null;
    new_reproduction_id?: string | null;
    area_ha?: number | null;
  } | null;
  materials?: Array<{
    component_type?: string | null;
    material_type?: string | null;
    product_id?: string | null;
    batch_id?: string | null;
    planned_rate?: number | null;
    actual_rate?: number | null;
    unit?: string | null;
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

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return message.includes(columnName.toLowerCase()) && (message.includes("column") || message.includes("schema cache"));
}

function isDuplicateKeyError(error: unknown): boolean {
  const code = String((error as any)?.code || "");
  const message = String((error as any)?.message || "").toLowerCase();
  return code === "23505" || message.includes("duplicate key") || message.includes("unique constraint");
}

function isMissingFunctionError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return message.includes("create_operation_plan_fast_v1") && (message.includes("schema cache") || message.includes("not found"));
}

function getOperationFingerprint(row: any): string | null {
  const fromColumn = String(row?.request_fingerprint || "").trim();
  if (fromColumn) return fromColumn;
  const config = row?.operation_config && typeof row.operation_config === "object" ? row.operation_config : {};
  const fromConfig = String((config as any).request_fingerprint || "").trim();
  return fromConfig || null;
}

async function findOperationByIdempotencyKey(params: {
  supabase: ReturnType<typeof getServiceClient>;
  companyId: string;
  key: string;
}) {
  const { supabase, companyId, key } = params;
  const columnResult = await supabase
    .from("operations")
    .select("*")
    .eq("company_id", companyId)
    .eq("idempotency_key", key)
    .maybeSingle();

  if (!columnResult.error) return columnResult.data || null;
  if (!isMissingColumnError(columnResult.error, "idempotency_key")) throw columnResult.error;

  const jsonResult = await supabase
    .from("operations")
    .select("*")
    .eq("company_id", companyId)
    .contains("operation_config", { idempotency_key: key })
    .order("created_at", { ascending: false })
    .limit(1);

  if (jsonResult.error) throw jsonResult.error;
  return (jsonResult.data || [])[0] || null;
}

async function rollbackStructureChange(params: {
  supabase: ReturnType<typeof getServiceClient>;
  companyId: string;
  event: Record<string, unknown> | null;
}) {
  const { supabase, companyId, event } = params;
  if (!event) return;
  const changeType = String(event.change_type || "");
  const sourceId = toNullableUuid(event.source_crop_structure_id);
  const newId = toNullableUuid(event.new_crop_structure_id);
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};

  if (changeType === "area_split" && sourceId) {
    await supabase
      .from("crop_structure")
      .update({ area: toNullableNumber(event.old_area_ha) })
      .eq("id", sourceId)
      .eq("company_id", companyId);
    if (newId && newId !== sourceId) {
      await supabase.from("crop_structure").delete().eq("id", newId).eq("company_id", companyId);
    }
  }

  if (changeType === "crop_replace" && sourceId) {
    await supabase
      .from("crop_structure")
      .update({
        crop_id: toNullableUuid(event.old_crop_id),
        variety_id: toNullableUuid(payload.old_variety_id),
        reproduction_id: toNullableUuid(payload.old_reproduction_id),
      })
      .eq("id", sourceId)
      .eq("company_id", companyId);
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

function normalizeDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
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

const MATERIAL_UNITS = new Set(["kg", "l", "pcs"]);

function inferUnitByMaterialType(materialType: string): "kg" | "l" | "pcs" {
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

function allowsDefaultOperationLine(categorySlug: string | null, typeSlug: string | null, operationType: string): boolean {
  const canonical = resolveCanonicalOperationType({ categorySlug, typeSlug, operationType });
  if (canonical?.requiresCropStructure) return true;
  const category = String(categorySlug || "").trim().toLowerCase();
  const merged = `${category} ${String(typeSlug || "").toLowerCase()} ${operationType.toLowerCase()}`;
  return ["seed", "sow", "plant", "harvest", "\u043f\u043e\u0441\u0435\u0432", "\u043f\u043e\u0441\u0430\u0434", "\u0443\u0431\u043e\u0440\u043a"].some((token) => merged.includes(token));
}

function requiresCropStructure(categorySlug: string | null, typeSlug: string | null, operationType: string): boolean {
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
    const supabase = getServiceClient();
    const idempotencyKey = normalizeIdempotencyKey(request, body);
    const requestFingerprint = idempotencyKey ? buildRequestFingerprint(body) : null;
    assertCreateActorAccess(actor, companyId);
    timing.actor_company_context_ms = Date.now() - contextStarted;

    if (idempotencyKey && requestFingerprint && body.structure_change?.mode) {
      const idempotencyStarted = Date.now();
      const existing = await findOperationByIdempotencyKey({ supabase, companyId, key: idempotencyKey });
      timing.idempotency_lookup_ms += Date.now() - idempotencyStarted;
      if (existing?.id) {
        const existingFingerprint = getOperationFingerprint(existing);
        if (existingFingerprint && existingFingerprint !== requestFingerprint) {
          return NextResponse.json(
            withTiming(
              { error: "Idempotency-Key was already used with a different operation payload" },
              timing,
              includeTiming,
              startedAt
            ),
            { status: 409 }
          );
        }
        return NextResponse.json(
          withTiming(
            {
              operation: existing,
              operation_line: null,
              material_request: { created: false, skipped_reason: "idempotent_replay" },
              idempotent_replay: true,
            },
            timing,
            includeTiming,
            startedAt
          )
        );
      }
    }

    const validationStarted = Date.now();
    const fieldId = toNullableUuid(body.field_id);

    const operationType = String(body.operation_type || "").trim();
    if (!operationType) return NextResponse.json({ error: "operation_type is required" }, { status: 400 });

    const dateRaw = String(body.date || "").trim();
    if (!dateRaw) return NextResponse.json({ error: "date is required" }, { status: 400 });
    const operationDate = normalizeDate(dateRaw);

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

    const operationCategorySlug = toNullableText(body.operation_category_slug);
    const requestedTypeSlug = toNullableText(body.operation_type_slug);
    const canonicalType = resolveCanonicalOperationType({
      categorySlug: operationCategorySlug,
      typeSlug: requestedTypeSlug,
      operationType,
    });
    const operationTypeSlug = requestedTypeSlug || canonicalType?.slug || null;
    const canonicalCategorySlug = canonicalType?.categorySlug || operationCategorySlug;
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
    const cropStructureRequired = requiresCropStructure(canonicalCategorySlug, operationTypeSlug, operationType);
    if (cropStructureRequired && !fieldId) {
      return NextResponse.json({ error: "field_id is required for production operations" }, { status: 400 });
    }
    if (cropStructureRequired && !cropStructureId) {
      return NextResponse.json(
        { error: "crop_structure_id is required for production operations" },
        { status: 400 }
      );
    }

    let resolvedCropId = toNullableUuid(body.crop_id);
    let resolvedVarietyId: string | null = null;
    let resolvedReproductionId: string | null = null;
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
            String(candidate?.planned_rate ?? "") === String(item?.planned_rate ?? "")
        )
    );
    const deferCropStructureReadForFastPath =
      Boolean(cropStructureId && fieldId) &&
      !body.structure_change?.mode &&
      operationComponents.length === 0 &&
      !rowSpacingM &&
      !seedSpacingCm &&
      operationTemplate !== "potato_planting" &&
      allowsDefaultOperationLine(canonicalCategorySlug, operationTypeSlug, operationType);

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
        const { error: updateSourceError } = await supabase
          .from("crop_structure")
          .update({ area: remainingArea })
          .eq("id", cropStructureId)
          .eq("company_id", companyId);
        if (updateSourceError) {
          return NextResponse.json({ error: updateSourceError.message }, { status: 400 });
        }
        const { data: newStructureRow, error: insertStructureError } = await supabase
          .from("crop_structure")
          .insert({
            company_id: companyId,
            field_id: (structureRow as any).field_id,
            season_id: (structureRow as any).season_id,
            crop_id: newCropId,
            variety_id: toNullableUuid(structureChange?.new_variety_id),
            reproduction_id: toNullableUuid(structureChange?.new_reproduction_id),
            area: splitArea,
            status: "planned",
            notes: "Created from operation area split",
            archived: false,
            user_id: actor.authUserId,
          })
          .select("id,field_id,crop_id,variety_id,reproduction_id,area,season_id,seasons:season_id(year)")
          .single();
        if (insertStructureError || !newStructureRow?.id) {
          await supabase
            .from("crop_structure")
            .update({ area: currentArea })
            .eq("id", cropStructureId)
            .eq("company_id", companyId);
          return NextResponse.json({ error: insertStructureError?.message || "Failed to create split crop plan" }, { status: 400 });
        }
        pendingStructureChangeEvent = {
          company_id: companyId,
          field_id: (structureRow as any).field_id,
          season_id: (structureRow as any).season_id,
          source_crop_structure_id: cropStructureId,
          new_crop_structure_id: String((newStructureRow as any).id),
          change_type: "area_split",
          old_crop_id: toNullableUuid((structureRow as any).crop_id),
          new_crop_id: newCropId,
          old_area_ha: currentArea,
          new_area_ha: splitArea,
          payload: {
            remaining_area_ha: remainingArea,
            old_variety_id: toNullableUuid((structureRow as any).variety_id),
            old_reproduction_id: toNullableUuid((structureRow as any).reproduction_id),
          },
          created_by_user_id: actor.authUserId,
        };
        cropStructureId = String((newStructureRow as any).id);
        structureRow = newStructureRow as any;
      } else if (structureRow && structureChangeMode === "crop_replace") {
        const currentArea = Number((structureRow as any).area || 0);
        const newCropId = toNullableUuid(structureChange?.new_crop_id);
        if (!newCropId) {
          return NextResponse.json({ error: "new_crop_id is required for crop replacement" }, { status: 400 });
        }
        const { data: updatedStructureRow, error: updateStructureError } = await supabase
          .from("crop_structure")
          .update({
            crop_id: newCropId,
            variety_id: toNullableUuid(structureChange?.new_variety_id),
            reproduction_id: toNullableUuid(structureChange?.new_reproduction_id),
          })
          .eq("id", cropStructureId)
          .eq("company_id", companyId)
          .select("id,field_id,crop_id,variety_id,reproduction_id,area,season_id,seasons:season_id(year)")
          .single();
        if (updateStructureError || !updatedStructureRow?.id) {
          return NextResponse.json({ error: updateStructureError?.message || "Failed to replace crop plan" }, { status: 400 });
        }
        pendingStructureChangeEvent = {
          company_id: companyId,
          field_id: (structureRow as any).field_id,
          season_id: (structureRow as any).season_id,
          source_crop_structure_id: cropStructureId,
          new_crop_structure_id: cropStructureId,
          change_type: "crop_replace",
          old_crop_id: toNullableUuid((structureRow as any).crop_id),
          new_crop_id: newCropId,
          old_area_ha: currentArea,
          new_area_ha: currentArea,
          payload: {
            old_variety_id: toNullableUuid((structureRow as any).variety_id),
            old_reproduction_id: toNullableUuid((structureRow as any).reproduction_id),
          },
          created_by_user_id: actor.authUserId,
        };
        structureRow = updatedStructureRow as any;
      }
      if (structureRow) {
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

    const effectivePlannedArea = plannedArea && plannedArea > 0 ? plannedArea : resolvedStructureArea;
    if (operationTemplate === "potato_planting" && (!resolvedSeedSpacingCm || resolvedSeedSpacingCm <= 0)) {
      return NextResponse.json({ error: "seed_spacing_cm is required for potato planting" }, { status: 400 });
    }
    const productIds = Array.from(
      new Set(operationComponents.map((item) => toNullableUuid(item?.product_id)).filter(Boolean) as string[])
    );
    if (productIds.length > 0) {
      const { data: warehouseRows, error: warehouseError } = await supabase
        .from("warehouses")
        .select("id,name,warehouse_type,description,archived,is_archived")
        .eq("company_id", companyId)
        .eq("archived", false)
        .eq("is_archived", false);
      if (warehouseError) {
        return NextResponse.json({ error: warehouseError.message }, { status: 400 });
      }
      const productionWarehouseIds = (warehouseRows || [])
        .filter((row: any) => !hasQaDataMarker(`${row.name || ""} ${row.warehouse_type || ""} ${row.description || ""}`))
        .map((row: any) => String(row.id || ""))
        .filter(Boolean);
      if (productionWarehouseIds.length === 0) {
        return NextResponse.json(
          { error: "Нет остатка на складе для выбранного материала" },
          { status: 400 }
        );
      }
      const { data: stockRows, error: stockError } = await supabase
        .from("v_stock_balance_identity")
        .select("warehouse_id,product_id,quantity")
        .eq("company_id", companyId)
        .in("warehouse_id", productionWarehouseIds)
        .in("product_id", productIds)
        .gt("quantity", 0);
      if (stockError) {
        return NextResponse.json({ error: stockError.message }, { status: 400 });
      }
      const availableProducts = new Set((stockRows || []).map((row: any) => String(row.product_id || "")));
      const missingProductId = productIds.find((productId) => !availableProducts.has(productId));
      if (missingProductId) {
        return NextResponse.json(
          { error: "Нет остатка на складе для выбранного материала", product_id: missingProductId },
          { status: 400 }
        );
      }
    }

    const tankMixComponents = operationComponents.map((item) => {
      const componentType = String(item?.component_type || item?.material_type || "other").trim().toLowerCase();
      const definition = getTankMixComponentDefinition(componentType);
      const requestedUnit = String(item?.unit || "").trim().toLowerCase();
      const unit = (MATERIAL_UNITS.has(requestedUnit) ? requestedUnit : definition.defaultUnit) as "kg" | "l" | "pcs";
      return {
        component_type: definition.slug,
        storage_material_type: definition.storageMaterialType,
        product_id: toNullableUuid(item?.product_id),
        batch_id: toNullableUuid(item?.batch_id),
        planned_rate: toNullableNumber(item?.planned_rate),
        actual_rate: toNullableNumber(item?.actual_rate),
        unit,
        notes: toNullableText(item?.notes),
        product_required: definition.productRequired,
      };
    });
    const calculatedPlantsPerHa =
      resolvedRowSpacingM && resolvedSeedSpacingCm && resolvedRowSpacingM > 0 && resolvedSeedSpacingCm > 0
        ? Math.round(10000 / (resolvedRowSpacingM * (resolvedSeedSpacingCm / 100)))
        : null;
    const calculatedTotalPlants =
      calculatedPlantsPerHa && effectivePlannedArea && effectivePlannedArea > 0
        ? Math.round(calculatedPlantsPerHa * effectivePlannedArea)
        : null;

    const operationConfig = {
      operation_engine_type: canonicalType?.slug || operationTypeSlug || null,
      operation_engine_label: canonicalType?.label || operationType,
      operation_template: operationTemplate,
      operation_params: {
        ...requestedOperationParams,
        irrigation_type: resolvedIrrigationType,
        row_spacing_m: resolvedRowSpacingM,
        seed_spacing_cm: resolvedSeedSpacingCm,
        calculated_plants_per_ha: calculatedPlantsPerHa,
        calculated_total_plants: calculatedTotalPlants,
      },
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      purposes,
      tank_mix: {
        enabled: Boolean(body.tank_mix?.enabled || canonicalType?.supportsTankMix),
        water_rate_l_ha: toNullableNumber(body.tank_mix?.water_rate_l_ha),
        total_solution_l_ha: toNullableNumber(body.tank_mix?.total_solution_l_ha ?? body.spray_volume_per_ha),
        components: tankMixComponents,
      },
      warehouse_workflow: buildWarehouseWorkflowMetadata(),
      execution_fact_model: buildExecutionFactModelMetadata(),
      planned_area_ha: effectivePlannedArea,
      crop_id: resolvedCropId,
      variety_id: resolvedVarietyId,
      reproduction_id: resolvedReproductionId,
      season_id: resolvedSeasonId,
      season_year: resolvedSeasonYear,
    };

    const operationPayload = {
      company_id: companyId,
      field_id: fieldId,
      crop_structure_id: cropStructureId,
      operation_category_slug: canonicalCategorySlug,
      operation_type_slug: storageOperationTypeSlug,
      operation_type: storageOperationType,
      machine_id: toNullableUuid(body.machine_id),
      equipment_id: toNullableUuid(body.equipment_id),
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

    const canUseFastPlanCreate =
      Boolean(cropStructureId && fieldId) &&
      !pendingStructureChangeEvent &&
      operationComponents.length === 0 &&
      !resolvedRowSpacingM &&
      !resolvedSeedSpacingCm &&
      operationTemplate !== "potato_planting" &&
      allowsDefaultOperationLine(canonicalCategorySlug, operationTypeSlug, operationType);

    if (canUseFastPlanCreate) {
      const fastPathStarted = Date.now();
      const { data: fastRows, error: fastError } = await supabase.rpc("create_operation_plan_fast_v1", {
        p_company_id: companyId,
        p_field_id: fieldId,
        p_crop_structure_id: cropStructureId,
        p_operation_category_slug: canonicalCategorySlug,
        p_operation_type_slug: storageOperationTypeSlug,
        p_operation_type: storageOperationType,
        p_operation_config: operationConfig,
        p_operation_date: operationDate,
        p_responsible_user_id: responsibleUserId,
        p_notes: toNullableText(body.notes),
        p_user_id: actor.authUserId,
        p_idempotency_key: idempotencyKey,
        p_request_fingerprint: requestFingerprint,
        p_planned_area_ha: effectivePlannedArea ?? plannedArea,
      });
      const fastPathMs = Date.now() - fastPathStarted;
      timing.fast_path_ms = fastPathMs;
      timing.operation_insert_ms += fastPathMs;

      if (!fastError && Array.isArray(fastRows) && fastRows[0]?.operation_row) {
        const fastRow = fastRows[0] as any;
        const operationRow = fastRow.operation_row as Record<string, unknown>;
        const lineRow = (fastRow.operation_line_row || null) as Record<string, unknown> | null;
        return NextResponse.json(
          withTiming(
            {
              operation: {
                ...operationRow,
                planned_area_ha: lineRow?.planned_area_ha ?? effectivePlannedArea ?? plannedArea,
                crop_id: lineRow?.crop_id ?? resolvedCropId,
              },
              operation_line: lineRow,
              operation_line_warning: null,
              material_request: { created: false, skipped_reason: "no_planned_materials" },
              idempotent_replay: Boolean(fastRow.idempotent_replay),
            },
            timing,
            includeTiming,
            startedAt
          )
        );
      }

      if (fastError && String(fastError.message || "").includes("different operation payload")) {
        return NextResponse.json(
          withTiming(
            { error: "Idempotency-Key was already used with a different operation payload" },
            timing,
            includeTiming,
            startedAt
          ),
          { status: 409 }
        );
      }

      if (fastError && !isMissingFunctionError(fastError)) {
        return NextResponse.json(
          withTiming({ error: fastError.message || "Failed to create operation" }, timing, includeTiming, startedAt),
          { status: 400 }
        );
      }
    }

    const operationInsertStarted = Date.now();
    let { data: operationRow, error: operationError } = await supabase
      .from("operations")
      .insert(operationPayload)
      .select("*")
      .single();
    timing.operation_insert_ms += Date.now() - operationInsertStarted;

    if (operationError && isMissingColumnError(operationError, "idempotency_key")) {
      const { idempotency_key: _key, request_fingerprint: _fingerprint, ...fallbackPayload } = operationPayload as any;
      const fallbackInsertStarted = Date.now();
      const retryResult = await supabase
        .from("operations")
        .insert(fallbackPayload)
        .select("*")
        .single();
      timing.operation_insert_ms += Date.now() - fallbackInsertStarted;
      operationRow = retryResult.data;
      operationError = retryResult.error;
    }

    if (operationError && idempotencyKey && requestFingerprint && isDuplicateKeyError(operationError)) {
      const idempotencyStarted = Date.now();
      const existing = await findOperationByIdempotencyKey({ supabase, companyId, key: idempotencyKey });
      timing.idempotency_lookup_ms += Date.now() - idempotencyStarted;
      if (existing?.id) {
        const existingFingerprint = getOperationFingerprint(existing);
        if (existingFingerprint && existingFingerprint !== requestFingerprint) {
          return NextResponse.json(
            withTiming(
              { error: "Idempotency-Key was already used with a different operation payload" },
              timing,
              includeTiming,
              startedAt
            ),
            { status: 409 }
          );
        }
        return NextResponse.json(
          withTiming(
            {
              operation: existing,
              operation_line: null,
              material_request: { created: false, skipped_reason: "idempotent_replay" },
              idempotent_replay: true,
            },
            timing,
            includeTiming,
            startedAt
          )
        );
      }
    }

    if (operationError || !operationRow?.id) {
      await rollbackStructureChange({ supabase, companyId, event: pendingStructureChangeEvent });
      return NextResponse.json({ error: operationError?.message || "Failed to create operation" }, { status: 400 });
    }

    if (pendingStructureChangeEvent) {
      const childRowsStarted = Date.now();
      await supabase.from("crop_structure_change_events").insert({
        ...pendingStructureChangeEvent,
        operation_id: String(operationRow.id),
      });
      timing.child_rows_insert_ms += Date.now() - childRowsStarted;
    }

    const materialRows = operationComponents
      .map((item) => {
        const componentType = String(item?.component_type || item?.material_type || "other").trim().toLowerCase();
        const materialType = toStorageMaterialType(componentType);
        const productId = toNullableUuid(item?.product_id);
        if (!MATERIAL_TYPES.has(materialType) || !productId) return null;
        const requestedUnit = String(item?.unit || "").trim().toLowerCase();
        const unit = (MATERIAL_UNITS.has(requestedUnit) ? requestedUnit : inferUnitByMaterialType(materialType)) as "kg" | "l" | "pcs";
        const plannedRate = toNullableNumber(item?.planned_rate);
        const actualRate = toNullableNumber(item?.actual_rate);
        return {
          company_id: companyId,
          operation_id: String(operationRow.id),
          operation_line_id: null,
          product_id: productId,
          batch_id: toNullableUuid(item?.batch_id),
          material_type: materialType,
          unit,
          planned_rate: plannedRate,
          actual_rate: actualRate,
          notes: toNullableText(item?.notes) || `component:${componentType}`,
          created_by_user_id: actor.authUserId,
          updated_by_user_id: actor.authUserId,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (materialRows.length > 0) {
      const childRowsStarted = Date.now();
      const { error: materialInsertError } = await supabase.from("operation_materials").insert(materialRows);
      timing.child_rows_insert_ms += Date.now() - childRowsStarted;
      if (materialInsertError) {
        await supabase.from("operations").delete().eq("id", operationRow.id).eq("company_id", companyId);
        await rollbackStructureChange({ supabase, companyId, event: pendingStructureChangeEvent });
        return NextResponse.json({ error: materialInsertError.message || "Failed to save operation materials" }, { status: 400 });
      }
    }

    let defaultOperationLine: Record<string, unknown> | null = null;
    let operationLineWarning: string | null = null;
    if (allowsDefaultOperationLine(canonicalCategorySlug, operationTypeSlug, operationType)) {
      let effectiveArea = plannedArea && plannedArea > 0 ? plannedArea : resolvedStructureArea;
      if (!effectiveArea) {
        const { data: fieldRow } = await supabase
          .from("fields")
          .select("area")
          .eq("id", fieldId)
          .eq("company_id", companyId)
          .maybeSingle();
        const fieldArea = Number((fieldRow as any)?.area || 0);
        effectiveArea = Number.isFinite(fieldArea) && fieldArea > 0 ? fieldArea : 0;
      }

      const childRowsStarted = Date.now();
      const { data: lineRow, error: lineError } = await supabase
        .from("operation_lines")
        .insert({
          company_id: companyId,
          operation_id: String(operationRow.id),
          field_id: fieldId,
          crop_id: resolvedCropId,
          variety_id: resolvedVarietyId,
          reproduction_id: resolvedReproductionId,
          planned_area_ha: effectiveArea,
          actual_area_ha: null,
          row_spacing_m: resolvedRowSpacingM,
          seed_spacing_cm: resolvedSeedSpacingCm,
          calculated_plants_per_ha: calculatedPlantsPerHa,
          calculated_total_plants: calculatedTotalPlants,
          notes: cropStructureId ? "Auto-created from operation crop structure" : "Auto-created from operation",
          created_by_user_id: actor.authUserId,
          updated_by_user_id: actor.authUserId,
        })
        .select("*")
        .single();
      timing.child_rows_insert_ms += Date.now() - childRowsStarted;

      if (lineError || !lineRow?.id) {
        operationLineWarning = lineError?.message || "Failed to create default operation line";
      } else {
        defaultOperationLine = lineRow as Record<string, unknown>;
      }
    }

    let materialRequestResult: Record<string, unknown> = { created: false, skipped_reason: "not_attempted" };
    if (fieldId && materialRows.length > 0) {
      const materialRequestStarted = Date.now();
      try {
        materialRequestResult = await ensureMaterialRequestForOperation({
          supabase,
          companyId,
          operationId: String(operationRow.id),
          fieldId,
          operationDate,
          notes: toNullableText(body.notes),
          responsibleUserId,
          plannedAreaHa: effectivePlannedArea ?? plannedArea,
          cropId: resolvedCropId,
          varietyId: resolvedVarietyId,
          reproductionId: resolvedReproductionId,
        });
        timing.material_request_ms += Date.now() - materialRequestStarted;
      } catch (requestError) {
        timing.material_request_ms += Date.now() - materialRequestStarted;
        materialRequestResult = {
          created: false,
          skipped_reason: "request_exception",
          error: requestError instanceof Error ? requestError.message : "Failed to create material request",
        };
      }
    } else if (fieldId) {
      materialRequestResult = { created: false, skipped_reason: "no_planned_materials" };
    } else {
      materialRequestResult = { created: false, skipped_reason: "no_field_context" };
    }

    return NextResponse.json(
      withTiming(
        {
          operation: {
            ...operationRow,
            planned_area_ha: defaultOperationLine?.planned_area_ha ?? effectivePlannedArea ?? plannedArea,
            crop_id: resolvedCropId,
          },
          operation_line: defaultOperationLine,
          operation_line_warning: operationLineWarning,
          material_request: materialRequestResult,
        },
        timing,
        includeTiming,
        startedAt
      )
    );
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
