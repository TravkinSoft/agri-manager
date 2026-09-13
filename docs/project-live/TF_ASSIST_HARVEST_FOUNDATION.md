# TF Assist — первая рабочая основа уборочной кампании

Статус: IMPLEMENTED; AI runtime и положительный UI gate BLOCKED BY QA ENV, 2026-09-13. Владелец задачи: специалист TF Assist; решения по интеграции и Production: CEO tf.

## Авторизация и живой baseline

- Утверждённое ТЗ: читающий аналитический помощник Global Admin в явно выбранной компании. Код, тесты и Preview разрешены; Production deployment, миграции и включение другим ролям запрещены.
- Worktree: `C:/Users/TRAVKIN/Downloads/CodecSaaS/.worktrees/tf-assist-harvest-foundation-20260913`.
- Ветка: `codex/tf-assist-harvest-foundation-20260913`, создана чистой от `452cd1d0c21c44093ee81758d4c344e98305191b`.
- `git fetch origin master` и `ls-remote`: baseline совпал. Production health 2026-09-13T16:31:30.113Z: 200, production, `452cd1d0c21c`, deployment `agri-manager-bu3xq6ip6-travkin-ais-projects.vercel.app`.
- Старый assistant-v1: `f503f05b54de129b6778fee10e3b6406ec761ced`; 11 unstaged и 4 untracked A110. Не изменять и не переносить автоматически.
- A108 temporary: detached `abce1bb9e18fc118c68dfc6add6fb31d05ffe81c`; 55 staged, 2 unstaged. Не изменять индекс или файлы.
- Runtime прежних A108/A110, прежние тесты и доступность памяти: NOT LIVE VERIFIED. Старые отчёты — исторические указатели.

## Исполнимый план

| Этап | Действия | Критерий выхода | Статус |
| --- | --- | --- | --- |
| 1. Приёмка | Проверить master/health, старые dirty trees, изоляцию и правила; сохранить план | Точная чистая база, список чужих изменений, границы | DONE |
| 2. Gap audit | Прочитать current assistant entrypoints, auth, данные harvest/ledger/PTC, физическую схему QA; классифицировать reuse/rewrite/exclude | Матрица источников, ограничения и принятый контракт | DONE |
| 3. Read contract | Фиксированный набор только читающих источников; серверные company/role guards; минимальные DTO; provenance | Нет generic SQL, URL, RPC или mutation capability у модели | DONE |
| 4. Детерминированное ядро | Массы в целых минимальных единицах; отдельные source identities; effective tickets; примеси; площади; диапазоны | Граничные и исторические тесты PASS | DONE (42 tests) |
| 5. Вертикальный срез | Global Admin chat, выбор компании, вопрос → разрешённый план → чтение → расчёт → ответ с источниками | Уборка/поле/партия/склад/PTC/техника/урожайность в одном безопасном потоке | IMPLEMENTED; readonly Preview PASS; model/UI blocked |
| 6. Безопасность и контекст | Изоляция пользователя/компании, refresh scopes, injection boundaries, audit без секретов, отказ при неоднозначности | Негативные tenant/role/write/injection тесты PASS | DONE (mock/server tests) |
| 7. Проверка | Unit + integration + browser; полный typecheck/build; проверка immutable Preview и привязки QA | Воспроизводимые доказательства, нет Production writes | Code/build/negative HTTP PASS; positive UI blocked |
| 8. Передача | Записать SHA, файлы, команды, результаты, ограничения; обновить handoff и сообщить CEO | Подготовленный Preview для отдельного release-решения | Evidence saved; final CEO handoff follows Preview |

После каждого существенного этапа обновить этот документ и общий handoff. Не завершать работу на плане. Ошибка gate возвращает в соответствующий этап; ложный PASS недопустим.

## Матрица вопросов / источников / доказательств

