# TF2 Product: read-only preflight шести миграций

Проверка: 2026-09-10 02:46–02:53 UTC. Product: `bhsemlvmkikpntabctml`, PostgreSQL 17.6. QA: `gsglkmudcwkdetqtocae`. Только SELECT/catalog/health и локальное чтение; DDL, бизнес-DML, import, auth, env и deployment изменений нет. Единственная запись этой подзадачи — этот отчёт в изолированном worktree.

Исходный checkout: `C:/Users/TRAVKIN/Downloads/CodecSaaS/.worktrees/travkinflow-2`, исходный HEAD `d7bbedb5910a7c6be0155967be88036284685866`. Во время проверки ROOT перешёл на `ebfd12f5b204f8821ea2641ecfed5322e9728db2`; diff карты/API/SQL относительно d7bbedb пуст. Изменённый ROOT master-plan не трогался. Изолированная ветка отчёта: `codex/tf2-all-contours-20260910`, parent `5eb71b9557683cb006bb02781dc1c2a1b494860e`.

## Вердикт

Предпосылки схемы для точного пакета из шести файлов — PASS на момент снимка. В Product нет конфликтующих объектов или неожиданных данных карты. Это не разрешение на применение и не финальный GO всего релиза.

**Release/rollback blocker: старый Product `4bae7d9` нельзя оставлять универсальной безопасной точкой отката после шестой миграции.** Его прямые service-role записи карты обходят TF2-флаги и новые RPC wrappers; возможна частичная деактивация контуров. До Product DDL ROOT должен иметь проверенный immutable deployment с совместимыми map API/read fallback и выключенными boundary writes. Локальный SHA сам по себе deployment не заменяет.

Предыдущий `.codex-artifacts/tf2-release-20260909/MIGRATIONS_PRODUCT_PREFLIGHT.md` остаётся историческим доказательством пяти файлов. Настоящий отчёт добавляет v3, свежие физические проверки и усиливает его предупреждение об old-deployment rollback. Первые пять файлов не изменились.

## Точный порядок и хеши

Файлы относительно `supabase/migrations` основного checkout. SHA256 ниже — UTF-8 файл с LF. Для первых пяти это также текущий raw SHA. У шестого рабочая Windows-копия содержит CRLF: raw SHA `c2e31b4f2065b2ee4982ad217dd7f8d869baaec038ebe472868a0c513238b2ad`; после единственной нормализации CRLF→LF получается приведённый e22c. Разница не является SQL-изменением.

| № | Файл | SHA256 LF | QA remote version |
|---|---|---|---|
| 1 | `20260908215514_warehouse_display_order_v1.sql` | `003878e600b4e04300e5cbb4e9b0f17806fc6612eb5c617c958d0959a8ce9fc7` | `20260909052348` |
| 2 | `20260908231010_ptc_closed_shift_history_index_v1.sql` | `b273175e1bd320c6c5511b98ed48b82fea685bd9ba2c908c88a6b44f38a56103` | `20260909052548` |
| 3 | `20260908232606_field_boundary_revision_v1.sql` | `d9371014136fde8414da68ca99a56bdee2a5644d640a45440d08e8268d755909` | `20260909052646` |
| 4 | `20260909024500_profile_avatar_v1.sql` | `fa86ae9365c21a7fb92e0171e70aa3053f9bb3304cd3cc8d82f2d9282ed4c58b` | `20260909052907` |
| 5 | `20260909073000_fields_map_atomic_import_v2.sql` | `46a9c1581a1bbba297c85cc33f99017ae2705ac5060e16c67d75dabd2ac24905` | `20260909053016` |
| 6 | `20260909211431_field_map_independent_contours_v3.sql` | `e22cdd6114105b48e2a5962848c8a70bcdc473e173fdaf68c78e608e5f964eb5` | `20260909215439` |

Свежая read-only сверка QA history в 02:50–02:51 UTC: каждый файл записан одним history payload. MD5 после CRLF→LF и удаления только краевого whitespace совпал с локальным SQL для всех шести: соответственно `39111d90a4a645a79870f0145d9ee388`, `37c9a51165ee29890c20659bcfb46461`, `ea8ceb64947e373d4e607dbfda3ae8b8`, `7f63a9e7c23caffe8d8cc657e33403ed`, `ca643f104fe2739bacdb6e8936a1b4d6`, `69f6a3f5c70ade9c35ab73904ce8fd12`. Проверены history payloads; это не новая независимая сверка всех текущих QA function bodies. QA expansion не повторялся.

