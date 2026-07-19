import { supabase } from "@/lib/supabase/client";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import {
  Operation,
  OperationMaterial,
  OperationLine,
  OperationLineFormData,
  OperationMaterialRateBasis,
  OperationFormData,
  PotatoMaterialConsumptionRow,
  OperationWithDetails,
  SpecialistAssignee,
} from "@/lib/types/operation";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import { normalizeMaterialRateBasis } from "@/lib/materials/metadata";
import { buildProductPassport } from "@/lib/products/product-passport";
import {
  buildExecutionFactModelMetadata,
  buildWarehouseWorkflowMetadata,
  resolveCanonicalOperationType,
  toStorageMaterialType,
} from "@/lib/operations/operation-engine";
import { resolveCropIdentity } from "@/lib/operations/crop-identity";
import { enqueueOfflineRequest } from "@/lib/offline/offline-queue";

const DB_OPERATION_MATERIAL_TYPES = new Set([
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

function extractDraftValueFromNotes(notes: string | null | undefined, label: string): string | undefined {
  if (!notes) return undefined;
  const pattern = new RegExp(`(?:^|\\n)-\\s*${label}:\\s*(.+)`, "i");
  const matched = notes.match(pattern);
  const value = matched?.[1]?.trim();
  return value || undefined;
}

function parseOperationDraftDetails(notes: string | null | undefined) {
  return {
    draft_target: extractDraftValueFromNotes(notes, "Target"),
    draft_main_product: extractDraftValueFromNotes(notes, "Product"),
    draft_additional_products: extractDraftValueFromNotes(notes, "Additional products"),
    draft_rate_per_ha: extractDraftValueFromNotes(notes, "Rate per ha"),
    draft_mixture_volume_per_ha:
      extractDraftValueFromNotes(notes, "Spray volume per ha") ||
      extractDraftValueFromNotes(notes, "Legacy water per ha"),
    draft_equipment: extractDraftValueFromNotes(notes, "Equipment"),
    draft_responsible: extractDraftValueFromNotes(notes, "Responsible"),
    draft_comments: notes ? notes.split("\n\nDraft details:")[0].trim() : undefined,
  };
}

function parseMaterialRateBasisFromNotes(notes: string | null | undefined): OperationMaterialRateBasis {
  const matched = String(notes || "").match(/(?:^|[;\n]\s*)rate_basis\s*:\s*([a-z0-9_]+)/i);
  return normalizeMaterialRateBasis(matched?.[1]?.trim());
}

function serializeMaterialNotes(input: {
  notes?: string | null;
  componentType?: string | null;
  rateBasis?: string | null;
}) {
  const notes = String(input.notes || "").trim();
  const parts = notes ? notes.split(";").map((part) => part.trim()).filter(Boolean) : [];
  const hasComponent = parts.some((part) => /^component\s*:/i.test(part));
  const hasRateBasis = parts.some((part) => /^rate_basis\s*:/i.test(part));
  const rateBasis = input.rateBasis ? normalizeMaterialRateBasis(input.rateBasis) : null;

  if (!hasComponent && input.componentType) {
    parts.push(`component:${input.componentType}`);
  }
  if (!hasRateBasis && rateBasis) {
    parts.push(`rate_basis:${rateBasis}`);
  }

  return parts.length > 0 ? parts.join("; ") : null;
}

function normalizeOperationMaterials(rows: any[] | null | undefined): OperationMaterial[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...row,
    rate_basis: parseMaterialRateBasisFromNotes(row?.notes),
    product_name: row?.products
      ? buildProductPassport({ ...row.products, id: String(row.product_id || row.products.id || "") }).displayName
      : null,
    master_product_id: row?.products?.master_product_id || null,
    product_type: row?.products?.product_type || row?.products?.type || null,
  })) as OperationMaterial[];
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value ?? null) as T | null;
}

function normalizeOperationLines(rows: any[] | null | undefined): OperationLine[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const field = relationOne(row?.fields);
    const crop = relationOne(row?.crops);
    const variety = relationOne(row?.varieties);
    const reproduction = relationOne(row?.reproductions);
    return {
      ...row,
      field_name: (field as any)?.name || null,
      crop_name: localizedName(crop as any, "ru") || (crop as any)?.name || null,
      variety_name: brandName(variety as any) || (variety as any)?.name || null,
      reproduction_name: localizedName(reproduction as any, "ru") || (reproduction as any)?.name || null,
    };
  }) as OperationLine[];
}

