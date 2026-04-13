"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Plus, MoveHorizontal as MoreHorizontal, Pencil, Archive } from "lucide-react";
import { FieldFormDialog } from "@/components/fields/field-form-dialog";
import { Field, FieldFormData } from "@/lib/types/field";
import {
  getFields,
  createField,
  updateField,
  archiveField,
} from "@/lib/services/fields";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import type { Language } from "@/lib/i18n/translations";
import { localizeUnit } from "@/lib/i18n/helpers";

const pageText: Record<Language, Record<string, string>> = {
  ru: {
    title: "Поля",
    desc: "Управление полями и земельными участками",
    add: "Добавить поле",
    fieldName: "Название поля",
    area: "Площадь",
    soilType: "Тип почвы",
    notes: "Примечания",
    createdAt: "Создано",
    actions: "Действия",
    loading: "Загрузка...",
    empty: "Поля еще не добавлены. Нажмите «Добавить поле».",
    edit: "Редактировать",
    archive: "Архивировать",
    cancel: "Отмена",
    archiveTitle: "Архивировать поле",
    archiveDesc: "Вы уверены, что хотите архивировать поле",
    archiveDescTail: "Оно будет скрыто из основного списка, но его можно восстановить позже.",
    success: "Успешно",
    error: "Ошибка",
    loadError: "Не удалось загрузить поля",
    addSuccess: "Поле успешно добавлено",
    addError: "Не удалось добавить поле",
    editSuccess: "Поле успешно обновлено",
    editError: "Не удалось обновить поле",
    archiveSuccess: "Поле успешно архивировано",
    archiveError: "Не удалось архивировать поле",
  },
  kz: {
    title: "Алаңдар",
    desc: "Алаңдар мен жер телімдерін басқару",
    add: "Алаң қосу",
    fieldName: "Алаң атауы",
    area: "Ауданы",
    soilType: "Топырақ түрі",
    notes: "Ескертпе",
    createdAt: "Құрылған күні",
    actions: "Әрекеттер",
    loading: "Жүктелуде...",
    empty: "Әлі алаң қосылмаған. «Алаң қосу» түймесін басыңыз.",
    edit: "Өңдеу",
    archive: "Мұрағатқа жіберу",
    cancel: "Болдырмау",
    archiveTitle: "Алаңды мұрағаттау",
    archiveDesc: "Осы алаңды мұрағаттағыңыз келе ме",
    archiveDescTail: "Ол негізгі тізімнен жасырылады, кейін қалпына келтіруге болады.",
    success: "Сәтті",
    error: "Қате",
    loadError: "Алаңдарды жүктеу мүмкін болмады",
    addSuccess: "Алаң сәтті қосылды",
    addError: "Алаңды қосу мүмкін болмады",
    editSuccess: "Алаң сәтті жаңартылды",
    editError: "Алаңды жаңарту мүмкін болмады",
    archiveSuccess: "Алаң сәтті мұрағатталды",
    archiveError: "Алаңды мұрағаттау мүмкін болмады",
  },
  en: {
    title: "Fields",
    desc: "Manage fields and land parcels",
    add: "Add Field",
    fieldName: "Field Name",
    area: "Area",
    soilType: "Soil Type",
    notes: "Notes",
    createdAt: "Created At",
    actions: "Actions",
    loading: "Loading...",
    empty: "No fields yet. Click “Add Field” to start.",
    edit: "Edit",
    archive: "Archive",
    cancel: "Cancel",
    archiveTitle: "Archive Field",
    archiveDesc: "Are you sure you want to archive field",
    archiveDescTail: "It will be hidden from the main list and can be restored later.",
    success: "Success",
    error: "Error",
    loadError: "Failed to load fields",
    addSuccess: "Field added successfully",
    addError: "Failed to add field",
    editSuccess: "Field updated successfully",
    editError: "Failed to update field",
    archiveSuccess: "Field archived successfully",
    archiveError: "Failed to archive field",
  },
};

export default function FieldsPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [fieldToArchive, setFieldToArchive] = useState<Field | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { language } = useLanguage();
  const text = pageText[language];

  useEffect(() => {
    if (profile?.company_id) {
      loadFields();
    }
  }, [profile?.company_id]);

  const loadFields = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      const data = await getFields(profile.company_id);
      setFields(data);
    } catch (error) {
      toast({
        title: text.error,
        description: text.loadError,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddField = async (data: FieldFormData) => {
    if (!profile?.company_id) return;

    try {
      await createField(profile.company_id, data);
      setIsFormOpen(false);
      await loadFields();
      toast({
        title: text.success,
        description: text.addSuccess,
      });
    } catch (error) {
      toast({
        title: text.error,
        description: text.addError,
        variant: "destructive",
      });
    }
  };

  const handleEditField = async (data: FieldFormData) => {
    if (!editingField) return;

    try {
      await updateField(editingField.id, data);
      setIsFormOpen(false);
      setEditingField(null);
      await loadFields();
      toast({
        title: text.success,
        description: text.editSuccess,
      });
    } catch (error) {
      toast({
        title: text.error,
        description: text.editError,
        variant: "destructive",
      });
    }
  };

  const handleArchiveField = async () => {
    if (!fieldToArchive) return;

    try {
      await archiveField(fieldToArchive.id);
      setArchiveDialogOpen(false);
      setFieldToArchive(null);
      await loadFields();
      toast({
        title: text.success,
        description: text.archiveSuccess,
      });
    } catch (error) {
      toast({
        title: text.error,
        description: text.archiveError,
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (field: Field) => {
    setEditingField(field);
    setIsFormOpen(true);
  };

  const openArchiveDialog = (field: Field) => {
    setFieldToArchive(field);
    setArchiveDialogOpen(true);
  };

  const handleFormClose = (open: boolean) => {
    setIsFormOpen(open);
    if (!open) {
      setEditingField(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={text.title}
        description={text.desc}
        action={{
          label: text.add,
          icon: Plus,
          onClick: () => setIsFormOpen(true),
        }}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{text.fieldName}</TableHead>
                <TableHead>{text.area} ({localizeUnit("ha", language)})</TableHead>
                <TableHead>{text.soilType}</TableHead>
                <TableHead>{text.notes}</TableHead>
                <TableHead>{text.createdAt}</TableHead>
                <TableHead className="w-[70px]">{text.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    {text.loading}
                  </TableCell>
                </TableRow>
              ) : fields.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    {text.empty}
                  </TableCell>
                </TableRow>
              ) : (
                fields.map((field) => (
                  <TableRow key={field.id}>
                    <TableCell className="font-medium">{field.name}</TableCell>
                    <TableCell>{field.area.toFixed(2)}</TableCell>
                    <TableCell>{field.soil_type || "-"}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {field.notes || "-"}
                    </TableCell>
                    <TableCell>
                      {format(new Date(field.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(field)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {text.edit}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openArchiveDialog(field)}
                            className="text-red-600"
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            {text.archive}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FieldFormDialog
        open={isFormOpen}
        onOpenChange={handleFormClose}
        onSubmit={editingField ? handleEditField : handleAddField}
        defaultValues={
          editingField
            ? {
                name: editingField.name,
                area: editingField.area,
                soil_type: editingField.soil_type || "",
                notes: editingField.notes || "",
              }
            : undefined
        }
        isEdit={!!editingField}
      />

      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{text.archiveTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {text.archiveDesc} "{fieldToArchive?.name}"? {text.archiveDescTail}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{text.cancel || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchiveField}>
              {text.archive}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
