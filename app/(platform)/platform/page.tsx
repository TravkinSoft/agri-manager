"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightCircle, Building2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CompanyItem = {
  id: string;
  name: string;
};

async function buildAuthHeaders(contentType: "json" | "none" = "none") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("Сессия истекла. Войдите снова.");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (contentType === "json") {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export default function PlatformCompaniesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CompanyItem | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [newCompanyName, setNewCompanyName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminFullName, setNewAdminFullName] = useState("");

  const canCreate = useMemo(
    () => Boolean(newCompanyName.trim()) && Boolean(newAdminEmail.trim()) && Boolean(newAdminFullName.trim()),
    [newCompanyName, newAdminEmail, newAdminFullName]
  );
  const expectedDeletePhrase = deleteTarget
    ? `Да полностью удалить компанию ${deleteTarget.name} из проекта`
    : "";
  const canDelete = Boolean(deleteTarget) && deleteConfirmation.trim() === expectedDeletePhrase;

  const loadCompanies = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders("none");
      const response = await fetch("/api/global-admin/companies", { method: "GET", headers, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить компании");
      setCompanies(Array.isArray(payload?.companies) ? payload.companies : []);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить компании",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCompanies();
  }, [user?.id]);

  const openCompanyContext = async (companyId: string) => {
    if (!user?.id) return;
    try {
      const headers = await buildAuthHeaders("json");
      const response = await fetch("/api/global-admin/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({ companyId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось открыть компанию");
      window.location.href = "/dashboard";
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось открыть компанию",
        variant: "destructive",
      });
    }
  };

  const createCompany = async () => {
    if (!user?.id || !canCreate || submitting) return;
    setSubmitting(true);
    try {
      const headers = await buildAuthHeaders("json");
      const response = await fetch("/api/global-admin/create-company", {
        method: "POST",
        headers,
        body: JSON.stringify({
          actorUserId: user.id,
          companyName: newCompanyName.trim(),
          companyAdminEmail: newAdminEmail.trim(),
          companyAdminFullName: newAdminFullName.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось создать компанию");

      toast({
        title: "Готово",
        description: "Компания создана, приглашение первому администратору отправлено.",
      });
      setCreateOpen(false);
      setNewCompanyName("");
      setNewAdminEmail("");
      setNewAdminFullName("");
      await loadCompanies();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось создать компанию",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openDeleteDialog = (company: CompanyItem) => {
    setDeleteTarget(company);
    setDeleteConfirmation("");
  };

  const closeDeleteDialog = () => {
    if (deleteSubmitting) return;
    setDeleteTarget(null);
    setDeleteConfirmation("");
  };

  const deleteCompany = async () => {
    if (!deleteTarget || !canDelete || deleteSubmitting) return;
    setDeleteSubmitting(true);
    try {
      const headers = await buildAuthHeaders("json");
      const response = await fetch(`/api/global-admin/companies/${deleteTarget.id}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ confirmationText: deleteConfirmation.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const counts = payload?.blockingCounts
          ? Object.entries(payload.blockingCounts)
              .filter(([, count]) => Number(count) > 0)
              .map(([table, count]) => `${table}: ${count}`)
              .join("; ")
          : "";
        throw new Error(
          [payload?.error || "Не удалось удалить компанию", counts ? `Данные: ${counts}` : ""]
            .filter(Boolean)
            .join(" ")
        );
      }

      toast({
        title: "Компания удалена",
        description: `Компания "${deleteTarget.name}" удалена из платформы.`,
      });
      closeDeleteDialog();
      await loadCompanies();
    } catch (error: any) {
      toast({
        title: "Удаление запрещено",
        description: error?.message || "Не удалось удалить компанию",
        variant: "destructive",
      });
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Компании платформы</CardTitle>
            <CardDescription>
              Создание компаний и вход в контекст выбранной компании без изменения глобального профиля.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Создать компанию
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-slate-500">Загрузка...</p> : null}
          {!loading && companies.length === 0 ? <p className="text-sm text-slate-500">Компаний пока нет.</p> : null}
          {companies.map((company) => (
            <div key={company.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-500" />
                <span className="font-medium">{company.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => openCompanyContext(company.id)}>
                <ArrowRightCircle className="mr-2 h-4 w-4" />
                Открыть компанию
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  title="Удалить компанию"
                  aria-label={`Удалить компанию ${company.name}`}
                  onClick={() => openDeleteDialog(company)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая компания</DialogTitle>
            <DialogDescription>Укажите данные компании и первого администратора компании.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="companyName">Название компании</Label>
              <Input id="companyName" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyAdminName">ФИО первого администратора компании</Label>
              <Input id="companyAdminName" value={newAdminFullName} onChange={(e) => setNewAdminFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyAdminEmail">Email первого администратора компании</Label>
              <Input
                id="companyAdminEmail"
                type="email"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Отмена
            </Button>
            <Button onClick={createCompany} disabled={!canCreate || submitting}>
              {submitting ? "Создание..." : "Создать компанию"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => (!open ? closeDeleteDialog() : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="h-5 w-5" />
              Удаление компании
            </DialogTitle>
            <DialogDescription>
              Удаление доступно только глобальному администратору. Если у компании уже есть поля,
              склады, операции или другая производственная история, сервер заблокирует удаление.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
              <div className="font-semibold">Компания: {deleteTarget?.name}</div>
              <div className="mt-1 text-slate-400">
                Будут удалены пользователи этой компании. Саму компанию можно удалить только если нет
                производственных данных, которые нельзя безопасно удалить автоматически.
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-confirmation">Для подтверждения введите точную фразу:</Label>
              <div className="rounded-md bg-slate-950 p-2 font-mono text-xs text-slate-200">
                {expectedDeletePhrase}
              </div>
              <Input
                id="delete-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                disabled={deleteSubmitting}
                placeholder={expectedDeletePhrase}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDeleteDialog} disabled={deleteSubmitting}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={deleteCompany} disabled={!canDelete || deleteSubmitting}>
              {deleteSubmitting ? "Удаление..." : "Удалить компанию"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
