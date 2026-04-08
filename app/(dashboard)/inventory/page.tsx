'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { supabase } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CircleArrowDown as ArrowDownCircle, CircleArrowUp as ArrowUpCircle, Package } from 'lucide-react';

interface InventoryItem {
  id: string;
  warehouse_id: string;
  product_id: string;
  quantity: number;
  unit: string;
  warehouses?: { name: string };
  products?: { name: string; type: string };
}

interface Transaction {
  id: string;
  warehouse_id: string;
  product_id: string;
  type: string;
  quantity: number;
  unit: string;
  notes: string;
  date: string;
  warehouses?: { name: string };
  products?: { name: string; type: string };
}

export default function InventoryPage() {
  const { profile } = useAuth();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile) {
      loadInventoryData();
    }
  }, [profile]);

  const loadInventoryData = async () => {
    try {
      const [inventoryRes, transactionsRes] = await Promise.all([
        supabase
          .from('inventory_transactions')
          .select(`
            warehouse_id,
            product_id,
            unit,
            warehouses(name),
            products(name, type)
          `)
          .eq('user_id', profile?.id),
        supabase
          .from('inventory_transactions')
          .select(`
            *,
            warehouses(name),
            products(name, type)
          `)
          .eq('user_id', profile?.id)
          .order('date', { ascending: false })
          .limit(50),
      ]);

      if (inventoryRes.error) throw inventoryRes.error;
      if (transactionsRes.error) throw transactionsRes.error;

      const inventoryMap = new Map<string, InventoryItem>();
      inventoryRes.data?.forEach((item: any) => {
        const key = `${item.warehouse_id}-${item.product_id}`;
        if (!inventoryMap.has(key)) {
          inventoryMap.set(key, {
            id: key,
            warehouse_id: item.warehouse_id,
            product_id: item.product_id,
            quantity: 0,
            unit: item.unit,
            warehouses: item.warehouses,
            products: item.products,
          });
        }
      });

      transactionsRes.data?.forEach((transaction: Transaction) => {
        const key = `${transaction.warehouse_id}-${transaction.product_id}`;
        const item = inventoryMap.get(key);
        if (item) {
          if (transaction.type === 'in') {
            item.quantity += transaction.quantity;
          } else {
            item.quantity -= transaction.quantity;
          }
        }
      });

      setInventory(Array.from(inventoryMap.values()));
      setTransactions(transactionsRes.data || []);
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTransactionBadge = (type: string) => {
    return type === 'in' ? (
      <Badge className="bg-green-100 text-green-800">
        <ArrowDownCircle className="h-3 w-3 mr-1" />
        Incoming
      </Badge>
    ) : (
      <Badge className="bg-orange-100 text-orange-800">
        <ArrowUpCircle className="h-3 w-3 mr-1" />
        Outgoing
      </Badge>
    );
  };

  if (profile?.role !== 'warehouse') {
    return (
      <div>
        <PageHeader
          title="Inventory"
          description="Manage warehouse inventory"
        />
        <Alert variant="destructive">
          <AlertDescription>
            Access denied. This page is only available for warehouse staff.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Inventory Management"
        description="View and manage warehouse inventory"
      />

      <Tabs defaultValue="stock" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stock">
            <Package className="h-4 w-4 mr-2" />
            Current Stock
          </TabsTrigger>
          <TabsTrigger value="transactions">
            Transactions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        Loading inventory...
                      </TableCell>
                    </TableRow>
                  ) : inventory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        No inventory data found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    inventory.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.warehouses?.name || 'Unknown'}
                        </TableCell>
                        <TableCell>{item.products?.name || 'Unknown'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.products?.type || 'N/A'}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {item.quantity.toLocaleString()} {item.unit}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500">
                        Loading transactions...
                      </TableCell>
                    </TableRow>
                  ) : transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500">
                        No transactions found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          {new Date(transaction.date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{getTransactionBadge(transaction.type)}</TableCell>
                        <TableCell>{transaction.warehouses?.name || 'Unknown'}</TableCell>
                        <TableCell>{transaction.products?.name || 'Unknown'}</TableCell>
                        <TableCell className="text-right font-medium">
                          {transaction.quantity.toLocaleString()} {transaction.unit}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {transaction.notes || '-'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