function normalizeOperationRow(op: any): OperationWithDetails {
  const operationLines = normalizeOperationLines(op.operation_lines);
  const config =
    op?.operation_config && typeof op.operation_config === "object" && !Array.isArray(op.operation_config)
      ? op.operation_config
      : {};
  const canonicalType = resolveCanonicalOperationType({
    categorySlug: op.operation_category_slug || (config as any).operation_engine_type,
    typeSlug: op.operation_type_slug || (config as any).operation_engine_type,
    operationType: op.operation_type,
  });
  const plannedAreaFromLines = operationLines.reduce((sum, line) => sum + Number(line.planned_area_ha || 0), 0);
  const actualAreaValues = operationLines
    .map((line) => line.actual_area_ha)
    .filter((value): value is number => value !== null && value !== undefined);
  const actualAreaFromLines =
    actualAreaValues.length > 0
      ? actualAreaValues.reduce((sum, value) => sum + Number(value || 0), 0)
      : null;
  const plannedAreaFromConfig = Number((config as any).planned_area_ha || 0);
  const primaryLine =
    operationLines.find((line) => line.crop_id || line.crop_name || line.variety_id || line.reproduction_id) ||
    operationLines[0] ||
    null;
  const cropIdentity = resolveCropIdentity(
    {
      cropName: primaryLine?.crop_name,
      varietyName: primaryLine?.variety_name,
      reproductionName: primaryLine?.reproduction_name,
    },
    {
      cropName: localizedName(op.crop_structure?.crops, "ru"),
      varietyName: brandName(op.crop_structure?.varieties),
      reproductionName: localizedName(op.crop_structure?.seed_reproductions, "ru"),
    }
  );

  return {
    ...op,
    operation_lines: operationLines,
    operation_line_count: operationLines.length,
    planned_area_ha:
      plannedAreaFromLines > 0
        ? plannedAreaFromLines
        : Number.isFinite(plannedAreaFromConfig) && plannedAreaFromConfig > 0
          ? plannedAreaFromConfig
          : null,
    actual_area_ha: actualAreaFromLines,
    crop_id: primaryLine?.crop_id || (config as any).crop_id || null,
    operation_engine_type: String((config as any).operation_engine_type || canonicalType?.slug || op.operation_type_slug || ""),
    operation_engine_label: String((config as any).operation_engine_label || canonicalType?.label || op.operation_type || ""),
    operation_purposes: Array.isArray((config as any).purposes) ? (config as any).purposes.map(String) : [],
    tank_mix: (config as any).tank_mix && typeof (config as any).tank_mix === "object" ? (config as any).tank_mix : null,
    work_status: op.work_status || (op.status === "completed" ? "completed" : op.status === "in_progress" ? "in_progress" : "active"),
    field_name: op.fields?.name || primaryLine?.field_name || "-",
    crop_name: cropIdentity.cropName || "-",
    variety_name: cropIdentity.varietyName || "-",
    reproduction_name: cropIdentity.reproductionName || "-",
    materials: normalizeOperationMaterials(op.operation_materials),
    ...parseOperationDraftDetails(op.notes),
  } as OperationWithDetails;
}

function isProductionOperation(row: OperationWithDetails): boolean {
  const materials = (row.materials || [])
    .map((item) => `${item.product_name || ""} ${item.notes || ""} ${item.material_type || ""}`)
    .join(" ");
  const lines = (((row as any).operation_lines || []) as OperationLine[])
    .map((line: OperationLine) => `${line.field_name || ""} ${line.crop_name || ""} ${line.variety_name || ""} ${line.reproduction_name || ""} ${line.notes || ""}`)
    .join(" ");
  return !hasQaDataMarker(
    [
      row.operation_type,
      row.operation_type_slug,
      row.operation_category_slug,
      row.notes,
      row.field_name,
      row.crop_name,
      row.variety_name,
      row.reproduction_name,
      materials,
      lines,
    ].join(" ")
  );
}

async function buildAuthHeaders(contentType: "json" | "none" = "none") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Session not found. Please log in again.");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (contentType === "json") {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

