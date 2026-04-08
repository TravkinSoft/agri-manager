import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonError(message: string, status: number, details?: unknown) {
  return new Response(
    JSON.stringify({ error: message, details: details ?? null }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return jsonError("Server configuration error", 500);
    }

    let body: { email?: string; role?: string; company_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const { email, role, company_id } = body;

    if (!email || !role || !company_id) {
      return jsonError(`Missing required fields: ${[!email && "email", !role && "role", !company_id && "company_id"].filter(Boolean).join(", ")}`, 400);
    }

    const validRoles = ["admin", "agronomist", "specialist", "warehouse"];
    if (!validRoles.includes(role)) {
      return jsonError(`Invalid role "${role}". Must be one of: ${validRoles.join(", ")}`, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const origin = req.headers.get("origin") || supabaseUrl;
    const redirectTo = `${origin}/auth/callback`;

    console.log(`Inviting user: email=${email}, role=${role}, company_id=${company_id}, redirectTo=${redirectTo}`);

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        role,
        invited_by_company: company_id,
      },
      redirectTo,
    });

    if (error) {
      console.error("Supabase inviteUserByEmail error:", JSON.stringify(error));
      return jsonError(error.message, 400, { code: error.status, name: error.name });
    }

    console.log(`Invitation sent successfully to ${email}, user id: ${data.user?.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Invitation sent to ${email}`,
        user_id: data.user?.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("Unhandled error in invite-user function:", message);
    return jsonError(message, 500);
  }
});
