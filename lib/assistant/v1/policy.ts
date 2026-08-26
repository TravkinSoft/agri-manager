import type { AssistantPlatformSettings } from "@/lib/assistant/settings-types";
import type { AssistantToolOutput, AssistantUiContext } from "@/lib/assistant/engine/types";
import type { ServerActorContext } from "@/lib/auth/server-session";
import {
  READ_ONLY_MODEL_TOOL_NAMES,
  type ReadOnlyModelToolName,
} from "@/lib/assistant/v1/types";

export type ReadOnlyToolPolicy = {
  sideEffect: "none";
  maxRows: number;
  requiresSeason: boolean;
};

export type ReadOnlyRequestPolicyDecision =
  | { mode: "model_with_tools"; code: null }
  | { mode: "model_without_tools"; code: "ORDINARY_CONVERSATION" }
  | { mode: "clarify_material"; code: "AMBIGUOUS_MATERIAL" }
  | { mode: "deny_write"; code: "WRITE_ACTION_DENIED" }
  | { mode: "deny_foreign_company"; code: "FOREIGN_COMPANY_DENIED" };

export const READ_ONLY_TOOL_POLICIES: Readonly<Record<ReadOnlyModelToolName, ReadOnlyToolPolicy>> = Object.freeze({
  get_current_context: { sideEffect: "none", maxRows: 1, requiresSeason: false },
  search_fields: { sideEffect: "none", maxRows: 50, requiresSeason: false },
  get_field_card: { sideEffect: "none", maxRows: 12, requiresSeason: true },
  get_field_land_bank_summary: { sideEffect: "none", maxRows: 1, requiresSeason: false },
  get_field_materials: { sideEffect: "none", maxRows: 100, requiresSeason: true },
  get_warehouse_stock: { sideEffect: "none", maxRows: 100, requiresSeason: false },
  get_crop_structure_summary: { sideEffect: "none", maxRows: 100, requiresSeason: true },
  get_active_operations_summary: { sideEffect: "none", maxRows: 100, requiresSeason: true },
  get_active_tickets: { sideEffect: "none", maxRows: 120, requiresSeason: false },
  get_recent_tickets: { sideEffect: "none", maxRows: 80, requiresSeason: false },
  get_ticket_details: { sideEffect: "none", maxRows: 40, requiresSeason: false },
});

const READ_ONLY_TOOL_SET = new Set<string>(READ_ONLY_MODEL_TOOL_NAMES);

export class ReadOnlyPolicyError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReadOnlyPolicyError";
    this.code = code;
  }
}
function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function normalizePolicyText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»“”"'`.,!?;:()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOrdinaryConversationRequest(message: string): boolean {
  const text = normalizePolicyText(message);
  return /^(?:привет|привент|здравствуй(?:те)?|добрый\s+(?:день|вечер|утро)|спасибо(?:\s+большое)?|благодарю|как\s+дела|hello|hi|thanks|thank\s+you|how\s+are\s+you)$/u.test(text);
}

function isExplicitWriteRequest(message: string): boolean {
  const text = normalizePolicyText(message);
  return /^(?:пожалуйста\s+)?(?:спиши|списать|создай|создать|измени|изменить|закрой|закрыть|выполни|выполнить|удали|удалить|добавь|добавить|перемести|переместить|проведи|провести|подтверди|подтвердить|выдай|выдать|верни|вернуть|вызови|вызвать)(?:\s|$)/u.test(text) ||
    /^(?:insert|update|delete|drop|alter|create|write|close|confirm)(?:\s|$)/u.test(text);
}

function isAmbiguousMaterialRequest(message: string): boolean {
  const text = normalizePolicyText(message);
  return /^(?:сколько\s+)?осталось\s+(?:удобрения|материала)$/u.test(text);
}

function explicitlyRequestsForeignCompany(message: string, currentCompanyName: string | null | undefined): boolean {
  const text = normalizePolicyText(message);
  if (!text) return false;
  if (/(?:^|\s)(?:чужой|чужая|чужую|чужие|другой|другая|другую)\s+компани/u.test(text)) return true;

  const currentCompany = normalizePolicyText(currentCompanyName);
  if (currentCompany && text.includes(currentCompany)) return false;

  const targetMatch = text.match(/(?:^|\s)(?:компания|компании|компанию|company)\s+(.+)$/u);
  const target = targetMatch?.[1]?.trim() || "";
  if (!target) return false;
  if (/^(?:моя|моей|мою|наша|нашей|нашу|текущая|текущей|текущую|эта|этой|эту|своя|своей|свою)$/u.test(target)) {
    return false;
  }
  return true;
}

export function decideReadOnlyRequestPolicy(params: {
  message: string;
  currentCompanyName?: string | null;
}): ReadOnlyRequestPolicyDecision {
  if (isExplicitWriteRequest(params.message)) {
    return { mode: "deny_write", code: "WRITE_ACTION_DENIED" };
  }
  if (explicitlyRequestsForeignCompany(params.message, params.currentCompanyName)) {
    return { mode: "deny_foreign_company", code: "FOREIGN_COMPANY_DENIED" };
  }
  if (isAmbiguousMaterialRequest(params.message)) {
    return { mode: "clarify_material", code: "AMBIGUOUS_MATERIAL" };
  }
  if (isOrdinaryConversationRequest(params.message)) {
    return { mode: "model_without_tools", code: "ORDINARY_CONVERSATION" };
  }
  return { mode: "model_with_tools", code: null };
}

