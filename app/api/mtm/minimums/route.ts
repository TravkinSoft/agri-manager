import { NextRequest, NextResponse } from "next/server";
import { mtmMinimumSchema } from "@/lib/mtm/stock-validation";
import { mtmStockBody, mtmStockError, mtmStockSession } from "../_stock-helpers";

export const dynamic = "force-dynamic";
export async function PUT(request: NextRequest) {
  try {
    const parsed = mtmMinimumSchema.safeParse(await mtmStockBody(request));
    if (!parsed.success) return NextResponse.json({ error: "Проверьте минимум и версию записи", code: "MTM_INVALID" }, { status: 400 });
    const { companyId, supabase } = await mtmStockSession(request, parsed.data.companyId, true);
    const { data, error } = await supabase.rpc("mtm_set_minimum_v1", {
      p_company_id: companyId, p_warehouse_id: parsed.data.warehouse_id, p_product_id: parsed.data.product_id,
      p_quantity: parsed.data.quantity, p_expected_revision: parsed.data.expected_revision,
    });
    if (error) throw error;
    if (!data || typeof data.minimum_quantity !== "string" || !Number.isInteger(data.minimum_revision)) throw new Error("MTM_UNCONFIRMED_RESPONSE");
    return NextResponse.json(data);
  } catch (error) { return mtmStockError(error); }
}
