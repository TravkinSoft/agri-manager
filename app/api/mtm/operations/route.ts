import { NextRequest, NextResponse } from "next/server";
import { parseMtmPage } from "@/lib/mtm/validation";
import { mtmIdempotencySchema, mtmOperationSchema } from "@/lib/mtm/stock-validation";
import { mtmOptionalId, mtmStockBody, mtmStockError, mtmStockSession } from "../_stock-helpers";
import { MTM_UUID } from "../_helpers";
import { normalizeMtmQuantity } from "@/lib/mtm/stock-validation";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const { companyId, supabase } = await mtmStockSession(request, params.get("companyId"));
    const page = parseMtmPage(params);
    const { data, error } = await supabase.rpc("mtm_operations_list_v1", {
      p_company_id: companyId, p_warehouse_id: mtmOptionalId(params.get("warehouseId")),
      p_product_id: mtmOptionalId(params.get("productId")), p_offset: page.offset, p_limit: page.limit,
    });
    if (error) throw error;
    if (!data || !Array.isArray(data.items)) throw new Error("MTM_UNCONFIRMED_RESPONSE");
    return NextResponse.json(data);
  } catch (error) { return mtmStockError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const parsed = mtmOperationSchema.safeParse(await mtmStockBody(request));
    const key = mtmIdempotencySchema.safeParse(request.headers.get("Idempotency-Key"));
    if (!parsed.success || !key.success) return NextResponse.json({ error: "Проверьте реквизиты и ключ операции", code: "MTM_INVALID" }, { status: 400 });
    const { companyId: requestedCompanyId, ...payload } = parsed.data;
    const { companyId, supabase } = await mtmStockSession(request, requestedCompanyId, true);
    const { data, error } = await supabase.rpc("mtm_post_operation_v1", { p_company_id: companyId, p_idempotency_key: key.data, p_payload: payload });
    if (error) throw error;
    const validId = (value: unknown) => typeof value === "string" && MTM_UUID.test(value);
    if (!data || !validId(data.id) || data.id !== key.data || !validId(data.ledger_entry_id) || !validId(data.inventory_transaction_id)
      || data.company_id !== companyId || data.kind !== payload.kind || data.warehouse_id !== payload.warehouse_id
      || data.product_id !== payload.product_id || data.uom !== payload.uom || typeof data.quantity !== "string"
      || normalizeMtmQuantity(data.quantity) !== payload.quantity || data.purpose !== payload.purpose
      || (data.original_issue_id || null) !== payload.original_issue_id) throw new Error("MTM_UNCONFIRMED_RESPONSE");
    return NextResponse.json({ operation: data });
  } catch (error) { return mtmStockError(error); }
}
