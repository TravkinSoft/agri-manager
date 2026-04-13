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
  archiveVehicleReference,
  createVehicleReference,
  getVehicleReferences,
  updateVehicleReference,
} from "@/lib/services/references";
import { vehicleSchema, type VehicleFormData, type VehicleReference } from "@/lib/types/references";

const VEHICLE_TYPE_LABELS: Record<VehicleReference["vehicle_type"], string> = {
  truck: "Грузовик",
  grain_truck: "Зерновоз",
  dump_truck: "Самосвал",
  tractor_trailer: "Трактор с прицепом",
};

const VEHICLE_STATUS_LABELS: Record<VehicleReference["status"], string> = {
  free: "Свободен",
  in_trip: "В рейсе",
  loading: "На загрузке",
  unloading: "На выгрузке",
  drying: "На сушке",
};

export default function MachinesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<VehicleReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleReference | null>(null);
  const [archiveItem, setArchiveItem] = useState<VehicleReference | null>(null);

  const form = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      name: "",
      vehicle_type: "truck",
      plate_number: "",
      capacity_kg: 0,
      body_volume_m3: null,
      status: "free",
      is_active: true,
    },
  });

  const canManage = useMemo(
    () =>
      profile?.role === "admin" ||
      profile?.role === "company_admin" ||
      profile?.role === "global_admin" ||
      profile?.role === "warehouse" ||
      profile?.role === "weighman",
    [profile?.role]
  );

  const load = async () => {
    if (!profile?.company_id) return;
    try {
      setLoading(true);
      const data = await getVehicleReferences(profile.company_id, false);
      setRows(data);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить машины",
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
    form.reset({
      name: "",
      vehicle_type: "truck",
      plate_number: "",
      capacity_kg: 0,
      body_volume_m3: null,
      status: "free",
      is_active: true,
    });
    setDialogOpen(true);
  };

  const openEdit = (item: VehicleReference) => {
    setEditing(item);
    form.reset({
      name: item.name,
      vehicle_type: item.vehicle_type,
      plate_number: item.plate_number,
      capacity_kg: Number(item.capacity_kg || 0),
      body_volume_m3: item.body_volume_m3 == null ? null : Number(item.body_volume_m3),
      status: item.status,
      is_active: item.is_active,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: VehicleFormData) => {
    if (!profile?.company_id || !profile?.id || !canManage) return;
    try {
      if (editing) {
        await updateVehicleReference(editing.id, values);
      } else {
        await createVehicleReference(profile.company_id, profile.id, values);
      }
      setDialogOpen(false);
      await load();
      toast({ title: "Готово", description: editing ? "Машина обновлена" : "Машина добавлена" });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось сохранить машину",
        variant: "destructive",
      });
    }
  };

  const onArchive = async () => {
    if (!archiveItem || !canManage) return;
    try {
      await archiveVehicleReference(archiveItem.id);
      setArchiveOpen(false);
      setArchiveItem(null);
      await load();
      toast({ title: "Готово", description: "Машина отправлена в архив" });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось архивировать машину",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Машины" description="Транспорт для рейсов и талонов весовой" />

      <div className="flex justify-end">
        <Button onClick={openCreate} disabled={!canManage}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить машину
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Гос номер</TableHead>
                <TableHead>Грузоподъемность</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Активна</TableHead>
                <TableHead className="w-[130px]">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500">Загрузка...</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500">Машины не добавлены</TableCell>
                </TableRow>
              ) : (
                rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{VEHICLE_TYPE_LABELS[item.vehicle_type] || item.vehicle_type}</TableCell>
                    <TableCell>{item.plate_number}</TableCell>
                    <TableCell>{Number(item.capacity_kg || 0).toLocaleString("ru-RU")} кг</TableCell>
                    <TableCell>{VEHICLE_STATUS_LABELS[item.status] || item.status}</TableCell>
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
            <DialogTitle>{editing ? "Редактировать машину" : "Добавить машину"}</DialogTitle>
            <DialogDescription>Используется в талонах весовой и складских рейсах.</DialogDescription>
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
                name="vehicle_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Тип *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="truck">Грузовик</SelectItem>
                        <SelectItem value="grain_truck">Зерновоз</SelectItem>
                        <SelectItem value="dump_truck">Самосвал</SelectItem>
                        <SelectItem value="tractor_trailer">Трактор с прицепом</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="plate_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Гос номер *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="capacity_kg"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Грузоподъемность, кг *</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} step="0.001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="body_volume_m3"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Объем кузова, м³</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          step="0.001"
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(event.target.value === "" ? null : Number(event.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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
                        <SelectItem value="free">Свободен</SelectItem>
                        <SelectItem value="in_trip">В рейсе</SelectItem>
                        <SelectItem value="loading">На загрузке</SelectItem>
                        <SelectItem value="unloading">На выгрузке</SelectItem>
                        <SelectItem value="drying">На сушке</SelectItem>
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
            <AlertDialogTitle>Архивировать машину?</AlertDialogTitle>
            <AlertDialogDescription>
              Машина будет скрыта из активного списка и недоступна для новых талонов.
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
