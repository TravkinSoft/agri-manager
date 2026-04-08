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

export default function FieldsPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [fieldToArchive, setFieldToArchive] = useState<Field | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();

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
        title: "Error",
        description: "Failed to load fields",
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
        title: "Success",
        description: "Field added successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add field",
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
        title: "Success",
        description: "Field updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update field",
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
        title: "Success",
        description: "Field archived successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to archive field",
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
        title="Fields"
        description="Manage your agricultural fields and land parcels"
        action={{
          label: "Add Field",
          icon: Plus,
          onClick: () => setIsFormOpen(true),
        }}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field Name</TableHead>
                <TableHead>Area (ha)</TableHead>
                <TableHead>Soil Type</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="w-[70px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : fields.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    No fields added yet. Click "Add Field" to get started.
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
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openArchiveDialog(field)}
                            className="text-red-600"
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Archive
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
            <AlertDialogTitle>Archive Field</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive "{fieldToArchive?.name}"? This
              field will be hidden from the main view but can be restored later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchiveField}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
