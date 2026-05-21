'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useLanguage } from '@/lib/contexts/language-context';
import { supabase } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CircleCheck as CheckCircle, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  confirmWarehouseReceipt,
  getRecipientWarehouseIssueRequests,
  returnWarehouseRequestMaterials,
} from '@/lib/services/warehouse-requests';
import type { WarehouseIssueRequest } from '@/lib/types/warehouse-request';

interface Operation {
  id: string;
  operation_type: string;
  date: string;
  notes: string;
  status?: string | null;
  work_status?: 'active' | 'in_progress' | 'completed' | null;
  completed_at: string | null;
  fields?: { name: string };
  crop_structure?: {
    crops?: { name: string };
    varieties?: { name: string };
  };
}

type TaskTab = 'my_ops' | 'receiving' | 'in_work' | 'history';

export default function TasksPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();

  const [myTasks, setMyTasks] = useState<Operation[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Operation[]>([]);
  const [pendingReceipts, setPendingReceipts] = useState<WarehouseIssueRequest[]>([]);
  const [receiptHistory, setReceiptHistory] = useState<WarehouseIssueRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingReceiptId, setConfirmingReceiptId] = useState<string | null>(null);
  const [returningReceiptId, setReturningReceiptId] = useState<string | null>(null);
  const [returnDraftByItemId, setReturnDraftByItemId] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<TaskTab>('my_ops');

  const getTaskStatus = (task: Operation): 'active' | 'in_progress' | 'completed' => {
    if (task.work_status === 'active' || task.work_status === 'in_progress' || task.work_status === 'completed') {
      return task.work_status;
    }
    if (task.status === 'completed') return 'completed';
    if (task.status === 'in_progress' || task.status === 'accepted') return 'in_progress';
    return 'active';
  };

  useEffect(() => {
    if (profile) void loadTasks();
  }, [profile, language]);

  const buildAuthHeaders = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      throw new Error('Session not found. Please log in again.');
    }
    return {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    };
  };

  const loadTasks = async () => {
    try {
      const [operationsResult, receiptsResult] = await Promise.all([
        supabase
          .from('operations')
          .select(
            `
            *,
            fields(name),
            crop_structure(
              crops(name),
              varieties(name)
            )
          `
          )
          .or(`responsible_user_id.eq.${profile?.id},assigned_to.eq.${profile?.id}`)
          .order('date', { ascending: true }),
        profile?.company_id && profile?.id
          ? getRecipientWarehouseIssueRequests({
              companyId: profile.company_id,
              recipientUserId: profile.id,
            })
          : Promise.resolve([] as WarehouseIssueRequest[]),
      ]);

      if (operationsResult.error) throw operationsResult.error;

      const data = operationsResult.data || [];
      setMyTasks(data.filter((op) => getTaskStatus(op) !== 'completed'));
      setCompletedTasks(data.filter((op) => getTaskStatus(op) === 'completed'));

      const requests = receiptsResult || [];
      setPendingReceipts(
        requests.filter((r) => r.status === 'issued_by_warehouse' || r.status === 'partially_issued' || r.status === 'issued')
      );

      const confirmed = requests.filter((r) => r.status === 'received_confirmed');
      setReceiptHistory(confirmed);

      const nextReturnDraft: Record<string, string> = {};
      confirmed.forEach((request) => {
        (request.items || []).forEach((item) => {
          nextReturnDraft[item.id] = '0';
        });
      });
      setReturnDraftByItemId(nextReturnDraft);
    } catch (error) {
      console.error('Error loading tasks:', error);
      toast({
        title: 'Error',
        description: 'Failed to load tasks',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReceipt = async (requestId: string) => {
    if (!profile?.company_id) return;
    try {
      setConfirmingReceiptId(requestId);
      await confirmWarehouseReceipt({
        requestId,
        companyId: profile.company_id,
      });
      toast({
        title: 'Receipt confirmed',
        description: 'Materials receipt confirmed. Stock deduction finalized.',
      });
      await loadTasks();
    } catch (error: any) {
      console.error('Error confirming receipt:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to confirm receipt',
        variant: 'destructive',
      });
    } finally {
      setConfirmingReceiptId(null);
    }
  };

  const handleConfirmReturn = async (request: WarehouseIssueRequest) => {
    if (!profile?.company_id) return;

    const items = (request.items || [])
      .map((item) => {
        const raw = String(returnDraftByItemId[item.id] || '').trim();
        const qty = Number(raw);
        const issued = Number(item.issued_quantity || 0);
        const returned = Number(item.returned_quantity || 0);
        const maxQty = Math.max(issued - returned, 0);

        if (!Number.isFinite(qty) || qty <= 0) return null;
        if (qty > maxQty + 0.000001) {
          throw new Error(`Return exceeds available quantity for ${item.product_name || 'material'}`);
        }

        return {
          itemId: item.id,
          returnedQuantity: Number(qty.toFixed(4)),
        };
      })
      .filter(Boolean) as Array<{ itemId: string; returnedQuantity: number }>;

    if (items.length === 0) {
      toast({
        title: 'Error',
        description: 'Enter return quantity for at least one material.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setReturningReceiptId(request.id);
      await returnWarehouseRequestMaterials({
        requestId: request.id,
        companyId: profile.company_id,
        items,
      });
      toast({
        title: 'Return confirmed',
        description: 'Return movement created and request quantities updated.',
      });
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to register return',
        variant: 'destructive',
      });
    } finally {
      setReturningReceiptId(null);
    }
  };

  const handleAccept = async (taskId: string) => {
    try {
      const headers = await buildAuthHeaders();
      const response = await fetch(`/api/operations/${encodeURIComponent(taskId)}/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ companyId: profile?.company_id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Failed to start operation');

      toast({
        title: 'Task accepted',
        description: 'Operation moved to in-progress.',
      });
      await loadTasks();
    } catch (error) {
      console.error('Error accepting task:', error);
      toast({
        title: 'Error',
        description: 'Failed to accept task',
        variant: 'destructive',
      });
    }
  };

  const handleComplete = async (taskId: string) => {
    try {
      const headers = await buildAuthHeaders();
      const response = await fetch(`/api/operations/${encodeURIComponent(taskId)}/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ companyId: profile?.company_id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Failed to complete operation');

      toast({
        title: 'Task completed',
        description: 'Operation marked as completed.',
      });
      await loadTasks();
    } catch (error) {
      console.error('Error completing task:', error);
      toast({
        title: 'Error',
        description: 'Failed to complete task',
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-slate-100 text-slate-800',
      in_progress: 'bg-orange-100 text-orange-800',
      completed: 'bg-green-100 text-green-800',
    };
    return <Badge className={styles[status as keyof typeof styles] || styles.active}>{status.replace('_', ' ')}</Badge>;
  };

  const renderTaskCard = (task: Operation, isCompleted = false) => (
    <Card key={task.id} className="mb-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-lg">{task.operation_type}</CardTitle>
            <div className="space-y-1 text-sm text-slate-500">
              <p>Field: {task.fields?.name || 'Unknown'}</p>
              {task.crop_structure && (
                <p>
                  Crop: {task.crop_structure.crops?.name} - {task.crop_structure.varieties?.name}
                </p>
              )}
              <p>Date: {new Date(task.date).toLocaleDateString()}</p>
            </div>
          </div>
          {getStatusBadge(getTaskStatus(task))}
        </div>
      </CardHeader>
      <CardContent>
        {task.notes ? <p className="mb-4 text-sm text-slate-600">{task.notes}</p> : null}
        {!isCompleted ? (
          <div className="flex flex-wrap gap-2">
            {getTaskStatus(task) === 'active' ? (
              <Button onClick={() => handleAccept(task.id)} size="sm">
                <Clock className="mr-2 h-4 w-4" />
                Accept
              </Button>
            ) : null}
            {getTaskStatus(task) === 'in_progress' ? (
              <Button onClick={() => handleComplete(task.id)} size="sm" className="bg-green-600 hover:bg-green-700">
                <CheckCircle className="mr-2 h-4 w-4" />
                Complete
              </Button>
            ) : null}
          </div>
        ) : null}
        {isCompleted && task.completed_at ? (
          <p className="text-sm text-green-600">Completed: {new Date(task.completed_at).toLocaleString()}</p>
        ) : null}
      </CardContent>
    </Card>
  );

  const renderReturnCard = (request: WarehouseIssueRequest) => (
    <div key={request.id} className="rounded-md border p-3">
      <div className="font-medium">{request.request_number}</div>
      <div className="text-sm text-slate-500">
        {request.field_name || '-'} • {request.operation_type || '-'}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setReturnDraftByItemId((prev) => {
              const next = { ...prev };
              (request.items || []).forEach((item) => {
                const issued = Number(item.issued_quantity || 0);
                const returned = Number(item.returned_quantity || 0);
                next[item.id] = Math.max(issued - returned, 0).toFixed(2);
              });
              return next;
            });
          }}
        >
          Return all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setReturnDraftByItemId((prev) => {
              const next = { ...prev };
              (request.items || []).forEach((item) => {
                next[item.id] = '0';
              });
              return next;
            });
          }}
        >
          Clear
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        {(request.items || []).map((item) => {
          const issued = Number(item.issued_quantity || 0);
          const returned = Number(item.returned_quantity || 0);
          const available = Math.max(issued - returned, 0);
          return (
            <div key={item.id} className="rounded-md border p-2 text-sm">
              <div className="font-medium">{item.product_name || '-'}</div>
              <div className="text-xs text-slate-500">
                Issued {issued.toFixed(2)} {item.unit} • Returned {returned.toFixed(2)} {item.unit} • Available {available.toFixed(2)} {item.unit}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={available}
                  step="0.01"
                  value={returnDraftByItemId[item.id] ?? '0'}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setReturnDraftByItemId((prev) => ({
                      ...prev,
                      [item.id]: event.target.value,
                    }))
                  }
                  className="h-8"
                />
                <span className="text-xs text-slate-500">{item.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2">
        <Button type="button" variant="outline" onClick={() => handleConfirmReturn(request)} disabled={returningReceiptId === request.id}>
          Register return
        </Button>
      </div>
    </div>
  );

  const inProgressTasks = myTasks.filter((task) => getTaskStatus(task) === 'in_progress');
  const isTaskRole = profile?.role === 'specialist' || profile?.role === 'brigadier';

  if (!isTaskRole) {
    return (
      <div>
        <PageHeader title="My Tasks" description="Your assigned operations and material requests" />
        <Alert variant="destructive">
          <AlertDescription>Access denied. This page is available for specialists and brigadiers only.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="pb-20 md:pb-0">
      <PageHeader title="My Tasks" description="View and manage your assigned operations" />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TaskTab)} className="space-y-4">
        <TabsList className="hidden md:grid md:w-fit md:grid-cols-4">
          <TabsTrigger value="my_ops">My operations ({myTasks.length})</TabsTrigger>
          <TabsTrigger value="receiving">Receiving ({pendingReceipts.length})</TabsTrigger>
          <TabsTrigger value="in_work">In progress ({inProgressTasks.length})</TabsTrigger>
          <TabsTrigger value="history">History ({completedTasks.length + receiptHistory.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="my_ops">
          {loading ? (
            <Card><CardContent className="p-6 text-center text-slate-500">Loading tasks...</CardContent></Card>
          ) : myTasks.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-slate-500">No active tasks assigned to you.</CardContent></Card>
          ) : (
            <div>{myTasks.map((task) => renderTaskCard(task))}</div>
          )}
        </TabsContent>

        <TabsContent value="receiving">
          {loading ? (
            <Card><CardContent className="p-6 text-center text-slate-500">Loading receipt requests...</CardContent></Card>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Pending confirmation</CardTitle></CardHeader>
                <CardContent>
                  {pendingReceipts.length === 0 ? (
                    <div className="text-sm text-slate-500">No pending material receipts.</div>
                  ) : (
                    <div className="space-y-3">
                      {pendingReceipts.map((request) => (
                        <Card key={request.id}>
                          <CardContent className="pt-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="space-y-1 text-sm">
                                <div><span className="text-slate-500">Request:</span> {request.request_number}</div>
                                <div><span className="text-slate-500">Operation:</span> {request.operation_type} ({request.operation_date || '-'})</div>
                                <div><span className="text-slate-500">Field:</span> {request.field_name || '-'}</div>
                                <div><span className="text-slate-500">Warehouse:</span> {request.source_warehouse_name || '-'}</div>
                              </div>
                              <Button
                                onClick={() => handleConfirmReceipt(request.id)}
                                disabled={confirmingReceiptId === request.id}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                Confirm receipt
                              </Button>
                            </div>
                            <div className="mt-3 text-sm">
                              <div className="mb-1 font-medium">Materials</div>
                              <div className="space-y-1">
                                {request.items.map((item) => (
                                  <div key={item.id}>
                                    {item.product_name} - {Number(item.required_quantity || 0).toFixed(2)} {item.unit}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Confirmed receipts</CardTitle></CardHeader>
                <CardContent>
                  {receiptHistory.length === 0 ? (
                    <div className="text-sm text-slate-500">No confirmed receipts yet.</div>
                  ) : (
                    <div className="space-y-3">{receiptHistory.map((request) => renderReturnCard(request))}</div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="in_work">
          {loading ? (
            <Card><CardContent className="p-6 text-center text-slate-500">Loading tasks...</CardContent></Card>
          ) : inProgressTasks.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-slate-500">No operations in progress.</CardContent></Card>
          ) : (
            <div>{inProgressTasks.map((task) => renderTaskCard(task))}</div>
          )}
        </TabsContent>

        <TabsContent value="history">
          {loading ? (
            <Card><CardContent className="p-6 text-center text-slate-500">Loading history...</CardContent></Card>
          ) : (
            <div className="space-y-4">
              {completedTasks.length > 0 ? <div>{completedTasks.map((task) => renderTaskCard(task, true))}</div> : null}
              {completedTasks.length === 0 && receiptHistory.length === 0 ? (
                <Card><CardContent className="p-6 text-center text-slate-500">No history yet.</CardContent></Card>
              ) : null}
              {receiptHistory.length > 0 ? (
                <Card>
                  <CardHeader><CardTitle>Confirmed receipts</CardTitle></CardHeader>
                  <CardContent className="space-y-3 text-sm">{receiptHistory.map((request) => renderReturnCard(request))}</CardContent>
                </Card>
              ) : null}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-2 py-2 shadow md:hidden">
        <div className="grid grid-cols-4 gap-1 text-xs">
          <Button type="button" variant={activeTab === 'my_ops' ? 'default' : 'outline'} className="h-9 px-1" onClick={() => setActiveTab('my_ops')}>
            Ops
          </Button>
          <Button type="button" variant={activeTab === 'receiving' ? 'default' : 'outline'} className="h-9 px-1" onClick={() => setActiveTab('receiving')}>
            Receive
          </Button>
          <Button type="button" variant={activeTab === 'in_work' ? 'default' : 'outline'} className="h-9 px-1" onClick={() => setActiveTab('in_work')}>
            Work
          </Button>
          <Button type="button" variant={activeTab === 'history' ? 'default' : 'outline'} className="h-9 px-1" onClick={() => setActiveTab('history')}>
            History
          </Button>
        </div>
      </div>
    </div>
  );
}
