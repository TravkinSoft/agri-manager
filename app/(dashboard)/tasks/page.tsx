'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { supabase } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CircleCheck as CheckCircle, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Operation {
  id: string;
  operation_type: string;
  date: string;
  notes: string;
  status?: string | null;
  work_status?: 'active' | 'in_progress' | 'completed' | null;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  field_id: string;
  fields?: { name: string };
  crop_structure?: {
    crops?: { name: string };
    varieties?: { name: string };
  };
}

export default function TasksPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [myTasks, setMyTasks] = useState<Operation[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);

  const getTaskStatus = (task: Operation): 'active' | 'in_progress' | 'completed' => {
    if (task.work_status === 'active' || task.work_status === 'in_progress' || task.work_status === 'completed') {
      return task.work_status;
    }
    if (task.status === 'completed') return 'completed';
    if (task.status === 'in_progress' || task.status === 'accepted') return 'in_progress';
    return 'active';
  };

  useEffect(() => {
    if (profile) {
      loadTasks();
    }
  }, [profile]);

  const loadTasks = async () => {
    try {
      const { data, error } = await supabase
        .from('operations')
        .select(`
          *,
          fields(name),
          crop_structure(
            crops(name),
            varieties(name)
          )
        `)
        .or(`responsible_user_id.eq.${profile?.id},assigned_to.eq.${profile?.id}`)
        .order('date', { ascending: true });

      if (error) throw error;

      const active = data?.filter(op => getTaskStatus(op) !== 'completed') || [];
      const completed = data?.filter(op => getTaskStatus(op) === 'completed') || [];

      setMyTasks(active);
      setCompletedTasks(completed);
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

  const handleAccept = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('operations')
        .update({
          status: 'in_progress',
          work_status: 'in_progress',
          accepted_at: new Date().toISOString(),
        })
        .eq('id', taskId);

      if (error) throw error;

      toast({
        title: 'Task Accepted',
        description: 'You have accepted this task and started work',
      });

      loadTasks();
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
      const { error } = await supabase
        .from('operations')
        .update({
          status: 'completed',
          work_status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', taskId);

      if (error) throw error;

      toast({
        title: 'Task Completed',
        description: 'Great job! Task has been marked as completed',
      });

      loadTasks();
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
    return (
      <Badge className={styles[status as keyof typeof styles] || styles.active}>
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const renderTaskCard = (task: Operation, isCompleted: boolean = false) => (
    <Card key={task.id} className="mb-4">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{task.operation_type}</CardTitle>
            <div className="text-sm text-slate-500 space-y-1">
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
        {task.notes && (
          <p className="text-sm text-slate-600 mb-4">{task.notes}</p>
        )}
        {!isCompleted && (
          <div className="flex gap-2">
            {getTaskStatus(task) === 'active' && (
              <Button onClick={() => handleAccept(task.id)} size="sm">
                <Clock className="h-4 w-4 mr-2" />
                Accept in work
              </Button>
            )}
            {getTaskStatus(task) === 'in_progress' && (
              <Button onClick={() => handleComplete(task.id)} size="sm" className="bg-green-600 hover:bg-green-700">
                <CheckCircle className="h-4 w-4 mr-2" />
                Complete Task
              </Button>
            )}
          </div>
        )}
        {isCompleted && task.completed_at && (
          <p className="text-sm text-green-600">
            Completed: {new Date(task.completed_at).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );

  if (profile?.role !== 'specialist') {
    return (
      <div>
        <PageHeader
          title="My Tasks"
          description="Your assigned operations and tasks"
        />
        <Alert variant="destructive">
          <AlertDescription>
            Access denied. This page is only available for specialists.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="My Tasks"
        description="View and manage your assigned operations"
      />

      <Tabs defaultValue="active" className="space-y-4">
        <TabsList>
          <TabsTrigger value="active">
            My Tasks ({myTasks.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({completedTasks.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {loading ? (
            <Card>
              <CardContent className="p-6 text-center text-slate-500">
                Loading tasks...
              </CardContent>
            </Card>
          ) : myTasks.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-slate-500">
                No active tasks assigned to you.
              </CardContent>
            </Card>
          ) : (
            <div>
              {myTasks.map(task => renderTaskCard(task))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed">
          {loading ? (
            <Card>
              <CardContent className="p-6 text-center text-slate-500">
                Loading tasks...
              </CardContent>
            </Card>
          ) : completedTasks.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-slate-500">
                No completed tasks yet.
              </CardContent>
            </Card>
          ) : (
            <div>
              {completedTasks.map(task => renderTaskCard(task, true))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
