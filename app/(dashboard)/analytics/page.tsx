"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { MapPin, Maximize, TrendingUp, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getSeasonSummary,
  getCropStructureReport,
  getOperationsSummary,
  getInventorySummary,
  type SeasonSummary,
  type CropStructureReport,
  type OperationsSummary,
  type InventorySummary,
} from "@/lib/services/analytics";
import { supabase } from "@/lib/supabase/client";

export default function AnalyticsPage() {
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; year: number }>>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>("");
  const [seasonSummary, setSeasonSummary] = useState<SeasonSummary>({
    totalFields: 0,
    totalPlantedArea: 0,
    totalExpectedYield: 0,
    totalOperations: 0,
  });
  const [cropReport, setCropReport] = useState<CropStructureReport[]>([]);
  const [operationsSummary, setOperationsSummary] = useState<OperationsSummary[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSeasons() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("seasons")
        .select("id, name, year")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("year", { ascending: false });

      setSeasons(data || []);
      if (data && data.length > 0) {
        setSelectedSeasonId(data[0].id);
      }
    }

    loadSeasons();
  }, []);

  useEffect(() => {
    async function loadAnalytics() {
      setLoading(true);
      try {
        const [summary, crop, operations, inventory] = await Promise.all([
          selectedSeasonId ? getSeasonSummary(selectedSeasonId) : Promise.resolve({
            totalFields: 0,
            totalPlantedArea: 0,
            totalExpectedYield: 0,
            totalOperations: 0,
          }),
          selectedSeasonId ? getCropStructureReport(selectedSeasonId) : Promise.resolve([]),
          getOperationsSummary(),
          getInventorySummary(),
        ]);

        setSeasonSummary(summary);
        setCropReport(crop);
        setOperationsSummary(operations);
        setInventorySummary(inventory);
      } catch (error) {
        console.error("Error loading analytics:", error);
      } finally {
        setLoading(false);
      }
    }

    loadAnalytics();
  }, [selectedSeasonId]);

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        description="Comprehensive overview of your agricultural operations"
      />

      <div className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Select Season</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
              <SelectTrigger className="w-full md:w-96">
                <SelectValue placeholder="Select a season" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map((season) => (
                  <SelectItem key={season.id} value={season.id}>
                    {season.year} - {season.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <p className="text-slate-500">Loading analytics...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  Total Fields
                </CardTitle>
                <MapPin className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{seasonSummary.totalFields}</div>
                <p className="text-xs text-slate-500 mt-1">
                  {selectedSeasonId ? "Fields in selected season" : "Select a season"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  Planted Area
                </CardTitle>
                <Maximize className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {seasonSummary.totalPlantedArea.toFixed(2)} ha
                </div>
                <p className="text-xs text-slate-500 mt-1">Total area under cultivation</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  Expected Yield
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {seasonSummary.totalExpectedYield.toFixed(2)} t
                </div>
                <p className="text-xs text-slate-500 mt-1">Projected total harvest</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">
                  Operations
                </CardTitle>
                <Activity className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{seasonSummary.totalOperations}</div>
                <p className="text-xs text-slate-500 mt-1">Total operations recorded</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Crop Structure Report</CardTitle>
            </CardHeader>
            <CardContent>
              {cropReport.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No crop structure data for the selected season.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Crop</TableHead>
                      <TableHead>Variety</TableHead>
                      <TableHead>Reproduction</TableHead>
                      <TableHead className="text-right">Fields Count</TableHead>
                      <TableHead className="text-right">Total Area (ha)</TableHead>
                      <TableHead className="text-right">Expected Yield (t)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cropReport.map((report, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{report.cropName}</TableCell>
                        <TableCell>{report.varietyName || "—"}</TableCell>
                        <TableCell>{report.reproductionName || "—"}</TableCell>
                        <TableCell className="text-right">{report.fieldsCount}</TableCell>
                        <TableCell className="text-right">{report.totalArea.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          {report.expectedYield.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Operations Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {operationsSummary.length === 0 ? (
                <p className="text-sm text-slate-500">No operations recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Operation Type</TableHead>
                      <TableHead className="text-right">Total Records</TableHead>
                      <TableHead>Last Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {operationsSummary.map((summary, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{summary.operationType}</TableCell>
                        <TableCell className="text-right">{summary.totalRecords}</TableCell>
                        <TableCell>
                          {summary.lastDate
                            ? new Date(summary.lastDate).toLocaleDateString()
                            : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {inventorySummary.length === 0 ? (
                <p className="text-sm text-slate-500">No inventory data available.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Total Quantity</TableHead>
                      <TableHead className="text-right">Warehouses Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventorySummary.map((summary, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{summary.productName}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              summary.productType === "seed"
                                ? "bg-green-100 text-green-800 hover:bg-green-100"
                                : summary.productType === "fertilizer"
                                ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                                : "bg-orange-100 text-orange-800 hover:bg-orange-100"
                            }
                          >
                            {summary.productType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.totalQuantity.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">{summary.warehousesCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
