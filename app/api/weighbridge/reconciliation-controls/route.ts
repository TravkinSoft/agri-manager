import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  WEIGHBRIDGE_WRITE_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    let query = supabase
      .from("weighbridge_reconciliation_controls")
      .select("id,reconciliation_date,field_id,paper_total_kg,note,updated_at")
      .eq("company_id", companyId)
      .order("reconciliation_date", { ascending: false })
      .limit(180);
    if (from && ISO_DAY.test(from)) query = query.gte("reconciliation_date", from);
    if (to && ISO_DAY.test(to)) query = query.lte("reconciliation_date", to);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ controls: data || [] });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const day = String(body?.reconciliation_date || "").trim();
    const fieldId = String(body?.field_id || "").trim() || null;
    const paperTotal = body?.paper_total_kg == null || String(body.paper_total_kg).trim() === ""
      ? null
      : Number(body.paper_total_kg);
    const note = String(body?.note || "").trim() || null;
    if (!ISO_DAY.test(day)) return NextResponse.json({ error: "Некорректная дата сверки." }, { status: 400 });
    if (paperTotal != null && (!Number.isFinite(paperTotal) || paperTotal < 0)) {
      return NextResponse.json({ error: "Контрольный итог должен быть неотрицательным числом." }, { status: 400 });
    }

    const { actor, companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_WRITE_ROLES,
    });
    let existingQuery = supabase
      .from("weighbridge_reconciliation_controls")
      .select("id")
      .eq("company_id", companyId)
      .eq("reconciliation_date", day);
    existingQuery = fieldId ? existingQuery.eq("field_id", fieldId) : existingQuery.is("field_id", null);
    const { data: existing, error: findError } = await existingQuery.maybeSingle();
    if (findError) return NextResponse.json({ error: findError.message }, { status: 400 });

    const values = {
      company_id: companyId,
      reconciliation_date: day,
      field_id: fieldId,
      paper_total_kg: paperTotal,
      note,
      updated_by: actor.id,
    };
    const mutation = existing?.id
      ? supabase.from("weighbridge_reconciliation_controls").update(values).eq("id", existing.id)
      : supabase.from("weighbridge_reconciliation_controls").insert({ ...values, created_by: actor.id });
    const { data, error } = await mutation
      .select("id,reconciliation_date,field_id,paper_total_kg,note,updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ control: data });
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
