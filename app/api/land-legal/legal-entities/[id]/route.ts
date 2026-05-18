import { NextRequest, NextResponse } from "next/server";
import { LEGAL_ENTITY_TYPES } from "@/lib/land-legal/constants";
import { isUuidLike, normalizeText } from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

type RouteParams = { params: { id: string } };
const ENTITY_TYPES = new Set<string>(LEGAL_ENTITY_TYPES);

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await resolveLandLegalContext(request, { write: true });
    const { companyId, supabase } = context;
    const id = String(params.id || "").trim();
    if (!isUuidLike(id)) return NextResponse.json({ error: "Некорректный id юрлица" }, { status: 400 });

    const body = await request.json();
    const patch: Record<string, any> = {};

    if (body.name !== undefined) patch.name = normalizeText(body.name);
    if (body.short_name !== undefined) patch.short_name = normalizeText(body.short_name) || null;
    if (body.entity_type !== undefined) {
      const value = normalizeText(body.entity_type);
      if (!ENTITY_TYPES.has(value)) return NextResponse.json({ error: "Некорректный type юрлица" }, { status: 400 });
      patch.entity_type = value;
    }
    if (body.bin_iin !== undefined) patch.bin_iin = normalizeText(body.bin_iin) || null;
    if (body.legal_address !== undefined) patch.legal_address = normalizeText(body.legal_address) || null;
    if (body.contact_person !== undefined) patch.contact_person = normalizeText(body.contact_person) || null;
    if (body.phone !== undefined) patch.phone = normalizeText(body.phone) || null;
    if (body.email !== undefined) patch.email = normalizeText(body.email) || null;
    if (body.notes !== undefined) patch.notes = normalizeText(body.notes) || null;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.archived !== undefined) patch.archived = Boolean(body.archived);

    const { data, error } = await supabase
      .from("legal_entities")
      .update(patch)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ legalEntity: data });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

