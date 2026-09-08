import { NextRequest, NextResponse } from "next/server";
import {
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
  SessionAuthError,
} from "@/lib/auth/server-session";
import {
  buildFieldHarvestProjection,
  type FieldHarvestLedgerRow,
  type FieldHarvestStructureRow,
  type FieldHarvestTicketRow,
} from "@/lib/fields/field-harvest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_ALLOWED_ROLES = new Set(["global_admin", "company_admin", "agronomist"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PAGE_SIZE = 1000;
const LEDGER_CHUNK_SIZE = 200;

function requiredUuid(value: string | null, label: string): string {
  const normalized = String(value || "").trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new SessionAuthError(`${label} is required`, 400);
  }
  return normalized;
}

async function loadEffectiveTickets(
  supabase: Awaited<ReturnType<typeof getUserScopedClientFromRequest>>,
  scope: { companyId: string; seasonId: string; fieldId: string }
): Promise<FieldHarvestTicketRow[]> {
  const rows: FieldHarvestTicketRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await supabase
      .from("tickets")
      .select("id,company_id,season_id,field_id,crop_structure_allocation_id,op_type,status,is_finalized,is_voided,replacement_ticket_id,accepted_weight_kg,net_weight_kg,finalized_at")
      .eq("company_id", scope.companyId)
      .eq("season_id", scope.seasonId)
      .eq("field_id", scope.fieldId)
      .eq("op_type", "harvest_incoming")
      .eq("status", "finalized")
      .eq("is_finalized", true)
      .eq("is_voided", false)
      .is("replacement_ticket_id", null)
      .order("finalized_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = (result.data || []) as FieldHarvestTicketRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadLedgerEntries(
  supabase: Awaited<ReturnType<typeof getUserScopedClientFromRequest>>,
  companyId: string,
  ticketIds: string[]
): Promise<{ rows: FieldHarvestLedgerRow[]; available: boolean }> {
  if (!ticketIds.length) return { rows: [], available: true };
  const chunks: string[][] = [];
  for (let index = 0; index < ticketIds.length; index += LEDGER_CHUNK_SIZE) {
    chunks.push(ticketIds.slice(index, index + LEDGER_CHUNK_SIZE));
  }

  try {
    const pages = await Promise.all(chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("stock_ledger_entries")
        .select("ticket_id,company_id,direction,delta_qty_signed,reason_type,is_storno")
        .eq("company_id", companyId)
        .in("ticket_id", chunk)
        .eq("direction", "in")
        .eq("is_storno", false);
      if (error) throw error;
      return (data || []) as FieldHarvestLedgerRow[];
    }));
    return { rows: pages.flat(), available: true };
  } catch {
    return { rows: [], available: false };
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    if (!READ_ALLOWED_ROLES.has(actor.role)) {
      throw new SessionAuthError("Current role cannot view field harvest", 403);
    }

    const companyId = resolveCompanyForActor(actor, request.nextUrl.searchParams.get("companyId"));
    const seasonId = requiredUuid(request.nextUrl.searchParams.get("seasonId"), "seasonId");
    const fieldId = requiredUuid(request.nextUrl.searchParams.get("fieldId"), "fieldId");
    const supabase = await getUserScopedClientFromRequest(request);
    const scope = { companyId, seasonId, fieldId };

    const fieldPromise = supabase
      .from("fields")
      .select("id,area")
      .eq("company_id", companyId)
      .eq("id", fieldId)
      .eq("archived", false)
      .maybeSingle();
    const seasonPromise = supabase
      .from("seasons")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", seasonId)
      .maybeSingle();
    const structurePromise = supabase
      .from("crop_structure")
      .select("id,company_id,season_id,field_id,land_use_type,area")
      .eq("company_id", companyId)
      .eq("season_id", seasonId)
      .eq("field_id", fieldId)
      .eq("archived", false);
    const ticketsPromise = loadEffectiveTickets(supabase, scope);

    const [fieldResult, seasonResult, structureResult, tickets] = await Promise.all([
      fieldPromise,
      seasonPromise,
      structurePromise,
      ticketsPromise,
    ]);
    if (fieldResult.error) throw fieldResult.error;
    if (seasonResult.error) throw seasonResult.error;
    if (structureResult.error) throw structureResult.error;
    if (!fieldResult.data?.id || !seasonResult.data?.id) {
      return NextResponse.json({ error: "Field or season was not found in the selected company" }, { status: 404 });
    }

    const ledger = await loadLedgerEntries(supabase, companyId, tickets.map((ticket) => ticket.id));
    const projection = buildFieldHarvestProjection({
      companyId,
      seasonId,
      fieldId,
      fieldAreaHa: Number(fieldResult.data.area || 0),
      tickets,
      ledgerEntries: ledger.rows,
      structureRows: (structureResult.data || []) as FieldHarvestStructureRow[],
      ledgerAvailable: ledger.available,
    });

    return NextResponse.json(projection, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load field harvest" },
      { status: 500 }
    );
  }
}
