import { NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service";
import {
  failed,
  noStore,
  sameOrigin,
  TrafficError,
} from "@/lib/traffic/server";
import {
  newToken,
  SESSION_SECONDS,
  tokenHash,
  TRAFFIC_COOKIE,
  verifyPassword,
} from "@/lib/traffic/credentials";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const login = z
  .object({
    login: z
      .string()
      .trim()
      .toLowerCase()
      .min(6)
      .max(40)
      .regex(/^[a-z0-9-]+$/),
    password: z.string().min(1).max(128),
  })
  .strict();
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/traffic",
};
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = login.parse(await request.json());
    const db = getServiceClient();
    // Vercel supplies x-forwarded-for. Hash IP; never persist the password, IP or bearer token.
    const ip = (
      request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown"
    ).trim();
    // Reject an exhausted source before allocating more per-login limit rows.
    const ipLimit = await db.rpc("ptc_take_login_attempt_v1", {
      p_key: `ip:${tokenHash(ip)}`,
      p_limit: 50,
    });
    if (ipLimit.error) throw new TrafficError("Вход временно недоступен", 503);
    if (!ipLimit.data)
      throw new TrafficError("Слишком много попыток. Подождите 10 минут", 429);
    const accountLimit = await db.rpc("ptc_take_login_attempt_v1", {
      p_key: `login:${tokenHash(input.login)}`,
      p_limit: 10,
    });
    if (accountLimit.error)
      throw new TrafficError("Вход временно недоступен", 503);
    if (!accountLimit.data)
      throw new TrafficError("Слишком много попыток. Подождите 10 минут", 429);
    const { data: access, error } = await db
      .from("ptc_access")
      .select("id,company_id,person_id,password_hash")
      .eq("login", input.login)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    // Same expensive derivation for unknown accounts to reduce account enumeration.
    const valid = await verifyPassword(
      input.password,
      access?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!access || !valid)
      throw new TrafficError("Неверный логин или пароль", 401);
    const { data: person, error: personError } = await db
      .from("company_people")
      .select("id")
      .eq("id", access.person_id)
      .eq("company_id", access.company_id)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    if (personError) throw personError;
    if (!person) throw new TrafficError("Неверный логин или пароль", 401);
    const token = newToken();
    const { error: sessionError } = await db.from("ptc_sessions").insert({
      access_id: access.id,
      token_hash: tokenHash(token),
      expires_at: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
    });
    if (sessionError) throw sessionError;
    const response = noStore({ ok: true });
    response.cookies.set(TRAFFIC_COOKIE, token, {
      ...cookieOptions,
      maxAge: SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    return failed(error);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    const token = request.cookies.get(TRAFFIC_COOKIE)?.value;
    if (token) {
      const { error } = await getServiceClient()
        .from("ptc_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token_hash", tokenHash(token));
      if (error) throw error;
    }
    const response = noStore({ ok: true });
    response.cookies.set(TRAFFIC_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    return failed(error);
  }
}
