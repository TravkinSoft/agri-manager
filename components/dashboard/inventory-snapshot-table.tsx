import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { InventorySnapshot } from "@/lib/services/dashboard";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeMaterialType } from "@/lib/i18n/helpers";

interface InventorySnapshotTableProps {
  data: InventorySnapshot[];
}

const typeColors: Record<string, string> = {
  seed: "bg-green-100 text-green-800 hover:bg-green-100",
  fertilizer: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  pesticide: "bg-orange-100 text-orange-800 hover:bg-orange-100",
};

export function InventorySnapshotTable({ data }: InventorySnapshotTableProps) {
  const { t, language } = useLanguage();

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{t("inventory_snapshot_title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">{t("no_inventory_data")}</p>
        ) : (
          <>
            <div className="space-y-2 md:hidden">
              {data.map((item, index) => (
                <div key={index} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-semibold text-slate-900">{item.productName}</div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Badge
                      variant="secondary"
                      className={typeColors[item.productType] || ""}
                    >
                      {localizeMaterialType(item.productType, language)}
                    </Badge>
                    <div className="text-sm font-medium text-slate-900">{item.quantity.toFixed(2)}</div>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{item.warehouseName}</div>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("product")}</TableHead>
                    <TableHead>{t("type")}</TableHead>
                    <TableHead className="text-right">{t("quantity")}</TableHead>
                    <TableHead>{t("warehouse")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={typeColors[item.productType] || ""}
                        >
                          {localizeMaterialType(item.productType, language)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {item.quantity.toFixed(2)}
                      </TableCell>
                      <TableCell>{item.warehouseName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
