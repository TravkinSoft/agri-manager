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
import { format } from "date-fns";
import { useLanguage } from "@/lib/contexts/language-context";

interface RecentOperationsTableProps {
  data: RecentOperation[];
}

export function RecentOperationsTable({ data }: RecentOperationsTableProps) {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("recent_operations_title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">{t("no_operations_data")}</p>
        ) : (
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
                    {format(new Date(item.date), "MMM dd, yyyy")}
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
        )}
      </CardContent>
    </Card>
  );
}
