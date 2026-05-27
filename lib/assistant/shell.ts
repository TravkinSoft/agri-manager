import type { AppRole } from "@/lib/auth/roles";

export type AssistantAllowedRole =
  | "global_admin"
  | "company_admin"
  | "agronomist"
  | "director"
  | "warehouse_operator"
  | "weighman"
  | "specialist"
  | "brigadier"
  | "legal_operator"
  | "fuel_operator";

const ASSISTANT_ALLOWED_ROLES = new Set<AssistantAllowedRole>([
  "global_admin",
  "company_admin",
  "agronomist",
  "director",
  "warehouse_operator",
  "weighman",
  "specialist",
  "brigadier",
  "legal_operator",
  "fuel_operator",
]);

export function canUseAssistantShell(role: AppRole): boolean {
  if (!role) return false;
  return ASSISTANT_ALLOWED_ROLES.has(role as AssistantAllowedRole);
}

export type AssistantContextEntity = {
  type: string;
  id: string;
  label?: string | null;
};

export type AssistantRuntimeUiContext = {
  currentPage: string;
  currentRoute: string;
  entity: AssistantContextEntity | null;
  selectedRows: string[];
  filters: Record<string, string | string[]>;
  season: string | null;
  companyId: string | null;
  companyName: string | null;
  locale: "ru" | "kz" | "en" | null;
};

export type AssistantSessionMeta = {
  sessionId: string;
  updatedAt: string;
};
