import { NextRequest, NextResponse } from "next/server";
import { getRequestOrigin } from "@/lib/utils/app-url";
import { getServiceClient } from "@/lib/supabase/service";
import { getServerActorFromSession, SessionAuthError } from "@/lib/auth/server-session";
import { parseCanonicalRole } from "@/lib/auth/role-contract";

type UserAction =
  | "resend_invite"
  | "create_invite_link"
  | "revoke_invite"
  | "deactivate_user"
  | "reactivate_user";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  company_id: string | null;
};

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function errorToText(error: unknown): string {
  if (!error) return "unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : String(error);
  } catch {
    return String(error);
  }
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatus(value: unknown): string {
  return String(value || "active").trim().toLowerCase();
}

function assertCanManageTarget(actor: Awaited<ReturnType<typeof getServerActorFromSession>>, target: ProfileRow) {
  if (actor.role !== "global_admin" && actor.role !== "company_admin") {
    throw new SessionAuthError("Only administrators can manage users", 403);
  }

  const targetCompanyId = String(target.company_id || "").trim();
  if (!isUuidLike(targetCompanyId)) {
    throw new SessionAuthError("Target user has no company", 400);
  }

  if (actor.role === "company_admin" && actor.companyId !== targetCompanyId) {
    throw new SessionAuthError("Company admin can manage only own company users", 403);
  }

  if (actor.role === "global_admin") {
    const contextCompanyId = String(actor.contextCompanyId || actor.companyId || "").trim();
    if (isUuidLike(contextCompanyId) && contextCompanyId !== targetCompanyId) {
      throw new SessionAuthError("Selected company does not match target user", 403);
    }
  }
}

async function sendInviteEmail(params: {
  request: NextRequest;
  profile: ProfileRow;
  supabase: ReturnType<typeof getServiceClient>;
}) {
  const { request, profile, supabase } = params;
  const email = normalizeEmail(profile.email);
  if (!email) throw new Error("Target user email is missing");

  const origin = getRequestOrigin(request);
  const inviteRedirectTo = `${origin}/auth/callback?type=invite`;
  const recoveryRedirectTo = `${origin}/auth/callback?type=recovery`;
  const role = parseCanonicalRole(profile.role) || "specialist";

  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: inviteRedirectTo,
    data: {
      role,
      invited_by_company: profile.company_id,
      full_name: profile.full_name || email,
    },
  });

  if (!inviteError) return { method: "invite" };

  const inviteText = errorToText(inviteError).toLowerCase();
  const canFallbackToRecovery =
    inviteText.includes("already") ||
    inviteText.includes("registered") ||
    inviteText.includes("exists") ||
    inviteText.includes("duplicate");

  if (!canFallbackToRecovery) {
    throw new Error(`Invite email failed: ${errorToText(inviteError)}`);
  }

  const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: recoveryRedirectTo,
  });
  if (recoveryError) {
    throw new Error(`Recovery invite email failed: ${errorToText(recoveryError)}`);
  }

  return { method: "recovery" };
}

async function generateSetupLink(params: {
  request: NextRequest;
  profile: ProfileRow;
  supabase: ReturnType<typeof getServiceClient>;
}) {
  const { request, profile, supabase } = params;
  const email = normalizeEmail(profile.email);
  if (!email) throw new Error("Target user email is missing");

  const redirectTo = `${getRequestOrigin(request)}/auth/callback?type=recovery`;
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (error) throw new Error(errorToText(error));

  const actionLink = String((data as any)?.properties?.action_link || "").trim();
  if (!actionLink) throw new Error("Supabase did not return setup link");

  return actionLink;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const targetProfileId = String(params.id || "").trim();
    if (!isUuidLike(targetProfileId)) {
      return NextResponse.json({ success: false, message: "Invalid user id" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim() as UserAction;
    const allowedActions: UserAction[] = [
      "resend_invite",
      "create_invite_link",
      "revoke_invite",
      "deactivate_user",
      "reactivate_user",
    ];
    if (!allowedActions.includes(action)) {
      return NextResponse.json({ success: false, message: "Unknown user action" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true });

    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id,full_name,email,role,status,company_id")
      .eq("id", targetProfileId)
      .maybeSingle();

    if (targetError) throw new Error(targetError.message);
    if (!target?.id) {
      return NextResponse.json({ success: false, message: "User profile not found" }, { status: 404 });
    }

    const targetProfile = target as ProfileRow;
    assertCanManageTarget(actor, targetProfile);

    if (targetProfile.id === actor.id || targetProfile.id === actor.authUserId) {
      return NextResponse.json({ success: false, message: "You cannot change your own access here" }, { status: 400 });
    }

    if (parseCanonicalRole(targetProfile.role) === "global_admin") {
      return NextResponse.json({ success: false, message: "Global admin access is not managed from company users page" }, { status: 400 });
    }

    const status = normalizeStatus(targetProfile.status);

    if (action === "resend_invite") {
      if (status !== "pending") {
        return NextResponse.json({ success: false, message: "Only pending invitations can be resent" }, { status: 400 });
      }
      const result = await sendInviteEmail({ request, profile: targetProfile, supabase });
      await supabase.from("profiles").update({ updated_at: new Date().toISOString() }).eq("id", targetProfileId);
      return NextResponse.json({ success: true, method: result.method });
    }

    if (action === "create_invite_link") {
      if (status !== "pending") {
        return NextResponse.json({ success: false, message: "Setup link is available only for pending invitations" }, { status: 400 });
      }
      const actionLink = await generateSetupLink({ request, profile: targetProfile, supabase });
      return NextResponse.json({ success: true, action_link: actionLink });
    }

    if (action === "revoke_invite") {
      if (status !== "pending") {
        return NextResponse.json({ success: false, message: "Only pending invitations can be revoked" }, { status: 400 });
      }
      const { error } = await supabase
        .from("profiles")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", targetProfileId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, status: "revoked" });
    }

    if (action === "deactivate_user") {
      if (status !== "active") {
        return NextResponse.json({ success: false, message: "Only active users can be deactivated" }, { status: 400 });
      }
      const { error } = await supabase
        .from("profiles")
        .update({ status: "inactive", updated_at: new Date().toISOString() })
        .eq("id", targetProfileId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, status: "inactive" });
    }

    if (action === "reactivate_user") {
      if (status !== "inactive") {
        return NextResponse.json({ success: false, message: "Only inactive users can be reactivated" }, { status: 400 });
      }
      const { error } = await supabase
        .from("profiles")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", targetProfileId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, status: "active" });
    }

    return NextResponse.json({ success: false, message: "Unsupported action" }, { status: 400 });
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { success: false, message: errorToText(error) },
      { status: 500 }
    );
  }
}
