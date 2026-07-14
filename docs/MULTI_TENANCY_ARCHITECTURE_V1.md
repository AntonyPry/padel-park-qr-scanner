# Multi-tenant architecture v1: Organization → Clubs → Memberships

Статус: `accepted for implementation planning`

Дата: 2026-07-14

Срез: Feature 1 — inventory и архитектурное решение

Связанный inventory: [`TENANT_INVENTORY_V1.md`](./TENANT_INVENTORY_V1.md)

## 1. Решение

Setly переходит от неявной модели «одна установка = один клуб» к shared-schema multi-tenancy:

- глобальная identity пользователя хранится отдельно от его доступа к бизнес-данным;
- `Organization` объединяет один или несколько `Club`;
- `Membership` связывает глобальный `Account` с организацией и задает базовую роль;
- `MembershipClubAccess` задает разрешенные клубы и при необходимости role override;
- текущий Padel Park backfill-ится как одна организация и один клуб без изменения текущего UX;
- все бизнес-запросы получают проверенный tenant context до обращения к данным;
- SaaS-тарифы, подписка на Setly, usage billing и SaaS invoices в эту архитектуру не входят.

Новые сущности следующего среза:

```mermaid
erDiagram
    ACCOUNT ||--o{ MEMBERSHIP : "has identity access"
    ORGANIZATION ||--o{ CLUB : "owns"
    ORGANIZATION ||--o{ MEMBERSHIP : "admits"
    MEMBERSHIP ||--o{ MEMBERSHIP_CLUB_ACCESS : "can access"
    CLUB ||--o{ MEMBERSHIP_CLUB_ACCESS : "is granted"

    ACCOUNT {
      bigint id PK
      string email UK
      string status
    }
    ORGANIZATION {
      bigint id PK
      string slug UK
      string name
      string status
    }
    CLUB {
      bigint id PK
      bigint organizationId FK
      string slug
      string name
      string timezone
      string status
    }
    MEMBERSHIP {
      bigint id PK
      bigint organizationId FK
      bigint accountId FK
      bigint staffId FK
      string role
      string status
    }
    MEMBERSHIP_CLUB_ACCESS {
      bigint membershipId FK
      bigint clubId FK
      string roleOverride
      string status
    }
```

Обязательные ограничения:

- `Membership`: unique `(organizationId, accountId)`;
- nullable `Membership.staffId` ссылается только на `Staff` той же organization; при политике «один login на сотрудника» — unique `(organizationId, staffId)` where non-null;
- `MembershipClubAccess`: unique `(membershipId, clubId)`;
- `Club`: unique `(organizationId, slug)`;
- `Organization`: глобально unique `slug`;
- `MembershipClubAccess.clubId` должен принадлежать той же организации, что и `Membership`;
- `Account.email` остается глобально unique: один login может состоять в нескольких организациях.

`Account.role` и `Account.staffId` сейчас смешивают identity и tenant-доступ. В переходный период они остаются compatibility-полями, но целевым источником роли становится `Membership`/`MembershipClubAccess`, а связь с сотрудником переезжает на tenant-уровень.

## 2. Scope данных

### Global platform data

- `Account` как credential/identity;
- `SequelizeMeta`, OpenAPI schema, role/permission definitions и onboarding catalog как versioned platform metadata;
- общие технические конфигурации, не содержащие customer data.

Global не означает «доступно всем tenant». Это означает только отсутствие владельца-организации у самой записи.

### Organization-scoped

- профиль клиента (`User`) и его canonical merge-chain;
- сотрудник (`Staff`);
- общие справочники источников клиентов, целей визита и P&L taxonomy;
- методическая база навыков и упражнений;
- общий skill map клиента;
- шаблоны отчетов смены;
- политики мотивации и payroll period, если они управляются централизованно;
- продуктовые типы абонементов как общее определение организации; доступность/цена по клубам должна быть отдельной настройкой, если понадобится.

### Club-scoped

- визиты, scanner events и выдача ключей;
- корты, расписание, брони, серии, блокировки, тарифы и исключения;
- training notes и training plans как факт работы конкретного клуба;
- смены, отчеты смены и вложения;
- финоперации, чеки Эвотора, catalog mappings и pending sales;
- телефония, Beeline subscriptions/raw events, recordings, transcription jobs;
- операционные client bases/call tasks/saved views;
- utilization и club-level exports/analytics.

