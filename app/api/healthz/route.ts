import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    environment: process.env.VERCEL_ENV || "development",
    deployment: process.env.VERCEL_URL || "local",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || null,
    generatedAt: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
