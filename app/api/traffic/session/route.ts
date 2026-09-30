import { noStore } from "@/lib/traffic/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Retired endpoint: no legacy sessions/grants/cookies are read or mutated.
function retired() {
  return noStore(
    {
      error:
        "Используйте обычный вход TravkinFlow по приглашённой почте и паролю",
    },
    410,
  );
}
export const GET = retired;
export const POST = retired;
export const DELETE = retired;