| Вопрос | Канонические источники для изучения | Ответ и обязательные проверки |
| --- | --- | --- |
| Что сейчас убираем? | Сезон, crop_structure, fields, активная уборка/PTC | Явный сезон, точные field/source ID, незакрытый процесс отдельно |
| Поле 9, Сорая, примерно 7 га — урожайность? | Effective harvest tickets + crop source + оформленные source impurity allocations | Принятая масса / 7 га; 7 га — допущение пользователя, не запись в ERP; gross означает урожай до примеси, не вес машины с тарой |
| Осталось 18 га — сколько будет? | Текущая урожайность того же источника; наблюдения примеси | Диапазон сценариев и основания; при отсутствии наблюдений не выдумывать процент примеси |
| Сколько Галы первой репродукции? | Exact source lots, tickets, ledger | Приход и текущий остаток разные показатели; Gala Elite отдельно |
| Сколько с поля 49 и где лежит? | Источники партий, batch lineage, ledger warehouse slices | Не объединять одноимённые поля; warehouse sum равен source total |
| Какие рейсы сформировали массу? | Tickets, ticket lines, batch source mapping | UUID/номер/статус/дата/вес; отмены исключены; replacement без двойного счёта |
| Сколько земли/мусора вывезено? | Finalized impurity documents + member settlement/source allocations | Один документ, пропорциональные source allocations, чистые партии остаются разными |
| Что в пути/не закрыто? | PTC states/events и open tickets | Не прибавлять непроверенный вес; PTC cycle не равен автоматически весовому рейсу |
| Кто работает и что в ремонте? | Company people, canonical machines/vehicles, driver links, repairs, PTC | Current assignments отдельно от исторического водителя талона; ремонт сохраняет cargo status |
| Поступления/выбытия/остатки? | Canonical signed ledger + inventory identities | Сторно учитывается знаково; no float drift; отсутствие/ошибка данных не нулевой баланс |
| Почему числа расходятся? | Source receipts vs impurity vs other outflow vs current stock | Показать reconciliation equation и невыясненный остаток; отсутствие связи не угадывать |
| «А её остаток?» | Только ранее подтверждённый source focus текущего user/company | При смене компании сбросить focus; неоднозначность требует уточнения |

## Архитектурные инварианты

1. Доступ сначала только фактическому active Global Admin; impersonation не расширяет права. Компания должна быть явно выбрана в серверном контексте, request scope обязан совпасть.
2. Новый изолированный runtime не импортирует legacy action engine, draft confirmation, KB CRUD или A110 chemical tools. Модель не получает произвольный fetch/SQL/URL/RPC и не выбирает tenant.
3. Источники читаются фиксированными allowlist-запросами с проверенными company IDs, полями и ограничениями. Неполная пагинация/ошибка запроса блокирует точный итог.
4. Числа рассчитываются сервером. Модель может классифицировать вопрос и формулировать пояснения; критические числовые блоки и provenance формирует deterministic renderer.
5. Каждый ответ содержит company, season/filter, read interval, entity IDs/statuses и источник для чисел. Несколько REST-чтений не выдаются за атомарный снимок БД.
6. Тексты БД и пользовательские aliases — данные, а не инструкции; они не могут менять tools, company, policy или вычисления. Модель получает только минимальные разрешённые поля.
7. USER и COMPANY memory разделены; живые числа не запоминаются как истина. Conversation focus связан с user/company и перепроверяется. Перенос/миграция старой памяти не производится в этом релизе.
8. Логируются request ID, scope, source/table names, counts, timings, policy decisions и digest источников; секреты, raw prompts и полный персональный контекст не логируются.
9. Preview включается отдельным server/public flag и проверенной QA привязкой. Production по умолчанию закрыт; никакой migration/deploy/role enablement в Production в этом ТЗ.

## Риски и обязательные gates

- QA и Production schema могут расходиться. Физическая схема и текущий SQL/server contract важнее старого документа; автоматические migration/repair запрещены.
- Старый assistant содержит mutation routes и другую модель ролей. Перенос всей ветки исключён; общий shell reuse только после проверки.
- Совместная примесь поля 49: никогда не считать технический pool чистым новым lot; использовать подтверждённое распределение по исходным identity.
- ПТC и весовая — разные события: нет удвоения counts или неподтверждённого join по имени/времени.
- Гектары могут быть приблизительными и не совпадать со структурной площадью; статус и источник площади явно указать.
- Неизвестная примесь → сценарий с явными вводами, а не выдуманный доверительный интервал.
- Пустая/недоступная таблица, truncation или drift → incomplete/unavailable, не ноль.
- Личные данные ограничить именем/ролью/рабочей связью, исключить контакты, PIN, auth metadata.
- Тесты: Global Admin/no context/other role/impersonation/foreign IDs; duplicate names; correction/void; shared impurity; split batch; signed storno; decimal mass; zero/approx area; missing source; prompt injection; concurrent company switch.

## Проверка и release boundary

Каждый gate фиксируется командой, SHA и результатом. Browser smoke должен проверить настоящий UI, company switching, исходные ссылки, ошибки, mobile/desktop; fixture proof и authenticated QA proof указываются раздельно. Production read-only baseline допустим, operational test writes запрещены. Итог этого ТЗ — проверенный Preview и рекомендация CEO по отдельному release-решению.

## Gap audit / реализация / результаты

Заполняется по мере живого изучения и выполнения. Пока новый runtime и Preview: NOT LIVE VERIFIED.

### Milestone 2026-09-13 — local gates

