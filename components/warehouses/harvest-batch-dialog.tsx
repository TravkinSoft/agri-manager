"use client";

import { useRef, useState } from "react";
import { CalendarDays, ExternalLink, Factory, FileText, Loader2, PackageOpen, Scale, Truck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HarvestBatchSummary } from "@/lib/types/weighbridge";
import { TicketPreviewDialog } from "@/components/weighbridge/ticket-preview-dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: HarvestBatchSummary | null;
  loading?: boolean;
};

type OutgoingDocument = NonNullable<HarvestBatchSummary["outgoingDocuments"]>[number];

const kg = (value: number) =>
  `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг`;

function formatDate(value?: string | null): string {
  if (!value) return "Дата не указана";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Дата не указана" : date.toLocaleString("ru-RU");
}

function reviewReason(reason: string): string {
  return ({
    missing_variety: "сорт",
    missing_reproduction: "репродукция",
    missing_crop: "культура",
    missing_field: "поле",
    missing_season: "сезон",
    missing_composition: "состав зерносмеси",
  } as Record<string, string>)[reason] || reason;
}

const transformationLabel = (value: string) => ({
  drying: "Сушка",
  cleaning: "Очистка",
  sorting: "Сортировка",
  calibration: "Калибровка",
  conditioning: "Доработка",
  potato_sorting: "Сортировка клубней",
} as Record<string, string>)[value] || "Переработка";

const outputLabel = (value: string) => ({
  commodity: "Готовый продукт",
  process_loss: "Отходы / потери",
} as Record<string, string>)[value] || "Результат";

function stockComponentLabel(batchClass: string, physicalState: string, processingEligible: boolean): string {
  const batch = String(batchClass || "commodity").toLowerCase();
  const state = String(physicalState || "SOURCE").toUpperCase();
  if (!processingEligible) return batch === "waste" ? "Примеси / мусор" : "Продукция";
  if (batch === "waste" && state === "SCREENINGS") return "Отсев";
  if (batch === "waste" && state === "AFTER_CLEANING") return "Отходы после очистки";
  if (batch === "waste") return "Прочие отходы";
  if (state === "AFTER_CLEANING") return "Очищенная продукция";
  if (state === "AFTER_DRYING") return "Продукция после сушки";
  return "Исходная продукция";
}

