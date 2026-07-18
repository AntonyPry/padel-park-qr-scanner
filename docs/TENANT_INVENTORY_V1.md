# Tenant inventory v1

Статус: `accepted for implementation planning — QA green`

QA result: `ready for SaaS integration`; P0–P3 findings отсутствуют.

Дата: 2026-07-14

Ревизия: `1.3 — fresh install and Account writer contract`

Архитектурное решение: [`MULTI_TENANCY_ARCHITECTURE_V1.md`](./MULTI_TENANCY_ARCHITECTURE_V1.md)

## 1. Метод и обозначения

Inventory сопоставлен с фактическим состоянием `origin/main` на commit `822db9c`: 67 Sequelize models, 67 `createTable` migrations, 30 route files, 29 controllers, 36 logical services, 3 seeders и оба поколения transcription worker. `SequelizeMeta` учтен отдельно как global platform table. Runtime multi-tenancy в этом срезе не реализуется.

Классы scope:

- **G** — global platform data;
- **O** — organization-scoped;
- **C** — club-scoped;
- **M** — membership/access;
- **D** — derived/cache/audit, которому нужен immutable tenant snapshot или безопасный parent path;
- **Q** — отдельное бизнес-решение обязательно до enforcement.

Правила выбора ключа:

- прямой `organizationId`/`clubId` нужен на aggregate root, ingress record, очереди, polymorphic audit и объекте, который может жить без tenant-scoped parent;
- child с обязательным parent получает tenant через parent, без дублирования ID; сервис обязан проверять, что все дополнительные parents принадлежат тому же tenant;
- денормализованный tenant ID допустим только для производительности/partitioning с FK-like validation и consistency audit;
- tenant-aware index начинается с `organizationId` или `clubId`, если запрос сначала выбирает tenant;
- `Account.email` остается global unique. Business natural keys перестают быть global unique.

Колонка «Backfill» обозначает волну из ADR: `1 identity`, `2 org roots`, `3 club roots`, `4 operational roots`, `5 children/history`, `6 audit/infrastructure`.

Foundation decision для будущих таблиц зафиксирован однозначно: `MembershipClubAccess(organizationId, membershipId, clubId)` имеет composite FK к `Membership(organizationId,id)` и `Club(organizationId,id)`. Оба parent composite keys unique; access имеет PK `(membershipId,clubId)` и tenant-leading indexes. `Membership.staffId` в Feature 2 не создается: сначала в Feature 5 Staff/access wave backfill-ится `Staff.organizationId`, затем добавляется composite Membership→Staff FK. Полный DDL contract, active-chain и rollback preflight находятся в ADR.

Feature 2 также содержит mandatory compatibility lifecycle bridge: Account остается read/auth source, но create/update/archive/restore/permanent-delete атомарно поддерживают default Membership/access parity. Existing permanent-delete product contract сохраняется; hard delete удаляет access → membership → Account в одной transaction после текущих dependency/self checks.

Fresh install формально допускает `Accounts = Memberships = MembershipClubAccesses = 0` при уже существующих exact default Organization/Club. Это bootstrap-pending, а не owner-invariant failure: разрешены только health/auth-status/bootstrap, business routes/bots/runners/ingress закрыты. Bootstrap под Organization lock одной transaction создает Staff+Account+owner Membership; partial empty state invalid. После commit включается strict parity/active-owner assertion.

## 2. Identity, membership и organization dictionaries

