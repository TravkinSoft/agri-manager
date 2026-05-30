import type { AssistantNavigationAction } from "@/lib/assistant/engine/types";

function normalize(value: string): string {
  return String(value || "").toLowerCase().trim();
}

const EXPLICIT_NAV_PATTERNS: RegExp[] = [
  /\b(открой|открыть|перейди|перейти|зайди|зайти)\b/u,
  /\b(покажи\s+страниц|открой\s+карточк)/u,
  /\b(open|go\s+to|navigate)\b/i,
];

export function hasExplicitNavigationRequest(message: string): boolean {
  const text = normalize(message);
  if (!text) return false;
  return EXPLICIT_NAV_PATTERNS.some((pattern) => pattern.test(text));
}

export type NavigationPolicyResult = {
  actions: AssistantNavigationAction[];
  explicitNavigationRequested: boolean;
  policy: "allowed" | "blocked" | "not_applicable";
};

export function applyNavigationPolicy(params: {
  message: string;
  actions: AssistantNavigationAction[];
  strict?: boolean;
}): NavigationPolicyResult {
  const strict = params.strict ?? true;
  const explicitNavigationRequested = hasExplicitNavigationRequest(params.message);

  if (!params.actions.length) {
    return {
      actions: [],
      explicitNavigationRequested,
      policy: "not_applicable",
    };
  }

  if (strict && !explicitNavigationRequested) {
    return {
      actions: [],
      explicitNavigationRequested,
      policy: "blocked",
    };
  }

  return {
    actions: params.actions,
    explicitNavigationRequested,
    policy: "allowed",
  };
}

