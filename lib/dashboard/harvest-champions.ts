import { buildHarvestOverview, resolveHarvestPeriod, type HarvestOverview } from "./harvest-summary";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

export const CHAMPION_PERIOD_QUERY = {
  today: "current_day",
  previous_shift: "previous_shift",
  month: "current_month",
  all_time: "all_time",
} as const;
export type ChampionPeriod = keyof typeof CHAMPION_PERIOD_QUERY;
export type ChampionSummary = Pick<HarvestOverview, "period" | "potatoDrivers">;
export type HarvestChampions = {
  updatedAt: string;
  periods: Record<ChampionPeriod, ChampionSummary>;
};

// One canonical receipt/impurity snapshot serves all buttons. No warehouse
// balances, plot timeline, active-combine lookup or per-button network request.
export function buildHarvestChampions(
  tickets: WeighbridgeTicket[],
  context: Omit<Parameters<typeof resolveHarvestPeriod>[0], "preset">,
): HarvestChampions {
  const now = context.now || new Date();
  const periods = Object.fromEntries(Object.entries(CHAMPION_PERIOD_QUERY).map(([key, preset]) => {
    const period = resolveHarvestPeriod({ ...context, now, preset });
    const summary = buildHarvestOverview(tickets, { period, warehouseRows: [], suppressInferredActiveSelection: true });
    return [key, { period: summary.period, potatoDrivers: summary.potatoDrivers }];
  })) as Record<ChampionPeriod, ChampionSummary>;
  return { updatedAt: now.toISOString(), periods };
}
