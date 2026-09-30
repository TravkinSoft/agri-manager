import type { NextRequest } from "next/server";
import {
  assignmentCommand,
  assignmentContext,
  assignmentFailure,
  assignmentQuery,
  assignmentResponse,
  assignmentSameOrigin,
  readDriverAssignment,
  saveDriverAssignment,
} from "@/lib/vehicles/driver-assignment-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const input = assignmentQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    const context = await assignmentContext(request, input.companyId, false);
    return assignmentResponse(await readDriverAssignment(context, input.vehicleId));
  } catch (error) {
    return assignmentFailure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assignmentSameOrigin(request);
    const input = assignmentCommand.parse(await request.json());
    const context = await assignmentContext(request, input.companyId, true);
    return assignmentResponse(await saveDriverAssignment(context, input));
  } catch (error) {
    return assignmentFailure(error);
  }
}
