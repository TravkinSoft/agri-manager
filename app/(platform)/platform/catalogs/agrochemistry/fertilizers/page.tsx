"use client";

import { GlobalCatalogManager } from "@/components/platform/global-catalog-manager";
import { getCatalogConfig } from "@/lib/platform/global-catalog-config";

export default function GlobalFertilizersPage() {
  return <GlobalCatalogManager config={getCatalogConfig("fertilizers")} />;
}
