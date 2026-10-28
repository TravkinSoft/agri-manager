import { NextRequest, NextResponse } from "next/server";
import { mtmError, mtmSession, MTM_UUID } from "../../_helpers";
import { mtmSaveSchema } from "@/lib/mtm/validation";

export async function PUT(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params;
    if (!MTM_UUID.test(productId)) return NextResponse.json({ error: "Некорректный товар" }, { status: 400 });
    const parsed = mtmSaveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Проверьте поля карточки МТМ", details: parsed.error.flatten() }, { status: 400 });
    const { companyId, supabase } = await mtmSession(request, parsed.data.companyId, true);
    const { companyId: _companyId, expected_revision, ...metadata } = parsed.data;
    const { data, error } = await supabase.rpc("mtm_catalog_save_v1", {
      p_company_id: companyId, p_product_id: productId, p_expected_revision: expected_revision, p_metadata: metadata,
    });
    if (error) return mtmError(error);
    return NextResponse.json({ item: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mtmError(error); }
}