async function parseApiResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export async function getOperations(
  companyId: string,
  includeArchived = false
): Promise<OperationWithDetails[]> {
  let query = supabase
    .from("operations")
    .select(`
      *,
      fields:field_id (name),
      crop_structure:crop_structure_id (
        crops:crop_id (name,name_ru,name_kz,name_en,slug),
        varieties:variety_id (name),
        seed_reproductions:reproduction_id (name,name_ru,name_kz,name_en,code)
      ),
      operation_materials:operation_materials (
        *,
        products:product_id (name,trade_name,master_product_id,type,product_type)
      ),
      operation_lines:operation_lines (
        id,
        company_id,
        operation_id,
        field_id,
        crop_id,
        variety_id,
        reproduction_id,
        planned_area_ha,
        actual_area_ha,
        row_count,
        row_spacing_m,
        seed_spacing_cm,
        calculated_plants_per_ha,
        calculated_total_plants,
        completed_by,
        completed_at,
        notes,
        created_at,
        updated_at,
        fields:field_id (name),
        crops:crop_id (name,name_ru,name_kz,name_en,slug),
        varieties:variety_id (name),
        reproductions:reproduction_id (name,name_ru,name_kz,name_en,code)
      )
    `)
    .eq("company_id", companyId)
    .order("date", { ascending: false });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((op: any) => normalizeOperationRow(op)).filter(isProductionOperation);
}

export async function getSpecialistOperations(
  companyId: string,
  specialistId: string
): Promise<OperationWithDetails[]> {
  const { data, error } = await supabase
    .from("operations")
    .select(`
      *,
      fields:field_id (name),
      crop_structure:crop_structure_id (
        crops:crop_id (name,name_ru,name_kz,name_en,slug),
        varieties:variety_id (name),
        seed_reproductions:reproduction_id (name,name_ru,name_kz,name_en,code)
      ),
      operation_materials:operation_materials (
        *,
        products:product_id (name,trade_name,master_product_id,type,product_type)
      ),
      operation_lines:operation_lines (
        id,
        company_id,
        operation_id,
        field_id,
        crop_id,
        variety_id,
        reproduction_id,
        planned_area_ha,
        actual_area_ha,
        row_count,
        row_spacing_m,
        seed_spacing_cm,
        calculated_plants_per_ha,
        calculated_total_plants,
        completed_by,
        completed_at,
        notes,
        created_at,
        updated_at,
        fields:field_id (name),
        crops:crop_id (name,name_ru,name_kz,name_en,slug),
        varieties:variety_id (name),
        reproductions:reproduction_id (name,name_ru,name_kz,name_en,code)
      )
    `)
    .eq("company_id", companyId)
    .eq("responsible_user_id", specialistId)
    .eq("archived", false)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((op: any) => normalizeOperationRow(op)).filter(isProductionOperation);
}

