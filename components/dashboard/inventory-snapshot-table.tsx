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

interface InventorySnapshotTableProps {
  data: InventorySnapshot[];
}

const typeColors: Record<string, string> = {
  seed: "bg-green-100 text-green-800 hover:bg-green-100",
  fertilizer: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  pesticide: "bg-orange-100 text-orange-800 hover:bg-orange-100",
};

export function InventorySnapshotTable({ data }: InventorySnapshotTableProps) {
  const { t } = useLanguage();
  const typeLabel = (value: string) => {
    if (value === "seed") return t("type_seed");
    if (value === "fertilizer") return t("type_fertilizer");
    if (value === "pesticide") return t("type_pesticide");
    return value;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("inventory_snapshot_title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">{t("no_inventory_data")}</p>
        ) : (
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
                      {typeLabel(item.productType)}
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
        )}
      </CardContent>
    </Card>
  );
}
