import { NextRequest, NextResponse } from "next/server";
import { WEIGHBRIDGE_SERVICE, isBlockedWeighbridgeWrite, isWeighbridgePage } from "@/lib/weighbridge/service-status";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isBlockedWeighbridgeWrite(pathname, request.method, WEIGHBRIDGE_SERVICE.active)) {
    return NextResponse.json({
      error: "На весовой идут сервисные работы. Талон не изменён. Дождитесь окончания работ.",
      code: "WEIGHBRIDGE_MAINTENANCE",
      ...WEIGHBRIDGE_SERVICE,
    }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
  if (WEIGHBRIDGE_SERVICE.active && isWeighbridgePage(pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/weighbridge-service";
    target.search = "";
    return NextResponse.rewrite(target, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/weighbridge/:path*", "/api/weighbridge/:path*"] };
