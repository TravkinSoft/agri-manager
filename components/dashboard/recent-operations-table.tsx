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

interface RecentOperationsTableProps {
  data: RecentOperation[];
}

export function RecentOperationsTable({ data }: RecentOperationsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Operations</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">No operations recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Crop</TableHead>
                <TableHead>Operation Type</TableHead>
                <TableHead>Notes</TableHead>
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
