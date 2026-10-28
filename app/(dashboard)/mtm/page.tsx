"use client";

import { useAuth } from "@/lib/contexts/auth-context";
import { canAccessPath } from "@/lib/auth/role-access";
import { MtmWorkspace } from "@/components/mtm/mtm-workspace";

export default function MtmPage() {
  const { profile, loading } = useAuth();
  if (loading) return <p role="status">Проверка доступа…</p>;
  if (!profile || !canAccessPath(profile.role, "/mtm")) return <p role="alert">Раздел МТМ недоступен для вашей роли.</p>;
  const companyId = profile.context_company_id || profile.company_id;
  if (!companyId) return <p role="status">Выберите компанию для работы с МТМ.</p>;
  // A changed company or actor destroys all prior editor/request state.
  return <MtmWorkspace key={`${profile.id}:${profile.role}:${companyId}`} companyId={companyId} actorId={profile.id} />;
}
