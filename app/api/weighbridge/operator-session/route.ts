import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_OPERATOR_COOKIE,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

const OPERATOR_SESSION_ROLES = ["global_admin", "company_admin", "director", "weighman"] as const;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 12 * 60 * 60,
};

function statusForCode(code: string) {
  if (code === "invalid_pin") return 401;
  if (code === "pin_locked") return 423;
  if (code === "handover_required" || code === "pin_not_configured") return 409;
  return 400;
}

function failureMessage(code: string) {
  if (code === "invalid_pin") return "Неверный PIN.";
  if (code === "pin_locked") return "PIN временно заблокирован после пяти ошибок.";
  if (code === "handover_required") return "Смена принадлежит другому весовщику. Выполните передачу смены.";
  if (code === "pin_not_configured") return "Для весовщика ещё не настроен PIN.";
  return "Не удалось подтвердить весовщика.";
}

function jsonWithOperatorCookie(payload: Record<string, any>) {
  const token = String(payload.token || "");
  const safePayload = { ...payload };
  delete safePayload.token;
  const response = NextResponse.json(safePayload);
  if (token) response.cookies.set(WEIGHBRIDGE_OPERATOR_COOKIE, token, cookieOptions);
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: OPERATOR_SESSION_ROLES,
    });
    const token = request.cookies.get(WEIGHBRIDGE_OPERATOR_COOKIE)?.value || null;
    const { data, error } = await supabase.rpc("weighbridge_operator_session_state_v1", {
      p_company_id: companyId,
      p_session_token: token,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data || {});
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "unlock");
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: OPERATOR_SESSION_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });

    if (action === "lock") {
      const token = request.cookies.get(WEIGHBRIDGE_OPERATOR_COOKIE)?.value || "";
      const { data, error } = await supabase.rpc("lock_weighbridge_operator_session_v1", {
        p_company_id: companyId,
        p_session_token: token,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const response = NextResponse.json(data || { ok: true });
      response.cookies.set(WEIGHBRIDGE_OPERATOR_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      return response;
    }

    if (action !== "unlock" && action !== "handover") {
      return NextResponse.json({ error: "Неизвестное действие операторской сессии." }, { status: 400 });
    }

    const rpcName = action === "handover"
      ? "handover_weighbridge_shift_v1"
      : "open_or_unlock_weighbridge_shift_v1";
    const args = action === "handover"
      ? {
          p_company_id: companyId,
          p_person_id: String(body?.personId || ""),
          p_pin: String(body?.pin || ""),
          p_handover_note: String(body?.note || "").trim() || null,
        }
      : {
          p_company_id: companyId,
          p_person_id: String(body?.personId || ""),
          p_pin: String(body?.pin || ""),
          p_opening_note: String(body?.note || "").trim() || null,
        };
    const { data, error } = await supabase.rpc(rpcName, args);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const payload = (data || {}) as Record<string, any>;
    if (!payload.ok) {
      const code = String(payload.code || "unknown");
      return NextResponse.json({ ...payload, error: failureMessage(code) }, { status: statusForCode(code) });
    }
    const token = String(payload.token || "");
    const { data: sessionState, error: sessionStateError } = await supabase.rpc(
      "weighbridge_operator_session_state_v1",
      {
        p_company_id: companyId,
        p_session_token: token,
      }
    );
    if (sessionStateError) {
      return NextResponse.json({ error: sessionStateError.message }, { status: 400 });
    }
    return jsonWithOperatorCookie({ ...payload, ...(sessionState || {}), token });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
