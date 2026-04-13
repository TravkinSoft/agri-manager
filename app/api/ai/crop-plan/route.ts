import { NextRequest, NextResponse } from "next/server";

type CropPlanRequest = {
  season_id?: string;
  mode?: "copy_previous" | "optimize_rotation" | "fill_crop";
  crop_id?: string;
  field_ids?: string[];
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as CropPlanRequest;

  return NextResponse.json(
    {
      ok: true,
      status: "not_implemented_yet",
      message:
        "AI crop plan endpoint is reserved for next step. Use crop structure UI actions for planning now.",
      request: {
        season_id: body.season_id ?? null,
        mode: body.mode ?? null,
        crop_id: body.crop_id ?? null,
        field_ids_count: Array.isArray(body.field_ids) ? body.field_ids.length : 0,
      },
    },
    { status: 501 },
  );
}