function selectedActorCompany(actor: ServerActorContext): string | null {
  if (actor.isImpersonating) return clean(actor.impersonatedCompanyId) || clean(actor.companyId);
  if (actor.role === "global_admin") return clean(actor.contextCompanyId);
  return clean(actor.homeCompanyId) || clean(actor.companyId);
}

export function isReadOnlyModelToolName(value: unknown): value is ReadOnlyModelToolName {
  return READ_ONLY_TOOL_SET.has(String(value || ""));
}

export function assertReadOnlyRequestPolicy(params: {
  actor: ServerActorContext;
  companyId: string;
  settings: AssistantPlatformSettings;
  runtimeContext: AssistantUiContext;
}): void {
  const { actor, settings, runtimeContext } = params;
  const companyId = clean(params.companyId);
  if (!clean(actor.id) || !clean(actor.authUserId)) {
    throw new ReadOnlyPolicyError("AUTH_REQUIRED", "Authenticated assistant actor is required.");
  }
  if (!companyId) {
    throw new ReadOnlyPolicyError("COMPANY_REQUIRED", "Server-selected company is required.");
  }
  if (!settings.enabled || !settings.allowedRoles.includes(actor.role as never)) {
    throw new ReadOnlyPolicyError("ROLE_DENIED", "The current role is not allowed to use the assistant.");
  }
  const actorCompany = selectedActorCompany(actor);
  if (!actorCompany || actorCompany !== companyId) {
    throw new ReadOnlyPolicyError("COMPANY_DENIED", "Actor company scope does not match the server-selected company.");
  }
  if (clean(runtimeContext.companyId) !== companyId) {
    throw new ReadOnlyPolicyError("COMPANY_DENIED", "Runtime company scope does not match the server-selected company.");
  }
  if (clean(runtimeContext.userId) !== clean(actor.id) || clean(runtimeContext.userRole) !== actor.role) {
    throw new ReadOnlyPolicyError("ACTOR_CONTEXT_DENIED", "Runtime actor context is not server-authenticated.");
  }
}

export function assertReadOnlyToolPolicy(params: {
  toolName: unknown;
  args: Record<string, unknown>;
  settings: AssistantPlatformSettings;
  season: string | null;
}): ReadOnlyToolPolicy {
  if (!isReadOnlyModelToolName(params.toolName)) {
    throw new ReadOnlyPolicyError("TOOL_NOT_ALLOWED", `Tool is not exposed in A101: ${String(params.toolName || "unknown")}`);
  }
  const policy = READ_ONLY_TOOL_POLICIES[params.toolName];
  if (policy.sideEffect !== "none") {
    throw new ReadOnlyPolicyError("SIDE_EFFECT_DENIED", "Only side_effect=none tools are allowed.");
  }
  if (params.settings.allowedTools.length > 0 && !params.settings.allowedTools.includes(params.toolName)) {
    throw new ReadOnlyPolicyError("TOOL_DISABLED", `Tool is disabled by platform settings: ${params.toolName}`);
  }
  if (Object.prototype.hasOwnProperty.call(params.args, "company_id") || Object.prototype.hasOwnProperty.call(params.args, "companyId")) {
    throw new ReadOnlyPolicyError("CLIENT_COMPANY_DENIED", "Tool arguments cannot select company scope.");
  }
  const requestedLimit = Number(params.args.limit);
  if (Number.isFinite(requestedLimit) && (requestedLimit < 1 || requestedLimit > policy.maxRows)) {
    throw new ReadOnlyPolicyError("ROW_LIMIT_DENIED", `Requested row limit exceeds ${policy.maxRows}.`);
  }
  if (policy.requiresSeason && !clean(params.season)) {
    throw new ReadOnlyPolicyError("SEASON_REQUIRED", `Active season is required for ${params.toolName}.`);
  }
  return policy;
}

function inspectCompanyScope(value: unknown, companyId: string, seen: Set<unknown>): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => inspectCompanyScope(item, companyId, seen));
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if ((key === "company_id" || key === "companyId") && clean(item) && clean(item) !== companyId) {
      throw new ReadOnlyPolicyError("RESULT_COMPANY_DENIED", "Tool returned data from another company.");
    }
    inspectCompanyScope(item, companyId, seen);
  });
}

export function assertReadOnlyResultCompany(params: { output: AssistantToolOutput; companyId: string }): void {
  inspectCompanyScope(params.output.rows, params.companyId, new Set());
}

export function boundReadOnlyToolOutput(params: {
  output: AssistantToolOutput;
  policy: ReadOnlyToolPolicy;
}): AssistantToolOutput {
  return {
    ...params.output,
    rows: (params.output.rows || []).slice(0, params.policy.maxRows),
  };
}