| Model / table | Scope | Текущий owner и связи | Целевой tenant key / можно ли вывести | Tenant-aware unique/index | Isolation risk | Backfill |
| --- | --- | --- | --- | --- | --- | --- |
| `Account` / `Accounts` | G + access bridge | Login identity; global `role`, optional `staffId`; auth/JWT owner сейчас сам Account | Feature 2 reads/auth остаются Account-based. Create/role/status/archive/restore/delete и mixed updates идут через full bridge с Organization lock; allowlisted `lastLoginAt/email/passwordHash/staffId` — через metadata writer без org lock | `email` global unique; Membership `(organizationId,accountId)` unique; lifecycle transaction сохраняет role/status parity; direct-write audit закрывает обход | **P0:** direct/bulk Account mutation вне writers создает divergence и ломает startup/rollback | Accounts=0 → bootstrap-pending; иначе continuous parity: Membership на каждый Account, non-owner один parity access, owner access отсутствует |
| `User` / `Users` | O | CRM-клиент; parent для visits, bookings, prepayments, calls, skill map; merge chain `mergedIntoUserId` | Прямой `organizationId`; club нельзя вывести: клиент может посещать несколько clubs | `(organizationId, telegramId/vkId/webId)` unique where non-null; tenant-leading phone/name/status/source/merge indexes | **P0:** поиск/merge/bot registration смешивает клиентов организаций | 2: все roots → Padel Park org; затем проверить merge/source parents |
| `Staff` / `Staffs` | O | Сотрудник, trainer/account link, shifts/bookings/finance | Прямой `organizationId`; club access — MembershipClubAccess, не Staff. Feature 5: Staff org backfill first, затем nullable Membership.staffId composite FK | unique `(organizationId, id)` для composite FK; `(organizationId, status)`, `(organizationId, name)`; Membership unique `(organizationId,staffId)` with nullable staffId | **P0:** staff/account link и списки сотрудников глобальны | 2 в Feature 5: default org → validate Account.staffId → add composite link; не входит в Feature 2 |
| `ClientSource` / `ClientSources` | O | Справочник источников для User/registration | Прямой `organizationId` | unique `(organizationId, name)`; tenant + active/sort | **P1:** bot/UI может переиспользовать источник чужой организации | 2: dictionary before User FK validation |
| `VisitCategory` / `VisitCategories` | O | Справочник аналитических категорий; assignments привязаны к Visit | Прямой `organizationId` | unique `(organizationId, name)`; tenant + active/sort | **P1:** одинаковые названия конфликтуют, аналитика смешивается | 2 |
| `Category` / `Categories` | O | Финансовая/мотивационная категория; hierarchy + bonus rules | Прямой `organizationId`; parent обязан быть в той же org | unique `(organizationId, name)` вместо global name; tenant + parent/sort/status | **P1:** чужая иерархия/правило может попасть в расчет | 2: parents before children, orphan/cycle audit |
| `MotivationRule` / `MotivationRules` | O | Именованное правило мотивации, используется расчетами | Прямой `organizationId` | unique `(organizationId, key)`; tenant + active | **P1:** одноименный key и глобальный расчет payroll | 2 |
| `MotivationBonusRule` / `MotivationBonusRules` | O | Набор условий/бонусов организации | Прямой `organizationId` | tenant + active/priority/date interval | **P1:** rules применятся к сотрудникам другой org | 2 |
| `MotivationBonusRuleCategory` / `MotivationBonusRuleCategories` | O via parents | Join bonus rule ↔ category | Не дублировать; вывести через rule/category, обязательна same-org проверка | Текущий category uniqueness/pair сохраняется в parent scope; индексы по обоим FK | Cross-org join обходит isolation двух parent tables | 5: после обоих parents; quarantine mismatches |
| `TrainingSkill` / `TrainingSkills` | O | Методология навыков; parent для client/exercise skill maps | Прямой `organizationId` | unique `(organizationId, name)`; tenant + status/direction/sort | **P1:** методология и client skill map организаций смешиваются | 2 |
| `TrainingExercise` / `TrainingExercises` | O | Библиотека упражнений; optional main skill | Прямой `organizationId`; main skill same-org | tenant + status/category/mainSkillId/name | Чужое упражнение может быть назначено в план | 2: skills before exercises |
| `TrainingExerciseSkill` / `TrainingExerciseSkills` | O via parents | Join exercise ↔ skill | Не дублировать; оба parents same-org | unique `(trainingExerciseId, trainingSkillId)` сохраняется; parent indexes | Cross-org join раскрывает методологию | 5 |
| `ClientTrainingSkill` / `ClientTrainingSkills` | O via parents | Current skill level User ↔ TrainingSkill | Не дублировать; User и Skill same-org | unique `(userId, trainingSkillId)` сохраняется; индексы user/skill/status | Чужой skill может быть привязан к client | 5 |
| `ClientTrainingSkillHistory` / `ClientTrainingSkillHistories` | D/O | История skill change, с user/skill/actor/booking/note provenance | Выводить через client skill/User; optional `originClubId` только как provenance | tenant-leading history index при денормализации; иначе parent + changedAt | История/actor может сослаться на другой tenant; audit без snapshot слаб | 5: после current map; validate all provenance links |
| `ShiftReportTemplate` / `ShiftReportTemplates` | O | Шаблон отчетов смен; используется всеми club shifts | Прямой `organizationId`; будущий optional club override отдельным механизмом | tenant + status/sort; tenant-scoped name/version if added | Глобальная публикация шаблона всем организациям | 2 |
| `ShiftReportTemplateItem` / `ShiftReportTemplateItems` | O via parent | Пункты template | Через обязательный template, не дублировать | unique/order constraint в template scope; index template + sort | Чужой template item можно подставить без parent guard | 5 |
| `SubscriptionType` / `SubscriptionTypes` | O + Q | Тип/условия клубного абонемента, parent ClientSubscription | Предпочтительно `organizationId` для общего product definition; club price/availability требует отдельной offering-модели или club scope decision | unique `(organizationId, name)`; pricing indexes после решения | Одинаковые типы конфликтуют; цена может ошибочно стать общей для clubs | 2, но enforcement после решения offering/pricing |
| `CorporateClient` / `CorporateClients` | O | Корпоративный контрагент, parent ledger | Прямой `organizationId` | tenant + status/name/external key | Общий баланс/контакты видны другой организации | 2 |
| `PayrollPeriod` / `PayrollPeriods` | O + Q | Расчетный период мотивации сотрудников | Предпочтительно `organizationId`; club breakdown хранить в result lines/filters | unique `(organizationId, fromDate, toDate)`; tenant + status | **P1:** global period смешивает payroll clubs/orgs | 2; enforcement после решения consolidation |

## 3. CRM, visits и call tasks

