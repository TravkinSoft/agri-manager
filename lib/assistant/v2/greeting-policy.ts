const GREETING_SOURCE = [
  "здравствуйте",
  "здравствуй",
  "привет",
  "доброе\\s+утро",
  "добрый\\s+(?:день|вечер)",
  "салам",
  "hello",
  "hi",
  "hey",
].join("|");

const EXPLICIT_GREETING = new RegExp(`^\\s*(?:${GREETING_SOURCE})(?=$|[\\s,!?.:;—-])`, "iu");
const LEADING_GREETING = new RegExp(
  `^\\s*(?:(?:[^,!?。\\n]{1,80}),\\s*)?(?:${GREETING_SOURCE})(?=$|[\\s,!?.:;—-])(?:\\s*[!.,:;—-]+\\s*|\\s+)`,
  "iu"
);

export type AssistantGreetingPolicy = {
  priorMessageCount: number;
  currentMessageIsGreeting: boolean;
  greetingAllowed: boolean;
};

export function isExplicitUserGreeting(message: string): boolean {
  return EXPLICIT_GREETING.test(String(message || "").trim());
}

export function hasLeadingAssistantGreeting(answer: string): boolean {
  const text = String(answer || "").trim();
  return EXPLICIT_GREETING.test(text) || LEADING_GREETING.test(text);
}

export function resolveAssistantGreetingPolicy(params: {
  currentUserMessage: string;
  priorMessageCount: number;
}): AssistantGreetingPolicy {
  const priorMessageCount = Math.max(0, Math.floor(Number(params.priorMessageCount) || 0));
  const currentMessageIsGreeting = isExplicitUserGreeting(params.currentUserMessage);
  return {
    priorMessageCount,
    currentMessageIsGreeting,
    greetingAllowed: priorMessageCount === 0 || currentMessageIsGreeting,
  };
}

export function assistantGreetingInstruction(policy: AssistantGreetingPolicy): string {
  if (policy.greetingAllowed) {
    return [
      "Greeting policy: a greeting is allowed because this is the first assistant response in the thread or the user explicitly greeted you.",
      "Keep any greeting short. Use the preferred form of address naturally, not in every answer.",
    ].join(" ");
  }
  return [
    "Greeting policy: this thread already has prior user/assistant messages and the current user message is not an explicit greeting.",
    "Do not begin this answer with Здравствуйте, Здравствуй, Привет, Доброе утро, Добрый день, Добрый вечер, Салам, Hello, Hi, Hey, or an equivalent repeated greeting.",
    "Answer the current DATA, QUESTION, or follow-up directly. Use the preferred form of address only when it sounds natural, never in every answer.",
  ].join(" ");
}

export function enforceAssistantGreetingPolicy(params: {
  answer: string;
  currentUserMessage: string;
  priorMessageCount: number;
}): { answer: string; policy: AssistantGreetingPolicy; greetingRemoved: boolean } {
  const answer = String(params.answer || "").trim();
  const policy = resolveAssistantGreetingPolicy(params);
  if (!answer || policy.greetingAllowed) {
    return { answer, policy, greetingRemoved: false };
  }

  let filtered = answer;
  let greetingRemoved = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = filtered.replace(LEADING_GREETING, "").trimStart();
    if (next === filtered) break;
    filtered = next;
    greetingRemoved = true;
  }

  return {
    answer: filtered || "Продолжим по текущему вопросу.",
    policy,
    greetingRemoved,
  };
}
