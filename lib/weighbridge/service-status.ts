// Deployment-controlled maintenance. No database flag and no business-data writes.
// Never automatically reopen the scale because a guessed deadline has elapsed.
export const WEIGHBRIDGE_SERVICE = {
  active: true,
  startedAt: "2026-09-14T18:44:00.000Z",
  message: "Сервисные работы",
} as const;

export function isWeighbridgePage(pathname: string) {
  return pathname === "/weighbridge" || pathname.startsWith("/weighbridge/");
}

export function isBlockedWeighbridgeWrite(pathname: string, method: string, active: boolean) {
  return active
    && (pathname === "/api/weighbridge" || pathname.startsWith("/api/weighbridge/"))
    && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function serviceElapsed(nowMs: number, startedAt: string) {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 1000)) || 0;
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
}
