"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { localizedName } from "@/lib/i18n/helpers";
import {
  addTreatmentProgramStep,
  createOperationFromTreatmentStep,
  createTreatmentProgram,
  getProgramFields,
  getStepExecutions,
  loadCareSystemsContext,
  ProgramField,
  StepExecution,
  syncTreatmentProgramLinks,
  TreatmentProgram,
  updateTreatmentExecutionStatus,
} from "@/lib/services/care-systems";

const STATUS_LABEL: Record<StepExecution["status"], string> = {
  waiting: "Ожидание",
  ready: "Готово к запуску",
  done: "Выполнено",
  skipped: "Пропущено",
  overdue: "Просрочено",
};

function canUseCareSystems(role?: string | null) {
  return role === "global_admin" || role === "company_admin" || role === "agronomist";
}

export default function CareSystemsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [seasonId, setSeasonId] = useState("all");
  const [cropId, setCropId] = useState("all");
  const [varietyId, setVarietyId] = useState("all");
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadCareSystemsContext>> | null>(null);

  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [programFields, setProgramFields] = useState<ProgramField[]>([]);
  const [selectedFieldLinkId, setSelectedFieldLinkId] = useState("");
  const [executions, setExecutions] = useState<StepExecution[]>([]);

  const [newProgramName, setNewProgramName] = useState("");
  const [newProgramDescription, setNewProgramDescription] = useState("");
  const [createSeasonId, setCreateSeasonId] = useState("none");
  const [createCropId, setCreateCropId] = useState("");
  const [createVarietyId, setCreateVarietyId] = useState("");

  const [newStepName, setNewStepName] = useState("");
  const [newStepPurpose, setNewStepPurpose] = useState("");

  const reload = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    try {
      const data = await loadCareSystemsContext(profile.company_id, {
        seasonId: seasonId === "all" ? undefined : seasonId,
        cropId: cropId === "all" ? undefined : cropId,
        varietyId: varietyId === "all" ? undefined : varietyId,
      });
      setCtx(data);
      if (data.seasons.length > 0 && seasonId === "all") {
        setCreateSeasonId(data.seasons[0].id);
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось загрузить модуль", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.company_id, seasonId, cropId, varietyId]);

  const varietiesForCreate = useMemo(
    () => (ctx?.varieties || []).filter((v) => !createCropId || v.crop_id === createCropId),
    [ctx?.varieties, createCropId]
  );

  const filteredPrograms = useMemo(() => {
    const source = ctx?.programs || [];
    return source.filter((p) => {
      if (seasonId !== "all") {
        if (p.season_id && p.season_id !== seasonId) return false;
      }
      if (cropId !== "all" && p.crop_id !== cropId) return false;
      if (varietyId !== "all" && p.variety_id !== varietyId) return false;
      return true;
    });
  }, [ctx?.programs, seasonId, cropId, varietyId]);

  const selectedProgram: TreatmentProgram | null =
    filteredPrograms.find((p) => p.id === selectedProgramId) || filteredPrograms[0] || null;

  useEffect(() => {
    if (!selectedProgram) {
      setSelectedProgramId("");
      setProgramFields([]);
      setSelectedFieldLinkId("");
      setExecutions([]);
      setSelectedStepId("");
      return;
    }
    setSelectedProgramId(selectedProgram.id);
    void (async () => {
      if (!profile?.company_id) return;
      try {
        const fields = await getProgramFields(profile.company_id, selectedProgram.id, seasonId === "all" ? undefined : seasonId);
        setProgramFields(fields);
        setSelectedFieldLinkId(fields[0]?.link_id || "");
      } catch (e: any) {
        toast({ title: "Ошибка", description: e?.message || "Не удалось загрузить поля программы", variant: "destructive" });
      }
    })();
  }, [selectedProgram?.id, profile?.company_id, seasonId]);

  useEffect(() => {
    if (!profile?.company_id || !selectedFieldLinkId) {
      setExecutions([]);
      return;
    }
    void getStepExecutions(profile.company_id, selectedFieldLinkId)
      .then(setExecutions)
      .catch(() => setExecutions([]));
  }, [profile?.company_id, selectedFieldLinkId]);

  const roadmap = useMemo(() => {
    if (!selectedProgram) return [];
    const byStep = new Map(executions.map((x) => [x.treatment_program_step_id, x]));
    return selectedProgram.steps.map((step) => ({
      step,
      execution: byStep.get(step.id) || null,
      status: byStep.get(step.id)?.status || ("waiting" as StepExecution["status"]),
    }));
  }, [selectedProgram, executions]);

  useEffect(() => {
    if (!roadmap.length) {
      setSelectedStepId("");
      return;
    }
    if (!selectedStepId || !roadmap.some((x) => x.step.id === selectedStepId)) {
      setSelectedStepId(roadmap[0].step.id);
    }
  }, [roadmap, selectedStepId]);

  const selectedRoadmapItem = roadmap.find((x) => x.step.id === selectedStepId) || null;
  const totalProgramArea = useMemo(
    () => programFields.reduce((sum, row) => sum + Number(row.planned_area || 0), 0),
    [programFields]
  );

  const onCreateProgram = async () => {
    if (!profile?.company_id || !profile.id || !createCropId || !createVarietyId || !newProgramName.trim()) return;
    try {
      setSaving(true);
      const programId = await createTreatmentProgram({
        companyId: profile.company_id,
        seasonId: createSeasonId === "none" ? null : createSeasonId,
        cropId: createCropId,
        varietyId: createVarietyId,
        nameRu: newProgramName.trim(),
        description: newProgramDescription.trim() || null,
        userId: profile.id,
      });
      if (createSeasonId !== "none") {
        await syncTreatmentProgramLinks(profile.company_id, createSeasonId);
      }
      setNewProgramName("");
      setNewProgramDescription("");
      setSelectedProgramId(programId);
      toast({ title: "Готово", description: "Программа создана и будет автоматически применяться по crop+variety." });
      await reload();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось создать программу", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onAddStep = async () => {
    if (!selectedProgram || !newStepName.trim()) return;
    try {
      setSaving(true);
      const stepNo = (selectedProgram.steps.at(-1)?.step_no || 0) + 1;
      await addTreatmentProgramStep({
        programId: selectedProgram.id,
        stepNo,
        stepName: newStepName.trim(),
        agronomicPurpose: newStepPurpose.trim() || null,
      });
      if (profile?.company_id && (seasonId !== "all" || selectedProgram.season_id)) {
        await syncTreatmentProgramLinks(profile.company_id, selectedProgram.season_id || seasonId);
      }
      setNewStepName("");
      setNewStepPurpose("");
      await reload();
      toast({ title: "Готово", description: "Шаг добавлен." });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось добавить шаг", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onCreateOperation = async () => {
    if (!profile?.company_id || !selectedRoadmapItem || !selectedFieldLinkId) return;
    try {
      setSaving(true);
      await createOperationFromTreatmentStep({
        companyId: profile.company_id,
        linkId: selectedFieldLinkId,
        stepId: selectedRoadmapItem.step.id,
      });
      const refreshed = await getStepExecutions(profile.company_id, selectedFieldLinkId);
      setExecutions(refreshed);
      toast({ title: "Операция создана", description: "Факт операции создан из шага программы." });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось создать операцию", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onSetStepStatus = async (status: StepExecution["status"]) => {
    if (!profile?.company_id || !selectedRoadmapItem?.execution) return;
    try {
      setSaving(true);
      await updateTreatmentExecutionStatus({
        companyId: profile.company_id,
        executionId: selectedRoadmapItem.execution.id,
        status,
      });
      const refreshed = await getStepExecutions(profile.company_id, selectedFieldLinkId);
      setExecutions(refreshed);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось обновить статус", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!canUseCareSystems(profile?.role)) {
    return <PageHeader title="Системы защиты и ухода" description="Нет доступа для текущей роли" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Системы защиты и ухода"
        description="Программа создается по культуре и сорту, а поля подтягиваются автоматически из структуры посевов."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Фильтры и создание программы</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Сезон (просмотр)</Label>
              <Select value={seasonId} onValueChange={setSeasonId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все сезоны</SelectItem>
                  {(ctx?.seasons || []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Культура</Label>
              <Select value={cropId} onValueChange={setCropId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все культуры</SelectItem>
                  {(ctx?.crops || []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{localizedName(c as any, "ru") || "-"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Сорт</Label>
              <Select value={varietyId} onValueChange={setVarietyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все сорта</SelectItem>
                  {(ctx?.varieties || []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border-t pt-3">
              <div className="mb-2 text-sm font-medium">Новая программа (crop + variety)</div>
              <div className="space-y-2">
                <div>
                  <Label>Сезон программы</Label>
                  <Select value={createSeasonId} onValueChange={setCreateSeasonId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Для всех сезонов</SelectItem>
                      {(ctx?.seasons || []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.year}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Культура *</Label>
                  <Select value={createCropId} onValueChange={(v) => { setCreateCropId(v); setCreateVarietyId(""); }}>
                    <SelectTrigger><SelectValue placeholder="Выберите культуру" /></SelectTrigger>
                    <SelectContent>
                      {(ctx?.crops || []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{localizedName(c as any, "ru") || "-"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Сорт *</Label>
                  <Select value={createVarietyId} onValueChange={setCreateVarietyId}>
                    <SelectTrigger><SelectValue placeholder="Выберите сорт" /></SelectTrigger>
                    <SelectContent>
                      {varietiesForCreate.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Название программы *</Label>
                  <Input value={newProgramName} onChange={(e) => setNewProgramName(e.target.value)} placeholder="Например: Картофель Гала — базовая защита" />
                </div>
                <div>
                  <Label>Описание</Label>
                  <Input value={newProgramDescription} onChange={(e) => setNewProgramDescription(e.target.value)} placeholder="Опционально" />
                </div>
                <Button onClick={onCreateProgram} disabled={saving || !createCropId || !createVarietyId || !newProgramName.trim()} className="w-full">
                  Создать программу
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Программы по выбранным фильтрам</CardTitle>
              <CardDescription>Создание на поле вручную отключено: поля привязываются автоматически через структуру посевов.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-slate-500">Загрузка...</div>
              ) : filteredPrograms.length === 0 ? (
                <div className="text-sm text-slate-500">Программы не найдены.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {filteredPrograms.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProgramId(p.id)}
                      className={`rounded-md border px-3 py-2 text-left text-sm ${selectedProgram?.id === p.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}
                    >
                      <div className="font-medium">{p.name_ru}</div>
                      <div className="text-xs text-slate-600">{p.crop_name} · {p.variety_name}</div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Поля с этой программой</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedProgram ? (
                <div className="text-sm text-slate-500">Выберите программу.</div>
              ) : (
                <>
                  <div className="rounded-md border p-3 text-sm text-slate-700">
                    Полей: <b>{programFields.length}</b> · Общая площадь под программой: <b>{totalProgramArea.toFixed(2)} га</b>
                  </div>
                  {programFields.length === 0 ? (
                    <div className="text-sm text-slate-500">
                      Пока нет автопривязанных полей. Проверьте структуру посевов для выбранного сезона/культуры/сорта.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {programFields.map((f) => (
                        <div key={f.link_id} className="rounded-md border p-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{f.field_name}</div>
                            <Badge variant="outline">{f.link_status}</Badge>
                          </div>
                          <div className="text-xs text-slate-600">
                            Площадь поля: {f.field_area.toFixed(2)} га · Под культурой/сортом: {f.planned_area.toFixed(2)} га
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Шаги программы (горизонтальный roadmap)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedProgram ? (
                <div className="text-sm text-slate-500">Выберите программу.</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <div className="flex min-w-max gap-3">
                      {roadmap.map((item) => (
                        <button
                          key={item.step.id}
                          type="button"
                          onClick={() => setSelectedStepId(item.step.id)}
                          className={`w-[220px] rounded-md border p-3 text-left ${selectedStepId === item.step.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white"}`}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <Badge variant="outline">Шаг {item.step.step_no}</Badge>
                            <Badge>{STATUS_LABEL[item.status]}</Badge>
                          </div>
                          <div className="text-sm font-medium">{item.step.step_name}</div>
                          <div className="mt-1 text-xs text-slate-600">{item.step.timing_note || "-"}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-dashed p-3">
                    <div className="mb-2 text-sm font-medium">Добавить шаг</div>
                    <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <Input placeholder="Название шага" value={newStepName} onChange={(e) => setNewStepName(e.target.value)} />
                      <Input placeholder="Агрономическая цель (опционально)" value={newStepPurpose} onChange={(e) => setNewStepPurpose(e.target.value)} />
                      <Button onClick={onAddStep} disabled={saving || !newStepName.trim()}>
                        <Plus className="mr-2 h-4 w-4" />
                        Добавить
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Детали шага</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedRoadmapItem ? (
                <div className="text-sm text-slate-500">Выберите шаг в roadmap.</div>
              ) : (
                <>
                  <div className="rounded-md border p-3">
                    <div className="text-base font-semibold">{selectedRoadmapItem.step.step_name}</div>
                    <div className="text-sm text-slate-600">{selectedRoadmapItem.step.agronomic_purpose || "Без описания цели"}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      Тайминг: {selectedRoadmapItem.step.timing_note || "-"} · Условие: {selectedRoadmapItem.step.condition_note || "-"}
                    </div>
                  </div>

                  <div>
                    <Label>Поле для создания операции</Label>
                    <Select value={selectedFieldLinkId || "none"} onValueChange={(v) => setSelectedFieldLinkId(v === "none" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Выберите поле" /></SelectTrigger>
                      <SelectContent>
                        {programFields.length === 0 ? (
                          <SelectItem value="none">Нет полей</SelectItem>
                        ) : (
                          programFields.map((f) => (
                            <SelectItem key={f.link_id} value={f.link_id}>
                              {f.field_name} · {f.planned_area.toFixed(2)} га
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={onCreateOperation} disabled={saving || !selectedFieldLinkId}>
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Создать операцию
                    </Button>
                    <Button variant="outline" onClick={() => onSetStepStatus("ready")} disabled={saving || !selectedRoadmapItem.execution}>
                      Статус: ready
                    </Button>
                    <Button variant="outline" onClick={() => onSetStepStatus("skipped")} disabled={saving || !selectedRoadmapItem.execution}>
                      Статус: skipped
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