function ProcessingDocumentDialog({ document, onOpenChange, onOpenTicket }: {
  document: OutgoingDocument | null;
  onOpenChange: (open: boolean) => void;
  onOpenTicket: (ticketId: string) => void;
}) {
  const processing = document?.processingDocument || null;
  return (
    <Dialog open={Boolean(document && processing)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {document && processing ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Factory className="h-5 w-5 text-amber-400" />
                Документ переработки
              </DialogTitle>
              <DialogDescription>
                {transformationLabel(processing.transformationType)} · {formatDate(processing.completedAt || processing.startedAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/45 p-4 sm:grid-cols-2">
                <div><span className="text-slate-500">Операция</span><div className="font-semibold text-slate-100">{transformationLabel(processing.transformationType)}</div></div>
                <div><span className="text-slate-500">Статус</span><div className="font-semibold text-slate-100">{processing.status === "completed" ? "Завершена" : processing.status}</div></div>
                {processing.processingNodeName ? <div><span className="text-slate-500">Линия</span><div className="font-semibold text-slate-100">{processing.processingNodeName}</div></div> : null}
                {processing.sourceWarehouseName ? <div><span className="text-slate-500">Склад сырья</span><div className="font-semibold text-slate-100">{processing.sourceWarehouseName}</div></div> : null}
                <div><span className="text-slate-500">Начато</span><div className="font-semibold text-slate-100">{formatDate(processing.startedAt)}</div></div>
                <div><span className="text-slate-500">Завершено</span><div className="font-semibold text-slate-100">{formatDate(processing.completedAt)}</div></div>
                {processing.completedByName || processing.createdByName ? <div><span className="text-slate-500">Ответственный</span><div className="font-semibold text-slate-100">{processing.completedByName || processing.createdByName}</div></div> : null}
                {processing.inputBatchCode ? <div><span className="text-slate-500">Исходная партия</span><div className="font-semibold text-slate-100">{processing.inputBatchCode}</div></div> : null}
              </div>

              <div className="rounded-md border border-slate-800">
                <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3">
                  <span className="text-slate-400">Вход сырья</span>
                  <strong className="text-rose-300">{kg(processing.inputWeightKg)}</strong>
                </div>
                {processing.outputs.map((output, index) => (
                  <div key={`${output.lineType}-${index}`} className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3 last:border-0">
                    <span>
                      <span className="text-slate-200">{outputLabel(output.lineType)}</span>
                      {output.warehouseName ? <span className="ml-2 text-slate-500">· {output.warehouseName}</span> : null}
                    </span>
                    <strong className="text-emerald-300">{kg(output.weightKg)}</strong>
                  </div>
                ))}
              </div>

              {processing.note ? <div className="rounded-md border border-slate-800 px-4 py-3"><span className="text-slate-500">Примечание:</span> <span className="text-slate-200">{processing.note}</span></div> : null}
              {processing.sourceTicketId ? (
                <button
                  type="button"
                  onClick={() => onOpenTicket(processing.sourceTicketId as string)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800"
                >
                  <FileText className="h-4 w-4" />
                  Исходный приходной талон {processing.sourceTicketNo || ""}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function HarvestBatchDialog({ open, onOpenChange, batch, loading = false }: Props) {
  const [processingDocument, setProcessingDocument] = useState<OutgoingDocument | null>(null);
  const [ticketPreviewId, setTicketPreviewId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTopRef = useRef(0);
  const openTicketPreview = (ticketId: string) => {
    savedScrollTopRef.current = scrollRef.current?.scrollTop || 0;
    setTicketPreviewId(ticketId);
  };
  const closeTicketPreview = () => {
    setTicketPreviewId(null);
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTopRef.current;
    });
  };
  const trips = batch?.tripBatches || [];
  const stockComponents = batch?.stockComponents || [];
  const processingEligible = batch?.processingEligible !== false;
  const outgoingDocuments = (batch?.outgoingDocuments || []).filter(
    (document) => processingEligible || document.sourceType !== "processing_document"
  );
  const activeTrips = trips.filter((trip) => trip.status !== "voided");
  const moistureRelevant = Boolean(
    batch &&
    !/картоф/i.test(batch.cropName) &&
    activeTrips.some((trip) => trip.moisturePercent != null)
  );
  const moistureWeight = activeTrips.reduce(
    (sum, trip) => sum + (trip.moisturePercent == null ? 0 : trip.netWeightKg),
    0
  );
  const weightedMoisture = moistureWeight > 0
    ? activeTrips.reduce(
        (sum, trip) => sum + (trip.moisturePercent == null ? 0 : trip.moisturePercent * trip.netWeightKg),
        0
      ) / moistureWeight
    : null;
  const fieldSummaries = batch?.fieldSummaries?.length
    ? batch.fieldSummaries
    : [{
        fieldId: batch?.fieldId || null,
        fieldName: batch?.fieldName || "Поле не уточнено",
        netWeightKg: batch?.companyReceivedKg ?? batch?.receivedKg ?? 0,
        tripCount: activeTrips.length,
      }];
  const accountingRows = batch ? [
    {
      label: "Принято на этот склад",
      value: batch.receivedKg,
      tone: "text-emerald-300",
      visible: true,
    },
    {
      label: "Принято по всей партии",
      value: batch.companyReceivedKg || 0,
      tone: "text-slate-100",
      visible: batch.companyReceivedKg != null && Math.abs(batch.companyReceivedKg - batch.receivedKg) > 0.001,
    },
    {
      label: "Аннулировано (только история)",
      value: batch.voidedKg || 0,
      tone: "text-slate-300",
      visible: (batch.voidedKg || 0) > 0,
    },
    {
      label: "Примеси",
      value: -(batch.removedKg || 0),
      tone: "text-rose-300",
      visible: (batch.removedKg || 0) > 0,
    },
    {
      label: processingEligible ? "Передано в переработку" : "Историческое выбытие партии",
      value: -(batch.processingInputKg || 0),
      tone: "text-rose-300",
      visible: (batch.processingInputKg || 0) > 0,
    },
    {
      label: processingEligible ? "Возвращено из переработки" : "Историческое поступление партии",
      value: batch.processingOutputKg || 0,
      tone: "text-emerald-300",
      visible: (batch.processingOutputKg || 0) > 0,
    },
    {
      label: "Перемещено на склад",
      value: batch.transferInKg || 0,
      tone: "text-emerald-300",
      visible: (batch.transferInKg || 0) > 0,
    },
    {
      label: "Перемещено со склада",
      value: -(batch.transferOutKg || 0),
      tone: "text-rose-300",
      visible: (batch.transferOutKg || 0) > 0,
    },
    {
      label: "Списано",
      value: -(batch.writeoffKg || 0),
      tone: "text-rose-300",
      visible: (batch.writeoffKg || 0) > 0,
    },
    {
      label: "Выдано или отгружено",
      value: -(batch.issueKg || 0),
      tone: "text-rose-300",
      visible: (batch.issueKg || 0) > 0,
    },
    {
      label: "Прочая корректировка",
      value: batch.otherAdjustmentKg || 0,
      tone: (batch.otherAdjustmentKg || 0) < 0 ? "text-rose-300" : "text-emerald-300",
      visible: Math.abs(batch.otherAdjustmentKg || 0) > 0.001,
    },
  ].filter((row) => row.visible) : [];

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[min(900px,calc(100vw-32px))] sm:max-w-[900px] sm:rounded-lg">
        {batch ? (
          <>
            <DialogHeader className="shrink-0 border-b border-slate-800 px-5 py-4 text-left">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div className="min-w-0">
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <PackageOpen className="h-5 w-5 shrink-0 text-emerald-400" />
                    <span className="truncate">{batch.cropName}</span>
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {batch.reviewState === "requires_review"
                      ? "Требуется уточнение"
                      : [batch.varietyName, batch.reproductionName].filter(Boolean).join(" · ")}
                    {` · ${batch.warehouseName}`}
                  </DialogDescription>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-slate-500">Остаток на этом складе</div>
                  <div className="mt-1 text-lg font-semibold text-emerald-300">{kg(batch.cleanMassKg)}</div>
                </div>
              </div>
            </DialogHeader>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-slate-400" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загружаем историю партии...
                </div>
              ) : (
              <>
              {batch.reviewState === "requires_review" ? (
                <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <div className="font-semibold">Требуется уточнение</div>
                  <div className="mt-1 text-amber-200/80">
                    Не подтверждены: {(batch.reviewReasons || []).map(reviewReason).join(", ") || "данные партии"}.
                    Партия не объединяется с подтверждёнными партиями автоматически.
                  </div>
                </div>
              ) : null}

              {stockComponents.length > 1 ? (
                <section aria-label="Физический состав остатка">
                  <h3 className="mb-3 text-base font-semibold">Состав партии на этом складе</h3>
                  <div className="divide-y divide-slate-800 border-y border-slate-800">
                    {stockComponents.map((component, index) => (
                      <div key={`${component.batchClass}-${component.physicalState}-${index}`} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                        <span className="text-slate-400">{stockComponentLabel(component.batchClass, component.physicalState, processingEligible)}</span>
                        <span className="font-semibold tabular-nums text-slate-100">{kg(component.quantityKg)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {moistureRelevant && weightedMoisture != null ? (
                <div className="flex items-center justify-between gap-4 border-y border-slate-800 py-3 text-sm">
                  <span className="text-slate-400">Средневзвешенная влажность</span>
                  <span className="font-semibold text-slate-100">
                    {weightedMoisture.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}%
                  </span>
                </div>
              ) : null}

              <section aria-label="Движение массы">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold">Движение массы</h3>
                  {batch.companyCurrentKg != null && Math.abs(batch.companyCurrentKg - batch.cleanMassKg) > 0.001 ? (
                    <span className="text-sm text-slate-400">
                      По компании: <strong className="text-slate-100">{kg(batch.companyCurrentKg)}</strong>
                    </span>
                  ) : null}
                </div>
                <div className="divide-y divide-slate-800 border-y border-slate-800">
                  {accountingRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                      <span className="text-slate-400">{row.label}</span>
                      <span className={`font-semibold tabular-nums ${row.tone}`}>
                        {row.value > 0 && !row.label.startsWith("Принято") && !row.label.startsWith("Аннулировано") ? "+" : ""}{kg(row.value)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4 py-3 text-sm">
                    <span className="font-medium text-slate-200">Физический остаток</span>
                    <span className="font-semibold tabular-nums text-emerald-300">{kg(batch.cleanMassKg)}</span>
                  </div>
                  {(batch.reservedKg || 0) > 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
                        <span className="text-slate-400">В резерве</span>
                        <span className="font-semibold tabular-nums text-amber-300">{kg(batch.reservedKg || 0)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3 text-sm">
                        <span className="font-medium text-slate-200">Доступно</span>
                        <span className="font-semibold tabular-nums text-emerald-300">{kg(batch.availableKg ?? batch.cleanMassKg)}</span>
                      </div>
                    </>
                  ) : null}
                </div>
                {Math.abs(batch.reconciliationDeltaKg || 0) > 0.001 ? (
                  <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    Учёт не сходится на {kg(batch.reconciliationDeltaKg || 0)}. Требуется проверка проводок.
                  </div>
                ) : null}
              </section>

              <section>
                <h3 className="mb-3 text-base font-semibold">Происхождение и рейсы</h3>
                <p className="mb-3 text-sm text-slate-500">
                  По каждому полю показана фактически принятая масса действующих рейсов. Аннулированные рейсы остаются в истории и в сумму не входят.
                </p>
                <div className="space-y-3">
                  {fieldSummaries.map((field) => {
                    const fieldTrips = trips.filter((trip) => {
                      if (field.fieldId && trip.fieldId) return field.fieldId === trip.fieldId;
                      return field.fieldName === trip.fieldName;
                    });
                    return (
                      <div key={field.fieldId || field.fieldName} className="overflow-hidden rounded-md border border-slate-800 bg-slate-950/35">
                        <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-100">{field.fieldName}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{field.tripCount} рейс.</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-xs text-slate-500">Принято</div>
                            <div className="font-semibold text-emerald-300">{kg(field.netWeightKg)}</div>
                          </div>
                        </div>
                        <div className="divide-y divide-slate-800">
                          {fieldTrips.map((trip) => {
                            const className = `grid gap-2 px-4 py-3 text-sm transition-colors sm:grid-cols-[minmax(150px,1fr)_minmax(140px,1fr)_150px_120px] ${trip.status === "voided" ? "text-slate-500" : "text-slate-200"} ${trip.ticketId ? "cursor-pointer hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400" : ""}`;
                            const content = <>
                              <span className="flex min-w-0 items-center gap-2">
                                <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" />
                                <span className="truncate">{formatDate(trip.occurredAt)}</span>
                              </span>
                              <span className="flex min-w-0 items-center gap-2">
                                <Truck className="h-4 w-4 shrink-0 text-slate-500" />
                                <span className="truncate">{trip.vehicleName || "Транспорт не указан"}</span>
                              </span>
                              <span className="flex min-w-0 items-center gap-2">
                                <UserRound className="h-4 w-4 shrink-0 text-slate-500" />
                                <span className="truncate">{trip.driverName || "Водитель не указан"}</span>
                              </span>
                              <span className={`flex items-center justify-end gap-2 font-medium ${trip.status === "voided" ? "line-through" : "text-emerald-300"}`}>
                                <Scale className="h-4 w-4 shrink-0" />{kg(trip.netWeightKg)}
                              </span>
                              {trip.status === "voided" ? (
                                <Badge variant="outline" className="w-fit sm:col-span-4">Аннулирован</Badge>
                              ) : null}
                            </>;
                            return trip.ticketId ? (
                              <button key={trip.id} type="button" onClick={() => openTicketPreview(trip.ticketId as string)} className={`${className} w-full text-left`} aria-label={`Открыть талон ${trip.ticketNo}`}>
                                {content}
                              </button>
                            ) : (
                              <div key={trip.id} className={className}>{content}</div>
                            );
                          })}
                          {fieldTrips.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-500">Рейсы по этому полю не найдены</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {outgoingDocuments.length > 0 ? (
                <section aria-label="История партии">
                  <h3 className="mb-3 text-base font-semibold">История партии</h3>
                  <div className="divide-y divide-slate-800 overflow-hidden rounded-md border border-slate-800 bg-slate-950/35">
                    {outgoingDocuments.map((document) => {
                      const content = (
                        <>
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 font-medium text-slate-100">
                              <FileText className="h-4 w-4 shrink-0 text-amber-400" />
                              <span className="truncate">{document.label}</span>
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {formatDate(document.occurredAt)}
                              {document.documentNo ? ` · ${document.documentNo}` : ""}
                              {document.actorName ? ` · ${document.actorName}` : ""}
                            </span>
                            {document.vehicleName || document.driverName ? (
                              <span className="mt-1 block truncate text-xs text-slate-400">
                                {[document.vehicleName, document.driverName].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            <strong className={`tabular-nums ${document.direction === "processing" ? "text-emerald-300" : "text-rose-300"}`}>
                              {document.direction === "processing" ? "+" : "-"}{kg(document.quantityKg)}
                            </strong>
                            {document.sourceType !== "missing" ? <ExternalLink className="h-4 w-4 text-slate-500" /> : null}
                          </span>
                        </>
                      );
                      const className = "flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400";
                      if (document.sourceType === "weighbridge_ticket" && document.ticketId) {
                        return <button key={document.id} type="button" onClick={() => openTicketPreview(document.ticketId as string)} className={className}>{content}</button>;
                      }
                      if (document.sourceType === "processing_document" && document.processingDocument) {
                        return <button key={document.id} type="button" className={className} onClick={() => setProcessingDocument(document)}>{content}</button>;
                      }
                      return (
                        <div key={document.id} className="flex items-center justify-between gap-4 bg-rose-500/10 px-4 py-3 text-left">
                          {content}
                          <span className="text-xs font-medium text-rose-300">Документ-основание не найден</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              </>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
    <ProcessingDocumentDialog
      document={processingDocument}
      onOpenChange={(nextOpen) => !nextOpen && setProcessingDocument(null)}
      onOpenTicket={openTicketPreview}
    />
    <TicketPreviewDialog ticketId={ticketPreviewId} open={Boolean(ticketPreviewId)} onOpenChange={(nextOpen) => !nextOpen && closeTicketPreview()} />
    </>
  );
}
