import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getInviteSetPasswordRedirectTo } from "@/lib/utils/app-url";
import { assertActorAccess } from "@/lib/auth/server-acl";
import { SessionAuthError, getServerActorFromSession, resolveCompanyForActor } from "@/lib/auth/server-session";

const GLOBAL_ADMIN_ALLOWED_TARGETS = [
  "company_admin",
  "agronomist",
  "director",
  "legal_operator",
  "specialist",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "fuel_operator",
  "brigadier",
  "mechanic_operator",
  "vegetable_brigadier",
] as const;
const COMPANY_ADMIN_ALLOWED_TARGETS = [
  "agronomist",
  "director",
  "legal_operator",
  "specialist",
  "warehouse",
  "warehouse_operator",
  "weighman",
  "fuel_operator",
  "brigadier",
  "mechanic_operator",
  "vegetable_brigadier",
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
    const trafficInvite = normalizedRole === "mechanic_operator" || normalizedRole === "vegetable_brigadier";
    const normalizedFullName = String(full_name).trim().replace(/\s+/g, " ");

    if (!normalizedFullName) {
      return NextResponse.json({ success: false, message: "Full name is required" }, { status: 400 });
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedFullName.length > 150) {
        return NextResponse.json({ success: false, message: "Проверьте email и ФИО" }, { status: 400 });
      }
      if (personId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) {
          return NextResponse.json({ success: false, message: "Выберите сотрудника компании" }, { status: 400 });
        }
        const { data: person, error: personError } = await supabaseAdmin.from("company_people")
          .select("id,user_id").eq("id", personId).eq("company_id", targetCompanyId)
          .eq("status", "active").is("deleted_at", null).maybeSingle();
        if (personError) throw personError;
        if (!person) return NextResponse.json({ success: false, message: "Сотрудник не найден в этой компании" }, { status: 403 });
        if (person.user_id) return NextResponse.json({ success: false, message: "У сотрудника уже есть аккаунт. Используйте управление существующим пользователем." }, { status: 409 });
      } else if (create_person !== true) {
        return NextResponse.json({ success: false, message: "Выберите сотрудника или явно укажите, что он новый" }, { status: 400 });
      }
    }

    const redirectTo = getInviteSetPasswordRedirectTo();
    let shouldSendRecoveryEmail = false;

    let userId: string | null = null;

    const allUsers: Array<{ id: string; email?: string }> = [];
    let page = 1;
    const perPage = 200;
    while (true) {
      const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (usersError) {
        return NextResponse.json({ success: false, message: usersError.message }, { status: 500 });
      }

      const chunk = usersPage.users || [];
      allUsers.push(...chunk.map((u) => ({ id: u.id, email: u.email || undefined })));
      if (chunk.length < perPage) break;
      page += 1;
    }

    const existingUser = allUsers.find((u) => u.email?.toLowerCase() === normalizedEmail);
    const freshAuth = !existingUser;
    if (trafficInvite && existingUser) {
      const { data: target, error: targetError } = await supabaseAdmin.from("profiles")
        .select("company_id,role,status").eq("id", existingUser.id).maybeSingle();
      if (targetError) throw targetError;
      if (target && (target.company_id !== targetCompanyId || target.role !== normalizedRole || target.status !== "pending")) {
        return NextResponse.json({ success: false, message: "Этот email уже связан с аккаунтом. Не меняем его компанию или роль через новое приглашение; управляйте существующим пользователем." }, { status: 409 });
      }
    }

    if (!existingUser) {
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        normalizedEmail,
        {
          redirectTo,
          data: {
            role: normalizedRole,
            invited_by_company: targetCompanyId,
            full_name: normalizedFullName,
          },
        }
      );

      if (!inviteError && inviteData?.user?.id) {
        userId = inviteData.user.id;
      } else if (inviteError) {
        const lowerInviteError = errorToText(inviteError).toLowerCase();
        const alreadyExistsByInvite =
          lowerInviteError.includes("already been registered") ||
          lowerInviteError.includes("already exists") ||
          lowerInviteError.includes("user already registered");

        if (alreadyExistsByInvite) {
          const fallbackExisting = allUsers.find((u) => u.email?.toLowerCase() === normalizedEmail);
          userId = fallbackExisting?.id || null;
          shouldSendRecoveryEmail = true;
        } else {
          // Fallback path: some projects return opaque {} from invite endpoint
          // when DB trigger blocks invite creation. We continue with createUser flow.
          userId = null;
        }
      }
    }

    if (existingUser && !userId) {
      userId = existingUser.id;
      shouldSendRecoveryEmail = true;
    }

    if (!userId) {
      const { data: createdUserData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: !trafficInvite,
        user_metadata: {
          role: normalizedRole,
          invited_by_company: targetCompanyId,
          full_name: normalizedFullName,
        },
      });

      if (createError) {
        return NextResponse.json(
          { success: false, message: `Create user failed: ${errorToText(createError)}` },
          { status: 400 }
        );
      }

      userId = createdUserData.user?.id || null;
      shouldSendRecoveryEmail = true;
    }

    if (!userId) {
      return NextResponse.json({ success: false, message: "Failed to resolve user ID" }, { status: 500 });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    const { data: profileAfterTrigger } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (trafficInvite) {
      const { error: bindingError } = await supabaseAdmin.rpc("ptc_bind_invited_profile_v1", {
        p_actor: actor.id, p_user: userId, p_company: targetCompanyId, p_role: normalizedRole,
        p_name: normalizedFullName, p_email: normalizedEmail, p_person: personId || null,
        p_create_person: create_person === true, p_fresh_auth: freshAuth,
      });
      if (bindingError) {
        const messages: Record<string, string> = {
          PTC_SELECT_EXISTING_PERSON: "Такой сотрудник уже есть. Выберите его из списка — дубль не создаём.",
          PTC_PERSON_ALREADY_LINKED_OR_UNAVAILABLE: "Сотрудник уже связан с аккаунтом или недоступен. Обновите список.",
          PTC_USER_ALREADY_LINKED: "Этот аккаунт уже связан с другим сотрудником.",
          PTC_EXISTING_ACCOUNT_CONFLICT: "Не изменяем компанию или роль существующего аккаунта через приглашение.",
        };
        const message = Object.entries(messages).find(([key]) => bindingError.message.includes(key))?.[1];
        return NextResponse.json({ success: false, message: message || "Не удалось связать приглашение с сотрудником. Доступ PTC не выдан; проверьте пользователя перед повтором." }, { status: 409 });
      }
    } else if (profileAfterTrigger) {
      await supabaseAdmin
        .from("profiles")
        .update({ status: "pending", company_id: targetCompanyId, role: normalizedRole, full_name: normalizedFullName })
        .eq("id", userId);
    } else {
      await supabaseAdmin
        .from("profiles")
        .insert({
          id: userId,
          full_name: normalizedFullName,
          email: normalizedEmail,
          role: normalizedRole,
          company_id: targetCompanyId,
          status: "pending",
          is_owner: false,
        });
    }

    if (shouldSendRecoveryEmail) {
      const { error: recoveryError } = await supabaseAdmin.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });

      if (recoveryError) {
        return NextResponse.json(
          { success: false, message: `Failed to send recovery invite email: ${errorToText(recoveryError)}` },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: shouldSendRecoveryEmail
        ? "Recovery invite link sent successfully"
        : "Invitation link sent successfully",
    });
  } catch (err: any) {
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
