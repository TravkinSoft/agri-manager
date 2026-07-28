import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecentOperation } from "@/lib/services/dashboard";
import { useLanguage } from "@/lib/contexts/language-context";
import { formatDateOnly } from "@/lib/dates/date-only";

interface RecentOperationsTableProps {
  data: RecentOperation[];
}

export function RecentOperationsTable({ data }: RecentOperationsTableProps) {
  const { t, language } = useLanguage();
  const locale = language === "en" ? "en-US" : language === "kz" ? "kk-KZ" : "ru-RU";

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{t("recent_operations_title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">{t("no_operations_data")}</p>
        ) : (
          <>
            <div className="space-y-2 md:hidden">
              {data.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 text-xs text-slate-500">{formatDateOnly(item.date, locale)}</div>
                  <div className="text-sm font-semibold text-slate-900">{item.operationType}</div>
                  <div className="mt-1 text-sm text-slate-700">{item.fieldName}</div>
                  <div className="text-xs text-slate-500">{item.cropName || "-"}</div>
                  {item.notes ? <div className="mt-2 text-xs text-slate-600">{item.notes}</div> : null}
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("date")}</TableHead>
                    <TableHead>{t("field")}</TableHead>
                    <TableHead>{t("crop")}</TableHead>
                    <TableHead>{t("operation_type")}</TableHead>
                    <TableHead>{t("notes")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {formatDateOnly(item.date, locale)}
                      </TableCell>
                      <TableCell>{item.fieldName}</TableCell>
                      <TableCell>{item.cropName || "-"}</TableCell>
                      <TableCell>{item.operationType}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {item.notes || "-"}
                      </TableCell>
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
