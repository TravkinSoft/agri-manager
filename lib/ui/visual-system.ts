export const VISUAL_SYSTEM_SCOPES = [
  "shell",
  "dashboard",
  "weather",
  "tickets",
  "analytics",
  "cropStructure",
  "warehouses",
  "weighbridge",
] as const;

export type VisualSystemScope = (typeof VISUAL_SYSTEM_SCOPES)[number];
export type VisualSystemMode = "off" | "pilot" | "on";

const PROTECTED_SCOPES = new Set<VisualSystemScope>(["weighbridge"]);

function readMode(value: string | undefined): VisualSystemMode {
  return value === "pilot" || value === "on" ? value : "off";
}

function readScopes(value: string | undefined): ReadonlySet<VisualSystemScope> {
  const knownScopes = new Set<string>(VISUAL_SYSTEM_SCOPES);
  return new Set(
    String(value || "")
      .split(",")
      .map((scope) => scope.trim())
      .filter((scope): scope is VisualSystemScope => knownScopes.has(scope))
  );
}

export const visualSystemConfig = Object.freeze({
  mode: readMode(process.env.NEXT_PUBLIC_TRAVKIN_VISUAL_V2),
  scopes: readScopes(process.env.NEXT_PUBLIC_TRAVKIN_VISUAL_V2_SCOPES),
});

export function isVisualSystemV2Enabled(scope: VisualSystemScope): boolean {
  if (PROTECTED_SCOPES.has(scope) || visualSystemConfig.mode === "off") return false;
  if (visualSystemConfig.mode === "on") return true;
  return visualSystemConfig.scopes.has(scope);
}
