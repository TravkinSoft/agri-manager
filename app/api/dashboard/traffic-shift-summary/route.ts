import { NextRequest } from "next/server";
import { failed, manager, noStore, TrafficError } from "@/lib/traffic/server";
import {
  readLatestClosedTrafficShiftSummary,
  TrafficShiftReconstructionLimitError,
} from "@/lib/traffic/shift-summary-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { actor, companyId } = await manager(request);
    if (actor.role !== "agronomist")
      throw new TrafficError("Итог смены доступен только агроному", 403);
    return noStore({
      summary: await readLatestClosedTrafficShiftSummary(companyId),
    });
  } catch (error) {
    return failed(
      error instanceof TrafficShiftReconstructionLimitError
        ? new TrafficError(
            "Смена выходит за безопасный лимит детализации; итог не рассчитан",
            422,
          )
        : error,
    );
  }
}
