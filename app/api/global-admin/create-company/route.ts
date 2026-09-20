import { NextRequest, NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { getInviteSetPasswordRedirectTo } from "@/lib/utils/app-url";
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

async function hasGenericInviteBinder(admin: ReturnType<typeof getAdminClient>): Promise<boolean> {
  const { data, error } = await admin.rpc("generic_invite_capabilities_v1");
  return !error && data === "generic-invite-binder-v1";
}

function isExactCompanyProvisioningUser(
  user: User | null | undefined,
  companyId: string,
  email: string
): user is User {
  if (!user?.id || String(user.email || "").trim().toLowerCase() !== email) return false;
  const marker = user.app_metadata?.generic_invitation_v1;
  return Boolean(
    marker
    && typeof marker === "object"
    && !Array.isArray(marker)
    && (marker.state === "provisioning" || marker.state === "ready")
    && marker.company_id === companyId
    && marker.role === "company_admin"
    && marker.is_owner === true
  );
}

async function reconcileCompanyProvisioningUser(
  admin: ReturnType<typeof getAdminClient>,
  companyId: string,
  email: string,
  candidate?: User | null
): Promise<{ user: User | null; emailExists: boolean }> {
  if (isExactCompanyProvisioningUser(candidate, companyId, email)) {
    return { user: candidate, emailExists: true };
  }

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const emailMatch = data.users.find(
      (user) => String(user.email || "").trim().toLowerCase() === email
    );
    if (emailMatch) {
      return {
        user: isExactCompanyProvisioningUser(emailMatch, companyId, email) ? emailMatch : null,
        emailExists: true,
      };
    }
    if (data.users.length < 200) return { user: null, emailExists: false };
  }
}

async function cleanupFailedProvisioning(
  admin: ReturnType<typeof getAdminClient>,
  companyId: string,
  userId?: string | null
): Promise<boolean> {
  let authCleanupComplete = !userId;
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    authCleanupComplete = !error;
    if (error) console.error("Failed to clean up company admin Auth user", error);
    if (error) return false;
  }
  // Physical deletion cascades into statement-level immutable ledger guards,
  // even for a fresh empty company. Keep the failed attempt recoverable instead.
  const { error } = await admin.from("companies")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", companyId);
  if (error) console.error("Failed to archive newly created company", error);
  return authCleanupComplete && !error;
}

