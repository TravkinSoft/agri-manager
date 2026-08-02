import { NextRequest, NextResponse } from "next/server";
import {
  SessionAuthError,
  getServerActorFromSession,
  getUserScopedClientFromRequest,
  resolveCompanyForActor,
} from "@/lib/auth/server-session";

type NotificationPreferences = {
  email_enabled: boolean;
  operation_updates_enabled: boolean;
  warehouse_updates_enabled: boolean;
};

const defaults: NotificationPreferences = {
  email_enabled: true,
  operation_updates_enabled: true,
  warehouse_updates_enabled: true,
};

function errorResponse(error: unknown) {
  if (error instanceof SessionAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Notification settings request failed";
  return NextResponse.json({ error: message }, { status: 500 });
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new SessionAuthError(`${field} must be a boolean`, 400);
  }
  return value;
}

async function resolveSession(request: NextRequest, requestedCompanyId: string | null) {
  const actor = await getServerActorFromSession(request);
  if (String(actor.status || "active") !== "active") {
    throw new SessionAuthError("Inactive users cannot change notification settings", 403);
  }
  const companyId = resolveCompanyForActor(actor, requestedCompanyId);
  if (actor.role !== "global_admin" && actor.companyId !== companyId) {
    throw new SessionAuthError("Actor does not belong to the target company", 403);
  }
  const supabase = await getUserScopedClientFromRequest(request);
  return { actor, companyId, supabase };
}

export async function GET(request: NextRequest) {
  try {
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const { actor, companyId, supabase } = await resolveSession(request, requestedCompanyId);
    const { data, error } = await supabase
      .from("user_notification_preferences")
      .select("email_enabled,operation_updates_enabled,warehouse_updates_enabled")
      .eq("profile_id", actor.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      preferences: data || defaults,
      persisted: Boolean(data),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const requestedCompanyId = String(body.companyId || "").trim() || null;
    const { actor, companyId, supabase } = await resolveSession(request, requestedCompanyId);
    const preferences: NotificationPreferences = {
      email_enabled: parseBoolean(body.email_enabled, "email_enabled"),
      operation_updates_enabled: parseBoolean(
        body.operation_updates_enabled,
        "operation_updates_enabled"
      ),
      warehouse_updates_enabled: parseBoolean(
        body.warehouse_updates_enabled,
        "warehouse_updates_enabled"
      ),
    };

    const { data, error } = await supabase
      .from("user_notification_preferences")
      .upsert(
        {
          profile_id: actor.id,
          company_id: companyId,
          ...preferences,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "profile_id,company_id" }
      )
      .select("email_enabled,operation_updates_enabled,warehouse_updates_enabled")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ preferences: data });
  } catch (error) {
    return errorResponse(error);
  }
}
