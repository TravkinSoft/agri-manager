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

interface CropDistributionTableProps {
  data: CropDistribution[];
}

export function CropDistributionTable({ data }: CropDistributionTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Crop Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">No crop data available for this season.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Crop</TableHead>
                <TableHead className="text-right">Total Area (ha)</TableHead>
                <TableHead className="text-right">Fields Count</TableHead>
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