### Membership/access

- `Membership`, `MembershipClubAccess` и effective role;
- onboarding progress принадлежит membership, а training mode дополнительно фиксирует выбранный клуб;
- selected organization/club является предпочтением интерфейса, но не источником авторизации.

### Отдельное бизнес-решение до enforcement

- абонементы и сертификаты: действуют только в клубе продажи или во всех клубах организации;
- корпоративный баланс: единый по организации или отдельный по клубам;
- payroll/motivation: единый расчет организации или отдельные периоды/правила клубов;
- telephony client ownership: звонок всегда относится к номеру конкретного клуба, даже если клиент organization-wide;
- перенос/merge клиента между организациями запрещен; merge внутри организации разрешен.

До решения по предоплатам безопасный default — хранить `originClubId`, не разрешать cross-club redemption и не агрегировать liability между клубами.

## 3. Tenant context

### HTTP

После `requireAuth` отдельный resolver обязан построить:

```ts
type TenantContext = {
  accountId: number;
  membershipId: number | null;
  organizationId: number | null;
  clubId: number | null;
  membershipRole: AccountRole | null;
  effectiveRole: AccountRole | null;
  scope: 'global' | 'organization' | 'club' | 'membership';
};
```

Правила:

1. Токен содержит стабильный `accountId` и session/version metadata, но не является долгоживущим доказательством доступа к tenant.
2. Запрошенные organization/club IDs берутся из явного header (`X-Organization-Id`, `X-Club-Id`) или server-side active-context endpoint, затем всегда сверяются с активными memberships.
3. Если у membership доступен один клуб, resolver выбирает его автоматически. Это сохраняет текущий UX Padel Park.
4. Endpoint декларирует `global`, `organization` или `club` scope. Club endpoint без валидного `clubId` отвечает `400/409`, а без доступа — `403`.
5. `organizationId`/`clubId` из body не используется как authority. Create берет tenant только из `req.tenant`.
6. Lookup выполняется как `id + tenant predicate` либо через уже tenant-scoped parent. Один `findByPk(id)` для бизнес-сущности недопустим.
7. Raw SQL/CTE получает обязательные tenant replacements и фильтрует каждую корневую таблицу до join/aggregation.

### Roles и owner

- базовая роль находится в `Membership.role`;
- `MembershipClubAccess.roleOverride` применяется только внутри конкретного клуба;
- effective role = `owner`, если membership role `owner`, иначе `roleOverride ?? membership.role`;
- owner видит все текущие и будущие clubs своей organization, даже без отдельных access rows;
- owner не получает доступ к другой organization;
- platform support/admin, если когда-либо появится, должен быть отдельным явно audited механизмом и не использовать CRM role `owner`.

### Переключение клуба

- `/auth/me` или отдельный context endpoint возвращает memberships, доступные clubs и last-selected context;
- switch сохраняет preference сервером/локально, затем обновляет HTTP headers/socket subscription;
- перед показом данных frontend очищает или разделяет tenant-sensitive query cache;
- URL с entity ID из другого клуба возвращает `404` (предпочтительно для сокрытия существования) или единообразный `403`, но никогда не переключает context автоматически;
- если доступен ровно один клуб, switcher не показывается.

### Realtime / Socket.IO

Текущие role-only rooms (`crm:domain:*`) небезопасны для второго tenant. Целевые rooms:

- `org:{organizationId}` для organization-wide событий;
- `club:{clubId}:domain:{domain}` для club events;
- `membership:{membershipId}` для private progress/context events.

Socket handshake повторно загружает memberships, разрешает только доступные rooms и удаляет subscription после revoke. Event содержит `organizationId`, nullable `clubId`, `domain`, `entity`, `entityId`, но не содержит customer payload. Клиент игнорирует event, не совпадающий с активным context.

### Workers и background jobs

