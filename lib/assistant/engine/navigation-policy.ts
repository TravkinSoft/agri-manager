import type { AssistantNavigationAction } from "@/lib/assistant/engine/types";

function normalize(value: string): string {
  return String(value || "").toLowerCase().trim();
}

const EXPLICIT_NAV_MARKERS = [
  "\u043e\u0442\u043a\u0440\u043e\u0439",
  "\u043e\u0442\u043a\u0440\u044b\u0442\u044c",
  "\u043f\u0435\u0440\u0435\u0439\u0434\u0438",
  "\u043f\u0435\u0440\u0435\u0439\u0442\u0438",
  "\u0437\u0430\u0439\u0434\u0438",
  "\u0437\u0430\u0439\u0442\u0438",
  "\u043f\u043e\u043a\u0430\u0436\u0438 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443",
  "\u043e\u0442\u043a\u0440\u043e\u0439 \u043a\u0430\u0440\u0442\u043e\u0447\u043a",
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
