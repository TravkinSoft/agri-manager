export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const release = process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    "local-development";
  return new Response(`self.__TRAVKINFLOW_PTC_RELEASE__=${JSON.stringify(release)};`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
