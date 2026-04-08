import { supabase } from "@/lib/supabase/client";
import { Field, FieldFormData } from "@/lib/types/field";

export async function getFields(companyId: string, includeArchived = false) {
  let query = supabase
    .from("fields")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (!includeArchived) {
    query = query.eq("archived", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data as Field[];
}

export async function createField(
  companyId: string,
  fieldData: FieldFormData
): Promise<Field> {
  const { data, error } = await supabase
    .from("fields")
    .insert([
      {
        ...fieldData,
        company_id: companyId,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating field:", error);
    throw new Error(`Failed to create field: ${error.message} (${error.code || 'unknown'})`);
  }

  return data as Field;
}

export async function updateField(
  fieldId: string,
  fieldData: FieldFormData
): Promise<Field> {
  const { data, error } = await supabase
    .from("fields")
    .update(fieldData)
    .eq("id", fieldId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Field;
}

export async function archiveField(fieldId: string): Promise<void> {
  const { error } = await supabase
    .from("fields")
    .update({ archived: true })
    .eq("id", fieldId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function unarchiveField(fieldId: string): Promise<void> {
  const { error } = await supabase
    .from("fields")
    .update({ archived: false })
    .eq("id", fieldId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function searchFields(
  companyId: string,
  searchTerm: string
): Promise<Field[]> {
  const { data, error } = await supabase
    .from("fields")
    .select("*")
    .eq("company_id", companyId)
    .eq("archived", false)
    .ilike("name", `%${searchTerm}%`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data as Field[];
}
