"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MtmCatalogWorkspace } from "./catalog-workspace";
import { MtmStockWorkspace } from "./stock-workspace";

export function MtmWorkspace({ companyId, actorId }: { companyId: string; actorId: string }) {
  const [tab, setTab] = useState("catalog");
  const [stockVisited, setStockVisited] = useState(false);
  return <Tabs value={tab} onValueChange={(value) => { setTab(value); if (value === "stock") setStockVisited(true); }} className="space-y-3">
    <TabsList aria-label="Раздел МТМ">
      <TabsTrigger value="catalog">Каталог</TabsTrigger>
      <TabsTrigger value="stock">Склад</TabsTrigger>
    </TabsList>
    {/* Keep catalogue drafts intact when switching to warehouse operations. */}
    <TabsContent forceMount value="catalog" className="data-[state=inactive]:hidden">
      <MtmCatalogWorkspace companyId={companyId} />
    </TabsContent>
    <TabsContent forceMount value="stock" className="data-[state=inactive]:hidden">
      {stockVisited ? <MtmStockWorkspace companyId={companyId} actorId={actorId} /> : null}
    </TabsContent>
  </Tabs>;
}
