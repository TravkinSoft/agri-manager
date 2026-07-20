import type { CanonicalOperationTypeSlug } from "@/lib/operations/operation-engine";

type OperationWorkUiItem = {
  slug: string;
};

export type OperationWorkUiSection = {
  categorySlug: CanonicalOperationTypeSlug;
  label: string;
  selection: "direct" | "grouped";
  directOperationSlug?: CanonicalOperationTypeSlug;
  works: readonly OperationWorkUiItem[];
};

export const OPERATION_WORK_UI_SECTIONS: readonly OperationWorkUiSection[] = [
  {
    categorySlug: "soil_operation",
    label: "Работа с почвой",
    selection: "grouped",
    works: [
      { slug: "stubble_peeling" },
      { slug: "disking" },
      { slug: "plowing" },
      { slug: "deep_ripping" },
      { slug: "cultivation" },
      { slug: "interrow_cultivation" },
      { slug: "harrowing" },
      { slug: "rotary_tilling" },
      { slug: "rolling" },
      { slug: "ridge_forming" },
      { slug: "hilling" },
    ],
  },
  {
    categorySlug: "planting",
    label: "Посев и посадка",
    selection: "grouped",
    works: [{ slug: "seeding" }, { slug: "planting_generic" }, { slug: "overseeding" }],
  },
  {
    categorySlug: "fertilizer_application",
    label: "Внесение удобрений",
    selection: "direct",
    directOperationSlug: "fertilizer_application",
    works: [],
  },
  {
    categorySlug: "spraying",
    label: "Опрыскивание",
    selection: "direct",
    directOperationSlug: "spraying",
    works: [],
  },
  {
    categorySlug: "irrigation",
    label: "Полив",
    selection: "direct",
    directOperationSlug: "irrigation",
    works: [],
  },
  {
    categorySlug: "harvesting",
    label: "Уборка",
    selection: "grouped",
    works: [
      { slug: "direct_combining" },
      { slug: "windrow_mowing" },
      { slug: "windrow_pickup" },
      { slug: "tuber_harvesting" },
      { slug: "silage_harvesting" },
      { slug: "forage_mowing" },
      { slug: "tedding" },
      { slug: "raking" },
      { slug: "baling" },
      { slug: "straw_collection" },
    ],
  },
];

export const HIDDEN_NEW_PLAN_CATEGORY_SLUGS: readonly CanonicalOperationTypeSlug[] = [
  "fertigation",
  "scouting",
  "sampling",
  "transport",
  "post_harvest",
  "service_operation",
  "logistics_operation",
  "post_harvest_operation",
];

export function getOperationWorkUiSection(
  categorySlug: string | null | undefined
): OperationWorkUiSection | null {
  const normalized = String(categorySlug || "").trim();
  return OPERATION_WORK_UI_SECTIONS.find((section) => section.categorySlug === normalized) || null;
}
