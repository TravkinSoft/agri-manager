import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestOrigin } from "@/lib/utils/app-url";
import { SessionAuthError, getServerActorFromSession } from "@/lib/auth/server-session";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase service credentials are not configured");
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function assertGlobalAdmin(admin: ReturnType<typeof getAdminClient>, actorUserId: string) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("id", actorUserId)
    .maybeSingle();

  if (error || !profile?.id) {
    throw new SessionAuthError("Actor profile not found", 403);
  }
  if (String(profile.role || "").toLowerCase() !== "global_admin") {
    throw new SessionAuthError("Only global admin can create companies", 403);
  }
  if (String(profile.status || "active") !== "active") {
    throw new SessionAuthError("Global admin profile is inactive", 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });
    const { companyName, companyAdminEmail, companyAdminFullName } = await request.json();
    const name = String(companyName || "").trim();
    const adminEmail = String(companyAdminEmail || "").trim().toLowerCase();
    const adminFullName = String(companyAdminFullName || "").trim().replace(/\s+/g, " ");

    if (actor.role !== "global_admin") {
      return NextResponse.json({ error: "Only global admin can create companies" }, { status: 403 });
    }
    if (!name || !adminEmail || !adminFullName) {
      return NextResponse.json({ error: "companyName, companyAdminEmail and companyAdminFullName are required" }, { status: 400 });
    }

    const admin = getAdminClient();
    await assertGlobalAdmin(admin, actor.id);

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({ name })
      .select("id, name")
      .single();
    if (companyError || !company?.id) {
      return NextResponse.json({ error: companyError?.message || "Failed to create company" }, { status: 400 });
    }

    const redirectTo = `${getRequestOrigin(request)}/auth/callback?type=invite`;

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(adminEmail, {
      redirectTo,
      data: {
        role: "company_admin",
        invited_by_company: company.id,
        full_name: adminFullName,
      },
    });

    if (inviteError && !String(inviteError.message || "").toLowerCase().includes("already")) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 });
    }

    const invitedUserId = inviteData?.user?.id || null;
    if (invitedUserId) {
      await admin
        .from("profiles")
        .update({
          role: "company_admin",
          company_id: company.id,
          status: "pending",
          full_name: adminFullName,
          is_owner: true,
        })
        .eq("id", invitedUserId);
    }

    return NextResponse.json({
      success: true,
      company: { id: company.id, name: company.name },
    });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
