import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
  asMaterialRequestError,
  resolveMaterialRequestSession,
  toWorkflowStatus,
} from "@/app/api/material-requests/_helpers";

type IssueLinePayload = {
  itemId: string;
  issuedQuantity: number;
  batchId?: string | null;
};

function toPositiveNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requestId = String(id || "").trim();
    if (!requestId) {
      return NextResponse.json({ error: "request id is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const sourceWarehouseId = String(body.sourceWarehouseId || "").trim();
    if (!sourceWarehouseId) {
      return NextResponse.json({ error: "sourceWarehouseId is required" }, { status: 400 });
    }

    const issueItemsInput = Array.isArray(body.items) ? body.items : [];
    const issueItems: Array<{ item_id: string; issued_quantity: number; batch_id?: string }> = [];

    for (const raw of issueItemsInput) {
      const item = raw as IssueLinePayload;
      const itemId = String(item?.itemId || "").trim();
      const issuedQuantity = toPositiveNumber(item?.issuedQuantity);
      if (!itemId) continue;
      if (issuedQuantity == null) {
        return NextResponse.json({ error: `Invalid issuedQuantity for item ${itemId}` }, { status: 400 });
      }
      const normalized: { item_id: string; issued_quantity: number; batch_id?: string } = {
        item_id: itemId,
        issued_quantity: issuedQuantity,
      };
      if (item?.batchId) normalized.batch_id = String(item.batchId);
      issueItems.push(normalized);
    }

    const { actor, companyId, supabase, sessionSupabase } = await resolveMaterialRequestSession(request, {
      allowedRoles: MATERIAL_REQUEST_WAREHOUSE_WRITE_ROLES,
      requestedCompanyId: String(body.companyId || "").trim() || null,
    });

    const { data: reqRow, error: reqError } = await supabase
      .from("warehouse_issue_requests")
      .select("id,status,company_id")
      .eq("id", requestId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (reqError || !reqRow?.id) {
      return NextResponse.json({ error: reqError?.message || "Material request not found" }, { status: 404 });
    }

    const { data: rpcData, error: rpcError } = await sessionSupabase.rpc("issue_warehouse_request_v2", {
      p_request_id: requestId,
      p_actor_user_id: actor.authUserId,
      p_source_warehouse_id: sourceWarehouseId,
      p_items: issueItems.length > 0 ? issueItems : null,
    });

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message || "Issue failed" }, { status: 400 });
    }

    const nextStatusRaw = String((rpcData as any)?.status || reqRow.status || "");
    return NextResponse.json({
      result: rpcData,
      workflow_status: toWorkflowStatus(nextStatusRaw),
    });
  } catch (error) {
    const sessionError = asMaterialRequestError(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
