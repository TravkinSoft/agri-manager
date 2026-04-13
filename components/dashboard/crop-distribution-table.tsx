import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CropDistribution } from "@/lib/services/dashboard";
import { useLanguage } from "@/lib/contexts/language-context";

interface CropDistributionTableProps {
  data: CropDistribution[];
}

export function CropDistributionTable({ data }: CropDistributionTableProps) {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("crop_distribution_title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">{t("no_crop_data")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crop")}</TableHead>
                <TableHead className="text-right">{t("total_area_metric")}</TableHead>
                <TableHead className="text-right">{t("crop_count")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item) => (
                <TableRow key={item.crop}>
                  <TableCell className="font-medium">{item.crop}</TableCell>
                  <TableCell className="text-right">{item.totalArea}</TableCell>
                  <TableCell className="text-right">{item.fieldsCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
