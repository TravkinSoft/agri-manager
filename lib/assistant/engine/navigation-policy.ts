import type { AssistantNavigationAction } from "@/lib/assistant/engine/types";

function normalize(value: string): string {
  return String(value || "").toLowerCase().trim();
}

const EXPLICIT_NAV_MARKERS = [
  "открой",
  "открыть",
  "перейди",
  "перейти",
  "зайди",
  "зайти",
  "покажи страницу",
  "открой карточк",
  "open",
  "go to",
  "navigate",
];

export function hasExplicitNavigationRequest(message: string): boolean {
  const text = normalize(message);
  if (!text) return false;
  return EXPLICIT_NAV_MARKERS.some((marker) => text.includes(marker));
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
