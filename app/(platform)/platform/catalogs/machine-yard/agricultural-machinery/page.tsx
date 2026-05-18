"use client";

import { GlobalCatalogManager } from "@/components/platform/global-catalog-manager";
import { getCatalogConfig } from "@/lib/platform/global-catalog-config";

export default function GlobalAgriculturalMachineryPage() {
  return <GlobalCatalogManager config={getCatalogConfig("agricultural_machine_models")} />;
}
