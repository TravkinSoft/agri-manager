"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, CircleAlert as AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Field {
  id: string;
  name: string;
  area: number;
}

interface Season {
  id: string;
  year: number;
  name: string;
}

interface Crop {
  id: string;
  name: string;
}

interface HistoricalCrop {
  field_id: string;
  season_year: number;
  crop_name: string;
}

interface CurrentPlanEntry {
  field_id: string;
  crop_id: string;
  area: number;
  id?: string;
}

export default function CropStructurePage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [historicalData, setHistoricalData] = useState<Map<string, string>>(new Map());
  const [currentPlan, setCurrentPlan] = useState<Map<string, CurrentPlanEntry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentSeason, setCurrentSeason] = useState<Season | null>(null);
  const [rotationSeasons, setRotationSeasons] = useState<Season[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load all data in parallel
      const [fieldsRes, seasonsRes, cropsRes] = await Promise.all([
        supabase.from("fields").select("*").eq("archived", false).order("name"),
        supabase.from("seasons").select("*").eq("archived", false).order("year", { ascending: false }),
        supabase.from("crops").select("*").eq("archived", false).order("name"),
      ]);

      if (fieldsRes.error) throw fieldsRes.error;
      if (seasonsRes.error) throw seasonsRes.error;
      if (cropsRes.error) throw cropsRes.error;

      const fieldsData = fieldsRes.data || [];
      const seasonsData = seasonsRes.data || [];
      const cropsData = cropsRes.data || [];

      setFields(fieldsData);
      setSeasons(seasonsData);
      setCrops(cropsData);

      // Determine current season (latest year) and 5 previous seasons
      if (seasonsData.length > 0) {
        const current = seasonsData[0];
        setCurrentSeason(current);

        // Get 5 previous seasons
        const previous = seasonsData.slice(1, 6);
        setRotationSeasons(previous);

        // Load historical data for rotation seasons
        await loadHistoricalData(fieldsData, previous);

        // Load current season plan
        await loadCurrentPlan(fieldsData, current, cropsData);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast({
        title: "Error",
        description: "Failed to load data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadHistoricalData = async (fieldsData: Field[], previousSeasons: Season[]) => {
    if (previousSeasons.length === 0) return;

    const seasonIds = previousSeasons.map((s) => s.id);

    const { data, error } = await supabase
      .from("crop_structure")
      .select(`
        field_id,
        seasons!inner(year),
        crops!inner(name)
      `)
      .in("season_id", seasonIds);

    if (error) {
      console.error("Error loading historical data:", error);
      return;
    }

    const histMap = new Map<string, string>();
    data?.forEach((record: any) => {
      const key = `${record.field_id}-${record.seasons.year}`;
      histMap.set(key, record.crops.name);
    });

    setHistoricalData(histMap);
  };

  const loadCurrentPlan = async (fieldsData: Field[], current: Season, cropsData: Crop[]) => {
    const { data, error } = await supabase
      .from("crop_structure")
      .select("id, field_id, crop_id, area")
      .eq("season_id", current.id);

    if (error) {
      console.error("Error loading current plan:", error);
      return;
    }

    const planMap = new Map<string, CurrentPlanEntry>();
    data?.forEach((record) => {
      const key = `${record.field_id}-${record.crop_id}`;
      planMap.set(key, {
        id: record.id,
        field_id: record.field_id,
        crop_id: record.crop_id,
        area: record.area,
      });
    });

    setCurrentPlan(planMap);
  };

  const handleAreaChange = (fieldId: string, cropId: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    const key = `${fieldId}-${cropId}`;

    const existing = currentPlan.get(key);
    const updated = new Map(currentPlan);

    if (numValue > 0) {
      updated.set(key, {
        id: existing?.id,
        field_id: fieldId,
        crop_id: cropId,
        area: numValue,
      });
    } else {
      updated.delete(key);
    }

    setCurrentPlan(updated);
  };

  const handleSave = async () => {
    if (!currentSeason) return;

    try {
      setSaving(true);

      // Prepare data for upsert
      const entries = Array.from(currentPlan.values()).filter((entry) => entry.area > 0);

      // Delete existing entries for current season and then insert new ones
      // First, get all existing IDs
      const { data: existingData } = await supabase
        .from("crop_structure")
        .select("id, field_id, crop_id")
        .eq("season_id", currentSeason.id);

      const existingMap = new Map<string, string>();
      existingData?.forEach((item) => {
        const key = `${item.field_id}-${item.crop_id}`;
        existingMap.set(key, item.id);
      });

      // Identify records to delete (existing but not in current plan)
      const toDelete: string[] = [];
      existingMap.forEach((id, key) => {
        if (!currentPlan.has(key) || currentPlan.get(key)!.area <= 0) {
          toDelete.push(id);
        }
      });

      // Delete records
      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from("crop_structure")
          .delete()
          .in("id", toDelete);

        if (deleteError) throw deleteError;
      }

      // Upsert entries
      const upsertData = entries.map((entry) => ({
        id: entry.id || undefined,
        field_id: entry.field_id,
        season_id: currentSeason.id,
        crop_id: entry.crop_id,
        area: entry.area,
        status: "planned",
      }));

      if (upsertData.length > 0) {
        const { error: upsertError } = await supabase
          .from("crop_structure")
          .upsert(upsertData, { onConflict: "id" });

        if (upsertError) throw upsertError;
      }

      toast({
        title: "Success",
        description: "Crop structure saved successfully",
      });

      // Reload data
      await loadData();
    } catch (error) {
      console.error("Error saving:", error);
      toast({
        title: "Error",
        description: "Failed to save crop structure",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const getHistoricalCrop = (fieldId: string, year: number): string => {
    const key = `${fieldId}-${year}`;
    return historicalData.get(key) || "-";
  };

  const getCurrentPlanArea = (fieldId: string, cropId: string): number => {
    const key = `${fieldId}-${cropId}`;
    return currentPlan.get(key)?.area || 0;
  };

  const getFieldTotal = (fieldId: string): number => {
    let total = 0;
    crops.forEach((crop) => {
      const key = `${fieldId}-${crop.id}`;
      const entry = currentPlan.get(key);
      if (entry && entry.area > 0) {
        total += entry.area;
      }
    });
    return total;
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Crop Rotation & Current Plan"
          description="View crop rotation history and plan current season allocation"
        />
        <Card>
          <CardContent className="p-8 text-center text-slate-500">Loading...</CardContent>
        </Card>
      </div>
    );
  }

  if (!currentSeason) {
    return (
      <div>
        <PageHeader
          title="Crop Rotation & Current Plan"
          description="View crop rotation history and plan current season allocation"
        />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No seasons found. Please create a season first using the Import Data page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Crop Rotation & Current Plan"
        description={`Historical rotation and ${currentSeason.year} season planning`}
      />

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          <span className="font-medium">Current Season:</span> {currentSeason.year}{" "}
          {currentSeason.name && `- ${currentSeason.name}`}
        </div>
        <Button onClick={handleSave} disabled={saving} size="lg">
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b-2 border-slate-300">
                  <th className="sticky left-0 z-20 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700 border-r-2 border-slate-300">
                    Field
                  </th>
                  <th className="sticky left-[120px] z-20 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700 border-r-2 border-slate-300">
                    Area (ha)
                  </th>
                  {rotationSeasons.map((season) => (
                    <th
                      key={season.id}
                      className="px-4 py-3 text-center text-sm font-semibold text-slate-700 bg-slate-50 min-w-[100px]"
                    >
                      {season.year}
                    </th>
                  ))}
                  <th className="px-2 py-3 bg-slate-100 border-l-4 border-slate-400"></th>
                  {crops.map((crop) => (
                    <th
                      key={crop.id}
                      className="px-4 py-3 text-center text-sm font-semibold text-green-700 bg-green-50 min-w-[120px]"
                    >
                      {crop.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fields.map((field, idx) => {
                  const fieldTotal = getFieldTotal(field.id);
                  const isOverAllocated = fieldTotal > field.area;

                  return (
                    <tr
                      key={field.id}
                      className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}
                    >
                      <td className="sticky left-0 z-10 bg-inherit px-4 py-3 font-medium text-slate-900 border-r-2 border-slate-200">
                        {field.name}
                      </td>
                      <td className="sticky left-[120px] z-10 bg-inherit px-4 py-3 text-slate-700 border-r-2 border-slate-200">
                        <div className="flex flex-col">
                          <span>{field.area.toFixed(1)}</span>
                          {fieldTotal > 0 && (
                            <span
                              className={`text-xs ${
                                isOverAllocated ? "text-red-600 font-semibold" : "text-slate-500"
                              }`}
                            >
                              ({fieldTotal.toFixed(1)} planned)
                            </span>
                          )}
                        </div>
                      </td>
                      {rotationSeasons.map((season) => (
                        <td
                          key={season.id}
                          className="px-4 py-3 text-center text-sm text-slate-600"
                        >
                          {getHistoricalCrop(field.id, season.year)}
                        </td>
                      ))}
                      <td className="px-2 py-3 bg-slate-100 border-l-4 border-slate-400"></td>
                      {crops.map((crop) => {
                        const value = getCurrentPlanArea(field.id, crop.id);
                        return (
                          <td key={crop.id} className="px-2 py-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.1"
                              value={value > 0 ? value : ""}
                              onChange={(e) =>
                                handleAreaChange(field.id, crop.id, e.target.value)
                              }
                              placeholder="0"
                              className="text-center h-9"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {fields.some((field) => getFieldTotal(field.id) > field.area) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Warning: Some fields have more area allocated than their total size. Please adjust the
            values.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
