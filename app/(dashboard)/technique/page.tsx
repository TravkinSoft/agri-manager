"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Archive } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  archiveMachineReference,
  createMachineReference,
  getMachineReferences,
  updateMachineReference,
} from "@/lib/services/references";
import { machineSchema, type MachineFormData, type MachineReference } from "@/lib/types/references";

const TECHNIQUE_TYPE_LABELS: Record<MachineReference["type"], string> = {
  combine: "Комбайн",
  seeder: "Сеялка",
  sprayer: "Опрыскиватель",
  cultivator: "Культиватор",
  tractor: "Трактор",
  other: "Другое",
};

const TECHNIQUE_STATUS_LABELS: Record<MachineReference["status"], string> = {
  free: "Свободна",
  working: "Работает",
  maintenance: "В ремонте",
};

export default function TechniquePage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<MachineReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editing, setEditing] = useState<MachineReference | null>(null);
  const [archiveItem, setArchiveItem] = useState<MachineReference | null>(null);

  const form = useForm<MachineFormData>({
    resolver: zodResolver(machineSchema),
    defaultValues: {
      name: "",
      type: "other",
      model: "",
      status: "free",
      is_active: true,
    },
  });

  const canManage = useMemo(
    () =>
      profile?.role === "company_admin" ||
      profile?.role === "global_admin" ||
      profile?.role === "agronomist",
    [profile?.role]
  );

  const load = async () => {
    if (!profile?.company_id) return;
    try {
      setLoading(true);
      const data = await getMachineReferences(profile.company_id, false);
      setRows(data);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить технику",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [profile?.company_id]);

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", type: "other", model: "", status: "free", is_active: true });
    setDialogOpen(true);
  };

  const openEdit = (item: MachineReference) => {
    setEditing(item);
    form.reset({
      name: item.name,
      type: item.type,
      model: item.model || "",
      status: item.status,
      is_active: item.is_active,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: MachineFormData) => {
    if (!profile?.company_id || !profile?.id || !canManage) return;
    try {
      if (editing) {
        await updateMachineReference(editing.id, values);
      } else {
        await createMachineReference(profile.company_id, profile.id, values);
      }
      setDialogOpen(false);
      await load();
      toast({ title: "Готово", description: editing ? "Техника обновлена" : "Техника добавлена" });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось сохранить технику",
        variant: "destructive",
      });
    }
  };

  const onArchive = async () => {
    if (!archiveItem || !canManage) return;
    try {
      await archiveMachineReference(archiveItem.id);
      setArchiveOpen(false);
      setArchiveItem(null);
      await load();
      toast({ title: "Готово", description: "Техника отправлена в архив" });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось архивировать технику",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Техника" description="Спецтехника для полевых операций (не транспорт)" />

      <div className="flex justify-end">
        <Button onClick={openCreate} disabled={!canManage}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить технику
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Модель</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Активна</TableHead>
                <TableHead className="w-[130px]">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">Загрузка...</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">Техника не добавлена</TableCell>
                </TableRow>
              ) : (
                rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{TECHNIQUE_TYPE_LABELS[item.type] || item.type}</TableCell>
                    <TableCell>{item.model || "-"}</TableCell>
                    <TableCell>{TECHNIQUE_STATUS_LABELS[item.status] || item.status}</TableCell>
                    <TableCell>{item.is_active ? "Да" : "Нет"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(item)} disabled={!canManage}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setArchiveItem(item);
                            setArchiveOpen(true);
                          }}
                          disabled={!canManage}
                        >
                          <Archive className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать технику" : "Добавить технику"}</DialogTitle>
            <DialogDescription>Комбайны, сеялки, опрыскиватели и другая спецтехника.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Название *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Тип *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="combine">Комбайн</SelectItem>
                        <SelectItem value="seeder">Сеялка</SelectItem>
                        <SelectItem value="sprayer">Опрыскиватель</SelectItem>
                        <SelectItem value="cultivator">Культиватор</SelectItem>
                        <SelectItem value="tractor">Трактор</SelectItem>
                        <SelectItem value="other">Другое</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Модель</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Статус</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="free">Свободна</SelectItem>
                        <SelectItem value="working">Работает</SelectItem>
                        <SelectItem value="maintenance">В ремонте</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border px-3 py-2">
                    <FormLabel>Активна</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
                <Button type="submit">{editing ? "Сохранить" : "Создать"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Архивировать технику?</AlertDialogTitle>
            <AlertDialogDescription>
              Техника будет скрыта из списка и перестанет быть доступной в операциях.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onArchive}>Архивировать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