| Model / table | Scope | Текущий owner и связи | Целевой tenant key / можно ли вывести | Tenant-aware unique/index | Isolation risk | Backfill |
| --- | --- | --- | --- | --- | --- | --- |
| `ClientSavedView` / `ClientSavedViews` | M/C | Saved filter принадлежит global Account | Прямые `membershipId` и `clubId`; Account недостаточен | unique `(membershipId, clubId, name)` вместо `(accountId, name)` | Cached/filter definition другого membership/club | 4: Account→Membership + default club |
| `ClientBase` / `ClientBases` | C | Сегмент/база клиентов; owner Account; parent CallTask | Прямой `clubId`: filter snapshot и recurring runner являются club operation | tenant + status/origin/recurring/nextRun; name scoped if constrained | **P0:** recurring base обзвонит клиентов всех clubs | 4 |
| `CallTask` / `CallTasks` | C | Задача обзвона; optional ClientBase, assignee Account | Прямой `clubId`, потому что base может быть null | tenant + status/assignee/dueAt/base | **P0:** queue и assignee видят/меняют чужие задачи | 4: base first where present |
| `CallTaskClient` / `CallTaskClients` | C via task | Join task ↔ User с состоянием | Через CallTask; User.organization must match task.club.organization | unique `(callTaskId, userId)` остается; task/status indexes | Cross-org client inclusion и раскрытие телефона | 5 |
| `CallTaskAttempt` / `CallTaskAttempts` | C via task client | История попыток/результатов | Через CallTaskClient→CallTask; не дублировать | parent + attemptedAt/result indexes | История звонка другого club доступна по ID | 5 |
| `Visit` / `Visits` | C | Факт визита User; scanner/client event source | Прямой `clubId`: User organization не определяет посещенный club | unique `(clubId, clientEventId)` instead of global; tenant + visitedAt/user/status | **P0:** посещения и аналитика сразу смешиваются | 3: User org first, then default club |
| `VisitCategoryAssignment` / `VisitCategoryAssignments` | C via visit | Join Visit ↔ org VisitCategory | Через Visit; category organization must equal visit club organization | pair/PK сохраняется; visit/category indexes | Cross-org category раскрывает/портит analytics | 5 |
| `ScannerEvent` / `ScannerEvents` | D/C | Raw/diagnostic scanner event, Visit может отсутствовать | Прямой immutable `organizationId`,`clubId`; actor/account дополнительно | tenant + createdAt/type/status/device; event id scoped | **P1:** сырые payloads и ошибки чужого клуба в audit UI | 6: derive from Visit when present, default club otherwise |

## 4. Booking и training operations

| Model / table | Scope | Текущий owner и связи | Целевой tenant key / можно ли вывести | Tenant-aware unique/index | Isolation risk | Backfill |
| --- | --- | --- | --- | --- | --- | --- |
| `Court` / `Courts` | C | Площадка; parent bookings/blocks/series | Прямой `clubId` | unique `(clubId, name)`; tenant + status/sort | **P0:** расписание разных clubs объединяется | 3 |
| `BookingSettings` / `BookingSettings` | C | Фактически global singleton настроек | Прямой `clubId`, одна строка на club | unique `(clubId)` | **P0:** изменение настроек влияет на все clubs | 3: singleton → default club |
| `BookingPriceRule` / `BookingPriceRules` | C | Правила цены по времени/дню/условию | Прямой `clubId` | tenant + active/type/priority/time window; scoped natural name/key | Чужая цена применяется к booking | 3 |
| `BookingScheduleException` / `BookingScheduleExceptions` | C | Исключение расписания по date | Прямой `clubId` | unique `(clubId, date)` вместо global date | Второй club не может задать свою дату/часы | 3 |
| `CourtBlock` / `CourtBlocks` | C via court | Блокировка Court с actor Account | Через Court; прямой clubId не нужен | court + startsAt/endsAt/status indexes | Lookup by id без scoped parent блокирует чужой court | 5 |
| `BookingSeries` / `BookingSeries` | C | Recurring booking root, Court/User/creator | Прямой `clubId`; Court same-club, User same-org | tenant + status/next occurrence/court/user | Generator создаст booking в чужом club | 4: court/user first |
| `Booking` / `Bookings` | C | Бронирование Court/User/trainer/series | Прямой `clubId` как hot aggregate root; validate Court/series same club, clients/staff same org/access | tenant + court/startsAt; tenant + user/startsAt; tenant + status/startsAt; external key scoped if introduced | **P0:** calendar, mutation by id, exports and revenue mix | 3: courts/org identities first |
| `BookingParticipant` / `BookingParticipants` | C via booking | Join Booking ↔ User | Через Booking; User same organization | unique `(bookingId, userId)` сохраняется; parent indexes | Cross-org participant exposes client | 5 |
| `BookingChangeLog` / `BookingChangeLogs` | D/C | Immutable change history Booking + actor | Через Booking; рекомендуется immutable org/club snapshot для retained audit | tenant + bookingId/createdAt/action when denormalized | После move/delete parent audit теряет isolation context | 6 |
| `TrainingNote` / `TrainingNotes` | C | Тренерская заметка User/trainer/Booking | Прямой `clubId`: booking может отсутствовать | tenant + user/date; trainer/date; booking | Медицинские/тренировочные сведения другого club | 4 |
| `TrainingNoteExercise` / `TrainingNoteExercises` | C via note | Note ↔ organization exercise | Через TrainingNote; exercise organization must match club organization | pair/order indexes in note scope | Cross-org exercise content leak | 5 |
| `TrainingPlan` / `TrainingPlans` | C | План тренировки; booking optional, trainer/creator | Прямой `clubId`; Booking if present same club | `bookingId` unique remains parent-scoped; tenant + status/date/trainer | Nullable booking иначе не дает tenant; plans смешиваются | 4 |
| `TrainingPlanExercise` / `TrainingPlanExercises` | C via plan | Ordered exercise in plan | Через TrainingPlan; exercise same organization | plan + order; pair if constrained | Cross-org content injection | 5 |
| `TrainingPlanParticipant` / `TrainingPlanParticipants` | C via plan | Plan ↔ User participant | Через TrainingPlan; User same organization | unique `(trainingPlanId, userId)` сохраняется | Чужой client в плане | 5 |

