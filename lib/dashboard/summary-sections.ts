export const SUMMARY_SECTION_ROLES = ["agronomist", "director", "company_admin", "global_admin"] as const;
export const SUMMARY_SECTIONS = [
  { id: "weighbridge", label: "Весовая" },
  { id: "combine", label: "Комбайнёр" },
  { id: "traffic", label: "Трафик" },
] as const;
export type SummarySection = typeof SUMMARY_SECTIONS[number]["id"];
export function hasSummarySections(role?: string | null) {
  return SUMMARY_SECTION_ROLES.some(candidate => candidate === role);
}

// Menu visibility is not authorization. Existing route/API ACLs stay unchanged.
export function showMainMenuRoute(role: string | null | undefined, href: string) {
  return !(role === "agronomist" && (href === "/weighbridge" || href.startsWith("/weighbridge/")));
}
