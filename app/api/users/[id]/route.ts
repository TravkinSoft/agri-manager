import { NextRequest, NextResponse } from "next/server";
import { getInviteSetPasswordRedirectTo } from "@/lib/utils/app-url";
import { getServiceClient } from "@/lib/supabase/service";
import { getServerActorFromSession, SessionAuthError } from "@/lib/auth/server-session";
import { parseCanonicalRole } from "@/lib/auth/role-contract";
import { isTrafficOperatorRole } from "@/lib/auth/ptc-invitations";

const GENERIC_INVITATION_MARKER = "generic_invitation_v1";

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
  is_owner: boolean | null;
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

async function ensureGenericInviteProvenance(params: {
  profile: ProfileRow;
  supabase: ReturnType<typeof getServiceClient>;
}) {
  const { profile, supabase } = params;
  const role = parseCanonicalRole(profile.role);
  if (isTrafficOperatorRole(role)) return;
  if (!role || !isUuidLike(String(profile.company_id || ""))) {
    throw new Error("Pending invitation has no valid company or role");
  }
  if (profile.is_owner === true && role !== "company_admin") {
    throw new Error("Pending invitation has an invalid owner role");
  }

  const { data, error } = await supabase.auth.admin.getUserById(profile.id);
  const user = data?.user;
  if (error || !user) throw new Error(`Invitation identity check failed: ${errorToText(error)}`);

  const profileEmail = normalizeEmail(profile.email);
  if (!profileEmail || normalizeEmail(user.email) !== profileEmail) {
    throw new Error("Invitation identity email does not match the pending profile");
  }

  const appMetadata = user.app_metadata ?? {};
  const existing = appMetadata[GENERIC_INVITATION_MARKER];
  if (Object.prototype.hasOwnProperty.call(appMetadata, "ptc_invitation_v1")) {
    throw new Error("Invitation identity belongs to a traffic operator flow");
  }
  if (existing !== undefined) {
    if (!existing || typeof existing !== "object" || Array.isArray(existing)
      || ((existing as any).state !== "provisioning" && (existing as any).state !== "ready")
      || String((existing as any).company_id || "") !== profile.company_id
      || String((existing as any).role || "") !== role
      || typeof (existing as any).is_owner !== "boolean"
      || (existing as any).is_owner !== (profile.is_owner === true)
      || ((existing as any).is_owner === true && role !== "company_admin")) {
      throw new Error("Invitation provenance conflicts with the pending profile");
    }
    // create-company grants ownership before changing this marker to ready.
    // Never let a generic resend turn an incomplete owner grant into an
    // activatable non-owner company administrator.
    if ((existing as any).state === "provisioning"
      && role === "company_admin"
      && profile.is_owner !== true) {
      throw new Error("Company owner provisioning is incomplete");
    }
  }

  const { data: markerData, error: markerError } = await supabase.auth.admin.updateUserById(profile.id, {
    app_metadata: {
      ...appMetadata,
      [GENERIC_INVITATION_MARKER]: {
        state: "ready",
        company_id: profile.company_id,
        role,
        is_owner: profile.is_owner === true,
      },
    },
  });
  const updatedAppMetadata = markerData.user?.app_metadata ?? {};
  const updatedMarker = updatedAppMetadata[GENERIC_INVITATION_MARKER];
  const markerMatches = Boolean(
    updatedMarker
    && typeof updatedMarker === "object"
    && !Array.isArray(updatedMarker)
    && (updatedMarker as any).state === "ready"
    && (updatedMarker as any).company_id === profile.company_id
    && (updatedMarker as any).role === role
    && (updatedMarker as any).is_owner === (profile.is_owner === true)
    && !Object.prototype.hasOwnProperty.call(updatedAppMetadata, "ptc_invitation_v1")
  );
  if (markerError || !markerData.user?.id || !markerMatches) {
    throw new Error(`Invitation provenance update failed: ${errorToText(markerError)}`);
  }
}

async function sendRecoveryInvite(params: {
  profile: ProfileRow;
  supabase: ReturnType<typeof getServiceClient>;
}) {
  const { profile, supabase } = params;
  const email = normalizeEmail(profile.email);
  if (!email) throw new Error("Target user email is missing");

  const setPasswordRedirectTo = getInviteSetPasswordRedirectTo();

  const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: setPasswordRedirectTo,
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
  const { profile, supabase } = params;
  const email = normalizeEmail(profile.email);
  if (!email) throw new Error("Target user email is missing");

  const redirectTo = getInviteSetPasswordRedirectTo();
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
      .select("id,full_name,email,role,status,company_id,is_owner")
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
      await ensureGenericInviteProvenance({ profile: targetProfile, supabase });
      const result = await sendRecoveryInvite({ profile: targetProfile, supabase });
      await supabase.from("profiles").update({ updated_at: new Date().toISOString() }).eq("id", targetProfileId);
      return NextResponse.json({ success: true, method: result.method });
    }

    if (action === "create_invite_link") {
      if (status !== "pending") {
        return NextResponse.json({ success: false, message: "Setup link is available only for pending invitations" }, { status: 400 });
      }
      await ensureGenericInviteProvenance({ profile: targetProfile, supabase });
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
