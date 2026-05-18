import { NextRequest, NextResponse } from "next/server";
import { assertActorAccess } from "@/lib/auth/server-acl";
import {
  SessionAuthError,
  getServerActorFromSession,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";
import { getServiceClient } from "@/lib/supabase/service";
import type { CounterpartyType } from "@/lib/types/counterparty";

const COUNTERPARTY_ROLES = [
  "company_admin",
  "global_admin",
  "warehouse",
  "weighman",
  "fuel_operator",
  "agronomist",
  "director",
] as const;

const TYPE_VALUES = new Set<CounterpartyType>([
  "supplier",
  "buyer",
  "carrier",
  "service",
  "both",
  "other",
]);

function normalizeCounterpartyRow(row: any) {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    name: String(row.name || "Контрагент"),
    counterparty_type: String(row.counterparty_type || "other"),
    bin_iin: row.bin_iin ?? null,
    phone: row.phone ?? null,
    contact_person: row.contact_person ?? null,
    notes: row.notes ?? null,
    is_active: row.is_active !== false,
    archived: row.archived === true,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

function isMissingColumnError(message: string, column: string) {
  const text = message.toLowerCase();
  return text.includes("column") && text.includes(column.toLowerCase()) && text.includes("does not exist");
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const companyId = resolveCompanyForActor(actor, String(request.nextUrl.searchParams.get("companyId") || "").trim() || null);
    const type = String(request.nextUrl.searchParams.get("type") || "").trim().toLowerCase();
    const activeOnly = String(request.nextUrl.searchParams.get("activeOnly") || "true").toLowerCase() !== "false";

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...COUNTERPARTY_ROLES],
    });

    let query = supabase
      .from("counterparties")
      .select("*")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("name");

    if (activeOnly) query = query.eq("is_active", true);
    if (type && type !== "all") query = query.eq("counterparty_type", type);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      counterparties: (data || []).map(normalizeCounterpartyRow),
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request);
    const body = await request.json();
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const name = String(body.name || "").trim();
    const type = String(body.type || "").trim().toLowerCase() as CounterpartyType;
    const binIin = body.binIin == null ? null : String(body.binIin).trim() || null;
    const phone = body.phone == null ? null : String(body.phone).trim() || null;
    const contactPerson = body.contactPerson == null ? null : String(body.contactPerson).trim() || null;
    const comment = body.comment == null ? null : String(body.comment).trim() || null;
    const isActive = body.isActive !== false;

    if (!name || !type) {
      return NextResponse.json({ error: "name and type are required" }, { status: 400 });
    }
    if (!TYPE_VALUES.has(type)) {
      return NextResponse.json({ error: "Invalid counterparty type" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...COUNTERPARTY_ROLES],
    });

    const baseInsert: any = {
      company_id: companyId,
      name,
      counterparty_type: type,
      phone,
      notes: comment,
      is_active: isActive,
      archived: false,
    };
    const withExtra = {
      ...baseInsert,
      bin_iin: binIin,
      contact_person: contactPerson,
    };

    let insertRes = await supabase.from("counterparties").insert(withExtra).select("*").single();
    if (
      insertRes.error &&
      (isMissingColumnError(insertRes.error.message, "bin_iin") ||
        isMissingColumnError(insertRes.error.message, "contact_person"))
    ) {
      insertRes = await supabase.from("counterparties").insert(baseInsert).select("*").single();
    }
    if (insertRes.error || !insertRes.data) {
      return NextResponse.json({ error: insertRes.error?.message || "Insert failed" }, { status: 400 });
    }

    return NextResponse.json({ counterparty: normalizeCounterpartyRow(insertRes.data) });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
