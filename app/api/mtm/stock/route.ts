import { NextRequest, NextResponse } from "next/server";
import { parseMtmPage } from "@/lib/mtm/validation";
import { mtmOptionalId, mtmStockError, mtmStockSession } from "../_stock-helpers";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const { companyId, supabase, canOperate } = await mtmStockSession(request, params.get("companyId"));
    const page = parseMtmPage(params);
    const below = params.get("belowMinimum");
    if (below !== null && below !== "true" && below !== "false") return NextResponse.json({ error: "Некорректный фильтр минимумов" }, { status: 400 });
    const { data, error } = await supabase.rpc("mtm_stock_list_v1", {
      p_company_id: companyId, p_warehouse_id: mtmOptionalId(params.get("warehouseId")), p_search: page.search,
      p_below_minimum: below === "true", p_offset: page.offset, p_limit: page.limit,
    });
    if (error) throw error;
    if (!data || !Array.isArray(data.items)) throw new Error("MTM_UNCONFIRMED_RESPONSE");
    return NextResponse.json({ ...data, can_operate: canOperate && data.can_write === true, can_manage_minimums: canOperate && data.can_write === true });
  } catch (error) { return mtmStockError(error); }
}
