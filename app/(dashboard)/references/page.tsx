"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Archive } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Crop,
  CropFormData,
  cropSchema,
  Variety,
  VarietyFormData,
  varietySchema,
  VarietyWithCrop,
  SeedReproduction,
  SeedReproductionFormData,
  seedReproductionSchema,
  MachineReference,
  MachineFormData,
  machineSchema,
  EquipmentReference,
  EquipmentFormData,
  equipmentSchema,
  SpecialistReference,
  SpecialistReferenceFormData,
  specialistReferenceSchema,
} from "@/lib/types/references";
import {
  getCrops,
  createCrop,
  updateCrop,
  archiveCrop,
  getVarieties,
  getVarietiesByCrop,
  createVariety,
  updateVariety,
  archiveVariety,
  getSeedReproductions,
  createSeedReproduction,
  updateSeedReproduction,
  archiveSeedReproduction,
  getMachineReferences,
  createMachineReference,
  updateMachineReference,
  archiveMachineReference,
  getEquipmentReferences,
  createEquipmentReference,
  updateEquipmentReference,
  archiveEquipmentReference,
  getSpecialistReferences,
  createSpecialistReference,
  updateSpecialistReference,
  archiveSpecialistReference,
} from "@/lib/services/references";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";

export default function ReferencesPage() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState("crops");
  const [crops, setCrops] = useState<Crop[]>([]);
  const [varieties, setVarieties] = useState<VarietyWithCrop[]>([]);
  const [selectedCropId, setSelectedCropId] = useState<string>("all");
  const [seedReproductions, setSeedReproductions] = useState<SeedReproduction[]>([]);
  const [machines, setMachines] = useState<MachineReference[]>([]);
  const [equipment, setEquipment] = useState<EquipmentReference[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistReference[]>([]);
  const [loading, setLoading] = useState(true);

  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [varietyDialogOpen, setVarietyDialogOpen] = useState(false);
  const [reproductionDialogOpen, setReproductionDialogOpen] = useState(false);
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [equipmentDialogOpen, setEquipmentDialogOpen] = useState(false);
  const [specialistDialogOpen, setSpecialistDialogOpen] = useState(false);

  const [editingCrop, setEditingCrop] = useState<Crop | null>(null);
  const [editingVariety, setEditingVariety] = useState<Variety | null>(null);
  const [editingReproduction, setEditingReproduction] = useState<SeedReproduction | null>(null);
  const [editingMachine, setEditingMachine] = useState<MachineReference | null>(null);
  const [editingEquipment, setEditingEquipment] = useState<EquipmentReference | null>(null);
  const [editingSpecialist, setEditingSpecialist] = useState<SpecialistReference | null>(null);

  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveType, setArchiveType] = useState<"crop" | "variety" | "reproduction" | "machine" | "equipment" | "specialist">("crop");
  const [itemToArchive, setItemToArchive] = useState<any>(null);

  const { toast } = useToast();

  const cropForm = useForm<CropFormData>({
    resolver: zodResolver(cropSchema),
    defaultValues: { name: "" },
  });

  const varietyForm = useForm<VarietyFormData>({
    resolver: zodResolver(varietySchema),
    defaultValues: { crop_id: "", name: "" },
  });

  const reproductionForm = useForm<SeedReproductionFormData>({
    resolver: zodResolver(seedReproductionSchema),
    defaultValues: { name: "" },
  });

  const machineForm = useForm<MachineFormData>({
    resolver: zodResolver(machineSchema),
    defaultValues: { name: "", type: "machine" },
  });

  const equipmentForm = useForm<EquipmentFormData>({
    resolver: zodResolver(equipmentSchema),
    defaultValues: { name: "", category: "" },
  });

  const specialistForm = useForm<SpecialistReferenceFormData>({
    resolver: zodResolver(specialistReferenceSchema),
    defaultValues: { full_name: "", role: "" },
  });

  useEffect(() => {
    if (profile?.company_id) {
      loadData();
    }
  }, [profile?.company_id]);

  useEffect(() => {
    if (selectedCropId !== "all" && selectedCropId) {
      loadVarietiesByCrop(selectedCropId);
    } else {
      loadAllVarieties();
    }
  }, [selectedCropId]);

  const loadData = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      const settled = await Promise.allSettled([
        getCrops(profile.company_id),
        getVarieties(profile.company_id),
        getSeedReproductions(profile.company_id),
        getMachineReferences(profile.company_id),
        getEquipmentReferences(profile.company_id),
        getSpecialistReferences(profile.company_id),
      ]);
      const getData = <T,>(idx: number, fallback: T): T => {
        const result = settled[idx];
        return result.status === "fulfilled" ? (result.value as T) : fallback;
      };
      setCrops(getData(0, [] as Crop[]));
      setVarieties(getData(1, [] as VarietyWithCrop[]));
      setSeedReproductions(getData(2, [] as SeedReproduction[]));
      setMachines(getData(3, [] as MachineReference[]));
      setEquipment(getData(4, [] as EquipmentReference[]));
      setSpecialists(getData(5, [] as SpecialistReference[]));
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load reference data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAllVarieties = async () => {
    if (!profile?.company_id) return;

    try {
      const varietiesData = await getVarieties(profile.company_id);
      setVarieties(varietiesData);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load varieties",
        variant: "destructive",
      });
    }
  };

  const loadVarietiesByCrop = async (cropId: string) => {
    if (!profile?.company_id) return;

    try {
      const varietiesData = await getVarietiesByCrop(profile.company_id, cropId);
      setVarieties(varietiesData as VarietyWithCrop[]);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load varieties",
        variant: "destructive",
      });
    }
  };

  const handleCreateCrop = async (data: CropFormData) => {
    if (!profile?.company_id) return;

    try {
      await createCrop(profile.company_id, data);
      setCropDialogOpen(false);
      cropForm.reset();
      const cropsData = await getCrops(profile.company_id);
      setCrops(cropsData);
      toast({
        title: "Success",
        description: "Crop created successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create crop",
        variant: "destructive",
      });
    }
  };

  const handleUpdateCrop = async (data: CropFormData) => {
    if (!editingCrop || !profile?.company_id) return;
    try {
      await updateCrop(editingCrop.id, data);
      setCropDialogOpen(false);
      setEditingCrop(null);
      cropForm.reset();
      const cropsData = await getCrops(profile.company_id);
      setCrops(cropsData);
      toast({
        title: "Success",
        description: "Crop updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update crop",
        variant: "destructive",
      });
    }
  };

  const handleCreateVariety = async (data: VarietyFormData) => {
    if (!profile?.company_id) return;

    try {
      await createVariety(profile.company_id, data);
      setVarietyDialogOpen(false);
      varietyForm.reset();
      if (selectedCropId !== "all") {
        await loadVarietiesByCrop(selectedCropId);
      } else {
        await loadAllVarieties();
      }
      toast({
        title: "Success",
        description: "Variety created successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create variety",
        variant: "destructive",
      });
    }
  };

  const handleUpdateVariety = async (data: VarietyFormData) => {
    if (!editingVariety) return;
    try {
      await updateVariety(editingVariety.id, data);
      setVarietyDialogOpen(false);
      setEditingVariety(null);
      varietyForm.reset();
      if (selectedCropId !== "all") {
        await loadVarietiesByCrop(selectedCropId);
      } else {
        await loadAllVarieties();
      }
      toast({
        title: "Success",
        description: "Variety updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update variety",
        variant: "destructive",
      });
    }
  };

  const handleCreateReproduction = async (data: SeedReproductionFormData) => {
    if (!profile?.company_id) return;

    try {
      await createSeedReproduction(profile.company_id, data);
      setReproductionDialogOpen(false);
      reproductionForm.reset();
      const reproductionsData = await getSeedReproductions(profile.company_id);
      setSeedReproductions(reproductionsData);
      toast({
        title: "Success",
        description: "Seed reproduction created successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create seed reproduction",
        variant: "destructive",
      });
    }
  };

  const handleUpdateReproduction = async (data: SeedReproductionFormData) => {
    if (!editingReproduction || !profile?.company_id) return;
    try {
      await updateSeedReproduction(editingReproduction.id, data);
      setReproductionDialogOpen(false);
      setEditingReproduction(null);
      reproductionForm.reset();
      const reproductionsData = await getSeedReproductions(profile.company_id);
      setSeedReproductions(reproductionsData);
      toast({
        title: "Success",
        description: "Seed reproduction updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update seed reproduction",
        variant: "destructive",
      });
    }
  };

  const handleCreateMachine = async (data: MachineFormData) => {
    if (!profile?.company_id || !profile?.id) return;
    try {
      await createMachineReference(profile.company_id, profile.id, data);
      setMachineDialogOpen(false);
      machineForm.reset({ name: "", type: "machine" });
      setMachines(await getMachineReferences(profile.company_id));
      toast({ title: "Success", description: "Machine created successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create machine", variant: "destructive" });
    }
  };

  const handleUpdateMachine = async (data: MachineFormData) => {
    if (!editingMachine || !profile?.company_id) return;
    try {
      await updateMachineReference(editingMachine.id, data);
      setMachineDialogOpen(false);
      setEditingMachine(null);
      machineForm.reset({ name: "", type: "machine" });
      setMachines(await getMachineReferences(profile.company_id));
      toast({ title: "Success", description: "Machine updated successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update machine", variant: "destructive" });
    }
  };

  const handleCreateEquipment = async (data: EquipmentFormData) => {
    if (!profile?.company_id || !profile?.id) return;
    try {
      await createEquipmentReference(profile.company_id, profile.id, data);
      setEquipmentDialogOpen(false);
      equipmentForm.reset({ name: "", category: "" });
      setEquipment(await getEquipmentReferences(profile.company_id));
      toast({ title: "Success", description: "Equipment created successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create equipment", variant: "destructive" });
    }
  };

  const handleUpdateEquipment = async (data: EquipmentFormData) => {
    if (!editingEquipment || !profile?.company_id) return;
    try {
      await updateEquipmentReference(editingEquipment.id, data);
      setEquipmentDialogOpen(false);
      setEditingEquipment(null);
      equipmentForm.reset({ name: "", category: "" });
      setEquipment(await getEquipmentReferences(profile.company_id));
      toast({ title: "Success", description: "Equipment updated successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update equipment", variant: "destructive" });
    }
  };

  const handleCreateSpecialist = async (data: SpecialistReferenceFormData) => {
    if (!profile?.company_id || !profile?.id) return;
    try {
      await createSpecialistReference(profile.company_id, profile.id, data);
      setSpecialistDialogOpen(false);
      specialistForm.reset({ full_name: "", role: "" });
      setSpecialists(await getSpecialistReferences(profile.company_id));
      toast({ title: "Success", description: "Specialist created successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create specialist", variant: "destructive" });
    }
  };

  const handleUpdateSpecialist = async (data: SpecialistReferenceFormData) => {
    if (!editingSpecialist || !profile?.company_id) return;
    try {
      await updateSpecialistReference(editingSpecialist.id, data);
      setSpecialistDialogOpen(false);
      setEditingSpecialist(null);
      specialistForm.reset({ full_name: "", role: "" });
      setSpecialists(await getSpecialistReferences(profile.company_id));
      toast({ title: "Success", description: "Specialist updated successfully" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update specialist", variant: "destructive" });
    }
  };

  const handleArchive = async () => {
    if (!itemToArchive || !profile?.company_id) return;
    try {
      if (archiveType === "crop") {
        await archiveCrop(itemToArchive.id);
        const cropsData = await getCrops(profile.company_id);
        setCrops(cropsData);
      } else if (archiveType === "variety") {
        await archiveVariety(itemToArchive.id);
        if (selectedCropId !== "all") {
          await loadVarietiesByCrop(selectedCropId);
        } else {
          await loadAllVarieties();
        }
      } else if (archiveType === "machine") {
        await archiveMachineReference(itemToArchive.id);
        setMachines(await getMachineReferences(profile.company_id));
      } else if (archiveType === "equipment") {
        await archiveEquipmentReference(itemToArchive.id);
        setEquipment(await getEquipmentReferences(profile.company_id));
      } else if (archiveType === "specialist") {
        await archiveSpecialistReference(itemToArchive.id);
        setSpecialists(await getSpecialistReferences(profile.company_id));
      } else {
        await archiveSeedReproduction(itemToArchive.id);
        const reproductionsData = await getSeedReproductions(profile.company_id);
        setSeedReproductions(reproductionsData);
      }
      setArchiveDialogOpen(false);
      setItemToArchive(null);
      toast({
        title: "Success",
        description: `${archiveType.charAt(0).toUpperCase() + archiveType.slice(1)} archived successfully`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to archive item",
        variant: "destructive",
      });
    }
  };

  const openCropDialog = (crop?: Crop) => {
    if (crop) {
      setEditingCrop(crop);
      cropForm.reset({ name: crop.name });
    } else {
      setEditingCrop(null);
      cropForm.reset({ name: "" });
    }
    setCropDialogOpen(true);
  };

  const openVarietyDialog = (variety?: Variety) => {
    if (variety) {
      setEditingVariety(variety);
      varietyForm.reset({ crop_id: variety.crop_id, name: variety.name });
    } else {
      setEditingVariety(null);
      varietyForm.reset({
        crop_id: selectedCropId !== "all" ? selectedCropId : "",
        name: ""
      });
    }
    setVarietyDialogOpen(true);
  };

  const openReproductionDialog = (reproduction?: SeedReproduction) => {
    if (reproduction) {
      setEditingReproduction(reproduction);
      reproductionForm.reset({ name: reproduction.name });
    } else {
      setEditingReproduction(null);
      reproductionForm.reset({ name: "" });
    }
    setReproductionDialogOpen(true);
  };

  const openMachineDialog = (machine?: MachineReference) => {
    if (machine) {
      setEditingMachine(machine);
      machineForm.reset({ name: machine.name, type: machine.type });
    } else {
      setEditingMachine(null);
      machineForm.reset({ name: "", type: "machine" });
    }
    setMachineDialogOpen(true);
  };

  const openEquipmentDialog = (item?: EquipmentReference) => {
    if (item) {
      setEditingEquipment(item);
      equipmentForm.reset({ name: item.name, category: item.category || "" });
    } else {
      setEditingEquipment(null);
      equipmentForm.reset({ name: "", category: "" });
    }
    setEquipmentDialogOpen(true);
  };

  const openSpecialistDialog = (item?: SpecialistReference) => {
    if (item) {
      setEditingSpecialist(item);
      specialistForm.reset({ full_name: item.full_name, role: item.role || "" });
    } else {
      setEditingSpecialist(null);
      specialistForm.reset({ full_name: "", role: "" });
    }
    setSpecialistDialogOpen(true);
  };

  const openArchiveDialog = (
    type: "crop" | "variety" | "reproduction" | "machine" | "equipment" | "specialist",
    item: any
  ) => {
    setArchiveType(type);
    setItemToArchive(item);
    setArchiveDialogOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="References"
        description="Manage admin dictionaries for crops, varieties, and seed reproductions"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="crops">Crops</TabsTrigger>
          <TabsTrigger value="varieties">Varieties</TabsTrigger>
          <TabsTrigger value="reproductions">Seed Reproductions</TabsTrigger>
          <TabsTrigger value="machines">Machines</TabsTrigger>
          <TabsTrigger value="equipment">Equipment / Aggregates</TabsTrigger>
          <TabsTrigger value="specialists">Specialists / Brigadiers</TabsTrigger>
        </TabsList>

        <TabsContent value="crops">
          <div className="mb-4 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Crops</h2>
            <Button onClick={() => openCropDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Crop
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[150px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-slate-500">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : crops.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-slate-500">
                        No crops added yet. Click "Add Crop" to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    crops.map((crop) => (
                      <TableRow key={crop.id}>
                        <TableCell className="font-medium">{crop.name}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openCropDialog(crop)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openArchiveDialog("crop", crop)}
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
        </TabsContent>

        <TabsContent value="varieties">
          <div className="mb-4 flex justify-between items-center gap-4">
            <div className="flex items-center gap-4 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">Varieties</h2>
              <Select value={selectedCropId} onValueChange={setSelectedCropId}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Filter by crop" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Crops</SelectItem>
                  {crops.map((crop) => (
                    <SelectItem key={crop.id} value={crop.id}>
                      {crop.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => openVarietyDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Variety
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Crop</TableHead>
                    <TableHead>Variety Name</TableHead>
                    <TableHead className="w-[150px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-500">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : varieties.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-500">
                        No varieties added yet. Click "Add Variety" to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    varieties.map((variety) => (
                      <TableRow key={variety.id}>
                        <TableCell className="font-medium">
                          {variety.crop_name || "-"}
                        </TableCell>
                        <TableCell>{variety.name}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openVarietyDialog(variety)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openArchiveDialog("variety", variety)}
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
        </TabsContent>

        <TabsContent value="reproductions">
          <div className="mb-4 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Seed Reproductions</h2>
            <Button onClick={() => openReproductionDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Reproduction
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[150px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-slate-500">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : seedReproductions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-slate-500">
                        No seed reproductions added yet. Click "Add Reproduction" to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    seedReproductions.map((reproduction) => (
                      <TableRow key={reproduction.id}>
                        <TableCell className="font-medium">{reproduction.name}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openReproductionDialog(reproduction)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openArchiveDialog("reproduction", reproduction)}
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
        </TabsContent>

        <TabsContent value="machines">
          <div className="mb-4 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Machines</h2>
            <Button onClick={() => openMachineDialog()}><Plus className="mr-2 h-4 w-4" />Add Machine</Button>
          </div>
          <Card><CardContent className="p-0">
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead className="w-[150px]">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {machines.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-slate-500">No machines yet.</TableCell></TableRow> : machines.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.type}</TableCell>
                    <TableCell><div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openMachineDialog(item)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => openArchiveDialog("machine", item)}><Archive className="h-4 w-4 text-red-600" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="equipment">
          <div className="mb-4 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Equipment / Aggregates</h2>
            <Button onClick={() => openEquipmentDialog()}><Plus className="mr-2 h-4 w-4" />Add Equipment</Button>
          </div>
          <Card><CardContent className="p-0">
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead className="w-[150px]">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {equipment.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-slate-500">No equipment yet.</TableCell></TableRow> : equipment.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.category || "-"}</TableCell>
                    <TableCell><div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEquipmentDialog(item)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => openArchiveDialog("equipment", item)}><Archive className="h-4 w-4 text-red-600" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="specialists">
          <div className="mb-4 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Specialists / Brigadiers</h2>
            <Button onClick={() => openSpecialistDialog()}><Plus className="mr-2 h-4 w-4" />Add Specialist</Button>
          </div>
          <Card><CardContent className="p-0">
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead className="w-[150px]">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {specialists.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-slate-500">No specialists yet.</TableCell></TableRow> : specialists.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.full_name}</TableCell>
                    <TableCell>{item.role || "-"}</TableCell>
                    <TableCell><div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openSpecialistDialog(item)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => openArchiveDialog("specialist", item)}><Archive className="h-4 w-4 text-red-600" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={cropDialogOpen} onOpenChange={setCropDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCrop ? "Edit Crop" : "Add Crop"}</DialogTitle>
            <DialogDescription>
              {editingCrop ? "Update the crop name." : "Enter a new crop name."}
            </DialogDescription>
          </DialogHeader>
          <Form {...cropForm}>
            <form onSubmit={cropForm.handleSubmit(editingCrop ? handleUpdateCrop : handleCreateCrop)}>
              <FormField
                control={cropForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Crop Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Wheat" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setCropDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingCrop ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={varietyDialogOpen} onOpenChange={setVarietyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingVariety ? "Edit Variety" : "Add Variety"}</DialogTitle>
            <DialogDescription>
              {editingVariety ? "Update the variety details." : "Enter variety details."}
            </DialogDescription>
          </DialogHeader>
          <Form {...varietyForm}>
            <form onSubmit={varietyForm.handleSubmit(editingVariety ? handleUpdateVariety : handleCreateVariety)} className="space-y-4">
              <FormField
                control={varietyForm.control}
                name="crop_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Crop *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a crop" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {crops.map((crop) => (
                          <SelectItem key={crop.id} value={crop.id}>
                            {crop.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={varietyForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Variety Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Winter Wheat" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setVarietyDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingVariety ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={reproductionDialogOpen} onOpenChange={setReproductionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingReproduction ? "Edit Seed Reproduction" : "Add Seed Reproduction"}
            </DialogTitle>
            <DialogDescription>
              {editingReproduction ? "Update the reproduction name." : "Enter a new reproduction name."}
            </DialogDescription>
          </DialogHeader>
          <Form {...reproductionForm}>
            <form onSubmit={reproductionForm.handleSubmit(editingReproduction ? handleUpdateReproduction : handleCreateReproduction)}>
              <FormField
                control={reproductionForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reproduction Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Elite" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setReproductionDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingReproduction ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={machineDialogOpen} onOpenChange={setMachineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMachine ? "Edit Machine" : "Add Machine"}</DialogTitle>
          </DialogHeader>
          <Form {...machineForm}>
            <form onSubmit={machineForm.handleSubmit(editingMachine ? handleUpdateMachine : handleCreateMachine)} className="space-y-4">
              <FormField control={machineForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={machineForm.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="machine">Machine</SelectItem>
                      <SelectItem value="tractor">Tractor</SelectItem>
                      <SelectItem value="drone">Drone</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setMachineDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingMachine ? "Update" : "Create"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={equipmentDialogOpen} onOpenChange={setEquipmentDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingEquipment ? "Edit Equipment" : "Add Equipment"}</DialogTitle></DialogHeader>
          <Form {...equipmentForm}>
            <form onSubmit={equipmentForm.handleSubmit(editingEquipment ? handleUpdateEquipment : handleCreateEquipment)} className="space-y-4">
              <FormField control={equipmentForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={equipmentForm.control} name="category" render={({ field }) => (
                <FormItem><FormLabel>Category</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEquipmentDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingEquipment ? "Update" : "Create"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={specialistDialogOpen} onOpenChange={setSpecialistDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingSpecialist ? "Edit Specialist" : "Add Specialist"}</DialogTitle></DialogHeader>
          <Form {...specialistForm}>
            <form onSubmit={specialistForm.handleSubmit(editingSpecialist ? handleUpdateSpecialist : handleCreateSpecialist)} className="space-y-4">
              <FormField control={specialistForm.control} name="full_name" render={({ field }) => (
                <FormItem><FormLabel>Full name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={specialistForm.control} name="role" render={({ field }) => (
                <FormItem><FormLabel>Role</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSpecialistDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingSpecialist ? "Update" : "Create"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveType.charAt(0).toUpperCase() + archiveType.slice(1)}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive {itemToArchive?.name}? It will be hidden from the main view but can be restored later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