- Gap audit complete. Reused only shell and canonical session auth; legacy execution/actions, conversations and A108/A110 memory/tools excluded. Full contract and bounded gaps: `TF_ASSIST_READ_CONTRACT.md`.
- `npm ci --ignore-scripts --no-audit --no-fund`: isolated dependency install, no other worktree dependency reuse.
- `npm run qa:tf-assist:harvest`: **38/38 PASS**; includes model mocks, server scope, deterministic grams, shared impurity and paper correction chronology.
- `npm run qa:copilot:global-admin-only`: **10/10 PASS**; existing role/entrypoint policy preserved.
- `npx --no-install eslint ...`: targeted new/changed source files **PASS**.
- `npm run typecheck`: **PASS**.
- `npm run build`: **PASS**, all 159 static pages generated. Existing dependency warnings: Supabase dynamic require, optional ws bufferutil/utf-8-validate, outdated Browserslist; existing harvest-batches catches Next dynamic-server-usage during prerender. No new build failure.
- Real readonly QA check `npx --no-install tsx scripts/audit/tf-assist-readonly.ts`: **26/26 sources complete for each of two isolated QA companies**. Artifact: `tf-assist-qa-readonly-evidence.json`. QA shared impurity is V1; source clean figures are withheld. No data/schema writes.
- CEO confirmed existing AI env in remote Preview; no new key. LLM local tests use injected transport only. Vercel publish path is commit/push of isolated branch. Common QA alias remains untouched.
- Remote deployment, AI env boolean preflight and authenticated browser UI proof: **PENDING**. Full readiness for real use is not claimed.

### Remote Preview preflight and follow-up

- Initial immutable Preview `dpl_9116mgUFHQDa89fYMCvdVQaJbzmr`, `agri-manager-dg5ohrebz-travkin-ais-projects.vercel.app`: READY, Git SHA `53814317a54f788cec8ebf5debc5ccb1ca2ee93d`.
- Boolean HTTP preflight succeeded using connector-issued temporary Vercel access. `qaBound=true`, `sourceCredentialConfigured=true`, `productionLocked=false`, `aiConfigured=false`. Missing model variable: **OPENAI_API_KEY**. No secret values inspected/exposed.
- Initial feature flags absent. Follow-up uses one reviewed shared gate for the exact approved Preview branch + QA origin. Explicit off wins; all Production builds/functions remain off. No remote environment/secret changes required, no QA alias reassignment.
- Follow-up tightens lot identity (requires_review/merged/conflicting reproduction) and prevents a variety substring from selecting another variety. Added denied-request audit event. Tests now **41/41 PASS**.
- Browser preflight encountered Vercel login / ERR_BLOCKED_BY_CLIENT; server HTTP preflight succeeded independently. A positive authenticated QA browser test is still unproven. Final Preview verification will use the follow-up SHA, not the initial deployment.

### Final source/security gate, 2026-09-13

- Immutable `7f540746aebce8572285126325846fd3f9278235` Preview READY: `https://agri-manager-ia6ji02ch-travkin-ais-projects.vercel.app`, deployment `dpl_93g8knUnYDQmPhuwXdTwwbKuARuR`.
- HTTP: root 200; enabled/qaBound/uiEnabled/sourceCredentialConfigured=true; aiConfigured=false; unauthenticated query 401; foreign Origin 403. Evidence in `tf-assist-preview-evidence.json`.
- Browser: exact Preview root and login rendered; no saved session. Chrome `qa.travkinflow.com/auth/login` also displayed empty login form. Positive Global Admin/company-switch/evidence UI scenario NOT RUN; no credential reset or alias change.
- Model runtime **BLOCKED BY QA ENV**: required `OPENAI_API_KEY` absent. Existing code names-only inspection found no alternative approved credential; model/base-URL options are not credentials. Missing-key mock produces explicit model-unavailable warning and no network call; deterministic reader remains independently testable.
- Security diff scan `dffceafa-563d-4bba-a428-e8d11afa6271`: complete, 18 source/config/test files + 3 docs, 0 reportable findings. Scope `452cd1d0..7f540746`; report and SARIF retained in task handoff evidence. Daybreak not_granted; token usage unavailable.
- Small post-scan follow-up makes exact branch mandatory for every Vercel Preview activation, even server flag 1. Production/off/non-QA vetoes and local QA opt-in remain. Supplementary independent source review PASS; **42/42 tests PASS**, targeted ESLint PASS. Sealed scan remains bound to `7f540746` and is not represented as a scan of a later commit.
- Final remote deployment for this stricter gate and final handoff are recorded in the task report. Full feature acceptance/release remains blocked by missing QA AI configuration and positive authenticated UI proof.
### Gateway OIDC continuation (2026-09-13)

CEO authorized existing Vercel OIDC Gateway without creating/storing a new key. OPENAI_API_KEY keeps direct priority; absent direct key selects Gateway with VERCEL_OIDC_TOKEN. Provider prefix mapping is Gateway-only. Health exposes safe transport enum. Internal exact-Preview-only build smoke calls the real classifier with one synthetic question, no business data or public endpoint. 48 tests PASS + existing GA10/10 PASS. Remote proof follows the next immutable deployment; historical missing-key blocker remains historical until live verification. Positive authenticated UI still needs the existing QA session. Production/master/DB/migrations/remote env/qa.travkinflow.com alias remain outside scope.
