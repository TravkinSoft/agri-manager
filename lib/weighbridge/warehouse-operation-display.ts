type WarehouseOperationLabelInput = {
  reasonType?: unknown;
  ticketType?: unknown;
  operationType?: unknown;
  transformationType?: unknown;
  destinationPlaceType?: unknown;
  isStorno?: unknown;
  ticketStatus?: unknown;
  correctionOfTicketId?: unknown;
  replacementTicketId?: unknown;
};

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();

const processingLabel = (value: unknown, destinationPlaceType?: unknown) => {
  const type = normalize(value);
  const destination = String(destinationPlaceType || "").trim().toUpperCase();
  if (type === "drying" || destination === "DRYER") return "Сушка";
  if (type === "cleaning" || destination === "CLEANER") return "Очистка";
  if (type === "sorting") return "Сортировка";
  if (type === "calibration") return "Калибровка";
  return "Обработка";
};

export function warehouseOperationLabel(input: WarehouseOperationLabelInput): string {
  const reason = normalize(input.reasonType);
  const ticketType = normalize(input.ticketType);
  const operationType = normalize(input.operationType);
  const ticketStatus = normalize(input.ticketStatus);

  if (input.isStorno === true || reason.startsWith("storno_") || ticketStatus === "voided") {
    return "Аннулирование";
  }
  if (
    input.correctionOfTicketId
    || input.replacementTicketId
    || reason.includes("correction")
    || reason.includes("adjustment")
  ) {
    return "Корректировка";
  }
  if (reason.includes("harvest_incoming") || ticketType === "harvest" || operationType === "harvest_incoming") {
    return "Приход урожая";
  }

  if (reason.includes("impurit") || ticketType === "impurity_removal" || operationType.includes("impurit")) {
    return "Вывоз примеси";
  }
  if (reason.includes("moisture_loss") || reason.includes("processing_loss")) {
    return "Производственная потеря";
  }
  if (
    reason.includes("processing_input")
    || reason.includes("processing_output_in")
    || reason.includes("processing_output_source_out")
  ) {
    return processingLabel(input.transformationType, input.destinationPlaceType);
  }
  if (reason.includes("shipment") || ticketType === "shipment" || operationType.includes("shipment")) {
    return "Отгрузка";
  }
  if (reason.includes("issue_to_field") || operationType === "issue_to_field") return "Выдача на поле";
  if (reason.includes("issue") || ticketType === "issue") return "Выдача";
  if (["writeoff", "disposal", "spoilage", "shortage", "waste", "utilization", "other_removal"]
    .some((token) => reason.includes(token) || ticketType.includes(token) || operationType.includes(token))) {
    return "Списание";
  }
  if (reason.includes("transfer") || ticketType === "transfer" || operationType.includes("transfer")) {
    const destination = String(input.destinationPlaceType || "").trim().toUpperCase();
    if (destination === "DRYER") return "Сушка";
    if (destination === "CLEANER") return "Очистка";
    return "Перемещение";
  }
  return "Выбытие";
}

type CollapsibleOperationDocument = {
  id: string;
  label: string;
  quantityKg: number;
  warehouseName: string;
  sourceType: "weighbridge_ticket" | "processing_document" | "missing";
  sourceId: string | null;
  ticketId: string | null;
  direction?: "out" | "processing";
};

export function collapseOperationDocuments<T extends CollapsibleOperationDocument>(documents: T[]): T[] {
  const grouped = new Map<string, T>();
  documents.forEach((document) => {
    const sourceKey = document.ticketId
      ? `ticket:${document.ticketId}`
      : document.sourceId
        ? `${document.sourceType}:${document.sourceId}`
        : `entry:${document.id}`;
    const key = [sourceKey, document.label, document.warehouseName, document.direction || "out"].join("|");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...document });
      return;
    }
    grouped.set(key, {
      ...existing,
      quantityKg: existing.quantityKg + document.quantityKg,
    });
  });
  return Array.from(grouped.values());
}
