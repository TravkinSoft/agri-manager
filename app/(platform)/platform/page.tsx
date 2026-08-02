"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightCircle, Building2, FileText, Plus, ShieldCheck, Trash2 } from "lucide-react";
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
import {
  loadPlatformRuntimeStatus,
  type PlatformRuntimeStatus,
} from "@/lib/platform/platform-status-client";

type CompanyItem = {
  id: string;
  name: string;
};

function ConsolePanel({
  title,
  code,
  children,
  className = "",
}: {
  title: string;
  code: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-[#9aa8ba] bg-white shadow-[1px_1px_0_rgba(255,255,255,0.9)_inset] ${className}`}>
      <div className="flex items-center justify-between border-b border-[#9aa8ba] bg-[#d7dde6] px-2 py-1.5">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#16324f]">{title}</h2>
        <span className="border border-[#9aa8ba] bg-[#eef1f5] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#42566f]">
          {code}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function ConsoleRow({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "ok" | "warn" }) {
  return (
    <div className="grid grid-cols-[minmax(120px,0.9fr)_minmax(0,1fr)] border-b border-[#d5dbe5] py-1 text-[12px] last:border-b-0">
      <span className="text-[#536276]">{label}</span>
      <span
        className={
          tone === "ok"
            ? "font-mono font-semibold text-[#155e3b]"
            : tone === "warn"
              ? "font-mono font-semibold text-[#8a2f2f]"
              : "font-mono text-[#1f2937]"
        }
      >
        {value}
      </span>
    </div>
  );
}

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
  const router = useRouter();
  const { user, setGlobalAdminCompanyContext } = useAuth();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [platformStatus, setPlatformStatus] = useState<PlatformRuntimeStatus | null>(null);
  const [platformStatusError, setPlatformStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingCompanyId, setOpeningCompanyId] = useState<string | null>(null);
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
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) || null;
  const runtime = platformStatus?.runtime || null;
  const productCounts = platformStatus?.catalog.products || null;
  const importStatus = platformStatus?.catalog.pesticideImport || null;
  const statusValue = (value: number | undefined) => {
    if (platformStatusError) return "Не удалось загрузить данные";
    if (!platformStatus || value == null) return "Загрузка...";
    return String(value);
  };

  const loadCompanies = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders("none");
      const response = await fetch("/api/global-admin/companies", { method: "GET", headers, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить компании");
      setCompanies(Array.isArray(payload?.companies) ? payload.companies : []);
      setSelectedCompanyId(payload?.selectedCompanyId ? String(payload.selectedCompanyId) : null);
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

  const loadStatus = async () => {
    try {
      setPlatformStatusError(null);
      const status = await loadPlatformRuntimeStatus();
      setPlatformStatus(status);
    } catch (error) {
      setPlatformStatus(null);
      setPlatformStatusError(error instanceof Error ? error.message : "Не удалось загрузить данные");
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void loadStatus();
  }, [user?.id]);

  const openCompanyContext = async (companyId: string) => {
    if (!user?.id || openingCompanyId) return;
    setOpeningCompanyId(companyId);
    try {
      const headers = await buildAuthHeaders("json");
      const response = await fetch("/api/global-admin/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({ companyId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось открыть компанию");
      const nextCompanyId = payload?.selectedCompanyId ? String(payload.selectedCompanyId) : null;
      setSelectedCompanyId(nextCompanyId);
      setGlobalAdminCompanyContext(nextCompanyId);
      toast({
        title: "Вход в компанию",
        description: companies.find((company) => company.id === companyId)?.name || companyId,
      });
      router.push("/dashboard");
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось открыть компанию",
        variant: "destructive",
      });
      setOpeningCompanyId(null);
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
    <div className="space-y-3">
      <div className="border border-[#6e7f95] bg-[#0f2946] px-3 py-2 text-slate-100">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-300">
              ГЛОБАЛЬНАЯ КОНСОЛЬ / ВНУТРЕННИЙ ДОСТУП
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">TravkinFlow: глобальная консоль</h1>
          </div>
          <div className="grid grid-cols-2 gap-1 font-mono text-[10px] uppercase text-slate-300 sm:flex sm:flex-wrap">
            <span className="border border-slate-400/25 px-2 py-1">kno:v0</span>
            <span className="border border-slate-400/25 px-2 py-1">pp:v1</span>
            <span className="border border-slate-400/25 px-2 py-1">rls:draft</span>
            <span className="border border-slate-400/25 px-2 py-1">
              env:{runtime?.environment || (platformStatusError ? "error" : "loading")}
            </span>
            <span className="border border-slate-400/25 px-2 py-1">
              branch:{runtime?.branch || (platformStatusError ? "unknown" : "loading")}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-3 lg:grid-cols-2">
          <ConsolePanel title="Движок знаний" code="KNO">
            <ConsoleRow label="Проверки препаратов" value="включено" tone="ok" />
            <ConsoleRow label="Источники" value="ручной текст / URL" tone="ok" />
            <ConsoleRow label="Черновики" value="без применения в каталог" tone="ok" />
            <ConsoleRow label="Следующий слой" value="черновик OpenAI" tone="warn" />
            <Button
              variant="outline"
              className="mt-3 h-8 rounded-none border-[#9aa8ba] bg-[#eef1f5] text-[12px]"
              onClick={() => (window.location.href = "/platform/knowledge/intake")}
            >
              <FileText className="mr-2 h-3.5 w-3.5" />
              Открыть проверку препаратов
            </Button>
          </ConsolePanel>

          <ConsolePanel title="Состояние каталога" code="CAT">
            <ConsoleRow label="Всего глобальных продуктов" value={statusValue(productCounts?.total)} tone={platformStatusError ? "warn" : "ok"} />
            <ConsoleRow label="Пестициды" value={statusValue(productCounts?.pesticides)} tone={platformStatusError ? "warn" : "ok"} />
            <ConsoleRow label="Удобрения" value={statusValue(productCounts?.fertilizers)} tone={platformStatusError ? "warn" : "ok"} />
            <ConsoleRow label="Добавки" value={statusValue(productCounts?.additives)} tone={platformStatusError ? "warn" : "ok"} />
            <ConsoleRow
              label="Регуляторы роста"
              value={statusValue(productCounts?.growthRegulators)}
              tone={platformStatusError ? "warn" : "ok"}
            />
            <ConsoleRow label="Прочие" value={statusValue(productCounts?.other)} tone={platformStatusError ? "warn" : "ok"} />
            <ConsoleRow
              label="Пестициды пакета GLBD"
              value={
                importStatus
                  ? `${importStatus.found} / ${importStatus.expected}`
                  : platformStatusError
                    ? "Не удалось загрузить данные"
                    : "Загрузка..."
              }
              tone={importStatus && importStatus.found === importStatus.expected ? "ok" : "warn"}
            />
            <ConsoleRow
              label="Обновлено"
              value={
                platformStatus?.generatedAt
                  ? new Date(platformStatus.generatedAt).toLocaleString("ru-RU")
                  : platformStatusError
                    ? "Не удалось загрузить данные"
                    : "Загрузка..."
              }
              tone={platformStatusError ? "warn" : "neutral"}
            />
          </ConsolePanel>

          <ConsolePanel title="Качество данных" code="DQ">
            <ConsoleRow label="Identity-группы" value="локальный аудит ожидает" tone="warn" />
            <ConsoleRow label="Возможные дубли" value="очередь проверки" tone="warn" />
            <ConsoleRow label="Проверка metadata" value="обязательна для спорных строк" tone="warn" />
            <ConsoleRow label="data/**" value="не коммитить" tone="ok" />
          </ConsolePanel>

          <ConsolePanel title="Безопасность операций" code="OPS">
            <ConsoleRow label="per_t_solution" value="запрещён для новых записей" tone="ok" />
            <ConsoleRow label="Вода" value="не материал" tone="ok" />
            <ConsoleRow label="Season guard" value="активен" tone="ok" />
            <ConsoleRow label="Заявки на материалы" value="planned_quantity защищён" tone="ok" />
          </ConsolePanel>
        </div>

        <ConsolePanel title="Системные заметки" code="SYS" className="h-fit">
          <div className="space-y-2 text-[12px]">
            <div className="border border-[#c3ccd8] bg-[#f6f7f9] p-2">
              <div className="flex items-center gap-2 font-semibold text-[#16324f]">
                <ShieldCheck className="h-4 w-4" />
                Боевой контур
              </div>
              <p className="mt-1 leading-5 text-[#536276]">Бизнес-логика изолирована от этого изменения консоли.</p>
            </div>
            <div className="border border-[#c3ccd8] bg-[#f6f7f9] p-2 font-mono text-[11px] leading-5">
              Текущий сезон: 2026<br />
              Движок знаний: V0<br />
              Паспорт продукта: V1<br />
              Пароль БД: проверить вручную
            </div>
          </div>
        </ConsolePanel>
      </div>

      <div
        className={
          selectedCompany
            ? "border border-emerald-700/35 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"
            : "border border-amber-700/35 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
        }
        role="status"
      >
        {selectedCompany
          ? `Контекст компании: ${selectedCompany.name}`
          : "Сначала выберите компанию. До выбора контекста тест ассистента недоступен."}
      </div>

      <Card className="rounded-none border-[#9aa8ba] bg-white shadow-[1px_1px_0_rgba(255,255,255,0.9)_inset]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-[#9aa8ba] bg-[#d7dde6] text-[#111827]">
          <div>
            <CardTitle className="text-[#111827]">Компании платформы</CardTitle>
            <CardDescription className="text-[#5a6677]">
              Создание компаний и вход в контекст выбранной компании без изменения глобального профиля.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Создать компанию
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-[#111827]">
          {loading ? <p className="text-sm text-slate-500">Загрузка...</p> : null}
          {!loading && companies.length === 0 ? <p className="text-sm text-slate-500">Компаний пока нет.</p> : null}
          {companies.map((company) => (
            <div key={company.id} className="flex items-center justify-between gap-3 border border-[#9aa8ba] bg-white px-3 py-2 text-[#111827]">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-500" />
                <span className="font-medium">{company.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={openingCompanyId !== null}
                  onClick={() => openCompanyContext(company.id)}
                >
                  <ArrowRightCircle className="mr-2 h-4 w-4" />
                  {openingCompanyId === company.id ? "Открываем..." : "Войти в компанию"}
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