## 5. Shifts, files и operational reports

| Model / table | Scope | Текущий owner и связи | Целевой tenant key / можно ли вывести | Tenant-aware unique/index | Isolation risk | Backfill |
| --- | --- | --- | --- | --- | --- | --- |
| `Shift` / `Shifts` | C | Смена Staff, open/close actor Accounts | Прямой `clubId`; Staff same org, membership must access club | tenant + status/date/staff; только одна open shift rule scoped per club | **P0:** активная смена/касса и управление смешиваются | 3 |
| `ShiftReport` / `ShiftReports` | C via shift | Отчет Shift + Template + Account | Через Shift; Template same organization | unique `(shiftId, templateId, scheduledSlotKey)` сохраняется; parent/status indexes | Lookup/download by global id раскрывает отчет | 5 |
| `ShiftReportAnswer` / `ShiftReportAnswers` | C via report | Ответ + attachment JSON metadata | Через ShiftReport; tenant в физическом storage path обязателен | report/item index; attachment ID unique only in tenant path | **P0:** файлы лежат по `<reportId>` и auth не имеет tenant boundary | 5 data, 6 file copy/verify |

## 6. CRM finance, Evotor и prepayments

| Model / table | Scope | Текущий owner и связи | Целевой tenant key / можно ли вывести | Tenant-aware unique/index | Isolation risk | Backfill |
| --- | --- | --- | --- | --- | --- | --- |
| `Finance` / `Finances` | C | Ручная/derived операция P&L, Staff/Booking/source refs | Прямой `clubId`; organization consolidation — read model, не отсутствие scope | tenant + date/isTraining/type/status; tenant + staff/booking | **P0:** P&L/export суммирует clubs/orgs | 3 |
| `FinanceChangeLog` / `FinanceChangeLogs` | D/C | Polymorphic-ish finance audit/change payload + actor | Прямые immutable `organizationId`,`clubId` (nullable only for genuine platform event) | tenant + entityType/entityId/createdAt/action | **P1:** payload/actor не восстанавливает tenant надежно | 6: derive from Finance/related entity, exception report |
| `Receipt` / `Receipts` | C | Evotor receipt root; items/pending sales | Прямой `clubId`, resolved from integration connection before insert | unique `(clubId, evotorId)` вместо global; tenant + dateTime/type/status | **P0:** webhook idempotency/finance import смешивает кассы | 3 |
| `ReceiptItem` / `ReceiptItems` | C via receipt | Позиция receipt | Через Receipt, не дублировать | receipt + item/product indexes | ID lookup может раскрыть чек другого club | 5 |
| `CatalogRule` / `CatalogRules` | C | Маппинг строкового item name на CRM action/category | Прямой `clubId`: parent отсутствует | unique `(clubId, itemName)`; tenant + active/action | Чужое правило создает неверную продажу/финансы | 3 |
| `EvotorSaleSetting` / `EvotorSaleSettings` | C | Sale automation по Evotor itemName | Прямой `clubId`, integration connection same club | unique `(clubId, itemName)`; tenant + active/type | **P0:** item одинакового имени маршрутизируется в чужой club | 3 |
| `PendingSale` / `PendingSales` | C via receipt | Queue item из ReceiptItem, User/type/certificate/subscription refs | Выводить через обязательный ReceiptItem→Receipt; optional denormalized clubId допустим для queue index с consistency guard | `receiptItemId` unique сохраняется; tenant/parent + status/createdAt queue index | Worker/manager queue без parent join смешивает продажи | 5 |
| `PendingSaleHistory` / `PendingSaleHistories` | D/C | State-change history PendingSale + actor | Через PendingSale; immutable tenant snapshot рекомендуется для retention | tenant + pendingSaleId/createdAt if denormalized | История видна по global ID | 6 |
| `ClientSubscription` / `ClientSubscriptions` | Q | Баланс абонемента User + SubscriptionType + source Receipt/PendingSale | Минимум `organizationId` + `originClubId`; либо direct `clubId`, если redemption строго local. Решить portability до Feature 7 | sourceReceiptItem/pendingSale uniques остаются parent-scoped; tenant + status/startsAt/expiresAt/user | **P0:** liability и списание могут уйти в другой club | 5 after explicit liability decision |
| `ClientSubscriptionRedemption` / `ClientSubscriptionRedemptions` | Q/C | Списание subscription по Visit/Booking/actor | Прямой `redemptionClubId`: parent balance не доказывает место услуги | tenant + subscription/date; unique source event scoped | Cross-club списание без settlement trail | 5 after decision |
| `Certificate` / `Certificates` | Q | Денежный/услуговый сертификат User, source sale/receipt | `organizationId` + `originClubId`; code scope depends on org-wide redemption decision | unique `(organizationId, code)` if portable, else `(clubId, code)`; tenant + status/expiry | **P0:** двойное погашение или чужая liability | 5 after decision |
| `CertificateRedemption` / `CertificateRedemptions` | Q/C | Погашение certificate, возможно связано с booking/visit | Прямой `redemptionClubId`, проверка same organization | tenant + certificate/date; idempotency source scoped | Cross-club service без учета origin liability | 5 after decision |
| `CorporateLedgerEntry` / `CorporateLedgerEntries` | Q/C | Ledger CorporateClient; optional Finance/actor; deposit/write-off/service | Прямой `organizationId`,`clubId` для transaction; CorporateClient same org. Нужна policy общей credit line | tenant + corporateClient/date/status/type; Finance same club | **P0:** общий корпоративный баланс и P&L смешиваются | 4/5 after balance decision |

