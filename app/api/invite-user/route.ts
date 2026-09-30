import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getInviteSetPasswordRedirectTo } from "@/lib/utils/app-url";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";
import { sendTrafficInvitation, TrafficInvitationError } from "@/lib/auth/ptc-invitations";

const GENERIC_INVITATION_MARKER = "generic_invitation_v1";

const GLOBAL_ADMIN_ALLOWED_TARGETS = [
  "company_admin",
  "agronomist",
  "director",
  "accountant",
  "legal_operator",
  "specialist",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "fuel_operator",
  "brigadier",
  "mechanic_operator",
  "vegetable_brigadier",
  "fleet_manager",
] as const;
const COMPANY_ADMIN_ALLOWED_TARGETS = [
  "agronomist",
  "director",
  "accountant",
  "legal_operator",
  "specialist",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "fuel_operator",
  "brigadier",
  "mechanic_operator",
  "vegetable_brigadier",
  "fleet_manager",
] as const;

function errorToText(err: any): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (err.message && typeof err.message === "string") return err.message;
  if (err.error_description && typeof err.error_description === "string") return err.error_description;
  if (err.code && err.msg) return `${String(err.code)}: ${String(err.msg)}`;
  try {
    const serialized = JSON.stringify(err);
    if (serialized && serialized !== "{}") return serialized;
  } catch {}
  try {
    return String(err);
  } catch {
    return "unknown error";
  }
}