Product history содержит 228 записей. В 02:52:49 UTC ни одно имя пакета, source version или v3 QA version в Product history не найдено. Map MVP `20260530170500 / add_field_map_mvp` присутствует. Remote timestamps должны назначаться штатным migration-aware executor; не копировать QA history и не выполнять blind `db push`.

## Логический scope пакета

1. Warehouse: nullable `display_order`, validated positive CHECK, обычный partial index, archive trigger, invoker reorder RPC. Сам reorder миграцией не вызывается.
2. PTC: только обычный partial closed-shift history index; никаких переходов статусов, таймеров или driver/ticket функций.
3. Boundary v1: удалить ровно шесть legacy write policies; отозвать browser-role INSERT/UPDATE/DELETE двух map tables; сохранить service CRUD и SELECT; добавить service-only mutation RPC. Это изменение ACL, не чисто additive DDL.
4. Avatar: две nullable profile columns и private `profile-media` bucket, 1 572 864 bytes, только `image/webp`. Bucket INSERT — разрешаемая отдельно metadata-строка; при появлении bucket до запуска проверку остановить, так как ON CONFLICT меняет его параметры.
5. Atomic v2: snapshot/confirm/state функции с общим company advisory lock и revision CAS. Они не вызываются самой миграцией.
6. Independent contours v3: восемь geometry columns, nullable `field_id`, FK `fields ON DELETE CASCADE` заменяется на `ON DELETE SET NULL`, три новых индекса и три CHECK. Backfill задаёт stable IDs/исходную геометрию/имя/lineage существующим rows, а не создаёт поля. Четыре новые v3 RPC; snapshot и три legacy entrypoints заменяются совместимыми v3 wrappers. Чтение возвращает unlinked contours; state activation выбирает latest по contour identity, не по nullable field ID.

V3 тоже не строго additive: меняются FK-семантика и существующие function bodies, ослабляется NOT NULL связи с полем, при непустой карте обновляются metadata rows/updated_at. В текущем Product geometries=0/imports=0, поэтому backfill обновит ноль строк. Если перед DDL это изменится — NO-GO до нового разбора, а не автоматическое принятие нового scope.

После полного пакета ожидаются 11 новых columns, пять новых indexes, четыре новых CHECK, один warehouse trigger и десять функций указанного пакета (warehouse trigger function + reorder и восемь map RPC). Trigger function не является пользовательским RPC. Карта остаётся с RLS; anon/authenticated не получают map RPC EXECUTE или CRUD writes. Шестая миграция зависит от третьей и пятой, но не от выполнения какого-либо импорта.

## Product: свежая физическая проверка

- `/api/healthz` в 02:50:43 UTC: `ok=true`, `environment=production`, commit `4bae7d9ab258`, deployment `agri-manager-idxkgos0u-travkin-ais-projects.vercel.app`.
- Все девять необходимых public/storage relations присутствуют, RLS включён. Все проверенные constraints validated. Старые типы columns для warehouses, shifts, profiles, fields, imports, geometries и storage bucket соответствуют используемому SQL.
- Все 11 новых columns отсутствуют. Все десять function names пакета, пять index names, четыре CHECK names и warehouse trigger name свободны.
- `field_geometries.field_id` сейчас UUID NOT NULL; constraint точно называется `field_geometries_field_id_fkey`, validated, `ON DELETE CASCADE`. Остальные FK (company/import/profile) присутствуют. Это соответствует exact DROP/ADD шестого файла.
- Существующий unique partial `(company_id,field_id) WHERE is_active=true` сохранится; NULL field links не схлопываются этим индексом. Новые unique `(company_id,contour_id,contour_version)` и active `(company_id,contour_id)` добавляются отдельно.
- Geometry update trigger `trg_field_geometries_updated_at` активен. Отсюда необходимость учитывать изменение updated_at при metadata backfill, если карта станет непустой.
- Карта глобально пустая: imports=0, geometries=0, повторно проверено в 02:52 UTC. `profile-media` bucket отсутствует, его objects=0; storage.objects policies=0.
- Browser roles сейчас имеют map CRUD grants; migration №3 их явно отзывает. У anon/authenticated нет membership в дополнительных ролях. Service-role bypass RLS и CRUD присутствуют. Набор включает ожидаемые шесть legacy write policies; существующие director read-only restrictive policies не надо выдавать за новые grants.
- Историческое ACL замечание сохраняется: TRUNCATE/REFERENCES/TRIGGER grants есть; пакет снимает INSERT/UPDATE/DELETE, а не все мыслимые SQL privileges. Опасных privilege PoC не выполнялось.
- Размеры: warehouses 172 032 bytes / 19 rows; shifts 65 536 bytes / 4 rows, из них 3 closed; geometry table 49 152 bytes / 0 rows. Все CREATE INDEX обычные, не CONCURRENTLY. DDL/validation/FK берут блокировки даже на маленьких таблицах; размер не гарантирует нулевую задержку.
- В 02:47 UTC waiting locks=0, other active client backends=0, long transactions (>30s)=0. Повтор в 02:52 UTC: waiting=0, long=0. Это мгновенные наблюдения, не гарантия отсутствия работы сотрудников перед релизом.

