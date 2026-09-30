import { supabase } from "@/lib/supabase/client";

export interface ContainerRow {
  id: string;
  company_id: string;
  product_id: string | null;
  container_type: string;
  container_status: "in_stock" | "issued" | "awaiting_return" | "returned" | "to_disposal" | "disposed";
  quantity: number;
  linked_ticket_id: string | null;
  issued_to_user_id: string | null;
  issued_for_field_id: string | null;
  notes: string | null;
  created_at: string;
  product_name?: string;
}

export async function getContainerRegistry(companyId: string): Promise<ContainerRow[]> {
  const { data, error } = await supabase
    .from("container_registry")
    .select(`
      *,
      product:product_id(name)
    `)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    ...row,
    quantity: Number(row.quantity || 0),
    product_name: row.product?.name || null,
  }));
}

export async function createContainerRecord(input: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("container_registry")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateContainerStatus(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("container_registry")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

