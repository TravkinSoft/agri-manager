import { NextRequest, NextResponse } from "next/server";
import { asSessionErrorResponse, resolveWeighbridgeSession } from "@/app/api/weighbridge/_auth";

const ADMIN_ROLES = ["global_admin", "company_admin"] as const;

type AccessState = {
  person_id: string;
  is_weighbridge_operator: boolean;
  employee_status: string;
  pin_configured: boolean;
  access_enabled: boolean;
};

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function loadAccessState(
  supabase: Awaited<ReturnType<typeof resolveWeighbridgeSession>>["supabase"],
  companyId: string,
  personId: string
): Promise<AccessState> {
  const { data, error } = await supabase.rpc("weighbridge_operator_access_state_v1", {
    p_company_id: companyId,
    p_person_id: personId,
  });
  if (error) throw new Error(error.message);
  return data as AccessState;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const personId = String(params.id || "").trim();
    if (!isUuidLike(personId)) {
      return NextResponse.json({ error: "Некорректный идентификатор сотрудника." }, { status: 400 });
    }
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: ADMIN_ROLES,
    });
    return NextResponse.json(await loadAccessState(supabase, companyId, personId));
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось получить состояние доступа." },
      { status: 400 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const personId = String(params.id || "").trim();
    if (!isUuidLike(personId)) {
      return NextResponse.json({ error: "Некорректный идентификатор сотрудника." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    if (action !== "set_pin" && action !== "disable") {
      return NextResponse.json({ error: "Неизвестное действие." }, { status: 400 });
    }

    const pin = action === "set_pin" ? String(body?.pin || "") : null;
    if (action === "set_pin" && !/^\d{6}$/.test(pin || "")) {
      return NextResponse.json({ error: "PIN должен содержать ровно 6 цифр." }, { status: 400 });
    }

    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: ADMIN_ROLES,
      requestedCompanyId: String(body?.companyId || "").trim() || null,
    });
    const { error } = await supabase.rpc("set_weighbridge_operator_pin_v1", {
      p_company_id: companyId,
      p_person_id: personId,
      p_pin: pin,
      p_active: action === "set_pin",
    });
    if (error) throw new Error(error.message);

    return NextResponse.json(await loadAccessState(supabase, companyId, personId));
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить доступ к Весовой." },
      { status: 400 }
    );
  }
}
