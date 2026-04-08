"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, CircleAlert as AlertCircle, CircleCheck as CheckCircle2, FileJson, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";

interface ImportResults {
  fields: number;
  field_history: number;
  crop_structure: number;
  errors: string[];
}

export default function ImportPage() {
  const [importData, setImportData] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    setIsImporting(true);
    setError(null);
    setResults(null);

    try {
      // Parse the input data
      let parsedData;
      try {
        parsedData = JSON.parse(importData);
      } catch (e) {
        throw new Error("Invalid JSON format. Please check your input.");
      }

      // Send to API
      const response = await fetch("/api/import-farm-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parsedData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Import failed");
      }

      setResults(result.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const exampleJSON = `{
  "fields": [
    { "name": "Field 1", "area": 100.5 },
    { "name": "Field 2", "area": 85.3 }
  ],
  "field_history": [
    { "field_name": "Field 1", "season": 2020, "crop": "Wheat" },
    { "field_name": "Field 1", "season": 2021, "crop": "Barley" },
    { "field_name": "Field 1", "season": 2022, "crop": "Oats" },
    { "field_name": "Field 1", "season": 2023, "crop": "Peas" },
    { "field_name": "Field 1", "season": 2024, "crop": "Rapeseed" }
  ],
  "crop_structure": [
    { "field_name": "Field 1", "crop": "Wheat", "area": 50.5 },
    { "field_name": "Field 1", "crop": "Barley", "area": 50.0 }
  ]
}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Farm Data Import"
        description="Import fields, crop rotation history, and current season crop structure"
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Data
            </CardTitle>
            <CardDescription>
              Paste your structured data in JSON format to import fields, historical crop rotation, and 2025 crop structure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs defaultValue="json" className="w-full">
              <TabsList>
                <TabsTrigger value="json" className="flex items-center gap-2">
                  <FileJson className="h-4 w-4" />
                  JSON Format
                </TabsTrigger>
                <TabsTrigger value="guide" className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Data Guide
                </TabsTrigger>
              </TabsList>

              <TabsContent value="json" className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Import Data (JSON)</label>
                  <Textarea
                    placeholder="Paste your JSON data here..."
                    value={importData}
                    onChange={(e) => setImportData(e.target.value)}
                    rows={15}
                    className="font-mono text-sm"
                  />
                </div>

                <Button
                  onClick={handleImport}
                  disabled={isImporting || !importData.trim()}
                  className="w-full"
                  size="lg"
                >
                  {isImporting ? (
                    <>
                      <span className="animate-spin mr-2">⏳</span>
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-5 w-5" />
                      IMPORT DATA
                    </>
                  )}
                </Button>
              </TabsContent>

              <TabsContent value="guide" className="space-y-4">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Data Structure</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Your JSON should contain three arrays: fields, field_history, and crop_structure.
                    </p>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">1. Fields</h4>
                    <p className="text-xs text-muted-foreground mb-2">
                      Define your fields with name and area (in hectares).
                    </p>
                    <pre className="bg-slate-900 text-slate-50 p-3 rounded text-xs overflow-x-auto">
{`"fields": [
  { "name": "Field 1", "area": 100.5 },
  { "name": "Field 2", "area": 85.3 }
]`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">2. Field History (2020-2024)</h4>
                    <p className="text-xs text-muted-foreground mb-2">
                      Historical crop rotation records for each field by year.
                    </p>
                    <pre className="bg-slate-900 text-slate-50 p-3 rounded text-xs overflow-x-auto">
{`"field_history": [
  { "field_name": "Field 1", "season": 2020, "crop": "Wheat" },
  { "field_name": "Field 1", "season": 2021, "crop": "Barley" }
]`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">3. Crop Structure (2025)</h4>
                    <p className="text-xs text-muted-foreground mb-2">
                      Current season crop allocations for each field.
                    </p>
                    <pre className="bg-slate-900 text-slate-50 p-3 rounded text-xs overflow-x-auto">
{`"crop_structure": [
  { "field_name": "Field 1", "crop": "Wheat", "area": 50.5 },
  { "field_name": "Field 1", "crop": "Barley", "area": 50.0 }
]`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">Available Crops</h4>
                    <div className="text-xs text-muted-foreground">
                      <p className="mb-1">The system recognizes these crops:</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {["Wheat", "Barley", "Oats", "Peas", "Potato", "Carrot", "Rapeseed", "Sunflower", "Flax", "Corn"].map(crop => (
                          <span key={crop} className="inline-flex items-center px-2 py-1 rounded-md bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 text-xs font-medium">
                            {crop}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">Complete Example</h4>
                    <pre className="bg-slate-900 text-slate-50 p-3 rounded text-xs overflow-x-auto max-h-64">
{exampleJSON}
                    </pre>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => setImportData(exampleJSON)}
                    >
                      Use This Example
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Import Failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {results && (
              <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-900/20 dark:text-green-100">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertTitle>Import Completed</AlertTitle>
                <AlertDescription>
                  <div className="mt-2 space-y-1 text-sm">
                    <div>✓ Fields imported: {results.fields}</div>
                    <div>✓ Field history records: {results.field_history}</div>
                    <div>✓ Crop structure records: {results.crop_structure}</div>
                    {results.errors.length > 0 && (
                      <div className="mt-3">
                        <div className="font-medium text-amber-700 dark:text-amber-300 mb-1">
                          ⚠ Warnings ({results.errors.length}):
                        </div>
                        <ul className="list-disc list-inside space-y-1 text-xs text-amber-600 dark:text-amber-400">
                          {results.errors.map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
