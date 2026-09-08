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
import { vehicleAllowsMachineOperator } from "@/lib/vehicles/driver-name";
import { isTrailerTransport, resolveTransportIdentity } from "@/lib/weighbridge/transport";

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

function normalizeInitialWorkspace(
  payload: Record<string, any> | null | undefined,
  assignmentBridges: Record<string, any>[] = [],
  machineSourceRows: Record<string, any>[] = [],
  resourceErrors: Record<string, string>[] = [],
) {
  if (!payload) return null;
  const rawVehicles = (Array.isArray(payload.vehicles) ? payload.vehicles : [])
    .filter((row: any) => !row?.source_machine_id);
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
  const machineRows = machineSourceRows.map((row: any) => {
    const globalModel = Array.isArray(row.global_model)
      ? row.global_model[0]
      : row.global_model;
    const identity = resolveTransportIdentity({
      ...row,
      plate: row.license_plate,
    });
    return {
      id: String(row.id),
      name: identity.name,
      model: String(globalModel?.full_name || row.full_name || row.model || row.name || ""),
      plate: identity.plate,
      searchTerms: identity.searchTerms,
      type: String(row.type || row.machinery_type || ""),
      fleetType: String(row.machinery_type || row.type || ""),
      transportCategory: String(globalModel?.category || row.category || ""),
      source: "reference_machines" as const,
      primaryPersonnelId: null,
    };
  });

  const legacyDrivers = Array.isArray(payload.legacyDrivers) ? payload.legacyDrivers : [];
  const people = Array.isArray(payload.people) ? payload.people : [];
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const legacyPersonById = new Map<string, { personId: string; personnelType: string }>();
  const driverNames: Record<string, string> = {};
  legacyDrivers.forEach((row: any) => {
    const legacyId = String(row.id || "");
    if (legacyId) {
      driverNames[legacyId] = String(
        row.name_ru || row.full_name || row.name_en || row.name_kz || "Водитель"
      );
    }
  });
  profiles.forEach((row: any) => {
    if (row.id) driverNames[String(row.id)] = String(row.full_name || row.email || "Водитель");
  });
  assignmentBridges.forEach((row: any) => {
    const legacyId = String(row.id || "");
    if (legacyId && row.person_id && row.status === "active" && row.archived === false &&
        (row.personnel_type === "driver" || row.personnel_type === "machine_operator")) {
      legacyPersonById.set(legacyId, {
        personId: String(row.person_id),
        personnelType: String(row.personnel_type),
      });
    }
  });

  const personnelRoleById = new Map<string, string>();
  people.forEach((row: any) => {
    if (row.id) personnelRoleById.set(String(row.id), String(row.role_type || ""));
  });
  const byDriver = new Map<string, string[]>();
  vehicleRows.forEach((vehicle) => {
    if (!vehicle.primaryPersonnelId) return;
    const bridge = legacyPersonById.get(vehicle.primaryPersonnelId);
    if (!bridge) return;
    const role = personnelRoleById.get(bridge.personId);
    const compatible = (bridge.personnelType === "driver" && role === "driver") ||
      (bridge.personnelType === "machine_operator" && role === "mechanic_operator" &&
        vehicleAllowsMachineOperator(vehicle));
    if (!compatible) return;
    byDriver.set(bridge.personId, [...(byDriver.get(bridge.personId) || []), vehicle.id]);
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
      vehicles: [...vehicleRows.filter((row) => !isTrailerTransport(row)), ...machineRows]
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
      trailers: vehicleRows.filter((row) => isTrailerTransport(row)),
      drivers,
      driverNames,
      combineOperators,
      resourceErrors,
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
    const initialWorkspace = payload.initial_workspace as Record<string, any> | null | undefined;
    const initialVehicles = initialWorkspace && Array.isArray(initialWorkspace.vehicles)
      ? initialWorkspace.vehicles
      : [];
    const assignmentBridgeIds = Array.from(new Set(
      initialVehicles
        .map((row: any) => String(row?.primary_responsible_personnel_id || ""))
        .filter(Boolean),
    ));
    const bridgesStartedAt = performance.now();
    const bridgePromise = assignmentBridgeIds.length > 0
      ? supabase
        .from("reference_specialists")
        .select("id,person_id,personnel_type,status,archived")
        .eq("company_id", requestedCompanyId)
        .in("id", assignmentBridgeIds)
      : Promise.resolve({ data: [], error: null });
    const machinesStartedAt = performance.now();
    const machinePromise = initialWorkspace
      ? supabase
        .from("reference_machines")
        .select("id,name,full_name,brand,model,series,license_plate,source_raw_name,type,category,machinery_type,status,is_active,archived,global_model:global_machine_model_id(full_name,category)")
        .eq("company_id", requestedCompanyId)
        .eq("is_active", true)
        .eq("archived", false)
        .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null });
    const [bridgeResult, machineResult] = await Promise.all([bridgePromise, machinePromise]);
    const bridgesMs = performance.now() - bridgesStartedAt;
    const machinesMs = performance.now() - machinesStartedAt;
    if (bridgeResult.error) {
      return NextResponse.json(
        { error: "Не удалось проверить актуальные привязки водителей." },
        { status: bridgeResult.error.code === "42501" ? 403 : 500 },
      );
    }
    const assignmentBridges = (bridgeResult.data || []) as Record<string, any>[];
    const initialMachines = (machineResult.data || []) as Record<string, any>[];
    const initialResourceErrors = machineResult.error
      ? [{
          resource: "reference_machines",
          code: "WB_RESOURCES_MACHINES",
          message: "Не удалось загрузить тракторы и технику. Остальные данные сохранены.",
        }]
      : [];
    const response = NextResponse.json({
      ...(payload.operator_state || {}),
      initial_workspace: normalizeInitialWorkspace(
        initialWorkspace,
        assignmentBridges,
        initialMachines,
        initialResourceErrors,
      ),
    });
    response.headers.set(
      "Server-Timing",
      `initial_workspace_rpc;dur=${rpcMs.toFixed(1)}, assignment_bridges;dur=${bridgesMs.toFixed(1)}, machines;dur=${machinesMs.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`
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
