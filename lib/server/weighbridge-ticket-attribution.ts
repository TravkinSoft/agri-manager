import type { SupabaseClient } from "@supabase/supabase-js";

type TicketRow = Record<string, any>;

type TechnicalAudit = {
  auth_account_created: string | null;
  auth_account_finalized: string | null;
  shift_id: string | null;
  opened_at: string | null;
  finalized_at: string | null;
};

const ids = (values: unknown[]) => Array.from(new Set(values.map((value) => String(value || "")).filter(Boolean)));
const profileLabel = (profile: any) => String(profile?.full_name || profile?.email || "").trim() || null;

export async function enrichTicketOperatorAttribution(
  supabase: SupabaseClient,
  companyId: string,
  tickets: TicketRow[],
  options?: { includeTechnicalAudit?: boolean }
): Promise<TicketRow[]> {
  if (tickets.length === 0) return [];

  const shiftIds = ids(tickets.map((ticket) => ticket.shift_id));
  const { data: shifts, error: shiftsError } = shiftIds.length
    ? await supabase
        .from("weighbridge_shifts")
        .select("id,operator_person_id")
        .eq("company_id", companyId)
        .in("id", shiftIds)
    : { data: [], error: null };
  if (shiftsError) throw shiftsError;

  const shiftPersonById = new Map(
    (shifts || []).map((shift: any) => [String(shift.id), String(shift.operator_person_id || "") || null])
  );
  const personIds = ids(
    tickets.flatMap((ticket) => [
      ticket.created_by_person_id,
      ticket.finalized_by_person_id,
      shiftPersonById.get(String(ticket.shift_id || "")),
    ])
  );
  const { data: people, error: peopleError } = personIds.length
    ? await supabase
        .from("company_people")
        .select("id,full_name")
        .eq("company_id", companyId)
        .in("id", personIds)
    : { data: [], error: null };
  if (peopleError) throw peopleError;
  const personNameById = new Map(
    (people || []).map((person: any) => [String(person.id), String(person.full_name || "").trim()])
  );

  let profileById = new Map<string, any>();
  if (options?.includeTechnicalAudit) {
    const profileIds = ids(tickets.flatMap((ticket) => [ticket.created_by, ticket.closed_by]));
    const { data: profiles, error: profilesError } = profileIds.length
      ? await supabase.from("profiles").select("id,full_name,email").in("id", profileIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    profileById = new Map((profiles || []).map((profile: any) => [String(profile.id), profile]));
  }

  return tickets.map((ticket) => {
    const shiftPersonId = shiftPersonById.get(String(ticket.shift_id || "")) || null;
    const openedPersonId = String(ticket.created_by_person_id || "") || shiftPersonId;
    const finalizedPersonId = String(ticket.finalized_by_person_id || "") ||
      (ticket.finalized_at || ticket.status === "finalized" ? openedPersonId || shiftPersonId : null);
    const technicalAudit: TechnicalAudit | undefined = options?.includeTechnicalAudit
      ? {
          auth_account_created: profileLabel(profileById.get(String(ticket.created_by || ""))),
          auth_account_finalized: profileLabel(profileById.get(String(ticket.closed_by || ""))),
          shift_id: String(ticket.shift_id || "") || null,
          opened_at: String(ticket.created_at || "") || null,
          finalized_at: String(ticket.finalized_at || "") || null,
        }
      : undefined;

    return {
      ...ticket,
      opened_by_person_name: openedPersonId ? personNameById.get(openedPersonId) || null : null,
      finalized_by_person_name: finalizedPersonId ? personNameById.get(finalizedPersonId) || null : null,
      operator_attribution_source:
        ticket.created_by_person_id || ticket.finalized_by_person_id
          ? "ticket_person"
          : shiftPersonId
            ? "shift_unambiguous"
            : "unrecorded",
      ...(technicalAudit ? { technical_audit: technicalAudit } : {}),
    };
  });
}
