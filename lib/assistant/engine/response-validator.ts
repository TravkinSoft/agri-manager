import type { AssistantToolOutput } from "@/lib/assistant/engine/types";

function clean(value: unknown): string {
  return String(value || "").trim();
}

function looksLikeNumericAnswer(text: string): boolean {
  return /\d/.test(text);
}

export type GroundedAnswerValidationResult = {
  pass: boolean;
  normalizedAnswer: string;
  reason: string | null;
};

export function validateGroundedAnswer(params: {
  answer: string;
  outputs: AssistantToolOutput[];
  groundedRequired: boolean;
}): GroundedAnswerValidationResult {
  const answer = clean(params.answer);
  if (!params.groundedRequired) {
    return { pass: true, normalizedAnswer: answer, reason: null };
  }

  if (!answer) {
    return {
      pass: false,
      normalizedAnswer: "Не смог сформировать ответ по данным инструментов.",
      reason: "empty_answer",
    };
  }

  if (!params.outputs.length && looksLikeNumericAnswer(answer)) {
    return {
      pass: false,
      normalizedAnswer: "По доступным инструментам подтверждённых данных для этого запроса нет.",
      reason: "numeric_without_tool_output",
    };
  }

  return { pass: true, normalizedAnswer: answer, reason: null };
}

export function noDataGroundedMessage(): string {
  return "По системе сейчас данных по этому запросу не найдено.";
}
