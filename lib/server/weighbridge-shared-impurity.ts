import type { SupabaseClient } from "@supabase/supabase-js";

type SharedImpurityGroupRow = {
  id: string;
  ticket_id: string;
  state: string | null;
  member_resolution_status: string | null;
  source_total_kg: number | null;
  impurity_weight_kg: number | null;
  clean_total_kg: number | null;
};

type SharedImpurityMemberRow = {
  id: string;
  group_id: string;
  crop_structure_id: string;
  field_id: string | null;
  source_total_snapshot_kg: number | null;
  clean_balance_status: string | null;
  yield_status: string | null;
  identity_snapshot: Record<string, unknown> | null;
};

type SharedImpuritySourceRow = {
  group_id: string;
  member_id: string;
  harvest_lot_id: string;
};

const ids = (values: unknown[]) => Array.from(new Set(
  values.map((value) => String(value || "").trim()).filter(Boolean)
));

function isMissingSharedImpuritySchema(error: any): boolean {
  const code = String(error?.code || "").toUpperCase();
  // 42P01 is PostgreSQL undefined_table; PGRST205 is PostgREST's missing
  // relation-in-schema-cache error. Missing columns (42703/PGRST204) and other
  // contract drift must fail loudly instead of silently removing the scope.
  return code === "42P01" || code === "PGRST205";
}

function snapshotText(snapshot: Record<string, unknown> | null, ...keys: string[]) {
  for (const key of keys) {
    const value = String(snapshot?.[key] || "").trim();
    if (value) return value;
  }
  return null;
}

function snapshotNumber(snapshot: Record<string, unknown> | null, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(snapshot?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export async function loadSharedImpurityTicketIds(
  supabase: SupabaseClient,
  companyId: string,
  ticketIds: string[]
): Promise<Set<string>> {
  const normalizedTicketIds = ids(ticketIds);
  if (!normalizedTicketIds.length) return new Set();
  const { data, error } = await supabase
    .from("weighbridge_shared_impurity_groups")
    .select("ticket_id")
    .eq("company_id", companyId)
    .in("ticket_id", normalizedTicketIds);
  if (error) {
    if (isMissingSharedImpuritySchema(error)) return new Set();
    throw error;
  }
  return new Set((data || []).map((row: any) => String(row.ticket_id || "")).filter(Boolean));
}

export async function enrichSharedImpurityScopes<T extends Record<string, any>>(
  supabase: SupabaseClient,
  companyId: string,
  tickets: T[]
): Promise<T[]> {
  const ticketIds = ids(tickets.map((ticket) => ticket.id));
  if (!ticketIds.length) return tickets;

  const { data: rawGroups, error: groupsError } = await supabase
    .from("weighbridge_shared_impurity_groups")
    .select("id,ticket_id,state,member_resolution_status,source_total_kg,impurity_weight_kg,clean_total_kg")
    .eq("company_id", companyId)
    .in("ticket_id", ticketIds);
  if (groupsError) {
    if (isMissingSharedImpuritySchema(groupsError)) return tickets;
    throw groupsError;
  }
  const groups = (rawGroups || []) as SharedImpurityGroupRow[];
  if (!groups.length) return tickets;

  const groupIds = ids(groups.map((group) => group.id));
  const [{ data: rawMembers, error: membersError }, { data: rawSources, error: sourcesError }] = await Promise.all([
    supabase
      .from("weighbridge_shared_impurity_members")
      .select("id,group_id,crop_structure_id,field_id,source_total_snapshot_kg,clean_balance_status,yield_status,identity_snapshot")
      .eq("company_id", companyId)
      .in("group_id", groupIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("weighbridge_shared_impurity_source_batches")
      .select("group_id,member_id,harvest_lot_id")
      .eq("company_id", companyId)
      .in("group_id", groupIds)
      .order("created_at", { ascending: true }),
  ]);
  if (membersError || sourcesError) {
    const error = membersError || sourcesError;
    if (isMissingSharedImpuritySchema(error)) return tickets;
    throw error;
  }

  const members = (rawMembers || []) as SharedImpurityMemberRow[];
  const sources = (rawSources || []) as SharedImpuritySourceRow[];
  const harvestLotByMember = new Map<string, string>();
  for (const source of sources) {
    if (!harvestLotByMember.has(String(source.member_id))) {
      harvestLotByMember.set(String(source.member_id), String(source.harvest_lot_id));
    }
  }
  const membersByGroup = new Map<string, SharedImpurityMemberRow[]>();
  for (const member of members) {
    const list = membersByGroup.get(String(member.group_id)) || [];
    list.push(member);
    membersByGroup.set(String(member.group_id), list);
  }
  const groupByTicket = new Map(groups.map((group) => [String(group.ticket_id), group]));

  return tickets.map((ticket) => {
    const group = groupByTicket.get(String(ticket.id));
    if (!group) return ticket;
    const groupMembers = membersByGroup.get(String(group.id)) || [];
    return {
      ...ticket,
      impurity_source_scope: {
        allocation_mode: "unresolved_total",
        source_count: groupMembers.length,
        total_net_kg: group.impurity_weight_kg == null
          ? ticket.net_weight_kg == null ? null : Number(ticket.net_weight_kg)
          : Number(group.impurity_weight_kg),
        source_total_kg: group.source_total_kg == null ? null : Number(group.source_total_kg),
        clean_total_kg: group.clean_total_kg == null ? null : Number(group.clean_total_kg),
        state: group.state || "open",
        member_resolution_status: group.member_resolution_status || "unresolved",
        sources: groupMembers.map((member) => {
          const snapshot = member.identity_snapshot && typeof member.identity_snapshot === "object"
            ? member.identity_snapshot
            : null;
          return {
            harvest_lot_id: harvestLotByMember.get(String(member.id)) || snapshotText(snapshot, "harvest_lot_id") || "",
            crop_structure_id: String(member.crop_structure_id),
            field_id: member.field_id ? String(member.field_id) : snapshotText(snapshot, "field_id"),
            field_name_snapshot: snapshotText(snapshot, "field_name", "field_name_snapshot"),
            crop_name_snapshot: snapshotText(snapshot, "crop_name", "crop_name_snapshot"),
            variety_name_snapshot: snapshotText(snapshot, "variety_name", "variety_name_snapshot"),
            reproduction_name_snapshot: snapshotText(snapshot, "reproduction_name", "reproduction_name_snapshot"),
            area_ha_snapshot: snapshotNumber(snapshot, "area_ha", "area_ha_snapshot"),
            source_total_kg: member.source_total_snapshot_kg == null ? null : Number(member.source_total_snapshot_kg),
            clean_mass_kg: null,
            clean_yield_t_ha: null,
            clean_balance_status: member.clean_balance_status || "unresolved",
            yield_status: member.yield_status || "unresolved",
          };
        }),
      },
    } as T;
  });
}
