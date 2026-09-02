# Google Play release package — TravkinFlow 3.0.0 (3)

This directory contains the approved-scope native Android store materials for
`com.travkin.flow`. It does not describe or advertise web-only TravkinFlow
features.

## Listing text (ru-RU)

Short description:

> Защищённый мобильный кабинет агронома для работы с TravkinFlow.

Full description:

> TravkinFlow — защищённое рабочее приложение для агрономов организаций,
> использующих сервис TravkinFlow.
>
> В текущей версии доступен основной мобильный кабинет агронома:
> • вход по выданной организацией учётной записи;
> • проверка роли и контекста компании на сервере;
> • защищённое хранение сессии средствами Android Keystore;
> • обновление профиля и безопасный выход.
>
> Приложение предназначено только для пользователей с активной ролью
> «Агроном». Создание аккаунта внутри приложения не поддерживается: доступ
> предоставляет организация пользователя.
>
> В этой версии нет Весовой, сценариев взвешивания, карты, Travkin Copilot,
> рекламы, покупок и фонового отслеживания. Дополнительные рабочие разделы
> будут добавляться поэтапно после отдельной проверки.

Release notes:

> Первый нативный Android-релиз: защищённый кабинет Агронома, серверная
> проверка роли и компании, безопасная сессия, обновление профиля и выход.

## Required visual assets

- `app-icon-512.png` — 512 x 512, PNG, exact native launcher artwork.
- `feature-graphic-1024x500.png` — 1024 x 500, PNG.
- `phone-01-login-1080x1920.png` — 1080 x 1920, PNG.
- `phone-02-cabinet-1080x1920.png` — 1080 x 1920, PNG.
- `source/` — deterministic HTML source for the feature graphic and screenshots.

Screenshot identity values use the reserved `example.com` domain and a
zero-valued demonstration UUID. They are not real user or company data.

## Console declarations

- Privacy policy and deletion request URL: `https://travkinflow.com/privacy`
- App access: restricted; provide one active reusable production Agronomist
  review account directly in Play Console. Never commit its password.
- Ads: no.
- Advertising ID: no.
- Target audience: 18 years and older.
- Category: Business.
- Government app: no.
- Financial features: none.
- Health features: none.
- Account creation in app: no; accounts are provisioned by an organization.
- Data collected: email address and user ID.
- Data shared: none.
- Processing: encrypted in transit, required for app functionality, account
  management, and fraud prevention/security/compliance.
- Deletion: request mechanism is documented at the privacy policy URL.

## Reviewer access instructions

Name: `Agronomist review account`

Instructions:

> Enter the email and password supplied above. No OTP, subscription, PIN, or
> location restriction is required. The account opens the single Agronomist
> cabinet; refresh and sign-out are available.