## 7. Telephony, transcription и utilization

| Model / table | Scope | Текущий owner и связи | Целевой tenant key / можно ли вывести | Tenant-aware unique/index | Isolation risk | Backfill |
| --- | --- | --- | --- | --- | --- | --- |
| `TelephonyCall` / `TelephonyCalls` | C | Beeline call root; User/Account/task links; recording/transcript state | Прямой `clubId`, resolved from Beeline connection before idempotency | добавить `clubId` ко всем provider external IDs: externalCallId, trackingId, recordId, recordExternalId, phone+startedAt; tenant + status/time/user | **P0:** одинаковые provider IDs/phones объединяют calls clubs | 3 |
| `TelephonyRawEvent` / `TelephonyRawEvents` | D/C | Webhook/raw Beeline event до наличия call | Прямой immutable `organizationId`,`clubId`; connection is authority | unique `(clubId, provider, externalEventId)`; tenant + receivedAt/status | **P0:** ingress нельзя безопасно записать/переиграть | 6, connection mapping first |
| `TelephonySubscription` / `TelephonySubscriptions` | C | Beeline XSI subscription lifecycle | Прямой `clubId` | unique `(clubId, provider, subscriptionId)`; tenant + status/expiresAt | Одна global subscription/config обслуживает все clubs | 3 |
| `TelephonyTranscriptionJob` / `TelephonyTranscriptionJobs` | D/C | Queue job → TelephonyCall; lease/progress/retry/worker | Прямой immutable `clubId` рекомендуется для atomic claim/partition; validate Call | tenant + status/availableAt/lease; tenant + call; idempotency parent-scoped | **P1:** global worker token/claim возвращает чужие recordings | 4/6 |
| `TelephonyTranscriptSegment` / `TelephonyTranscriptSegments` | C via job/call | Segment text + timing/speaker, job/call parent | Через Job/Call; оба обязаны иметь один club | unique/order within call/job; parent + segment index | Transcript is sensitive; direct ID lookup leaks content | 5 |
| `Utilizations` / `Utilizations` | C | Daily calculated utilization row; current date is identifier | Прямой `clubId` | primary/unique `(clubId, date)` вместо date-only; tenant + date | Второй club перезаписывает utilization первого | 3: all dates → default club |

## 8. Audit и onboarding

| Model / table | Scope | Текущий owner и связи | Целевой tenant key / можно ли вывести | Tenant-aware unique/index | Isolation risk | Backfill |
| --- | --- | --- | --- | --- | --- | --- |
| `AuditLog` / `AuditLogs` | D | Generic entity/action payload + Account; entity polymorphic | Прямой immutable `organizationId`; nullable `clubId` только как exact provenance club-scoped request; `accountId` + `role` остаются actor/effective-role snapshot, `membershipId` не хранится | organization + createdAt; organization + entityType/entityId; organization + action/account; club FK support | **P1:** global list/count смешивает Organizations; ORM/raw/bulk mutation меняет историю; удаление Account не должно стирать actor id | 8.2: organization-scoped boundary, fresh Membership/effective role, immutable DB triggers, direct-write AST audit |
| `OnboardingProgress` / `OnboardingProgresses` | M | Progress keyed global Account + role + taskKey | Прямой `membershipId`; catalog task global; action checkpoint additionally stores club provenance | unique `(membershipId, role, taskKey)` вместо account tuple; membership + status/update | **P0:** shared account progress/cleanup пересекает organizations | 6: account → membership; current role preserved |
| `OnboardingTrainingMode` / `OnboardingTrainingModes` | M/C | Одна training session на global Account, selected role, cleanup metadata | Прямой `membershipId`,`clubId`; training artifacts tagged with session+tenant | unique `(membershipId)` или explicit one-session policy; tenant + expiry/status | **P0:** cleanup может удалить production/чужие tenant data | 6: existing session → default membership/club; verify cleanup ownership |
| `OnboardingEvent` / `OnboardingEvents` | D/M | Client/review checkpoint event, Account/role/task/payload | Прямой immutable org/club/membership context; event may have no business parent | tenant + account/taskKey/event/createdAt; idempotency includes membership/club | Events могут завершить lesson в другой организации | 6 |

