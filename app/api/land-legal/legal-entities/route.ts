import { NextRequest, NextResponse } from "next/server";
import { LEGAL_ENTITY_TYPES } from "@/lib/land-legal/constants";
import { normalizeText } from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

const ENTITY_TYPES = new Set<string>(LEGAL_ENTITY_TYPES);

export async function GET(request: NextRequest) {
  try {
    const context = await resolveLandLegalContext(request, { write: false });
    const { companyId, supabase } = context;
    const search = normalizeText(request.nextUrl.searchParams.get("search"));
    const activeOnly = String(request.nextUrl.searchParams.get("activeOnly") || "true").toLowerCase() !== "false";

    let query = supabase
      .from("legal_entities")
      .select("*")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name");

    if (activeOnly) query = query.eq("is_active", true);
    if (search) {
      query = query.or(`name.ilike.%${search}%,short_name.ilike.%${search}%,bin_iin.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ legalEntities: data || [] });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveLandLegalContext(request, { write: true });
    const { companyId, supabase } = context;
    const body = await request.json();

    const name = normalizeText(body.name);
    const entityType = normalizeText(body.entity_type || "company");
    if (!name) return NextResponse.json({ error: "name обязателен" }, { status: 400 });
    if (!ENTITY_TYPES.has(entityType)) {
      return NextResponse.json({ error: "Некорректный type юрлица" }, { status: 400 });
    }

    const payload = {
      company_id: companyId,
      name,
      short_name: normalizeText(body.short_name) || null,
      entity_type: entityType,
      bin_iin: normalizeText(body.bin_iin) || null,
      legal_address: normalizeText(body.legal_address) || null,
      contact_person: normalizeText(body.contact_person) || null,
      phone: normalizeText(body.phone) || null,
      email: normalizeText(body.email) || null,
      notes: normalizeText(body.notes) || null,
      is_active: body.is_active !== false,
      archived: false,
    };

    const { data, error } = await supabase.from("legal_entities").insert(payload).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ legalEntity: data });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}

