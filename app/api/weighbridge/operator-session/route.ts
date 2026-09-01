import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_OPERATOR_COOKIE,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import {
  SessionAuthError,
  getUserScopedClientFromRequest,
} from "@/lib/auth/server-session";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import { isCargoVehicle, isTrailerTransport, resolveTransportIdentity } from "@/lib/weighbridge/transport";

const OPERATOR_SESSION_ROLES = ["global_admin", "company_admin", "director", "weighman"] as const;
const WEIGHBRIDGE_PERSONNEL_ROLES = new Set(["driver", "mechanic_operator"]);

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  // The database enforces the 24-hour sliding inactivity window. The browser
  // cookie lives longer so an active shift survives browser and PC restarts.
  maxAge: 30 * 24 * 60 * 60,
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

function normalizeInitialWorkspace(payload: Record<string, any> | null | undefined) {
  if (!payload) return null;
  const rawVehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
  const vehicleRows = rawVehicles.map((row: any) => {
    const transportModel = Array.isArray(row.transport_model)
      ? row.transport_model[0]
      : row.transport_model;
    const identity = resolveTransportIdentity(row);
    return {
      id: String(row.id),
      name: identity.name,
      model: String(transportModel?.full_name || row.model || row.name || ""),
      plate: identity.plate,
      searchTerms: identity.searchTerms,
      type: String(row.type || ""),
      fleetType: String(row.fleet_type || ""),
      transportCategory: String(transportModel?.category || ""),
      source: "reference_vehicles" as const,
      primaryPersonnelId: row.primary_responsible_personnel_id
        ? String(row.primary_responsible_personnel_id)
        : null,
    };
  });

  const legacyDrivers = Array.isArray(payload.legacyDrivers) ? payload.legacyDrivers : [];
  const people = Array.isArray(payload.people) ? payload.people : [];
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const legacyPersonById = new Map<string, string>();
  const driverNames: Record<string, string> = {};
  legacyDrivers.forEach((row: any) => {
    const legacyId = String(row.id || "");
    if (row.person_id) legacyPersonById.set(legacyId, String(row.person_id));
    if (legacyId) {
      driverNames[legacyId] = String(
        row.name_ru || row.full_name || row.name_en || row.name_kz || "Водитель"
      );
    }
  });
  profiles.forEach((row: any) => {
    if (row.id) driverNames[String(row.id)] = String(row.full_name || row.email || "Водитель");
  });

  const byDriver = new Map<string, string[]>();
  vehicleRows.forEach((vehicle) => {
    if (!vehicle.primaryPersonnelId) return;
    const canonicalPersonId = legacyPersonById.get(vehicle.primaryPersonnelId);
    if (!canonicalPersonId) return;
    byDriver.set(canonicalPersonId, [...(byDriver.get(canonicalPersonId) || []), vehicle.id]);
  });

  const drivers = people
    .filter((row: any) => WEIGHBRIDGE_PERSONNEL_ROLES.has(String(row.role_type || "")))
    .map((row: any) => {
      const id = String(row.id);
      const name = String(row.full_name || "Сотрудник");
      driverNames[id] = name;
      return {
        id,
        name,
        machineId: null,
        roleType: String(row.role_type || ""),
        position: String(row.position || ""),
        department: String(row.department || ""),
        assignedVehicleIds: byDriver.get(id) || [],
      };
    });
  const combineOperators = people.map((row: any) => ({
    id: String(row.id),
    name: String(row.full_name || "Сотрудник"),
    roleType: String(row.role_type || ""),
    position: String(row.position || ""),
    department: String(row.department || ""),
  }));

  const byField: Record<string, any[]> = {};
  const incompleteByField: Record<string, boolean> = {};
  (Array.isArray(payload.allocations) ? payload.allocations : []).forEach((row: any) => {
    const fieldId = String(row.fieldId || "");
    if (!fieldId) return;
    const allocation = {
      ...row,
      fieldId: undefined,
      allocationId: String(row.allocationId || ""),
      areaHa: Number(row.areaHa || 0),
      cropId: String(row.cropId || ""),
      varietyId: String(row.varietyId || ""),
      reproductionId: String(row.reproductionId || ""),
      isIncomplete: Boolean(row.isIncomplete),
    };
    byField[fieldId] = [...(byField[fieldId] || []), allocation];
    if (allocation.isIncomplete) incompleteByField[fieldId] = true;
  });

  return {
    resources: {
      fields: (Array.isArray(payload.fields) ? payload.fields : [])
        .filter((row: any) => !hasQaDataMarker(String(row.name || ""))),
      destinations: (Array.isArray(payload.destinations) ? payload.destinations : [])
        .filter((row: any) => !hasQaDataMarker(String(row.name || ""))),
      vehicles: vehicleRows.filter((row) => isCargoVehicle(row)),
      trailers: vehicleRows.filter((row) => isTrailerTransport(row)),
      drivers,
      driverNames,
      combineOperators,
      resourceErrors: [],
    },
    harvestAllocations: {
      seasonId: payload.seasonId ? String(payload.seasonId) : null,
      seasonYear: payload.seasonYear ? Number(payload.seasonYear) : null,
      byField,
      incompleteByField,
    },
  };
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const requestedCompanyId = String(request.nextUrl.searchParams.get("companyId") || "").trim() || null;
    const includeWorkspace = request.nextUrl.searchParams.get("workspace") === "true";
    if (!requestedCompanyId) {
      throw new SessionAuthError("Company is required", 400);
    }
    const supabase = await getUserScopedClientFromRequest(request);
    const token = request.cookies.get(WEIGHBRIDGE_OPERATOR_COOKIE)?.value || null;
    const rpcStartedAt = performance.now();
    const { data, error } = await supabase.rpc("weighbridge_initial_workspace_v1", {
      p_company_id: requestedCompanyId,
      p_session_token: token,
      p_include_workspace: includeWorkspace,
    });
    const rpcMs = performance.now() - rpcStartedAt;
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
    const payload = (data || {}) as Record<string, any>;
    const response = NextResponse.json({
      ...(payload.operator_state || {}),
      initial_workspace: normalizeInitialWorkspace(payload.initial_workspace),
    });
    response.headers.set(
      "Server-Timing",
      `initial_workspace_rpc;dur=${rpcMs.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`
    );
    return response;
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
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
    const rpcStartedAt = performance.now();
    const { data, error } = await supabase.rpc(rpcName, args);
    const rpcMs = performance.now() - rpcStartedAt;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const payload = (data || {}) as Record<string, any>;
    if (!payload.ok) {
      const code = String(payload.code || "unknown");
      return NextResponse.json({ ...payload, error: failureMessage(code) }, { status: statusForCode(code) });
    }
    const canonicalPayload = {
      ...payload,
      unlocked: true,
      session_expires_at: payload.session_expires_at ?? payload.expires_at ?? null,
    };
    const response = jsonWithOperatorCookie(canonicalPayload);
    response.headers.set(
      "Server-Timing",
      `operator_rpc;dur=${rpcMs.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`
    );
    return response;
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
