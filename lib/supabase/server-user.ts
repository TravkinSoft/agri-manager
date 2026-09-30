import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export function getAuthenticatedServerClient(request: NextRequest): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = String(request.headers.get("authorization") || "").trim();
  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase public credentials are not configured");
  }
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    throw new Error("Authenticated Supabase bearer token is required");
  }
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
