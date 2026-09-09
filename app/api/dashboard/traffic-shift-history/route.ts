import { NextRequest } from "next/server";
import { dashboardAgronomist, failed, noStore, TrafficError } from "@/lib/traffic/server";
import {
  readClosedTrafficShiftHistoryPage,
  readClosedTrafficShiftSummaryById,
  TrafficShiftHistoryInputError,
  TrafficShiftReconstructionLimitError,
} from "@/lib/traffic/shift-summary-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 25;

function pageSize(value: string | null) {
  if (!value) return DEFAULT_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new TrafficError("Некорректный размер страницы истории смен", 400);
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export async function GET(request: NextRequest) {
  try {
    if (process.env.DASHBOARD_DATA_V2 !== "1")
      throw new TrafficError("История смен пока не включена", 404);
    const { companyId } = await dashboardAgronomist(request);

    const shiftId = request.nextUrl.searchParams.get("shiftId");
    if (shiftId) {
      return noStore({
        summary: await readClosedTrafficShiftSummaryById(companyId, shiftId),
      });
    }
    return noStore({
      page: await readClosedTrafficShiftHistoryPage(companyId, {
        cursor: request.nextUrl.searchParams.get("cursor"),
        limit: pageSize(request.nextUrl.searchParams.get("limit")),
      }),
    });
  } catch (error) {
    return failed(
      error instanceof TrafficShiftHistoryInputError
        ? new TrafficError("Некорректный запрос истории смен", 400)
        : error instanceof TrafficShiftReconstructionLimitError
          ? new TrafficError(
              "Смена выходит за безопасный лимит детализации; итог не рассчитан",
              422,
            )
          : error,
    );
  }
}
