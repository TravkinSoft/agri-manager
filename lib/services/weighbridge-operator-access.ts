import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";

export type WeighbridgeOperatorAccess = {
  person_id: string;
  is_weighbridge_operator: boolean;
  employee_status: string;
  pin_configured: boolean;
  access_enabled: boolean;
};

async function parseResponse(response: Response): Promise<WeighbridgeOperatorAccess> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || "Не удалось изменить доступ к Весовой.");
  return payload as WeighbridgeOperatorAccess;
}

export async function getWeighbridgeOperatorAccess(
  companyId: string,
  personId: string
): Promise<WeighbridgeOperatorAccess> {
  const headers = await buildClientAuthHeaders("none");
  const query = new URLSearchParams({ companyId });
  const response = await fetch(
    `/api/references/company-people/${encodeURIComponent(personId)}/weighbridge-access?${query.toString()}`,
    { method: "GET", cache: "no-store", headers }
  );
  return parseResponse(response);
}

export async function setWeighbridgeOperatorPinForEmployee(
  companyId: string,
  personId: string,
  pin: string
): Promise<WeighbridgeOperatorAccess> {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(
    `/api/references/company-people/${encodeURIComponent(personId)}/weighbridge-access`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ action: "set_pin", companyId, pin }),
    }
  );
  return parseResponse(response);
}

export async function disableWeighbridgeOperatorAccess(
  companyId: string,
  personId: string
): Promise<WeighbridgeOperatorAccess> {
  const headers = await buildClientAuthHeaders("json");
  const response = await fetch(
    `/api/references/company-people/${encodeURIComponent(personId)}/weighbridge-access`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ action: "disable", companyId }),
    }
  );
  return parseResponse(response);
}
