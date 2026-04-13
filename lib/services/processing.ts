import { supabase } from "@/lib/supabase/client";

export type ProcessingType =
  | "drying"
  | "cleaning"
  | "grading"
  | "treatment"
  | "soil_separation"
  | "washing"
  | "repacking"
  | "mixing";

export interface ProcessingDocumentRow {
  id: string;
  company_id: string;
  processing_type: ProcessingType;
  status: "draft" | "confirmed" | "cancelled";
  source_warehouse_id: string;
  destination_warehouse_id: string | null;
  product_id: string;
  input_qty_kg: number;
  output_qty_kg: number;
  loss_qty_kg: number;
  waste_qty_kg: number;
  moisture_in_percent: number | null;
  moisture_out_percent: number | null;
  dockage_in_percent: number | null;
  dockage_out_percent: number | null;
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
  product_name?: string;
  source_warehouse_name?: string;
  destination_warehouse_name?: string | null;
}

export async function getProcessingDocuments(companyId: string): Promise<ProcessingDocumentRow[]> {
  const { data, error } = await supabase
    .from("processing_documents")
    .select(`
      *,
      product:product_id(name),
      source_warehouse:source_warehouse_id(name),
      destination_warehouse:destination_warehouse_id(name)
    `)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    ...row,
    input_qty_kg: Number(row.input_qty_kg || 0),
    output_qty_kg: Number(row.output_qty_kg || 0),
    loss_qty_kg: Number(row.loss_qty_kg || 0),
    waste_qty_kg: Number(row.waste_qty_kg || 0),
    product_name: row.product?.name || "-",
    source_warehouse_name: row.source_warehouse?.name || "-",
    destination_warehouse_name: row.destination_warehouse?.name || null,
  }));
}

export async function createProcessingDocument(input: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("processing_documents")
    .insert(input)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function confirmProcessingDocument(processingId: string, actorUserId: string) {
  const { error } = await supabase.rpc("confirm_processing_document", {
    p_processing_id: processingId,
    p_actor_user_id: actorUserId,
  });
  if (error) throw new Error(error.message);
}

