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
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{t("crop_distribution_title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">{t("no_crop_data")}</p>
        ) : (
          <>
            <div className="space-y-2 md:hidden">
              {data.map((item) => (
                <div key={item.crop} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-semibold text-slate-900">{item.crop}</div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>{t("total_area_metric")}</span>
                    <span className="text-sm font-medium text-slate-900">{item.totalArea}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                    <span>{t("crop_count")}</span>
                    <span className="text-sm font-medium text-slate-900">{item.fieldsCount}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
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
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
