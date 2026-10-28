import { NextRequest, NextResponse } from "next/server";
import { mtmError, mtmSession } from "../_helpers";
import { parseMtmPage } from "@/lib/mtm/validation";

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await mtmSession(request, request.nextUrl.searchParams.get("companyId"));
    const kind = request.nextUrl.searchParams.get("kind") || "products";
    if (!["products", "machine", "equipment", "transport"].includes(kind)) return NextResponse.json({ error: "Неизвестный справочник" }, { status: 400 });
    const page = parseMtmPage(request.nextUrl.searchParams);
    const { data, error } = await supabase.rpc("mtm_catalog_options_v1", {
      p_company_id: companyId, p_kind: kind, p_offset: page.offset, p_limit: page.limit, p_search: page.search,
    });
    if (error) return mtmError(error);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mtmError(error); }
}
