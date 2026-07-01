import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function parseBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = String(match?.[1] || "").trim();
  return token || null;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const token = parseBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: "Missing authorization token" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Supabase auth is not configured" }, { status: 500 });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    const user = userData.user;
    if (userError || !user?.id || !isUuidLike(user.id)) {
      return NextResponse.json({ error: "Invalid or expired confirmation session" }, { status: 401 });
    }

    if (!user.email_confirmed_at && !user.confirmed_at) {
      return NextResponse.json({ error: "Email is not confirmed yet" }, { status: 403 });
    }

    const supabase = getServiceClient();
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,status")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) {
      return NextResponse.json({ error: profileError.message || "Failed to load profile" }, { status: 500 });
    }
    if (!profile?.id) {
      return NextResponse.json({ error: "Profile was not created" }, { status: 404 });
    }

    const currentStatus = String(profile.status || "pending").trim().toLowerCase();
    if (currentStatus === "revoked") {
      return NextResponse.json({ error: "Invitation was revoked by administrator" }, { status: 403 });
    }
    if (currentStatus === "inactive" || currentStatus === "disabled") {
      return NextResponse.json({ error: "Account is disabled by administrator" }, { status: 403 });
    }
    if (currentStatus !== "pending" && currentStatus !== "active") {
      return NextResponse.json({ error: `Account cannot be activated from status: ${currentStatus}` }, { status: 403 });
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message || "Failed to activate profile" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: "active" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to complete signup" },
      { status: 500 }
    );
  }
}
