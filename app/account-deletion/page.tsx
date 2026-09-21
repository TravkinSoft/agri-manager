import type { Metadata } from "next";
import Link from "next/link";

import { TravkinLogo } from "@/components/layout/travkin-logo";

export const metadata: Metadata = {
  title: "Удаление аккаунта TravkinFlow",
  description: "Как запросить удаление аккаунта TravkinFlow и связанных персональных данных.",
  alternates: { canonical: "/account-deletion" },
};

const supportEmail = "travkin.group@gmail.com";
const requestSubject = "TravkinFlow — запрос на удаление аккаунта и данных";
const requestBody = "Прошу удалить мой аккаунт TravkinFlow и связанные персональные данные.\n\nEmail аккаунта: \nНазвание организации (если известно): \n\nПрошу подтвердить получение запроса и сообщить срок выполнения, а также основания и сроки хранения данных, которые не могут быть удалены.";
const requestUrl = `mailto:${supportEmail}?subject=${encodeURIComponent(requestSubject)}&body=${encodeURIComponent(requestBody)}`;

export default function AccountDeletionPage() {
  return (
    <main className="min-h-screen bg-card text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <Link href="/" aria-label="На главную TravkinFlow"><TravkinLogo /></Link>
          <Link href="/privacy" className="text-sm underline underline-offset-4">Конфиденциальность</Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl space-y-8 px-4 py-10 leading-7 sm:px-6 sm:py-14">
        <section className="space-y-4">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Удаление аккаунта TravkinFlow</h1>
          <p>Вы можете запросить удаление своего аккаунта и связанных персональных данных по электронной почте. Вход в TravkinFlow и установленное приложение для отправки запроса не требуются.</p>
          <p className="text-sm text-muted-foreground">Приложение: TravkinFlow · Разработчик в Google Play: Travkin Group · Оператор сервиса: LWP LTD, TOO.</p>
        </section>

        <section className="space-y-4 rounded-2xl border border-border p-5 sm:p-6" aria-labelledby="request-heading">
          <h2 id="request-heading" className="text-xl font-bold">Как отправить запрос</h2>
          <ol className="list-decimal space-y-3 pl-6">
            <li>Напишите с почты, указанной в вашем аккаунте, на <a href={`mailto:${supportEmail}`} className="break-all font-semibold underline">{supportEmail}</a>.</li>
            <li>Укажите тему «Удаление аккаунта TravkinFlow», email аккаунта и название организации, если оно известно.</li>
            <li>Напишите, что просите удалить аккаунт и связанные персональные данные. Если доступа к прежней почте нет, сообщите об этом: поддержка уточнит безопасный способ подтверждения принадлежности аккаунта.</li>
          </ol>
          <a href={requestUrl} className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-foreground px-5 py-3 text-center font-semibold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">Подготовить письмо с запросом</a>
          <p className="text-sm text-muted-foreground">Кнопка открывает почтовое приложение, но не отправляет письмо. Если оно не настроено, скопируйте адрес и отправьте запрос через свою почту. Не присылайте пароль, PIN или коды подтверждения.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Что происходит после обращения</h2>
          <p>Запрос обрабатывается поддержкой вручную. Для защиты от удаления чужого аккаунта сначала проверяется принадлежность аккаунта заявителю. В ответе поддержка сообщает порядок и срок выполнения запроса; если нужны дополнительные сведения, запрашивает их у вас.</p>
          <p>Запрос касается учётной записи и связанных персональных данных, включая данные профиля и персональные материалы пользователя. Поддержка уточняет состав данных и необходимость удаления либо обезличивания с учётом обязательных требований к хранению.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Рабочие записи и сроки хранения</h2>
          <p>Удаление личного аккаунта не означает удаление организации, аккаунтов других сотрудников или всех её производственных документов. Отдельные сведения могут сохраняться для обязательного учёта, безопасности и исполнения применимых требований, как описано в <Link href="/privacy" className="underline underline-offset-4">политике конфиденциальности</Link>.</p>
          <p>Если какие-либо связанные с вами данные должны сохраняться, поддержка сообщает их категории, основания и применимые сроки хранения при рассмотрении запроса. Единый фиксированный срок хранения для всех видов производственных документов на этой странице не установлен.</p>
          <p className="rounded-xl border border-border p-4 font-medium">Открытие страницы и подготовка письма ничего не удаляют. Удаление приложения с телефона также не удаляет аккаунт TravkinFlow.</p>
        </section>
        <Link href="/" className="inline-block underline underline-offset-4">На главную TravkinFlow</Link>
      </article>
    </main>
  );
}
