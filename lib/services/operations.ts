import { supabase } from "@/lib/supabase/client";
import {
  Operation,
  OperationFormData,
  OperationWithDetails,
  SpecialistAssignee,
} from "@/lib/types/operation";

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

  return (data || []).map((op: any) => ({
    ...op,
    work_status: op.work_status || (op.status === "completed" ? "completed" : op.status === "in_progress" ? "in_progress" : "active"),
    field_name: op.fields?.name || "-",
    crop_name: op.crop_structure?.crops?.name || "-",
    variety_name: op.crop_structure?.varieties?.name || "-",
    ...parseOperationDraftDetails(op.notes),
  })) as OperationWithDetails[];
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
      )
    `)
    .eq("company_id", companyId)
    .eq("responsible_user_id", specialistId)
    .eq("archived", false)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((op: any) => ({
    ...op,
    work_status:
      op.work_status ||
      (op.status === "completed"
        ? "completed"
        : op.status === "in_progress"
          ? "in_progress"
          : "active"),
    field_name: op.fields?.name || "-",
    crop_name: op.crop_structure?.crops?.name || "-",
    variety_name: op.crop_structure?.varieties?.name || "-",
    ...parseOperationDraftDetails(op.notes),
  })) as OperationWithDetails[];
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
): Promise<Operation> {
  const safeResponsibleUserId =
    operationData.responsible_user_id && operationData.responsible_user_id !== "none"
      ? operationData.responsible_user_id
      : null;

  const { data, error } = await supabase
    .from("operations")
    .insert([
      {
        ...operationData,
        responsible_user_id: safeResponsibleUserId,
        work_status: "active",
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating operation:", error);
    throw new Error(`Failed to create operation: ${error.message} (${error.code || "unknown"})`);
  }

  return data as Operation;
}

export async function updateOperation(
  operationId: string,
  operationData: Partial<OperationFormData>
): Promise<Operation> {
  const payload = { ...operationData } as Partial<OperationFormData>;
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
