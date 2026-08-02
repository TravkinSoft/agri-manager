import { NextRequest, NextResponse } from "next/server";
import {
  WEIGHBRIDGE_READ_ROLES,
  asSessionErrorResponse,
  resolveWeighbridgeSession,
} from "@/app/api/weighbridge/_auth";
import {
  publicHarvestTicketContext,
  resolveHarvestTicketContext,
} from "@/lib/server/harvest-ticket-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const fieldId = String(request.nextUrl.searchParams.get("fieldId") || "").trim();
    const allocationId = String(request.nextUrl.searchParams.get("allocationId") || "").trim();
    const { companyId, supabase } = await resolveWeighbridgeSession(request, {
      allowedRoles: WEIGHBRIDGE_READ_ROLES,
    });

    const context = await resolveHarvestTicketContext({
      supabase,
      companyId,
      fieldId,
      allocationId,
    });

    return NextResponse.json(publicHarvestTicketContext(context));
  } catch (error) {
    const sessionError = asSessionErrorResponse(error);
    if (sessionError) {
      return NextResponse.json({ error: sessionError.error }, { status: sessionError.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось определить уборку" },
      { status: 500 }
    );
  }
}
