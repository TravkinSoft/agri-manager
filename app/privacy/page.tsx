import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { TravkinLogo } from "@/components/layout/travkin-logo";

export const metadata: Metadata = {
  title: "Политика конфиденциальности TravkinFlow",
  description: "Как TravkinFlow обрабатывает и защищает данные пользователей сервиса.",
  alternates: {
    canonical: "/privacy",
  },
};

const operatorName = "LWP LTD, TOO";
const supportEmail = "travkin.group@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#090d12] text-slate-100">
      <header className="border-b border-white/10 bg-[#090d12]/95">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <Link href="/" aria-label="На главную TravkinFlow">
            <TravkinLogo />
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            На главную
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="rounded-3xl border border-yellow-400/20 bg-[#101720] p-6 shadow-2xl shadow-black/25 sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Конфиденциальность и защита данных
          </div>
          <h1 className="mt-6 text-3xl font-black tracking-tight text-white sm:text-5xl">
            Политика конфиденциальности TravkinFlow
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
            Настоящая политика объясняет, какие данные обрабатывает TravkinFlow, зачем они нужны и какие меры применяются для их защиты.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-400">
            <span className="rounded-full border border-white/10 px-3 py-1.5">Версия 1.0</span>
            <span className="rounded-full border border-white/10 px-3 py-1.5">Дата вступления в силу: 2 сентября 2026 года</span>
          </div>
        </div>

        <div className="mt-8 space-y-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-[15px] leading-7 text-slate-300 sm:p-10">
          <section>
            <h2 className="text-2xl font-black text-white">1. Кто обрабатывает данные</h2>
            <p className="mt-3">
              Оператором сервиса TravkinFlow является {operatorName}. TravkinFlow предоставляется организациям и их уполномоченным сотрудникам для управления производственными процессами агропредприятия.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">2. Какие данные обрабатываются</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-yellow-300">
              <li>данные аккаунта: адрес электронной почты, идентификатор пользователя, роль, организация и статус сессии;</li>
              <li>рабочие данные, доступные пользователю по его роли: поля, операции, талоны и взвешивания, партии, склады, остатки, задачи, уведомления и связанные производственные записи;</li>
              <li>запросы пользователя, включая выбранный населённый пункт или КАТО для прогноза погоды;</li>
              <li>файлы, документы или аудиозаписи только тогда, когда пользователь сам запускает доступную ему функцию импорта, загрузки или распознавания речи в веб-версии;</li>
              <li>технические и защитные журналы: IP-адрес, время запроса, тип устройства или браузера, результат запроса и сведения об ошибках, если они фиксируются инфраструктурой сервиса.</li>
            </ul>
            <p className="mt-3">
              Нативное Android-приложение текущей версии не запрашивает системный доступ к геолокации устройства, контактам, SMS, звонкам, камере или пользовательским файлам и не содержит рекламных или аналитических SDK.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">3. Цели обработки</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-yellow-300">
              <li>аутентификация, управление сессией и разграничение доступа;</li>
              <li>предоставление функций TravkinFlow и синхронизация рабочих данных организации;</li>
              <li>обеспечение информационной безопасности, предотвращение злоупотреблений и расследование ошибок;</li>
              <li>выполнение запросов пользователя и поддержка работы сервиса;</li>
              <li>исполнение договорных и применимых законодательных требований.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">4. Основания обработки</h2>
            <p className="mt-3">
              Данные обрабатываются для исполнения договора с организацией пользователя, предоставления запрошенных функций, защиты сервиса и выполнения обязательных требований. Когда применимое право требует отдельного согласия, соответствующая функция должна использоваться только после получения такого согласия.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">5. Передача и поставщики инфраструктуры</h2>
            <p className="mt-3">
              TravkinFlow не продаёт персональные данные и не передаёт их рекламным сетям. Данные могут обрабатываться уполномоченными сотрудниками организации пользователя и поставщиками инфраструктуры, включая Supabase для аутентификации и хранения данных и Vercel для размещения веб-сервиса. Поставщики действуют в пределах своих договорных обязанностей и мер защиты. Передача также возможна, если она обязательна по применимому законодательству.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">6. Хранение и удаление</h2>
            <p className="mt-3">
              Данные хранятся, пока активен аккаунт организации и это необходимо для предоставления сервиса, договорной отчётности, безопасности и обязательных сроков хранения. После обоснованного запроса данные удаляются или обезличиваются, если их дальнейшее хранение не требуется законом, договором или для защиты законных интересов.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">7. Защита данных</h2>
            <p className="mt-3">
              Передача выполняется по HTTPS. Доступ ограничивается ролью и контекстом организации. В Android-приложении токены сессии и локальные рабочие кэши шифруются средствами Android Keystore, пароль не сохраняется, а выход немедленно очищает локальную сессию текущего пользователя.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">8. Права и запросы пользователя</h2>
            <p className="mt-3">
              Пользователь или его организация может запросить сведения об обработке, исправление, экспорт, ограничение или удаление данных в пределах применимого права и договорных обязательств. Для запроса необходимо написать на {supportEmail}. Для защиты аккаунта оператор может запросить подтверждение личности и полномочий заявителя.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">9. Дети</h2>
            <p className="mt-3">
              TravkinFlow является рабочим сервисом для организаций и не предназначен для самостоятельного использования детьми. Учётные записи создаются или разрешаются организацией пользователя.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-white">10. Изменения политики</h2>
            <p className="mt-3">
              Актуальная версия публикуется на этой странице. При существенных изменениях дата вступления в силу и номер версии обновляются до начала применения новой редакции.
            </p>
          </section>

          <section className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-5">
            <h2 className="text-xl font-black text-yellow-100">Контакты</h2>
            <p className="mt-2 text-yellow-50">Оператор: {operatorName}</p>
            <p className="text-yellow-50">Поддержка и запросы по данным: {supportEmail}</p>
          </section>
        </div>
      </article>
    </main>
  );
}
