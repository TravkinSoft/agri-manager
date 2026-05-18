import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import { DEFAULT_ASSISTANT_PLATFORM_SETTINGS } from "@/lib/assistant/settings-types";
import { normalizeRoleKey, parseCanonicalRole } from "@/lib/auth/role-contract";

type JsonRecord = Record<string, unknown>;

function isObject(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T extends JsonRecord>(base: T, extra: JsonRecord): T {
  const out: JsonRecord = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (isObject(value) && isObject(out[key])) {
      out[key] = deepMerge(out[key] as JsonRecord, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

function normalizeRoleList(input: unknown): AssistantPlatformSettings["allowedRoles"] {
  if (!Array.isArray(input)) return [...DEFAULT_ASSISTANT_PLATFORM_SETTINGS.allowedRoles];
  const canonicalAllowSet = new Set(["global_admin", "company_admin", "agronomist", "director"]);
  const roles = input
    .map((item) => {
      const key = normalizeRoleKey(item);
      if (!canonicalAllowSet.has(key)) return null;
      return parseCanonicalRole(key);
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .filter((role) => canonicalAllowSet.has(role));
  const unique = Array.from(new Set(roles));
  return (unique.length ? unique : DEFAULT_ASSISTANT_PLATFORM_SETTINGS.allowedRoles) as AssistantPlatformSettings["allowedRoles"];
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function sanitizeSettings(payload: unknown): AssistantPlatformSettings {
  if (!isObject(payload)) return { ...DEFAULT_ASSISTANT_PLATFORM_SETTINGS };

  const merged = deepMerge(DEFAULT_ASSISTANT_PLATFORM_SETTINGS as JsonRecord, payload) as AssistantPlatformSettings;
  return {
    ...merged,
    allowedRoles: normalizeRoleList(merged.allowedRoles),
    allowedTools: normalizeStringArray(merged.allowedTools),
    forbiddenActions: normalizeStringArray(merged.forbiddenActions),
  };
}

export async function getAssistantPlatformSettings(
  supabase: SupabaseClient,
  actorUserId: string
): Promise<AssistantPlatformSettings> {
  // Primary storage (new table)
  const primary = await supabase
    .from("assistant_platform_settings")
    .select("config")
    .eq("scope", "global")
    .maybeSingle();

  if (!primary.error && primary.data?.config) {
    return sanitizeSettings(primary.data.config);
  }

  // Legacy fallback: keep working if migration wasn't applied yet.
  const legacy = await supabase
    .from("assistant_settings")
    .select("system_prompt")
    .eq("user_id", actorUserId)
    .maybeSingle();

  if (!legacy.error && legacy.data?.system_prompt) {
    const text = String(legacy.data.system_prompt || "").trim();
    const marker = "<assistant_platform_settings_json>";
    if (text.includes(marker)) {
      const jsonPart = text.slice(text.indexOf(marker) + marker.length).trim();
      try {
        return sanitizeSettings(JSON.parse(jsonPart));
      } catch {
        return { ...DEFAULT_ASSISTANT_PLATFORM_SETTINGS };
      }
    }
  }

  return { ...DEFAULT_ASSISTANT_PLATFORM_SETTINGS };
}

export async function saveAssistantPlatformSettings(
  supabase: SupabaseClient,
  actorUserId: string,
  settings: AssistantPlatformSettings
): Promise<AssistantPlatformSettings> {
  const sanitized = sanitizeSettings(settings);

  const upsertPrimary = await supabase
    .from("assistant_platform_settings")
    .upsert(
      {
        scope: "global",
        config: sanitized,
        enabled: sanitized.enabled,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "scope" }
    )
    .select("config")
    .maybeSingle();

  if (!upsertPrimary.error) {
    return sanitizeSettings(upsertPrimary.data?.config || sanitized);
  }

  // Legacy fallback for DBs without assistant_platform_settings table.
  const marker = "<assistant_platform_settings_json>";
  const legacySystemPrompt = `${sanitized.systemPrompt || ""}\n${marker}\n${JSON.stringify(sanitized)}`;

  const upsertLegacy = await supabase
    .from("assistant_settings")
    .upsert(
      {
        user_id: actorUserId,
        system_prompt: legacySystemPrompt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("system_prompt")
    .maybeSingle();

  if (upsertLegacy.error) {
    throw new Error(upsertLegacy.error.message || "Failed to save assistant settings");
  }

  return sanitized;
}