## 9. Не-БД поверхности

| Surface | Найденное текущее состояние | Required tenant control | Риск |
| --- | --- | --- | --- |
| HTTP routes/controllers/services | 30 route files, 29 controllers, 36 logical services; большинство `findByPk/findAll` без scope; raw SQL в `clients.service.js`, `telephony.service.js`, `visits-analytics.service.js` | Authenticated resolver создает `TenantContext`; endpoint декларирует G/O/C/M; service принимает context обязательным параметром; lookup всегда `id + tenant`; raw SQL начинает CTE/root predicates с tenant | **P0** cross-tenant reads/writes/IDOR и смешанные exports |
| Auth / roles / permissions | JWT содержит `accountId/role/staffId`; bootstrap напрямую создает Staff/Account; login напрямую пишет lastLoginAt; `requireRole` global | Feature 2: pending allowlist только health/status/bootstrap; concurrent bootstrap serializes on Organization; Account auth/read unchanged; login uses metadata writer; parity mutations use full bridge; Feature 3 later switches resolver | **P0** partial bootstrap, double owner, direct mutation или преждевременный auth-source switch |
| Files/uploads | `server/var/shift-report-attachments/<reportId>/<uuid>`; JSON metadata на answer; download auth через report/role | Storage key `<org>/<club>/<domain>/<record>/<file>`; tenant from DB/context, never request path; signed/streamed download rechecks membership; dual-read during migration | **P0** attachment disclosure/overwrite |
| Exports | P&L/payroll XLSX, visits/source-quality XLSX, corporate ledger XLSX, shift attachment `sendFile` | Snapshot verified tenant context; filename/metadata declares org/club; row-count assertion; owner consolidated export explicit and read-only | **P0** bulk exfiltration has higher impact than single row |
| Socket.IO | Account/global role auth; rooms `crm:domain:<domain>`; payload lacks tenant | Rooms `org:<id>`, `club:<id>`, `membership:<id>`; tenant in signed server event envelope; join only after membership check; disconnect/rejoin on switch | **P1** fanout to same roles in other clubs |
| Server Redis cache | Prefix defaults `padel-crm`; keys `references:<type>:list`, `catalog:<scope>:list` | Key prefix contains deployment + organization + club/scope; invalidation publishes same tenant; global catalog explicitly marked G | **P1** cached reference/catalog leak |
| Frontend query keys | Domain-only TanStack Query keys for bookings, clients, telephony, finance, etc. | Every O/C key includes selected org/club; cancel and clear incompatible queries on switch; no stale placeholder from previous club | **P1** instant stale-data leak after switch |
| Onboarding catalog/checkpoints | Versioned catalog global; progress/training mode global account-based; allowlisted review-only client events | Catalog G; progress M; action events C/M; cleanup deletes only rows tagged by training session + tenant | **P0** destructive cleanup and false completion |
| Cron/background | `server/bot.js` starts global recurring call-task runner and Beeline subscription runner; global advisory lock | Feature 2 state gate blocks Telegram/VK bots, recurring tasks, Beeline runner, worker claim and webhook ingress in bootstrap-pending/invalid; later tenant cursor/locks include club | **P1** fresh install may process business traffic before initial owner or wrong-club work later |
| Evotor webhook | Public webhook before auth; optional one global secret; global `Receipt.evotorId`; string catalog rules | IntegrationConnection/API key resolves club before parsing/idempotency; secrets per connection; unique IDs include club; reject unknown connection | **P0** writes cannot be attributed safely |
| Beeline webhook/subscription | One env config/secret/subscription, webhook route before regular auth; global provider IDs and advisory lock | Per-club/organization connection identity; signed callback resolves connection; tenant-aware IDs, subscription and lock; replay retains tenant | **P0** calls/recordings mix |
| Telegram/VK bots | Global external IDs on User; global registration/source lookup; no club selection | BotConnection declares org/club or explicit safe organization routing; external ID unique in organization; consent/source policy decided; do not infer club from user input | **P0** client created/updated in wrong org |
| Transcription worker | Global `CRM_WORKER_TOKEN`, global claim queue; local SQLite/UI state and temp `crm-transcription-<callId>` lack tenant; ASR/LLM shared | Worker credential has tenant allowlist or platform worker scope; claim returns immutable tenant; recording/result URLs tenant authorized; temp/state/log keys include tenant; ASR/LLM receive only required content | **P1** recording/transcript disclosure and wrong job completion |
| Audit logs | Generic entity ID/payload, no immutable tenant | Store verified org/club/membership at write time; audit queries require scope; platform events explicit G; redact integration payload secrets | **P1** investigation/export cannot isolate tenant |
| Backups/restore | Documented DB dump/restore; local shift uploads and worker state outside DB not in backup contract | Manifest covers DB + object/files + connection metadata; encryption/access logs; restore into empty environment; tenant-selective restore either formally unsupported or remaps every FK/key | **P1** partial restore mixes IDs or loses files |
| Demo/training fixtures | `server/scripts/seed-demo-accounts.js` transactionally upserts Accounts; `demo-crm-data` up/down bulk-deletes/inserts Accounts; three seeders total | Both named paths require initialized state, one Organization-locked batch transaction and lifecycle-aware writes; deletes order access→membership→Account→Staff; down aborts if projected state loses last owner; no tenant provisioning seeder | **P1** current direct bulk writes break parity or remove the last owner |
| API/OpenAPI/generated client | Public order currently exposes health, OpenAPI, auth, webhooks and worker routes before general auth | Feature 2 bootstrap gate precedes all routers: only `/health`, `/auth/status`, `/auth/bootstrap` pass in pending; Feature 3 adds tenant headers for initialized M/O/C requests | Contract/order drift can expose business or ingress routes before bootstrap |

