import type { SupabaseClient } from "@supabase/supabase-js";

type TicketWithCombineOperator = {
  combine_operator_person_id?: string | null;
  [key: string]: unknown;
};

export async function validateActiveCombineOperator(
  supabase: SupabaseClient,
  companyId: string,
  personId: string
) {
  const { data, error } = await supabase
    .from("company_people")
    .select("id,company_id,full_name,status,deleted_at")
    .eq("id", personId)
    .eq("company_id", companyId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data?.id) {
    return {
      ok: false as const,
      error: "Выбранный комбайнер недоступен в текущей компании.",
    };
  }
  return {
    ok: true as const,
    person: {
      id: String(data.id),
      name: String(data.full_name || "Сотрудник"),
    },
  };
}

export async function enrichTicketCombineOperators<T extends TicketWithCombineOperator>(
  supabase: SupabaseClient,
  companyId: string,
  tickets: T[]
): Promise<Array<T & { combine_operator_person_name: string | null }>> {
  const personIds = Array.from(new Set(
    tickets.map((ticket) => String(ticket.combine_operator_person_id || "").trim()).filter(Boolean)
  ));
  if (personIds.length === 0) {
    return tickets.map((ticket) => ({ ...ticket, combine_operator_person_name: null }));
  }

  const { data, error } = await supabase
    .from("company_people")
    .select("id,full_name")
    .eq("company_id", companyId)
    .in("id", personIds);
  if (error) throw error;
  const names = new Map((data || []).map((person: any) => [
    String(person.id),
    String(person.full_name || "Сотрудник"),
  ]));
  return tickets.map((ticket) => ({
    ...ticket,
    combine_operator_person_name: names.get(String(ticket.combine_operator_person_id || "")) || null,
  }));
}
