"use client";

import { useState, useEffect } from "react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package } from "lucide-react";
import { getInventoryBalances } from "@/lib/services/warehouses";
import { InventoryBalance } from "@/lib/types/warehouse";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";

export default function WarehousesPage() {
  const [inventoryBalances, setInventoryBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const loadInventory = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      const balances = await getInventoryBalances(profile.company_id);
      setInventoryBalances(balances);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load inventory data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.company_id) {
      loadInventory();
    }
  }, [profile?.company_id]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getProductTypeBadgeColor = (type: string) => {
    switch (type) {
      case "seed":
        return "bg-green-100 text-green-800";
      case "fertilizer":
        return "bg-blue-100 text-blue-800";
      case "pesticide":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouses & Inventory"
        description="View inventory levels and stock balances across all warehouses"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Current Inventory Levels
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : inventoryBalances.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-slate-500 py-8"
                    >
                      No inventory data available. Add transactions to see inventory levels.
                    </TableCell>
                  </TableRow>
                ) : (
                  inventoryBalances.map((balance, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        {balance.warehouse_name}
                      </TableCell>
                      <TableCell>{balance.product_name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={getProductTypeBadgeColor(balance.product_type)}
                        >
                          {balance.product_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {balance.quantity.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {formatDate(balance.last_updated)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => (window.location.href = "/warehouses/transactions")}
            >
              View All Transactions
            </Button>
            <Button
              variant="outline"
              onClick={() => (window.location.href = "/warehouses/manage")}
            >
              Manage Warehouses & Products
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
