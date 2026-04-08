import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestOrigin } from "@/lib/utils/app-url";

const ALLOWED_ROLES = ["admin", "agronomist", "specialist", "warehouse"] as const;

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

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseServiceKey) {
    return NextResponse.json({ success: false, message: "Missing service role key" }, { status: 500 });
  }

  if (!supabaseUrl) {
    return NextResponse.json({ success: false, message: "Missing Supabase URL" }, { status: 500 });
  }

  try {
    const { email, role, company_id } = await request.json();
    if (!email || !role || !company_id) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedRole = String(role).trim().toLowerCase();

    if (!ALLOWED_ROLES.includes(normalizedRole as (typeof ALLOWED_ROLES)[number])) {
      return NextResponse.json({ success: false, message: "Invalid role" }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const origin = getRequestOrigin(request);
    const redirectTo = `${origin}/auth/callback?type=invite`;
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

    if (!existingUser) {
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        normalizedEmail,
        {
          redirectTo,
          data: {
            role: normalizedRole,
            invited_by_company: company_id,
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
        email_confirm: true,
        user_metadata: {
          role: normalizedRole,
          invited_by_company: company_id,
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

    if (profileAfterTrigger) {
      await supabaseAdmin
        .from("profiles")
        .update({ status: "pending", company_id, role: normalizedRole })
        .eq("id", userId);
    } else {
      await supabaseAdmin
        .from("profiles")
        .insert({
          id: userId,
          email: normalizedEmail,
          role: normalizedRole,
          company_id,
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
    console.error("Invite user error:", err);
    return NextResponse.json(
      { success: false, message: errorToText(err) },
      { status: 500 }
    );
  }
}