- job хранит или однозначно наследует tenant; claim возвращает tenant context вместе с job;
- worker credential имеет allowlist организаций/клубов либо явно объявленный audited platform-worker scope;
- claim/update/result используют `(jobId, tenant)` и не принимают tenant только со слов worker;
- advisory/distributed locks включают organization/club ID;
- recurring call tasks и Beeline subscription runner итерируют clubs отдельно, логируют tenant и не используют глобальный singleton config;
- временные аудиофайлы включают opaque tenant namespace; PII не попадает в имена файлов/логи;
- ASR/LLM получают минимальный payload, а CRM сохраняет tenant и исходные speaker/timestamps вне LLM response.

## 4. Isolation по инфраструктурным поверхностям

### Files/uploads

Целевой layout:

```text
<storage-root>/<organization-uuid>/<club-uuid>/<domain>/<record-uuid>/<file-uuid>
```

DB metadata содержит organization/club; download сначала проверяет tenant-scoped record, затем открывает файл. Нельзя строить authorization только по пути или sequential `reportId`. Backup/restore должен включать DB и tenant-partitioned uploads одним consistency boundary.

### Exports

- export использует тот же scoped query/service, что экран;
- filename не является защитой; workbook metadata/manifest фиксирует organization, club, period и generatedAt;
- platform-wide export запрещен обычным CRM role;
- background export job наследует tenant immutable;
- временные export-файлы удаляются и не лежат в общем public directory.

### Cache/query keys

- Redis prefix: `setly:{organizationId}:{clubId|org}:{domain}:...`;
- invalidation ограничена tenant prefix;
- frontend query keys начинаются с `['tenant', organizationId, clubId, ...]`;
- при switch нельзя повторно показывать cached data предыдущего клуба даже как placeholder;
- health cache stats могут быть global aggregate, но debug keys/payload не отдаются tenant users.

### Webhooks/integrations

- credential/secret или отдельный opaque integration ID сначала разрешается в `IntegrationConnection(organizationId, clubId, provider)`;
- только после этого payload обрабатывается и idempotency key вычисляется внутри tenant;
- Evotor: unique `(clubId, evotorId)`, sale settings/catalog mapping club-scoped;
- Beeline: unique `(clubId, provider, external*)`, per-club callback/subscription/config и tenant-scoped advisory lock;
- Telegram/VK bots: один bot token нельзя молча привязать к нескольким клубам; entry point/deep link/bot connection должен определить club до поиска/создания клиента;
- webhook без разрешенного tenant отклоняется и сохраняет только redacted platform diagnostic, не business row.

### Audit/onboarding/demo

- `AuditLog`, `FinanceChangeLog`, `BookingChangeLog`, raw events и scanner events сохраняют immutable tenant snapshot;
- onboarding catalog global, progress membership-scoped, action events/training data club-scoped;
- training cleanup требует organization + club + membership/account, иначе возможна массовая cross-tenant deletion;
- demo/performance/smoke fixtures создаются только внутри явно выбранного test organization/club;
- production seeders не используют глобальные `findOrCreate` по имени/email бизнес-сущности без tenant.

### Backups/restore

- текущий DB-only checklist недостаточен: нужны DB, uploads, integration config metadata и worker state policy;
- restore отдельной организации нельзя делать простым partial SQL import без remap PK/FK, tenant validation и object/file restore;
- первый production rollout требует full backup и restore rehearsal до включения scoped reads;
- каждая migration wave имеет row-count/checksum отчет по organization/club и orphan detector;
- удаление organization/club — отдельная retention/erasure процедура, не cascade из UI.

## 5. Cross-tenant invariants

1. Каждая новая модель, endpoint, event, job, cache key, file и export явно декларирует scope: `global | organization | club | membership`.
2. Business row без выводимого tenant запрещен. Для aggregate root tenant ID обязателен; child может наследовать tenant через non-null parent FK.
3. Денормализованный tenant ID разрешен только для ingress, audit, queue/routing, partitioning или доказанной производительности; он проверяется на совпадение с parent.
4. Все unique/index constraints, которые описывают business identity, включают tenant либо опираются на tenant-scoped parent key.
5. FK между organization-scoped и club-scoped данными обязан проверять, что `club.organizationId` совпадает с organization owner записи.
6. Нельзя использовать client-supplied tenant ID без membership check.
7. Нельзя возвращать данные другой организации через error detail, autocomplete, count, metrics, export, log, realtime event или cache.
8. Изоляционные тесты используют минимум две organizations, одинаковые natural keys и пользователя с разными ролями/club access.
9. Cross-organization join запрещен по умолчанию. Разрешение требует отдельного ADR и platform-level authorization.
10. SaaS billing entities (`SaasPlan`, `OrganizationSubscription`, `UsageRecord`, SaaS `Invoice`) не создаются в этом эпике.

