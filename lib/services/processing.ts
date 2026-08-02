import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";

export type TransformationType =
  | "drying"
  | "cleaning"
  | "sorting"
  | "calibration"
  | "seed_treatment"
  | "seed_selection"
  | "packaging"
  | "aeration"
  | "conditioning"
  | "reclassification";

export type BatchClass = "commodity" | "seed" | "feed" | "waste" | "processing" | "rejected";

export type TransformationStatus = "draft" | "completed" | "voided";

export interface StockIdentityItem {
  key: string;
  warehouse_id: string;
  product_id: string;
  product_name: string;
  variety_id: string | null;
  variety_name: string;
  reproduction_id: string | null;
  reproduction_name: string;
  batch_id: string | null;
  batch_class: BatchClass | string;
  batch_class_label: string;
  quantity: number;
  label: string;
}

export interface TransformationOutputDraft {
  line_type: string;
  batch_class: BatchClass;
  warehouse_to_id: string | null;
  output_weight_kg: number;
}

export interface CreateTransformationInput {
  company_id: string;
  actor_user_id: string;
  transformation_type: TransformationType;
  processing_node_id?: string | null;
  source_ticket_id?: string | null;
  note?: string | null;
  input: {
    batch_id: string;
    warehouse_from_id: string;
    input_weight_kg: number;
  };
  outputs: TransformationOutputDraft[];
}

export interface BatchTransformationRow {
  id: string;
  record_type?: "transformation" | "waiting_ticket";
  queue_status?: "waiting" | "in_progress" | "completed" | "voided";
  company_id: string;
  transformation_type: TransformationType | string;
  status: TransformationStatus | string;
  processing_node_id: string | null;
  processing_node_name: string | null;
  source_ticket_id: string | null;
  ticket_no?: string | null;
  field_name?: string | null;
  crop_name?: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  note: string | null;
  input_label: string;
  input_weight_kg: number;
  source_warehouse_name: string | null;
  outputs: Array<{
    line_type: string;
    batch_class: string;
    warehouse_to_name: string | null;
    output_weight_kg: number;
  }>;
}

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export async function getProcessingTransformations(companyId: string, actorUserId: string): Promise<BatchTransformationRow[]> {
  const headers = await buildClientAuthHeaders("none");
  const params = new URLSearchParams({ companyId, userId: actorUserId });
  const payload = await parseJsonOrThrow(await fetch(`/api/processing/transformations?${params.toString()}`, { headers, cache: "no-store" }));
  return payload.items || [];
}

export async function createBatchTransformation(input: CreateTransformationInput): Promise<{ id: string }> {
  const headers = await buildClientAuthHeaders("json");
  return parseJsonOrThrow(
    await fetch("/api/processing/transformations", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
  );
}

export async function finalizeBatchTransformation(transformationId: string, actorUserId: string): Promise<void> {
  const headers = await buildClientAuthHeaders("json");
  await parseJsonOrThrow(
    await fetch(`/api/processing/transformations/${encodeURIComponent(transformationId)}/finalize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor_user_id: actorUserId }),
    })
  );
}

export async function getWarehouseStockIdentities(companyId: string, actorUserId: string, warehouseId: string): Promise<StockIdentityItem[]> {
  if (!companyId || !actorUserId || !warehouseId) return [];
  const headers = await buildClientAuthHeaders("none");
  const params = new URLSearchParams({ companyId, userId: actorUserId, warehouseId });
  const payload = await parseJsonOrThrow(await fetch(`/api/weighbridge/stock-identities?${params.toString()}`, { headers, cache: "no-store" }));
  return payload.items || [];
}
