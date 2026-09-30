import { NextResponse } from "next/server";
import { WEIGHBRIDGE_SERVICE } from "@/lib/weighbridge/service-status";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ...WEIGHBRIDGE_SERVICE, serverNow: Date.now() }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
