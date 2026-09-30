export type SeasonCandidate = {
  id: string;
  year: number;
  name?: string | null;
  archived?: boolean | null;
};

export function selectCurrentSeason<T extends SeasonCandidate>(
  seasons: T[],
  preferredYear = 2026
): T | null {
  const active = seasons
    .filter((season) => !season.archived && Number.isFinite(Number(season.year)))
    .sort((left, right) => Number(right.year) - Number(left.year));

  return active.find((season) => Number(season.year) === preferredYear) || active[0] || null;
}