## 6. Backfill Padel Park

Общий порядок для будущих migrations (в этом Feature 1 migrations нет):

1. Создать `Organization` со стабильным slug `padel-park` и первый `Club` со стабильным slug, согласованным до migration.
2. Создать по одному `Membership` для каждого `Account`; текущую `Account.role/status` скопировать, owner пометить organization-wide.
3. Создать club access для non-owner active/archive memberships, сохранив текущие роли. Owner не зависит от access rows и получает все current/future clubs по invariant. Скрытый default context указывает первый club.
4. Добавлять tenant columns только nullable, backfill-ить корневые таблицы default organization/club, валидировать row counts и orphan paths.
5. Backfill children через parent. Если parent path неоднозначен или отсутствует — остановить migration и записать exception, не назначать tenant по догадке.
6. Добавить dual-write и shadow assertions; старые reads остаются до проверки.
7. Перестроить global unique indexes в tenant-aware только после duplicate preflight.
8. Включить scoped reads domain wave за feature flag; сравнить counts/exports с baseline первого клуба.
9. После QA сделать tenant columns `NOT NULL`, включить cross-tenant guards и только затем удалить compatibility role/context paths.

Backfill order по зависимостям:

```text
Organization/Club/Membership
  → organization dictionaries (Staff, User, ClientSource, VisitCategory, Category, methodology)
  → club roots (Court, BookingSettings, Finance, Receipt, Visit, Shift, TelephonyCall)
  → operational roots (ClientBase, CallTask, TrainingNote/Plan, integrations)
  → child/ledger/history rows
  → audit/onboarding/cache/files/worker state
  → constraints and enforcement
```

## 7. Следующие feature-срезы

| Срез | Зависит от | Scope и merge point | Rollback |
| --- | --- | --- | --- |
| Feature 2 — tenant foundation | Feature 1 QA | Additive models/migrations `Organization`, `Club`, `Membership`, `MembershipClubAccess`; default Padel Park backfill; compatibility с `Account.role`; tests только на invariants. Merge после DB backup + migration rollback/reapply на копии. | `down` удаляет только новые связи после preflight; runtime продолжает старую single-club модель. |
| Feature 3 — context plumbing | Feature 2 | `req.tenant`, membership resolver, `/auth/me` context, endpoint scope declaration API, feature flag; без массовой фильтрации доменов. Merge при identical behavior для default club. | Disable flag; старые services остаются источником поведения. |
| Feature 4 — isolation infrastructure | Features 2–3 | Tenant-aware realtime rooms, Redis/query keys, files, worker claim, integration connections, per-tenant locks. Merge до подключения второго club. | Отключить new fanout/cache/worker routing; новые columns остаются additive. |
| Feature 5 — CRM/access wave | Features 2–4 | Users/clients, references, visits/scanner, client bases/call tasks; expand → backfill → dual-write → scoped reads → constraints. | Per-domain read flag назад; dual-written tenant data сохраняется. |
| Feature 6 — bookings/training wave | Feature 5 org client identity | Courts/settings/bookings/series, training notes/plans, methodology/skill map; cross-parent checks. | Per-domain read flag; не откатывать committed business rows. |
| Feature 7 — finance/prepayments wave | Feature 5 + решения liability scope | Evotor/catalog/finance/payroll/prepayments/certificates/corporate; tenant-aware exports and reconciliation. | Отключить scoped reads/ingress по provider connection; сохранить tenant attribution. |
| Feature 8 — ops/audit/onboarding | Features 5–7 | Staff/shifts/reports/uploads, audit logs, onboarding/training cleanup, demo fixtures and backups. | Per-surface flags; attachment layout поддерживает dual-read до copy verification. |
| Feature 9 — enforcement and two-tenant QA | Features 4–8 | `NOT NULL`, composite uniques, orphan/cross-tenant detectors, two-org isolation suite, restore drill. | Roll back constraints, не tenant attribution; второй tenant не provision-ить при failure. |
| Feature 10 — club switch UX/rollout | Feature 9 | Switcher, selected context, owner all-club UX, staged production enablement. | Скрыть switcher и pin default club; data model остается multi-tenant. |