## Обновлённая контрольная точка бизнес-данных

02:50:37 UTC: повторно выполнен исходный `migrations-data-fingerprints.readonly.sql`. Представление прежнее: MD5 отсортированных полных JSONB rows; исключаются только будущие `warehouses.display_order`, `profiles.avatar_path/avatar_updated_at`. Ниже глобальные row counts и full-row MD5. STEM company: `10000000-0000-0000-0000-000000000001`.

| Таблица | Rows | Full rows MD5 |
|---|---:|---|
| crop_structure | 129 | `33434a54df2f4503f69fe60b26152545` |
| field_geometries | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| field_map_imports | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| fields | 100 | `19cdc84c620bd9b87334170a02c30fc5` |
| harvest_lots | 3 | `477e431053b4244d82c72b2eabe3870d` |
| inventory_batches | 269 | `209e0dc6db1bf8cf59e31719817a6fc9` |
| profiles | 18 | `3df89584707796fa6d9a11c4a9b8767a` |
| ptc_combine_operator_status_events | 2 | `5a8609d39aed96d4359110844639da01` |
| ptc_combine_operator_statuses | 1 | `221c896d8b1791509937caf46f5ed7ca` |
| ptc_combine_shift_events | 7 | `eaa502c45edc03b5587fcd6d0f6d6328` |
| ptc_combine_shifts | 4 | `4517ae428fea4fbd80e489bb69305462` |
| ptc_events | 941 | `2ae02f3b9154d9e855bb3eba33213b69` |
| ptc_flows | 1 | `f5bc388f84c93f82dd6362e16c060e71` |
| ptc_vehicle_states | 23 | `cdf42fe6e65e860e931991bf1a618742` |
| stock_ledger_entries | 389 | `cac07ded7fc788971ffbb16ea39f1a83` |
| ticket_lines | 387 | `decb16368b8158682637a8be9381e4be` |
| tickets | 342 | `7e37fb14222ae41661edae0be65c3b92` |
| warehouses | 19 | `64083fa0ab74fcf1087d11f94cc0df93` |

14 из 18 fingerprints совпали с 2026-09-09 18:03:06 UTC. Изменились четыре PTC таблицы. Отдельная проверка 02:52:11 UTC установила: старые 908 ptc_events целиком сохраняют прежний MD5 `5cc1bea90e7bf76364996b8a81f2df52`; добавлены 33 события, последнее 02:47:06 UTC. Старые 5 shift_events сохраняют MD5 `4899bb88ec4b3e8d0abf3218a69af562`; добавлены 2. Создана одна смена, две строки shifts имеют updated_at после старой точки. Это подтверждённый дрейф между снимками до DDL, а не изменение миграцией. Полная атрибуция пользовательских действий и семантический аудит всех PTC transitions не входят в этот preflight.

STEM талоны 341/строки 386; finalized nonvoid 326, open 0. Суммы ledger signed delta и batches current weight обе 1 850 710 kg; STEM fields 99 / 20 500 ha; crop_structure 127. Их fingerprints совпали с предыдущим снимком. Равенство общих ledger/batch сумм — checksum всех продуктов, не новая бумажная сверка картофеля.

Нужна новая baseline непосредственно перед каждым релизным окном и после пакета. При продолжающейся работе PTC нельзя требовать совпадения устаревших hashes или автоматически приписывать изменения DDL. Пакет не вызывает ticket/ledger/batch/PTC business functions. После DDL карта должна оставаться 0/0 до отдельного разрешённого Product import; QA expansion не является Product-операцией.

## Legacy compatibility и обязательный rollback gate

Исходники старого `4bae7d9ab2583d635d4c21b22c330ee763bd75e2` проверены независимо. Пути ниже — repo-relative в этом commit, не строки нового кода.

