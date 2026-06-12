import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function normalizeText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const fullName = normalizeText(body.fullName);
    const companyName = normalizeText(body.companyName);

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    if (!fullName || !companyName) {
      return NextResponse.json({ error: "Full name and company name are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      // Supabase Auth is configured to auto-confirm emails in this project.
      // App access is still blocked by profiles.status=pending until OTP is verified.
      email_confirm: true,
      user_metadata: {
        role: "company_admin",
        full_name: fullName,
        company_name: companyName,
      },
    });

    if (error) {
      const message = String(error.message || "Failed to create user");
      const status = /already|registered|exists/i.test(message) ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({ ok: true, userId: data.user?.id || null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to register company" },
      { status: 500 }
    );
  }
}
