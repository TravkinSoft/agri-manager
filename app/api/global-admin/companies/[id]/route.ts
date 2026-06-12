import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

export const runtime = "nodejs";

const HARD_DELETE_BLOCKING_TABLES = [
  "crop_structure",
  "crops",
  "fields",
  "inventory_transactions",
  "operations",
  "products",
  "seasons",
  "seed_reproductions",
  "varieties",
  "warehouses",
] as const;

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function buildConfirmationPhrase(companyName: string) {
  return `Да полностью удалить компанию ${companyName} из проекта`;
}

async function countCompanyRows(supabase: ReturnType<typeof getServiceClient>, table: string, companyId: string) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if (error) {
    const message = String(error.message || "");
    if (message.toLowerCase().includes("does not exist") || message.toLowerCase().includes("schema cache")) {
      return 0;
    }
    throw new Error(`${table}: ${message}`);
  }

  return count || 0;
}

export async function DELETE(request: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    if (actor.role !== "global_admin") {
      throw new SessionAuthError("Only global_admin can delete companies", 403);
    }
    if (String(actor.status || "active").toLowerCase() !== "active") {
      throw new SessionAuthError("Global admin profile is inactive", 403);
    }

    const companyId = String(context.params.id || "").trim();
    if (!isUuidLike(companyId)) {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    const payload = await request.json().catch(() => ({}));
    const confirmationText = normalizeText(payload?.confirmationText);

    const supabase = getServiceClient();
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id,name")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      throw new Error(companyError.message || "Failed to load company");
    }
    if (!company?.id) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const expectedConfirmation = buildConfirmationPhrase(String(company.name || company.id));
    if (confirmationText !== expectedConfirmation) {
      return NextResponse.json(
        {
          error: "Confirmation text does not match",
          expectedConfirmation,
        },
        { status: 400 }
      );
    }

    const blockingCounts: Record<string, number> = {};
    await Promise.all(
      HARD_DELETE_BLOCKING_TABLES.map(async (table) => {
        blockingCounts[table] = await countCompanyRows(supabase, table, companyId);
      })
    );

    const blockers = Object.entries(blockingCounts).filter(([, count]) => count > 0);
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error:
            "Company has operational data. Hard delete is blocked to avoid accidental loss. Archive or clean company data first.",
          blockingCounts,
        },
        { status: 409 }
      );
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id,email")
      .eq("company_id", companyId);
    if (profilesError) {
      throw new Error(profilesError.message || "Failed to load company users");
    }

    let deletedAuthUsers = 0;
    for (const profile of profiles || []) {
      const profileId = String(profile.id || "").trim();
      if (!isUuidLike(profileId)) continue;
      const deleteUser = await supabase.auth.admin.deleteUser(profileId);
      if (deleteUser.error && !String(deleteUser.error.message || "").toLowerCase().includes("not found")) {
        throw new Error(deleteUser.error.message || `Failed to delete auth user ${profileId}`);
      }
      deletedAuthUsers += 1;
    }

    const { error: leftoverProfileError } = await supabase.from("profiles").delete().eq("company_id", companyId);
    if (leftoverProfileError) {
      throw new Error(leftoverProfileError.message || "Failed to delete company profiles");
    }

    const { error: deleteCompanyError } = await supabase.from("companies").delete().eq("id", companyId);
    if (deleteCompanyError) {
      throw new Error(deleteCompanyError.message || "Failed to delete company");
    }

    return NextResponse.json({
      ok: true,
      deleted: true,
      company: { id: company.id, name: company.name },
      deletedAuthUsers,
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete company" },
      { status: 500 }
    );
  }
}
