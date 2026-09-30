import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import {
  OperationMutationInputError,
  operationMutationError,
  requireOperationIdempotency,
} from "@/lib/server/operation-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["global_admin", "company_admin"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requestContext(request: NextRequest, requestedCompanyId: string | null) {
  const actor = await getServerActorFromSession(request);
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  const supabase = await getUserScopedClientFromRequest(request);
  await assertActorAccess({
    supabase,
    actorUserId: actor.id,
    companyId,
    allowedRoles: [...ADMIN_ROLES],
  });
  return { actor, companyId, supabase };
}
export async function GET(request: NextRequest) {
  try {
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const { companyId, supabase } = await requestContext(request, requestedCompanyId);
    const { data: documents, error: documentsError } = await supabase
      .from("warehouse_opening_balance_documents")
      .select("id,company_id,season_id,document_no,snapshot_at,status,notes,created_by_profile_id,created_at")
      .eq("company_id", companyId)
      .order("snapshot_at", { ascending: false });
    if (documentsError) throw new Error(documentsError.message);

    const documentIds = (documents || []).map((row: any) => String(row.id));
    const { data: lines, error: linesError } = documentIds.length
      ? await supabase
          .from("warehouse_opening_balance_lines")
          .select("id,document_id,line_no,warehouse_id,inventory_batch_id,harvest_lot_id,ledger_entry_id,product_id,crop_id,variety_id,reproduction_id,batch_code,batch_name,quantity_kg,physical_state,origin_mode,source_count,source_quantities_known,parent_batch_id,moisture_percent,dockage_percent,notes,created_at")
          .eq("company_id", companyId)
          .in("document_id", documentIds)
          .order("line_no")
      : { data: [] as any[], error: null };
    if (linesError) throw new Error(linesError.message);

    const lineIds = (lines || []).map((row: any) => String(row.id));
    const { data: sources, error: sourcesError } = lineIds.length
      ? await supabase
          .from("warehouse_opening_balance_line_sources")
          .select("id,opening_balance_line_id,crop_structure_id,field_id,quantity_kg")
          .eq("company_id", companyId)
          .in("opening_balance_line_id", lineIds)
      : { data: [] as any[], error: null };
    if (sourcesError) throw new Error(sourcesError.message);

    const sourcesByLine = new Map<string, any[]>();
    for (const source of sources || []) {
      const key = String((source as any).opening_balance_line_id);
      sourcesByLine.set(key, [...(sourcesByLine.get(key) || []), source]);
    }
    const linesByDocument = new Map<string, any[]>();
    for (const line of lines || []) {
      const key = String((line as any).document_id);
      linesByDocument.set(key, [
        ...(linesByDocument.get(key) || []),
        { ...line, sources: sourcesByLine.get(String((line as any).id)) || [] },
      ]);
    }

    return NextResponse.json({
      documents: (documents || []).map((document: any) => ({
        ...document,
        lines: linesByDocument.get(String(document.id)) || [],
      })),
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить начальные остатки" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedCompanyId = String(body.companyId || body.company_id || "").trim() || null;
    const { actor, companyId, supabase } = await requestContext(request, requestedCompanyId);
    const seasonId = String(body.season_id || "").trim();
    const documentNo = String(body.document_no || "").trim();
    const snapshotAt = String(body.snapshot_at || "").trim();
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!UUID_RE.test(seasonId)) throw new OperationMutationInputError("Выберите сезон", 400);
    if (!documentNo) throw new OperationMutationInputError("Укажите номер документа", 400);
    if (!snapshotAt || Number.isNaN(new Date(snapshotAt).getTime())) {
      throw new OperationMutationInputError("Укажите дату и время среза", 400);
    }
    if (lines.length === 0 || lines.length > 500) {
      throw new OperationMutationInputError("Добавьте от 1 до 500 строк начального остатка", 400);
    }
    const idempotency = requireOperationIdempotency(request, body);
    const { data, error } = await supabase.rpc("create_warehouse_opening_balance_atomic_v1", {
      p_company_id: companyId,
      p_actor_profile_id: actor.id,
      p_season_id: seasonId,
      p_document_id: randomUUID(),
      p_document_no: documentNo,
      p_snapshot_at: new Date(snapshotAt).toISOString(),
      p_notes: body.notes == null ? null : String(body.notes),
      p_lines: lines,
      p_idempotency_key: idempotency.key,
      p_request_fingerprint: idempotency.fingerprint,
    });
    if (error || !data) {
      const failure = operationMutationError(error, "Не удалось провести начальный остаток");
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
    return NextResponse.json({ opening_balance: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof OperationMutationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось провести начальный остаток" },
      { status: 500 },
    );
  }
}