## 10. API/service coverage map

Все route/controller/service domains были сопоставлены с inventory:

| Domain/routes | Models and tenant root | Особая проверка |
| --- | --- | --- |
| `auth`, `accounts`, `access` | Account → Membership/ClubAccess, Staff | role source, `/auth/me`, membership switching, owner invariant |
| `clients`, `references`, `visits-analytics` | User/ClientSource/Visit/VisitCategory/Assignments/ScannerEvent | raw SQL tenant predicates, merge same-org, XLSX scope |
| `client-bases`, `call-tasks` | ClientBase/CallTask/clients/attempts | recurring runner and account assignee membership |
| `bookings`, booking rules, `utilization` | Club/Court/Booking family/Utilizations | calendar hot indexes and date singleton constraints |
| `training-notes`, `training-plans`, `training-methodology` | Training notes/plans/skills/exercises/client map | org library used only by club in same org |
| `finance`, `motivation`, dashboards | Finance/change log/Category/Motivation/Payroll/Receipt | consolidated reads explicit; P&L/payroll exports |
| `subscriptions`, `certificates`, `prepayments-dashboard` | Subscription/Certificate/PendingSale families | unresolved cross-club liability blocks enforcement |
| `corporate-clients` | CorporateClient/Ledger/Finance | balance and transaction club policy |
| `catalog`, `webhooks` | CatalogRule/Evotor settings/Receipt/PendingSale | connection-first tenant resolution and idempotency |
| `telephony`, worker routes | Telephony family | Beeline connection, recording authorization, queue claim |
| `staff`, `shifts`, `shift-reports` | Staff/Shift/report/templates/attachments | org employee vs club operation and storage path |
| `onboarding` | Catalog (G), Progress/Mode/Event (M/C) | session-tagged cleanup and checkpoint tenant |
| `audit` | AuditLog and domain histories | immutable tenant snapshot |

Routes `manager-control-dashboard` and all aggregate dashboards inherit the strictest scope of their source rows. An organization-wide dashboard is a deliberate aggregation over an explicit allowed club set, not an unscoped query.

## 11. Unique/index migration checklist

Before replacing constraints, run duplicate preflight grouped by target tenant. Critical changes:

1. Foundation: `Organizations.slug`; `Clubs(organizationId,slug)` and `(organizationId,id)`; `Memberships(organizationId,accountId)` and `(organizationId,id)`; access PK `(membershipId,clubId)`, indexes `(organizationId,membershipId)` / `(organizationId,clubId,status)`, composite FKs к обоим parents. Same-organization здесь DB-enforced, не эмулируется приложением.
2. Keep global: `Accounts.email`.
3. Organization composite: User external IDs, ClientSource/VisitCategory/Category names, MotivationRule key, TrainingSkill name, SubscriptionType name, PayrollPeriod dates.
4. Club composite: Court name, BookingScheduleException date, Receipt Evotor ID, CatalogRule/EvotorSaleSetting itemName, every Beeline external ID/subscription/event ID, Utilizations date.
5. Membership composite: progress `(membershipId, role, taskKey)`, training mode session policy, saved view `(membershipId, clubId, name)`.
6. Parent-scoped uniques stay parent-scoped: BookingParticipant, CallTaskClient, TrainingExerciseSkill, ClientTrainingSkill, TrainingPlanParticipant, ShiftReport scheduling key, PendingSale receipt item, receipt-derived subscription/certificate provenance.
7. Existing analytics indexes on Receipt, Finance, CorporateLedgerEntry, Booking, ClientSubscription and Certificate get tenant as leading column; otherwise isolation predicate causes table scans.
8. Cross-parent relations use composite FK where tenant is stored on both sides; where a child intentionally inherits scope through one parent, consistency audit and parent-scoped lookup remain mandatory before enforcement.

## 12. Backfill reconciliation gates

For default Padel Park organization/club each wave must record:

