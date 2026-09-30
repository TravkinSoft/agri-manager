"use client";

import { GlobalCatalogManager } from "@/components/platform/global-catalog-manager";
import { getCatalogConfig } from "@/lib/platform/global-catalog-config";

export default function GlobalSeedOriginatorsPage() {
  return <GlobalCatalogManager config={getCatalogConfig("seed_originators")} />;
}
