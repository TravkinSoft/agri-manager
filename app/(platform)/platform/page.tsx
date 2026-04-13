"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightCircle, Building2, Plus } from "lucide-react";
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

export default function PlatformCompaniesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [newCompanyName, setNewCompanyName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminFullName, setNewAdminFullName] = useState("");

  const canCreate = useMemo(
    () =>
      Boolean(newCompanyName.trim()) &&
      Boolean(newAdminEmail.trim()) &&
      Boolean(newAdminFullName.trim()),
    [newCompanyName, newAdminEmail, newAdminFullName]
  );

  const loadCompanies = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/global-admin/companies?userId=${encodeURIComponent(user.id)}`);
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
      const response = await fetch("/api/global-admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, companyId }),
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
      const response = await fetch("/api/global-admin/create-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          {!loading && companies.length === 0 ? (
            <p className="text-sm text-slate-500">Компаний пока нет.</p>
          ) : null}
          {companies.map((company) => (
            <div key={company.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-500" />
                <span className="font-medium">{company.name}</span>
              </div>
              <Button variant="outline" onClick={() => openCompanyContext(company.id)}>
                <ArrowRightCircle className="mr-2 h-4 w-4" />
                Открыть компанию
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая компания</DialogTitle>
            <DialogDescription>
              Укажите данные компании и первого администратора компании.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="companyName">Название компании</Label>
              <Input id="companyName" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyAdminName">ФИО первого администратора компании</Label>
              <Input
                id="companyAdminName"
                value={newAdminFullName}
                onChange={(e) => setNewAdminFullName(e.target.value)}
              />
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
    </div>
  );
}