Параллельные обычные фичи продолжаются от актуального `main`. Требования на время эпика:

- каждый новый object/endpoint декларирует tenant scope в PR/handoff;
- migrations multi-tenant waves регулярно rebase на `main` и обновляют inventory для новых моделей;
- нельзя держать долгую mega-ветку со всеми доменами;
- каждый domain wave имеет отдельный merge point и feature flag;
- старый single-club behavior остается рабочим до Feature 9;
- конфликтующие migrations решаются добавлением новой forward migration, а не переписыванием уже merged history.

## 8. P0/P1 места смешивания при втором клубе

### P0 — блокируют добавление второго tenant

1. HTTP auth и permissions: token/account несут одну глобальную `role`; `requireRole` не проверяет organization/club, а services массово используют unscoped `findByPk/findAll`.
2. Raw SQL analytics: `clients.service.js`, `telephony.service.js`, особенно `visits-analytics.service.js` агрегируют таблицы без tenant predicate и экспортируют общий набор.
3. External ingress: один Evotor secret и global `Receipt.evotorId`; одна Beeline config/subscription и global provider external IDs; webhook не разрешает club до записи.
4. Training cleanup/onboarding: выборка по global account/role может удалить training data другого tenant после появления shared identity.
5. Files: shift-report attachments лежат в `server/var/shift-report-attachments/<reportId>`; tenant не входит в path/metadata authorization boundary.
6. Bots: Telegram/VK lookup по global external ID и единый список источников создают/обновляют клиента без organization/club context.

### P1 — серьезная утечка/порча или отказ в обслуживании

1. Socket.IO rooms разделены только по role/domain; tenant events будут fanout-иться всем одноименным ролям.
2. Redis keys `references:*`/`catalog:*` и frontend TanStack Query keys не содержат organization/club; switch может показать cached data другого клуба.
3. Worker token открывает глобальную transcription queue; jobs, progress и local SQLite dashboard state не содержат tenant partition.
4. Background runners обходят все recurring bases и единственную Beeline subscription; advisory lock name глобальный.
5. Global business uniques (`Court.name`, exception `date`, source/category/rule names, external IDs, certificate code и другие) либо блокируют легитимные данные второго tenant, либо заставляют ошибочно переиспользовать чужую запись.
6. Audit/FinanceChangeLog/ScannerEvent/raw payloads не имеют immutable tenant snapshot; расследование и безопасный export невозможны.
7. DB-only backup не включает shift-report uploads и не описывает tenant-selective restore; partial restore может смешать PK/FK.
8. Demo/performance seeders и smoke accounts используют глобальные natural keys и без tenant могут очистить/обновить записи другой организации.

Полная model-by-model детализация, tenant-aware indexes и backfill order находятся в [`TENANT_INVENTORY_V1.md`](./TENANT_INVENTORY_V1.md).

## 9. Сознательно нерешенные вопросы

1. Будут ли subscription/certificate balances переносимы между clubs одной organization.
2. Corporate balance и payroll period organization-wide или club-wide с organization consolidation.
3. Нужна ли manager organization-wide роль, отличная от manager отдельных clubs.
4. Клиентский consent/source: единый для organization или отдельный по club/channel.
5. Один Telegram/VK bot на organization или отдельный connection на club; как club выбирается до регистрации.
6. File/object storage target и RPO/RTO для uploads; текущий local disk не является долгосрочным multi-tenant storage решением.
7. Нужен ли отдельный staging tenant и как anonymize production-like fixtures.
8. Политика data retention/erasure для организации, звонков, транскрипций и audit logs.
9. Нужен ли owner consolidated «все клубы» read mode; он не должен подменять явный club context в мутациях.

Эти вопросы не блокируют Feature 2, если foundation остается additive и не меняет runtime queries.
