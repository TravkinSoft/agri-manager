import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";

export interface VehicleDriverAssignmentResult {
  companyId: string;
  vehicle: {
    id: string;
    name: string;
    plate: string | null;
    assignmentId: string | null;
    driverPersonId: string | null;
    driverName: string | null;
  };
  canEdit: boolean;
  drivers?: Array<{ id: string; name: string }>;
}

export interface VehicleDriverAssignmentCommand {
  companyId?: string | null;
  vehicleId: string;
  driverPersonId: string | null;
  expectedAssignmentId: string | null;
}

export const VEHICLE_DRIVER_ASSIGNED_EVENT = "travkin:vehicle-driver-assigned";
const CHANNEL_NAME = "travkin.vehicle-driver-assigned.v1";
const listeners = new Set<(result: VehicleDriverAssignmentResult) => void>();
let stopListening: (() => void) | null = null;
let channel: BroadcastChannel | null = null;

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const nullableText = (value: unknown): value is string | null => value === null || text(value);

export function isVehicleDriverAssignmentResult(value: unknown): value is VehicleDriverAssignmentResult {
  if (!value || typeof value !== "object") return false;
  const result = value as VehicleDriverAssignmentResult;
  const vehicle = result.vehicle;
  return text(result.companyId) && typeof result.canEdit === "boolean" && !!vehicle &&
    text(vehicle.id) && typeof vehicle.name === "string" && nullableText(vehicle.plate) &&
    nullableText(vehicle.assignmentId) && nullableText(vehicle.driverPersonId) && nullableText(vehicle.driverName) &&
    (result.drivers === undefined || (Array.isArray(result.drivers) && result.drivers.every(driver =>
      !!driver && text(driver.id) && text(driver.name))));
}

function deliver(value: unknown) {
  if (!isVehicleDriverAssignmentResult(value)) return;
  listeners.forEach(listener => {
    // A consumer refresh must not turn an already committed write into a failure.
    try { listener(value); } catch { /* Other consumers must still be notified. */ }
  });
}

/** One listener/channel per page, regardless of how many surfaces subscribe. */
export function subscribeVehicleDriverAssignments(listener: (result: VehicleDriverAssignmentResult) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  listeners.add(listener);
  if (!stopListening) {
    const local = (event: Event) => deliver((event as CustomEvent).detail);
    window.addEventListener(VEHICLE_DRIVER_ASSIGNED_EVENT, local);
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = event => deliver(event.data);
      }
    } catch { channel = null; }
    stopListening = () => {
      window.removeEventListener(VEHICLE_DRIVER_ASSIGNED_EVENT, local);
      channel?.close();
      channel = null;
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { stopListening?.(); stopListening = null; }
  };
}

/** Call only after a successful, validated server response. Received events are never rebroadcast. */
export function publishVehicleDriverAssignment(result: VehicleDriverAssignmentResult): void {
  if (typeof window === "undefined" || !isVehicleDriverAssignmentResult(result)) return;
  // Do not broadcast the company personnel list; only the changed vehicle is needed.
  const detail: VehicleDriverAssignmentResult = { companyId: result.companyId, vehicle: result.vehicle, canEdit: result.canEdit };
  window.dispatchEvent(new CustomEvent(VEHICLE_DRIVER_ASSIGNED_EVENT, { detail }));
  try {
    if (channel) channel.postMessage(detail);
    else if (typeof BroadcastChannel !== "undefined") {
      const sender = new BroadcastChannel(CHANNEL_NAME);
      sender.postMessage(detail);
      sender.close();
    }
  } catch { /* Refresh on focus remains available when cross-tab messaging is unavailable. */ }
}

export class VehicleDriverAssignmentError extends Error {
  constructor(message: string, public readonly status = 0) { super(message); }
}

async function requestAssignment(
  vehicleId: string,
  companyId: string | null | undefined,
  command?: VehicleDriverAssignmentCommand,
  signal?: AbortSignal,
): Promise<VehicleDriverAssignmentResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 15000);
  try {
    const headers = await buildClientAuthHeaders(command ? "json" : "none");
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const query = new URLSearchParams({ vehicleId });
    if (companyId) query.set("companyId", companyId);
    const response = await fetch(`/api/vehicles/driver-assignment${command ? "" : `?${query}`}`, {
      method: command ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers,
      signal: controller.signal,
      body: command ? JSON.stringify({ ...(companyId ? { companyId } : {}), vehicleId,
        driverPersonId: command.driverPersonId, expectedAssignmentId: command.expectedAssignmentId }) : undefined,
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error : "Не удалось получить подтверждение сервера";
      throw new VehicleDriverAssignmentError(message, response.status);
    }
    if (!isVehicleDriverAssignmentResult(result) || result.vehicle.id !== vehicleId ||
      (companyId && result.companyId !== companyId) || (!command && !Array.isArray(result.drivers))) {
      throw new VehicleDriverAssignmentError("Ответ сервера не соответствует выбранной машине. Обновите данные.");
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Missing authorization token")) {
      throw new VehicleDriverAssignmentError("Войдите в TravkinFlow заново", 401);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new VehicleDriverAssignmentError("Нет подтверждения сервера. Обновите привязку перед повторным сохранением.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export function loadVehicleDriverAssignment(vehicleId: string, companyId?: string | null, signal?: AbortSignal) {
  return requestAssignment(vehicleId, companyId, undefined, signal);
}

export function saveVehicleDriverAssignment(command: VehicleDriverAssignmentCommand, signal?: AbortSignal) {
  return requestAssignment(command.vehicleId, command.companyId, command, signal);
}
