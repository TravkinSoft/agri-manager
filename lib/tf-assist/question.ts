import { z } from "zod";
import type { Intent } from "./contracts";
export const QuestionSchema = z
  .object({
    companyId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
    seasonId: z.string().uuid().optional(),
    sourceId: z.string().uuid().optional(),
    harvestedHa: z
      .string()
      .regex(/^\d{1,6}(?:[.,]\d{1,4})?$/)
      .optional(),
    remainingHa: z
      .string()
      .regex(/^\d{1,6}(?:[.,]\d{1,4})?$/)
      .optional(),
  })
  .strict();

/** Deterministic baseline; unsupported actions never enter an execution planner. */
export function classifyQuestion(message: string): Intent | null {
  const text = message.toLowerCase();
  if (isWriteRequest(text)) return null;
  if (/урожайност|прогноз|остал|\d\s*га|выход.*гектар/i.test(text))
    return "yield";
  if (/расхожд|свер|сошл|сходит|баланс/i.test(text)) return "reconcile";
  if (/остат|склад|лежит|выбы|отгруж/i.test(text)) return "stock";
  if (/ремонт|техник|комбайн|водител|машин/i.test(text)) return "fleet";
  if (/птц|линии|в пути|просто|работает/i.test(text)) return "traffic";
  if (/урож|пол[еяю]|убир|убор|принят|парт|рейс|талон|примес|земл/i.test(text))
    return "harvest";
  return null;
}
export const isWriteRequest = (text: string): boolean =>
  /(?:удали|измени|создай|запиши|перемести|проведи|отмени|обнови|insert\b|delete\b|update\b|drop\b|execute\b)/i.test(
    text,
  );