- `lib/fields-map/server.ts:22–38` берёт service client, не читает boundary flag; `access.ts:12–17` допускает legacy write roles. `FIELD_BOUNDARY_WRITE_V1=0` на таком deployment не блокирует его import APIs.
- `app/api/fields-map/import/confirm/route.ts:135–167`: отдельный UPDATE деактивирует геометрию до INSERT. Старый INSERT не передаёт `source_geometry_geojson`, который v3 делает NOT NULL без DEFAULT. INSERT может упасть после уже зафиксированной деактивации; SQL wrappers этот direct-DML путь не перехватывают.
- `app/api/fields-map/imports/[id]/route.ts:26–62`: old activation сначала выключает геометрии, а latestByField пропускает NULL field_id. После появления unlinked contours такой путь оставит их неактивными. PATCH:124–156 и DELETE:165–174 не используют новые CAS RPC.
- `app/api/fields-map/import/preview/route.ts:227–243` напрямую создаёт draft и тоже не становится flags-off от новых env.
- Old bootstrap формирует только field cards: `bootstrap/route.ts:125–127,160–163`. Независимые контуры в старом UI не видны даже без записей; данные не исчезают лишь от чтения.

В новом коде d7bbedb/ebfd12f все пять boundary/import mutation entrypoints проходят `mutation:true` и server flag до service client: preview:105, confirm:86, imports PATCH:30/DELETE:79, boundaries mutate:40. Новый bootstrap читает legacy geometry при строго распознанном отсутствии v3 и выставляет `contour_editing_available=false`; auth/network ошибки не скрываются. Новый client требует exact true плюс роль и UI flag.

Для промежуточного v1/v2 RPC-клиента wrappers сохраняют full geometry/source и не схлопывают NULL links. Старые preview/revision после изменения snapshot устаревают, нужен новый preview. Old undo после unlink с прежним geometry ID получает CAS conflict — ожидаемое fail-closed поведение. Эти сценарии проверены PGlite локально (26 сценариев), bootstrap — actual-handler harness (9), mutation/editor — 22. Это не удалённые Product write tests.

**Безопасный порядок:** сначала подготовить и проверить immutable совместимый read/flags-off deployment; затем ROOT применяет точный reviewed schema package с writes выключенными; проверить postflight/роль/новую схему; только затем включать boundary writes и запускать разрешённый импорт. При app regression сохранить совместимые map APIs, данные и schema, выключить server flag. Не откатывать весь сервер на 4bae7d9 после v3 без отдельной реально действующей блокировки старых map-write endpoints. Одной договорённости «не нажимать» недостаточно для технической гарантии.

`FIELD_BOUNDARY_WRITE_V1` не является общим запретом всех записей карты: engineering-object APIs используют отдельное `write:true` и остаются под своими role gates как в старом, так и в новом коде. При планировании полного read-only rollback это отдельный scope. Server flags аватаров/warehouse order тоже не заменяют проверенный backend anchor; NEXT_PUBLIC flags уже выданного JS меняются только новым build/refresh.

## Перед применением / после каждого файла

Немедленно обновить project/health, history+physical absence, source hashes, bucket absence, 0/0 map rows, baseline и locks. При mismatch или неизвестном ответе executor сначала readback, не повтор DDL вслепую. Пять файлов содержат BEGIN/COMMIT; PTC index-only — обычный DDL. Не объединять их искусственно и не модифицировать approved payload ради IF EXISTS. Если executor поддерживает connection-local lock/statement timeouts, задать короткое ограниченное окно штатным способом.

После каждого успеха проверить history/object/ACL. После шестого — новые 8 geometry columns/constraints/indexes, field FK SET NULL, exact v3 function bodies и legacy wrappers, отсутствие broad EXECUTE, SELECT/RLS и отзыв browser I/U/D, приватный bucket, отсутствие бизнес-дрейфа с учётом событий сотрудников. Старый `migrations-postflight.readonly.sql` охватывает только пять файлов: для v3 требуется расширенный catalog postflight, а не отчёт о его покрытии старым скриптом.

Destructive schema rollback не нужен: не удалять source/history columns, не возвращать field_id NOT NULL после появления unlinked contours и не восстанавливать CASCADE, способный удалить геометрию вместе с полем. Включение Product import, даже при уже завершённом QA expansion 18→130, остаётся отдельной явной операцией ROOT.

Supabase skills повлияли на read-only проверку: повторно проверены changelog, точные grants/inheritance/RLS, SECURITY DEFINER границы, отсутствие новых объектов и короткие lock windows. Релевантных изменений платформы для этого пакета в просмотренном changelog не обнаружено. Не выполнялись migration CLI, apply_migration, бизнес-RPC, auth/session изменения или QA expansion.
