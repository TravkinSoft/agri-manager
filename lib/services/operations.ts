import { supabase } from "@/lib/supabase/client";
import {
  Operation,
  OperationMaterial,
  OperationLine,
  OperationLineFormData,
  OperationFormData,
  PotatoMaterialConsumptionRow,
  OperationWithDetails,
  SpecialistAssignee,
} from "@/lib/types/operation";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

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

function normalizeOperationMaterials(rows: any[] | null | undefined): OperationMaterial[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...row,
    product_name: row?.products?.trade_name || row?.products?.name || null,
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
      crop_name: (crop as any)?.name || null,
      variety_name: (variety as any)?.name || null,
      reproduction_name: (reproduction as any)?.name || null,
    };
  }) as OperationLine[];
}

function normalizeOperationRow(op: any): OperationWithDetails {
  const operationLines = normalizeOperationLines(op.operation_lines);
  const config =
    op?.operation_config && typeof op.operation_config === "object" && !Array.isArray(op.operation_config)
      ? op.operation_config
      : {};
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
    work_status: op.work_status || (op.status === "completed" ? "completed" : op.status === "in_progress" ? "in_progress" : "active"),
    field_name: op.fields?.name || primaryLine?.field_name || "-",
    crop_name: primaryLine?.crop_name || op.crop_structure?.crops?.name || "-",
    variety_name: primaryLine?.variety_name || op.crop_structure?.varieties?.name || "-",
    reproduction_name: primaryLine?.reproduction_name || "-",
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
        crops:crop_id (name),
        varieties:variety_id (name)
      ),
      operation_materials:operation_materials (
        *,
        products:product_id (name,trade_name)
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
        crops:crop_id (name),
        varieties:variety_id (name),
        reproductions:reproduction_id (name)
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
        crops:crop_id (name),
        varieties:variety_id (name)
      ),
      operation_materials:operation_materials (
        *,
        products:product_id (name,trade_name)
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
        crops:crop_id (name),
        varieties:variety_id (name),
        reproductions:reproduction_id (name)
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
  operationData: OperationFormData
): Promise<Operation & { material_request?: Record<string, unknown> }> {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/operations", {
    method: "POST",
    headers,
    body: JSON.stringify({
      companyId,
      ...operationData,
      responsible_user_id:
        operationData.responsible_user_id && operationData.responsible_user_id !== "none"
          ? operationData.responsible_user_id
          : null,
    }),
  });
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
  delete (payload as any).materials;
  if (payload.responsible_user_id === "none") {
    payload.responsible_user_id = null;
  }

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
        return {
          company_id: companyId,
          operation_id: operationId,
          operation_line_id: null,
          product_id: productId,
          batch_id: item?.batch_id || null,
          material_type: materialType,
          unit,
          planned_rate: item?.planned_rate ?? null,
          actual_rate: item?.actual_rate ?? null,
          notes: item?.notes || null,
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