function provisioningFailure(
  message: string,
  status: number,
  cleanupComplete: boolean
) {
  return NextResponse.json({
    error: cleanupComplete
      ? message
      : `${message} Автоматическая очистка не подтверждена; проверьте список компаний перед повтором.`,
    cleanup_required: !cleanupComplete,
  }, {
    status: cleanupComplete ? status : 500,
    headers: { "Cache-Control": "no-store, private" },
  });
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
    if (
      !name
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)
      || !adminFullName
      || adminFullName.length > 150
    ) {
      return NextResponse.json({ error: "Проверьте название компании, email и ФИО администратора." }, { status: 400 });
    }

    const admin = getAdminClient();
    await assertGlobalAdmin(admin, actor.id);

    // Deploy application code before the migration. Until the read-only
    // capability RPC appears, stop before creating either a company or user.
    if (!await hasGenericInviteBinder(admin)) {
      return NextResponse.json({
        error: "Создание компаний временно недоступно: обновление базы ещё не завершено.",
      }, {
        status: 503,
        headers: { "Cache-Control": "no-store, private" },
      });
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({ name })
      .select("id, name")
      .single();
    if (companyError || !company?.id) {
      if (companyError?.code === "23505") {
        return NextResponse.json({
          error: "Компания с таким названием уже существует. Выберите её в списке; сотрудника приглашайте внутри компании.",
          code: "COMPANY_NAME_EXISTS",
        }, { status: 409 });
      }
      return NextResponse.json({ error: companyError?.message || "Failed to create company" }, { status: 400 });
    }

    const redirectTo = getInviteSetPasswordRedirectTo();

    const { data: createdUserData, error: createError } = await admin.auth.admin.createUser({
      email: adminEmail,
      email_confirm: false,
      app_metadata: {
        generic_invitation_v1: {
          state: "provisioning",
          company_id: company.id,
          role: "company_admin",
          is_owner: true,
        },
      },
      user_metadata: {
        full_name: adminFullName,
      },
    });
    let invitedUser = createdUserData.user;
    if (createError || !invitedUser?.id) {
      // Auth creation can commit even when the caller sees an ambiguous error.
      // Reconcile only the exact server marker for this newly-created company;
      // never delete or bind an unrelated pre-existing email identity.
      let reconciled: { user: User | null; emailExists: boolean };
      try {
        reconciled = await reconcileCompanyProvisioningUser(
          admin,
          company.id,
          adminEmail,
          invitedUser
        );
      } catch (reconcileError) {
        console.error("Failed to reconcile company admin Auth creation", reconcileError);
        // An uncertain Auth outcome is not evidence that the company is empty.
        // Leave it visible for recovery instead of archiving a surviving account.
        return provisioningFailure(
          "Не удалось подтвердить создание администратора компании.",
          503,
          false
        );
      }

      if (!reconciled.user) {
        const cleanupComplete = await cleanupFailedProvisioning(admin, company.id);
        const message = String(createError?.message || "Не удалось создать администратора компании.");
        const conflict = reconciled.emailExists || /already|registered|exists|duplicate/i.test(message);
        return provisioningFailure(
          conflict ? "Этот email уже связан с аккаунтом." : "Не удалось создать администратора компании.",
          conflict ? 409 : 503,
          cleanupComplete
        );
      }
      invitedUser = reconciled.user;
    }

    const { error: bindError } = await admin.rpc("bind_invited_profile_v1", {
      p_actor: actor.id,
      p_user: invitedUser.id,
      p_company: company.id,
      p_role: "company_admin",
      p_name: adminFullName,
      p_email: adminEmail,
      p_fresh_auth: true,
    });
    if (bindError) {
      const cleanupComplete = await cleanupFailedProvisioning(admin, company.id, invitedUser.id);
      return provisioningFailure(
        "Не удалось безопасно привязать администратора компании.",
        500,
        cleanupComplete
      );
    }

    // Re-read the Auth identity after the database bind. This avoids replacing
    // newer app metadata with the stale createUser response and proves that the
    // exact provisioning marker is still attached before granting ownership.
    const { data: preparedAuthData, error: preparedAuthError } = await admin.auth.admin.getUserById(invitedUser.id);
    const preparedUser = preparedAuthData.user;
    const preparedAppMetadata = preparedUser?.app_metadata ?? {};
    const preparedMarker = preparedAppMetadata.generic_invitation_v1;
    const markerMatches = Boolean(
      preparedMarker
      && typeof preparedMarker === "object"
      && !Array.isArray(preparedMarker)
      && preparedMarker.state === "provisioning"
      && preparedMarker.company_id === company.id
      && preparedMarker.role === "company_admin"
      && preparedMarker.is_owner === true
    );
    if (preparedAuthError || !preparedUser?.id || !markerMatches) {
      const cleanupComplete = await cleanupFailedProvisioning(admin, company.id, invitedUser.id);
      return provisioningFailure(
        "Не удалось подтвердить подготовку администратора компании.",
        500,
        cleanupComplete
      );
    }

    const { data: ownerProfile, error: ownerError } = await admin
      .from("profiles")
      .update({ is_owner: true })
      .eq("id", invitedUser.id)
      .eq("company_id", company.id)
      .eq("role", "company_admin")
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (ownerError || !ownerProfile?.id) {
      const cleanupComplete = await cleanupFailedProvisioning(admin, company.id, invitedUser.id);
      return provisioningFailure(
        "Не удалось назначить владельца новой компании.",
        500,
        cleanupComplete
      );
    }

    const { data: readyAuthData, error: readyError } = await admin.auth.admin.updateUserById(invitedUser.id, {
      app_metadata: {
        ...preparedAppMetadata,
        generic_invitation_v1: {
          state: "ready",
          company_id: company.id,
          role: "company_admin",
          is_owner: true,
        },
      },
    });
    const readyMarker = readyAuthData.user?.app_metadata?.generic_invitation_v1;
    const readyMarkerMatches = Boolean(
      readyMarker
      && typeof readyMarker === "object"
      && !Array.isArray(readyMarker)
      && readyMarker.state === "ready"
      && readyMarker.company_id === company.id
      && readyMarker.role === "company_admin"
      && readyMarker.is_owner === true
    );
    if (readyError || !readyMarkerMatches) {
      const cleanupComplete = await cleanupFailedProvisioning(admin, company.id, invitedUser.id);
      return provisioningFailure(
        "Приглашение администратора не удалось подготовить.",
        500,
        cleanupComplete
      );
    }

    const { error: recoveryError } = await admin.auth.resetPasswordForEmail(adminEmail, { redirectTo });
    if (recoveryError) {
      // Delivery is an external side effect with an uncertain failure boundary.
      // Keep the fully bound, ready pending account so the global admin can open
      // the company and resend the invitation instead of creating a duplicate.
      return NextResponse.json({
        error: "Компания создана, но письмо администратору не отправлено. Откройте компанию и переотправьте приглашение.",
        code: "COMPANY_CREATED_INVITE_DELIVERY_FAILED",
        company: { id: company.id, name: company.name },
        invite_pending: true,
      }, {
        status: 503,
        headers: { "Cache-Control": "no-store, private" },
      });
    }

    return NextResponse.json({
      success: true,
      company: { id: company.id, name: company.name },
    }, { headers: { "Cache-Control": "no-store, private" } });
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
