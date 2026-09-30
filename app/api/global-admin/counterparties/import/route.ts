import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
} from "@/lib/auth/server-session";
import {
  type GlobalCounterpartyImportRow,
  validateGlobalCounterpartyImport,
} from "@/lib/counterparties/catalog";

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (actor.role !== "global_admin") throw new SessionAuthError("Global admin role is required", 403);
    const body = await request.json();
    const rows = Array.isArray(body.rows) ? body.rows as GlobalCounterpartyImportRow[] : [];
    const validation = validateGlobalCounterpartyImport(rows);
    if (validation.errors.length > 0) {
      return NextResponse.json({ validation, error: validation.errors.join(" ") }, { status: 400 });
    }
    if (body.dryRun !== false) return NextResponse.json({ validation, applied: false });
    const supabase = await getUserScopedClientFromRequest(request);
    const { data, error } = await supabase.rpc("import_global_counterparties_v1", { p_rows: rows });
    if (error) throw new Error(error.message);
    return NextResponse.json({ validation, applied: true, result: data });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed" }, { status: 400 });
  }
}
