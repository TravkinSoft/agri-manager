# Google — Native ticket list checkpoint

Дата: 2026-09-02.

## Результат этапа

- В Android-клиент добавлен нативный список талонов через `GET /api/weighbridge/tickets?workspace=true&historyLimit=N`.
- Добавлена read-only карточка талона через `GET /api/weighbridge/tickets/{id}`.
- Реализованы loading, empty, error, offline/stale cache и ручное обновление.
- История догружается существующим безопасным server window: 20, 40, 60, 80, 100. Это не cursor pagination; backend-контракт cursor остаётся отдельным улучшением.
- Локальный список зашифрован существующим Android Keystore storage и изолирован по `actorId + companyId`.
- Карточка показывает статус, операцию, дату, маршрут, транспорт, водителя, брутто/тару/нетто, участников, строки и примечание. Изменяющих действий на экране нет.
- Mobile role policy остаётся fail-closed: только `global_admin`, `company_admin`, `agronomist`, `weighman`, `specialist`. Более широкий web ACL endpoint не расширяет native scope.

## Live и source verification

- Production read-only probe без `Authorization`: `GET https://travkinflow.com/api/weighbridge/tickets?workspace=true&historyLimit=10` вернул `401`, без redirect. Тело ответа и токены не выводились.
- QA-домен защищён Vercel SSO и без browser session возвращает `302` на SSO; это не использовалось как доказательство API auth contract.
- Source contract обоих `GET` использует `resolveWeighbridgeSession`.
- Session resolver получает server actor, разрешает company context, создаёт user-scoped Supabase client и вызывает `assertActorAccess`.
- ACL повторно проверяет профиль, canonical role, active status и принадлежность компании; выборки ticket/detail дополнительно ограничены `company_id`.
- Android повторяет запрос после безопасного refresh только при `401`; остальные ошибки не превращаются в write/retry loop.

## Проверки

- `testDebugUnitTest`: 5/5 PASS, failures 0, errors 0.
- `lintDebug`: PASS, fatal 0, errors 0, warnings 12.
- Warnings: 7 pinned dependency, 2 icon location, 2 monochrome launcher icon, 1 obsolete version qualifier; новых blocking findings нет.
- `assembleDebug`: PASS.
- `compileReleaseKotlin`: PASS.
- Runtime source gate: 0 совпадений по `WebView`, `androidx.webkit`, `loadUrl`, `TrustedWebActivity`, `bubblewrap`.
- Runtime dependency gate: 0 совпадений по `androidx.webkit` и `androidx.browser` в `debugRuntimeClasspath`.
- Hardcoded JWT/password gate: 0 совпадений.
- Подключённых Android-устройств нет (`adb devices` пуст).

## Debug APK

- Package: `com.travkin.flow.qa`.
- Version: `3 (3.0.0-qa)`.
- minSdk 29, targetSdk 36, compileSdk 36.
- Path: `android/app/build/outputs/apk/debug/app-debug.apk`.
- Size: `64,098,399` bytes.
- SHA-256: `BB6B780DF1F1EDA8BAB94EB7386C8C722AC7A34EE7A4C1D3D7CE045ED4683B09`.

APK является локальным QA artifact и не предназначен для Play upload.

## Честные ограничения checkpoint

- В build process отсутствовали Supabase URL/publishable key, поэтому собранный APK сохраняет fail-closed login до безопасной QA-сборки с build-time значениями.
- Без физического устройства не проверены login, process death, реальная role matrix, offline recovery и UI на разных размерах экрана.
- Текущий backend отдаёт history window максимум 100, а не cursor. Клиент честно догружает увеличенное окно и не заявляет бесконечную pagination.
- Detail fallback берётся из зашифрованного списка; полная карточка повторно загружается с сервера и отдельно не кэшируется.
- Write flow Весовщика, PIN/operator session, Room/WorkManager queue и idempotency E2E не включены.

## Граница воздействия

- Production deploy: 0.
- Production DB writes: 0.
- Production read-only requests: 1 unauthenticated auth-gate probe.
- Миграции: 0.
- Google Play uploads/releases/publication: 0.
- Основная ветка TravkinFlow: не изменялась.
- Старые Google-ветки: не изменялись, не сливались и не удалялись.

## Следующий безопасный этап

1. Реализовать следующий read-only role slice по утверждённой архитектуре без расширения ролей и без write API.
2. Получить Supabase URL/publishable key только через secure build environment и выполнить device smoke.
3. Не переходить к Play/Production или write-весовой без отдельного гейта и внешнего разрешения.