async function findAuthUserByEmail(db: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Auth user lookup failed: ${errorToText(error)}`);
    const match = data.users.find((user) => user.email?.trim().toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
}

function genericInviteError(error: { message?: string }): { message: string; status: number } {
  const code = error.message || "";
  if (code.includes("GENERIC_INVITE_INVALID")) {
    return { message: "Проверьте email, ФИО и роль", status: 400 };
  }
  if (code.includes("GENERIC_INVITE_FORBIDDEN")) {
    return { message: "Недостаточно прав для приглашения в эту компанию", status: 403 };
  }
  if (code.includes("GENERIC_INVITE_COMPANY_NOT_FOUND")) {
    return { message: "Компания не найдена", status: 404 };
  }
  if (
    code.includes("GENERIC_INVITE_EXISTING_ACCOUNT_CONFLICT") ||
    code.includes("GENERIC_INVITE_PROFILE_REQUIRED") ||
    code.includes("GENERIC_INVITE_AUTH_MISMATCH")
  ) {
    return {
      message: "Этот email уже связан с другим, действующим или незавершённым аккаунтом. Компания и роль не изменены.",
      status: 409,
    };
  }
  return { message: "Не удалось безопасно привязать приглашение. Письмо не отправлено.", status: 500 };
}

type GenericInvitationMarker = {
  state: "provisioning" | "ready";
  company_id: string;
  role: string;
  is_owner: boolean;
};

function genericInvitationMarkerOf(user: User): GenericInvitationMarker | null {
  const marker = user.app_metadata?.[GENERIC_INVITATION_MARKER];
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return null;
  const value = marker as Record<string, unknown>;
  const state = value.state;
  const companyId = value.company_id;
  const role = value.role;
  const isOwner = value.is_owner;
  if ((state !== "provisioning" && state !== "ready")
    || typeof companyId !== "string" || typeof role !== "string"
    || typeof isOwner !== "boolean") return null;
  return { state, company_id: companyId, role, is_owner: isOwner };
}

async function hasGenericInviteBinder(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc("generic_invite_capabilities_v1");
  return !error && data === "generic-invite-binder-v1";
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseServiceKey) {
    return NextResponse.json({ success: false, message: "Missing service role key" }, { status: 500 });
  }

  if (!supabaseUrl) {
    return NextResponse.json({ success: false, message: "Missing Supabase URL" }, { status: 500 });
  }

  try {
    const { email, role, company_id, full_name, person_id, create_person } = await request.json();
    if (!email || !role || !full_name) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true, skipCache: true });

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedRoleRaw = String(role).trim().toLowerCase();
    const normalizedRole = normalizedRoleRaw === "admin" ? "company_admin" : normalizedRoleRaw;
    const trafficInvite = normalizedRole === "mechanic_operator" || normalizedRole === "vegetable_brigadier" || normalizedRole === "fleet_manager";
    const normalizedFullName = String(full_name).trim().replace(/\s+/g, " ");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !normalizedFullName || normalizedFullName.length > 150) {
      return NextResponse.json({ success: false, message: "Проверьте email и ФИО" }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const actorIsGlobalAdmin = actor.role === "global_admin";
    const actorIsCompanyAdmin = actor.role === "company_admin";

    if (!actorIsGlobalAdmin && !actorIsCompanyAdmin) {
      return NextResponse.json({ success: false, message: "Only administrators can send invites" }, { status: 403 });
    }
    const targetCompanyId = resolveCompanyForActor(actor, String(company_id || "").trim() || null);

    await assertActorAccess({
      supabase: supabaseAdmin,
      actorUserId: actor.id,
      companyId: targetCompanyId,
      allowedRoles: ["global_admin", "company_admin"],
    });

    const allowedTargets: readonly string[] = actorIsGlobalAdmin
      ? GLOBAL_ADMIN_ALLOWED_TARGETS
      : COMPANY_ADMIN_ALLOWED_TARGETS;

    if (!allowedTargets.includes(normalizedRole)) {
      return NextResponse.json(
        {
          success: false,
          message: actorIsGlobalAdmin
            ? "Global admin can invite only company_admin and lower company roles"
            : "Company admin can invite only lower company roles",
        },
        { status: 403 }
      );
    }

    const personId = typeof person_id === "string" ? person_id.trim() : "";
    if (trafficInvite) {
      if (personId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) {
          return NextResponse.json({ success: false, message: "Выберите сотрудника компании" }, { status: 400 });
        }
        const { data: person, error: personError } = await supabaseAdmin.from("company_people")
          .select("id,user_id").eq("id", personId).eq("company_id", targetCompanyId)
          .eq("status", "active").is("deleted_at", null).maybeSingle();
        if (personError) throw personError;
        if (!person) return NextResponse.json({ success: false, message: "Сотрудник не найден в этой компании" }, { status: 403 });
        // A retry may refer to the same already-bound account. The PTC helper and atomic
        // binding verify exact user ownership; reject foreign links there, not all retries.
      } else if (create_person !== true) {
        return NextResponse.json({ success: false, message: "Выберите сотрудника или явно укажите, что он новый" }, { status: 400 });
      }
    }

    const redirectTo = getInviteSetPasswordRedirectTo();
    if (trafficInvite) {
      const method = await sendTrafficInvitation({
        db: supabaseAdmin, actorId: actor.id, companyId: targetCompanyId,
        role: normalizedRole as "mechanic_operator" | "vegetable_brigadier" | "fleet_manager",
        email: normalizedEmail, fullName: normalizedFullName,
        personId: personId || null, createPerson: create_person === true, redirectTo,
      });
      return NextResponse.json({ success: true, message: method === "invite" ? "Invitation link sent successfully" : "Recovery invite link sent successfully" },
        { headers: { "Cache-Control": "no-store, private" } });
    }

    // Code is deployed before the companion migration. Fail closed before any
    // Auth/profile mutation until the exact binder capability is available.
    if (!await hasGenericInviteBinder(supabaseAdmin)) {
      return NextResponse.json({
        success: false,
        message: "Приглашения временно недоступны: обновление базы ещё не завершено.",
      }, {
        status: 503,
        headers: { "Cache-Control": "no-store, private" },
      });
    }

    let user = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);
    let createdAuthUserId: string | null = null;

    if (!user) {
      const { data: createdUserData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: false,
        app_metadata: {
          generic_invitation_v1: {
            state: "provisioning",
            company_id: targetCompanyId,
            role: normalizedRole,
            is_owner: false,
          },
        },
        user_metadata: {
          role: normalizedRole,
          invited_by_company: targetCompanyId,
          full_name: normalizedFullName,
        },
      });

      if (!createError && createdUserData.user) {
        user = createdUserData.user;
        createdAuthUserId = user.id;
      } else {
        // A concurrent invite can win Auth's unique-email race. It is safe to
        // resume only if the database binder proves an exact pending retry.
        user = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);
        if (!user) {
          return NextResponse.json(
            { success: false, message: `Не удалось создать аккаунт: ${errorToText(createError)}` },
            { status: 503 }
          );
        }
      }
    }

    const existingGenericMarkerPresent = Object.prototype.hasOwnProperty.call(
      user.app_metadata ?? {},
      GENERIC_INVITATION_MARKER
    );
    const existingGenericMarker = genericInvitationMarkerOf(user);
    const trafficMarkerPresent = Object.prototype.hasOwnProperty.call(
      user.app_metadata ?? {},
      "ptc_invitation_v1"
    );
    if (trafficMarkerPresent || (existingGenericMarkerPresent && (
      !existingGenericMarker
      || existingGenericMarker.company_id !== targetCompanyId
      || existingGenericMarker.role !== normalizedRole
      || existingGenericMarker.is_owner !== false
    ))) {
      return NextResponse.json(
        {
          success: false,
          message: "Этот email подготовлен для другого приглашения. Компания и роль не изменены.",
        },
        { status: 409 }
      );
    }

    const { error: bindError } = await supabaseAdmin.rpc("bind_invited_profile_v1", {
      p_actor: actor.id,
      p_user: user.id,
      p_company: targetCompanyId,
      p_role: normalizedRole,
      p_name: normalizedFullName,
      p_email: normalizedEmail,
      p_fresh_auth: createdAuthUserId === user.id,
    });

    if (bindError) {
      let cleanupFailed = false;
      if (createdAuthUserId === user.id) {
        const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
        cleanupFailed = Boolean(cleanupError);
        if (cleanupError) {
          console.error("Fresh invite Auth cleanup failed:", cleanupError);
        }
      }

      const mapped = genericInviteError(bindError);
      return NextResponse.json(
        {
          success: false,
          message: cleanupFailed
            ? "Привязка не выполнена и автоматическая очистка нового аккаунта не завершилась. Письмо не отправлено."
            : mapped.message,
        },
        { status: cleanupFailed ? 500 : mapped.status }
      );
    }

    // Activation accepts only a ready marker in server-controlled app metadata.
    // Marking ready happens after the exact DB bind and before any email is sent;
    // a failed update leaves the pending profile unusable and safely retryable.
    const { data: boundAuthData, error: boundAuthError } = await supabaseAdmin.auth.admin.getUserById(user.id);
    if (boundAuthError || !boundAuthData.user) {
      return NextResponse.json(
        { success: false, message: "Привязка выполнена, но приглашение ещё не готово. Повторите отправку." },
        { status: 503 }
      );
    }
    const currentAppMetadata = boundAuthData.user.app_metadata ?? {};
    const { error: readyError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...currentAppMetadata,
        [GENERIC_INVITATION_MARKER]: {
          state: "ready",
          company_id: targetCompanyId,
          role: normalizedRole,
          is_owner: false,
        },
      },
    });
    if (readyError) {
      return NextResponse.json(
        { success: false, message: "Привязка выполнена, но приглашение ещё не готово. Повторите отправку." },
        { status: 503 }
      );
    }

    // Recovery is intentionally the final step: no email is sent until the
    // exact tenant/role binding has committed. The same pending account can retry.
    const { error: recoveryError } = await supabaseAdmin.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo,
    });

    if (recoveryError) {
      return NextResponse.json(
        { success: false, message: "Аккаунт подготовлен, но письмо не отправлено. Повторите приглашение." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Recovery invite link sent successfully",
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (err: any) {
    if (err instanceof TrafficInvitationError) {
      return NextResponse.json({ success: false, message: err.message }, { status: err.status, headers: { "Cache-Control": "no-store, private" } });
    }
    if (err instanceof SessionAuthError) {
      return NextResponse.json({ success: false, message: err.message }, { status: err.status });
    }
    console.error("Invite user error:", err);
    return NextResponse.json(
      { success: false, message: errorToText(err) },
      { status: 500 }
    );
  }
}

// Active unlinked personnel for an explicit administrator selection; no inferred name matching.
export async function GET(request: NextRequest) {
  try {
    const actor = await getServerActorFromSession(request, { ignoreImpersonation: true, skipCache: true });
    const companyId = resolveCompanyForActor(actor, request.nextUrl.searchParams.get("company_id"));
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await assertActorAccess({ supabase: db, actorUserId: actor.id, companyId, allowedRoles: ["global_admin", "company_admin"] });
    const people: Array<{ id: string; full_name: string }> = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await db.from("company_people").select("id,full_name")
        .eq("company_id", companyId).eq("status", "active").is("deleted_at", null).is("user_id", null)
        .order("full_name").order("id").range(from, from + 499);
      if (error) throw error;
      people.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
    }
    return NextResponse.json({ people }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SessionAuthError ? error.message : "Не удалось загрузить сотрудников" },
      { status: error instanceof SessionAuthError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
