"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter } from "lucide-react";
import {
  getAllFieldHistory,
  type FieldHistoryRecord,
} from "@/lib/services/field-history";
import { supabase } from "@/lib/supabase/client";

const statusColors: Record<string, string> = {
  planned: "bg-slate-100 text-slate-800 hover:bg-slate-100",
  planted: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  growing: "bg-green-100 text-green-800 hover:bg-green-100",
  harvested: "bg-amber-100 text-amber-800 hover:bg-amber-100",
};

export default function FieldHistoryPage() {
  const [fields, setFields] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>("all");
  const [fieldHistory, setFieldHistory] = useState<FieldHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFields() {
      const { data } = await supabase
        .from("fields")
        .select("id, name")
        .eq("archived", false)
        .order("name");

      setFields(data || []);
    }

    loadFields();
  }, []);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const history = await getAllFieldHistory(selectedFieldId);
        setFieldHistory(history);
      } catch (error) {
        console.error("Error loading field history:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [selectedFieldId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Field History</h1>
        <p className="text-slate-600 mt-2">
          View crop rotation history for each field across seasons
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filter by Field
          </CardTitle>
          <CardDescription>
            Select a specific field or view all fields
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedFieldId} onValueChange={setSelectedFieldId}>
            <SelectTrigger className="w-full md:w-96">
              <SelectValue placeholder="Select a field to view history" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Fields</SelectItem>
              {fields.map((field) => (
                <SelectItem key={field.id} value={field.id}>
                  {field.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Crop Rotation History</CardTitle>
          <CardDescription>
            {selectedFieldId === "all"
              ? `Showing all fields (${fieldHistory.length} records)`
              : `Showing ${fields.find(f => f.id === selectedFieldId)?.name || "selected field"} (${fieldHistory.length} records)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <p className="text-slate-500">Loading data...</p>
            </div>
          ) : fieldHistory.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500">No history available.</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="font-semibold">Field</TableHead>
                    <TableHead className="font-semibold">Season</TableHead>
                    <TableHead className="font-semibold">Crop</TableHead>
                    <TableHead className="font-semibold">Variety</TableHead>
                    <TableHead className="text-right font-semibold">Area (ha)</TableHead>
                    <TableHead className="text-right font-semibold">Expected Yield (t/ha)</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fieldHistory.map((record) => (
                    <TableRow key={record.id} className="hover:bg-slate-50">
                      <TableCell className="font-medium">{record.fieldName}</TableCell>
                      <TableCell>{record.seasonYear}</TableCell>
                      <TableCell>{record.cropName}</TableCell>
                      <TableCell>{record.varietyName || "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {record.area.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {record.expectedYield ? record.expectedYield.toFixed(2) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={statusColors[record.status] || ""}
                        >
                          {record.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