export async function getOperation(operationId: string): Promise<Operation | null> {
  const { data, error } = await supabase
    .from("operations")
    .select("*")
    .eq("id", operationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Operation | null;
}

export async function createOperation(
  companyId: string,
  operationData: OperationFormData,
  options?: { idempotencyKey?: string }
): Promise<Operation & { material_request?: Record<string, unknown>; offline_queued?: boolean; offline_queue_id?: string }> {
  const headers = await buildAuthHeaders("json");
  if (options?.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  const body = {
    companyId,
    ...operationData,
    idempotency_key: options?.idempotencyKey,
    responsible_user_id:
      operationData.responsible_user_id && operationData.responsible_user_id !== "none"
        ? operationData.responsible_user_id
        : null,
  };
  const queueable = Boolean(options?.idempotencyKey);
  const queueHeaders = { ...headers };
  delete queueHeaders.Authorization;

  let response: Response;
  try {
    if (typeof navigator !== "undefined" && !navigator.onLine && queueable) {
      throw new TypeError("offline");
    }
    response = await fetch("/api/operations", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (!queueable) throw error;
    const item = enqueueOfflineRequest({
      description: `Создание операции: ${operationData.operation_type || "план работы"}`,
      url: "/api/operations",
      method: "POST",
      headers: queueHeaders,
      body,
      authRequired: true,
      idempotencyKey: options?.idempotencyKey,
    });
    return {
      id: item.id,
      company_id: companyId,
      field_id: operationData.field_id || null,
      crop_structure_id: operationData.crop_structure_id || null,
      operation_type: operationData.operation_type,
      operation_category_slug: operationData.operation_category_slug || null,
      operation_type_slug: operationData.operation_type_slug || null,
      planned_area_ha: operationData.planned_area_ha ?? null,
      crop_id: operationData.crop_id || null,
      status: "queued",
      date: operationData.date,
      machine_id: operationData.machine_id || null,
      equipment_id: operationData.equipment_id || null,
      transport_id: operationData.transport_id || null,
      operation_target: operationData.operation_target || null,
      rate_per_ha: operationData.rate_per_ha ?? null,
      spray_volume_per_ha: operationData.spray_volume_per_ha ?? null,
      row_spacing_m: operationData.row_spacing_m ?? null,
      seed_spacing_cm: operationData.seed_spacing_cm ?? null,
      operation_params: operationData.operation_params || null,
      operation_config: null,
      notes: operationData.notes || null,
      responsible_user_id: body.responsible_user_id,
      work_status: "active",
      accepted_at: null,
      completed_at: null,
      specialist_comment: null,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      archived: false,
      user_id: "",
      offline_queued: true,
      offline_queue_id: item.id,
    } as Operation & { offline_queued: true; offline_queue_id: string };
  }
  const payload = await parseApiResponse(response);
  return {
    ...(payload.operation as Operation),
    material_request: (payload.material_request || undefined) as Record<string, unknown> | undefined,
  };
}

export async function updateOperation(
  operationId: string,
  operationData: Partial<OperationFormData>
): Promise<Operation> {
  const payload = { ...operationData } as Partial<OperationFormData>;
  const materials = Array.isArray((payload as any).materials) ? ([...(payload as any).materials] as any[]) : null;
  const purposes = Array.isArray((payload as any).purposes) ? [...((payload as any).purposes as string[])] : [];
  const tankMix = (payload as any).tank_mix && typeof (payload as any).tank_mix === "object" ? (payload as any).tank_mix : null;
  const operationParams =
    (payload as any).operation_params && typeof (payload as any).operation_params === "object" && !Array.isArray((payload as any).operation_params)
      ? ({ ...(payload as any).operation_params } as Record<string, unknown>)
      : {};
  const rowSpacingM = (payload as any).row_spacing_m ?? null;
  const seedSpacingCm = (payload as any).seed_spacing_cm ?? null;
  const canonicalType = resolveCanonicalOperationType({
    categorySlug: payload.operation_category_slug,
    typeSlug: payload.operation_type_slug,
    operationType: payload.operation_type,
  });
  delete (payload as any).materials;
  delete (payload as any).purposes;
  delete (payload as any).tank_mix;
  delete (payload as any).operation_params;
  delete (payload as any).row_spacing_m;
  delete (payload as any).seed_spacing_cm;
  if (payload.responsible_user_id === "none") {
    payload.responsible_user_id = null;
  }

  const { data: currentOperation, error: currentError } = await supabase
    .from("operations")
    .select("operation_config")
    .eq("id", operationId)
    .maybeSingle();
  if (currentError) {
    throw new Error(currentError.message);
  }
  const currentConfig =
    (currentOperation as any)?.operation_config &&
    typeof (currentOperation as any).operation_config === "object" &&
    !Array.isArray((currentOperation as any).operation_config)
      ? ((currentOperation as any).operation_config as Record<string, unknown>)
      : {};
  (payload as any).operation_config = {
    ...currentConfig,
    operation_engine_type: canonicalType?.slug || payload.operation_type_slug || currentConfig.operation_engine_type || null,
    operation_engine_label: canonicalType?.label || payload.operation_type || currentConfig.operation_engine_label || null,
    operation_template: payload.operation_type_slug || currentConfig.operation_template || null,
    operation_params: {
      ...(((currentConfig as any).operation_params && typeof (currentConfig as any).operation_params === "object")
        ? ((currentConfig as any).operation_params as Record<string, unknown>)
        : {}),
      ...operationParams,
      row_spacing_m: rowSpacingM,
      seed_spacing_cm: seedSpacingCm,
    },
    purposes,
    tank_mix: tankMix || currentConfig.tank_mix || null,
    warehouse_workflow: buildWarehouseWorkflowMetadata(),
    execution_fact_model: buildExecutionFactModelMetadata(),
  };

  const { data, error } = await supabase
    .from("operations")
    .update(payload)
    .eq("id", operationId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (materials) {
    const companyId = String((data as any).company_id || "").trim();
    if (!companyId) {
      throw new Error("Operation company context missing for material sync");
    }
    const { error: deleteError } = await supabase
      .from("operation_materials")
      .delete()
      .eq("company_id", companyId)
      .eq("operation_id", operationId);
    if (deleteError) throw new Error(deleteError.message);

    const normalizedRows = materials
      .map((item) => {
        const productId = String(item?.product_id || "").trim();
        const materialType = String(item?.material_type || "").trim();
        const unit = String(item?.unit || "").trim();
        if (!productId || !materialType || !unit) return null;
        const storageMaterialType = toStorageMaterialType(item?.component_type || materialType);
        if (!DB_OPERATION_MATERIAL_TYPES.has(storageMaterialType)) return null;
        return {
          company_id: companyId,
          operation_id: operationId,
          operation_line_id: null,
          product_id: productId,
          batch_id: item?.batch_id || null,
          material_type: storageMaterialType,
          unit,
          planned_rate: item?.planned_rate ?? null,
          actual_rate: item?.actual_rate ?? null,
          planned_quantity: item?.planned_quantity ?? null,
          notes: serializeMaterialNotes({
            notes: item?.notes,
            componentType: item?.component_type,
            rateBasis: item?.rate_basis,
          }),
        };
      })
      .filter(Boolean);

    if (normalizedRows.length > 0) {
      const { error: insertError } = await supabase.from("operation_materials").insert(normalizedRows as any[]);
      if (insertError) throw new Error(insertError.message);
    }
  }

  return data as Operation;
}

export async function archiveOperation(operationId: string): Promise<void> {
  const { error } = await supabase
    .from("operations")
    .update({ archived: true })
    .eq("id", operationId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function unarchiveOperation(operationId: string): Promise<void> {
  const { error } = await supabase
    .from("operations")
    .update({ archived: false })
    .eq("id", operationId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getAssignableSpecialists(companyId: string): Promise<SpecialistAssignee[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("role", "specialist")
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as SpecialistAssignee[];
}

export async function acceptOperationInWork(operationId: string): Promise<Operation> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("operations")
    .update({
      work_status: "in_progress",
      accepted_at: now,
    })
    .eq("id", operationId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Operation;
}

export async function completeOperationWork(
  operationId: string,
  specialistComment: string
): Promise<Operation> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("operations")
    .update({
      work_status: "completed",
      completed_at: now,
      specialist_comment: specialistComment || null,
    })
    .eq("id", operationId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Operation;
}

export async function getOperationLines(
  operationId: string,
  companyId: string
): Promise<OperationLine[]> {
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/operations/${encodeURIComponent(operationId)}/lines?companyId=${encodeURIComponent(companyId)}`,
    { method: "GET", headers, cache: "no-store" }
  );
  const payload = await parseApiResponse(response);
  return (payload.operation_lines || []) as OperationLine[];
}

export async function createOperationLine(
  operationId: string,
  companyId: string,
  line: OperationLineFormData
): Promise<OperationLine> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/lines`, {
    method: "POST",
    headers,
    body: JSON.stringify({ companyId, ...line }),
  });
  const payload = await parseApiResponse(response);
  return payload.operation_line as OperationLine;
}

export async function updateOperationLine(
  lineId: string,
  companyId: string,
  patch: Partial<OperationLineFormData> & { completed?: boolean }
): Promise<OperationLine> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/operation-lines/${encodeURIComponent(lineId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ companyId, ...patch }),
  });
  const payload = await parseApiResponse(response);
  return payload.operation_line as OperationLine;
}

export async function deleteOperationLine(lineId: string, companyId: string): Promise<void> {
  const headers = await buildAuthHeaders("none");
  const response = await fetch(
    `/api/operation-lines/${encodeURIComponent(lineId)}?companyId=${encodeURIComponent(companyId)}`,
    { method: "DELETE", headers }
  );
  await parseApiResponse(response);
}

export async function getPotatoMaterialConsumptionReport(
  companyId: string,
  options?: { seasonYear?: number; limit?: number }
): Promise<PotatoMaterialConsumptionRow[]> {
  const headers = await buildAuthHeaders("none");
  const params = new URLSearchParams();
  params.set("companyId", companyId);
  if (options?.seasonYear) params.set("seasonYear", String(options.seasonYear));
  if (options?.limit) params.set("limit", String(options.limit));
  const response = await fetch(
    `/api/operations/reports/potato-material-consumption?${params.toString()}`,
    {
      method: "GET",
      headers,
      cache: "no-store",
    }
  );
  const payload = await parseApiResponse(response);
  return ((payload.rows || []) as PotatoMaterialConsumptionRow[]).filter((row) => !hasQaDataMarker(JSON.stringify(row)));
}

export async function ensureOperationMaterialRequest(
  operationId: string,
  companyId: string
): Promise<Record<string, unknown>> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/material-request`, {
    method: "POST",
    headers,
    body: JSON.stringify({ companyId }),
  });
  const payload = await parseApiResponse(response);
  return (payload.material_request || {}) as Record<string, unknown>;
}