- source row count, updated row count, null tenant count;
- orphan parents and cross-parent tenant mismatches;
- duplicate groups that would violate future composite uniques;
- financial totals by month/type before and after;
- bookings/visits/calls/transcripts counts and min/max timestamps;
- attachment manifest count/hash and missing files;
- onboarding progress/training artifacts by account/role;
- audit rows whose tenant cannot be derived.

Feature 2 creates exact slugs `padel-park` / `padel-park`. При Accounts=0 migration успешно оставляет Membership/access пустыми и классифицирует state как bootstrap-pending. При Accounts>0 Membership role/status mirrors every Account including inactive/archived; non-owner получает parity access, owner — none. После migration parity поддерживается full lifecycle bridge, а metadata writer меняет только allowlisted Account fields. Divergence/partial bootstrap блокирует startup/release/rollback и не чинится молча.

Rollback preflight state-aware: до bootstrap он разрешен только при одновременно пустых Accounts/Memberships/Accesses; после bootstrap требует полную parity и active owner. DB-backed Feature 2 gate покрывает empty migrate/bootstrap, concurrent bootstrap, forced rollback, lifecycle matrix, login `lastLoginAt` metadata update, hard-delete order, `seed-demo-accounts.js`, `demo-crm-data up/down`, unchanged Account auth/reads и direct-write repository audit. После каждой test sequence повторно запускается общий state/parity assertion.

## 13. Сознательно открытые решения

- organization-wide или club-local redemption для subscriptions/certificates и settlement между clubs;
- organization credit line vs club ledger для corporate clients;
- organization payroll period и motivation policy vs club overrides;
- organization-wide manager role и owner consolidated read mode;
- client source/consent and bot connection topology;
- target object storage, upload retention and backup RPO/RTO;
- platform-worker credential vs per-tenant worker pools;
- formal support or prohibition of tenant-selective restore.

Ни одно из решений не предполагает `SaasPlan`, `OrganizationSubscription`, `UsageRecord` или SaaS `Invoice`: product billing Setly полностью вне этого эпика.

## 14. Completeness evidence

Discovery manifest на baseline commit:

- models: все 67 файлов в `server/models/`, кроме loader `index.js`; имена каждой model и table присутствуют в разделах 2–8;
- schema: 79 migration files, 67 unique `createTable` targets; все 67 сопоставлены с model rows; служебная `SequelizeMeta` классифицирована как G;
- routes (30 с router index): `access`, `accounts`, `audit`, `auth`, `bookings`, `call-tasks`, `catalog`, `certificates`, `client-bases`, `clients`, `corporate-clients`, `finance`, `manager-control-dashboard`, `motivation`, `onboarding`, `prepayments-dashboard`, `references`, `shift-reports`, `shifts`, `staff`, `subscriptions`, `telephony-transcription-worker`, `telephony`, `training-methodology`, `training-notes`, `training-plans`, `utilization`, `visits-analytics`, `webhooks`;
- controllers (29): те же business domains плюс отдельный `booking-rules`; worker route вызывает scoped telephony service contract, отдельного controller не имеет;
- service files: 37 файлов / 36 logical services, потому `cache.service.js` и `cache.service.ts` являются двумя слоями одного cache surface; дополнительно проверены `evotor`, `pending-sale`, `payroll`, `scanner-events`, methodology analytics/recommendations;
- frontend contract/data surfaces: 16 файлов `client/src/api/` плюс `client/src/lib/api.ts`, `auth-context`, `permissions`, `query-client`, `realtime`, `training-mode` и export helpers;
- realtime: `server/src/sockets/index.js`, `server/src/realtime/permissions.js`, `client/src/lib/realtime-provider.tsx`, `realtime-invalidation.ts`;
- jobs/integrations: `server/bot.js`, bot registration/Telegram/VK, Evotor/Beeline services and webhook routes, transcription worker route/middleware, recurring call task runner and provider subscription runner;
- Account writers: `accounts.service.js` create/update/archive/restore/permanent delete; `auth.service.js` bootstrap Staff+Account and login `lastLoginAt`; `server/scripts/seed-demo-accounts.js` upsert; `server/seeders/20260511120000-demo-crm-data.js` Account bulk delete/insert in both cleanup/up and down;
- uploads/exports: shift report controller/service/storage path; finance, payroll, visits analytics and corporate XLSX generation;
- worker: `workers/transcription-worker/` Node and Python implementations, local state/store, CRM client, ASR HTTP, LLM postprocess, UI and fixtures;
- operations: `docs/BACKUP_CHECKLIST.md`, `docs/RELEASE_CHECKLIST.md`, three Sequelize seeders, performance/demo scripts and smoke accounts.

Reproducible gates used for this inventory:

```text
rg --files server/models server/migrations server/src/routes server/src/controllers server/src/services
rg "createTable|unique|indexes" server/migrations server/models
rg "findByPk|findAll|sequelize.query" server/src
rg "sendFile|multer|xlsx|Socket|queryKey|redis|webhook|worker|advisory" server client workers scripts docs
```

Автоматическая сверка имен на 2026-07-14: `67 model files = 67 unique model names = 67 unique createTable targets`, `missing from inventory = 0`.
