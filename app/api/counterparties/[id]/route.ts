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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await getServerActorFromSession(request);
    const counterpartyId = String(params.id || "").trim();
    const body = await request.json();
    const companyId = resolveCompanyForActor(actor, String(body.companyId || "").trim() || null);
    const patch: any = {};

    if (!counterpartyId) {
      return NextResponse.json(
        { error: "counterparty id is required" },
        { status: 400 },
      );
    }

    if (body.name !== undefined) patch.name = String(body.name || "").trim();
    if (body.type !== undefined) {
      const type = String(body.type || "").trim().toLowerCase() as CounterpartyType;
      if (!TYPE_VALUES.has(type)) {
        return NextResponse.json({ error: "Invalid counterparty type" }, { status: 400 });
      }
      patch.counterparty_type = type;
    }
    if (body.phone !== undefined) patch.phone = body.phone == null ? null : String(body.phone).trim() || null;
    if (body.comment !== undefined) patch.notes = body.comment == null ? null : String(body.comment).trim() || null;
    if (body.isActive !== undefined) patch.is_active = body.isActive === true;
    if (body.archived !== undefined) patch.archived = body.archived === true;
    if (body.binIin !== undefined) patch.bin_iin = body.binIin == null ? null : String(body.binIin).trim() || null;
    if (body.contactPerson !== undefined) {
      patch.contact_person = body.contactPerson == null ? null : String(body.contactPerson).trim() || null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const supabase = getServiceClient();
    await assertActorAccess({
      supabase,
      actorUserId: actor.id,
      companyId,
      allowedRoles: [...COUNTERPARTY_ROLES],
    });

    let updateRes = await supabase
      .from("counterparties")
      .update(patch)
      .eq("id", counterpartyId)
      .eq("company_id", companyId)
      .select("*")
      .single();

    if (
      updateRes.error &&
      (isMissingColumnError(updateRes.error.message, "bin_iin") ||
        isMissingColumnError(updateRes.error.message, "contact_person"))
    ) {
      const fallbackPatch = { ...patch };
      delete fallbackPatch.bin_iin;
      delete fallbackPatch.contact_person;
      updateRes = await supabase
        .from("counterparties")
        .update(fallbackPatch)
        .eq("id", counterpartyId)
        .eq("company_id", companyId)
        .select("*")
        .single();
    }

    if (updateRes.error || !updateRes.data) {
      return NextResponse.json(
        { error: updateRes.error?.message || "Update failed" },
        { status: 400 },
      );
    }

    return NextResponse.json({ counterparty: normalizeCounterpartyRow(updateRes.data) });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
