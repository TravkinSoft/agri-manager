import { NextRequest, NextResponse } from "next/server";
import { loadCropCareSchemes } from "@/lib/services/crop-care-schemes";
import { getCropCareRequestContext, jsonError } from "../_server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ctx = await getCropCareRequestContext(request, body.companyId);
    if (!ctx.season?.id) {
      return NextResponse.json({ due_steps: [], message: "Нет активного сезона." });
    }
    const schemes = await loadCropCareSchemes(ctx.supabase, ctx.companyId, ctx.season.id);
    const today = new Date();
    const dueSteps = schemes
      .filter((scheme) => scheme.status === "active")
      .flatMap((scheme) =>
        scheme.steps
          .filter((step) => {
            if (step.generated_operation_id || !step.planned_date) return false;
            const plannedDate = new Date(`${step.planned_date}T00:00:00`);
            plannedDate.setDate(plannedDate.getDate() - Number(step.lead_time_days || 0));
            return plannedDate <= today;
          })
          .map((step) => ({
            scheme_id: scheme.id,
            scheme_name: scheme.name,
            step_id: step.id,
            step_no: step.step_no,
            title: step.title,
            planned_date: step.planned_date,
            responsible_user_id: step.responsible_user_id,
          }))
      );

    return NextResponse.json({
      dry_run: true,
      due_steps: dueSteps,
      message: "V1 только показывает этапы к генерации. Автоматический cron не включён.",
    });
  } catch (error) {
    return jsonError(error, "Failed to prepare due crop care operations");
  }
}
