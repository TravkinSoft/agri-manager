import { NextRequest, NextResponse } from "next/server";
import { parseMtmPage } from "@/lib/mtm/validation";
import { MTM_STOCK_OPTION_KINDS } from "@/lib/mtm/stock-types";
import { mtmStockError, mtmStockSession } from "../_stock-helpers";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const { companyId, supabase } = await mtmStockSession(request, params.get("companyId"));
    const page = parseMtmPage(params);
    const kind = params.get("kind") || "warehouse";
    if (!(MTM_STOCK_OPTION_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Неизвестный справочник МТМ" }, { status: 400 });
    const { data, error } = await supabase.rpc("mtm_stock_options_v1", { p_company_id: companyId, p_kind: kind, p_search: page.search, p_offset: page.offset, p_limit: page.limit });
    if (error) throw error;
    if (!data || !Array.isArray(data.items)) throw new Error("MTM_UNCONFIRMED_RESPONSE");
    return NextResponse.json(data);
  } catch (error) { return mtmStockError(error); }
}
