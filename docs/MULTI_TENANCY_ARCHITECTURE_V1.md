# Multi-tenant architecture v1: Organization → Clubs → Memberships

Статус: `accepted for implementation planning`

Дата: 2026-07-14

Ревизия: `1.1 — architecture findings resolved`

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
      string role
      string status
    }
    MEMBERSHIP_CLUB_ACCESS {
      bigint organizationId FK
      bigint membershipId FK
      bigint clubId FK
      string roleOverride
      string status
    }
```

### DB-enforceable foundation schema

Feature 2 использует один явный `organizationId` в `MembershipClubAccess` и два composite FK. Это не application-only validation: строка access физически не сможет связать membership одной организации с club другой.

| Table | Keys, constraints and required indexes |
| --- | --- |
| `Organizations` | PK `(id)`; global unique `(slug)`; `status ENUM('active','inactive','archived') NOT NULL`; default row slug `padel-park`. |
| `Clubs` | PK `(id)`; `organizationId NOT NULL` FK → `Organizations(id)` `ON DELETE RESTRICT`; `status ENUM('active','inactive','archived') NOT NULL`; unique `(organizationId, slug)`; additional unique `(organizationId, id)` as referenced composite key; index `(organizationId, status, id)`. Default row slug `padel-park`. |
| `Memberships` | PK `(id)`; `organizationId NOT NULL` FK → `Organizations(id)` `ON DELETE RESTRICT`; `accountId NOT NULL` FK → `Accounts(id)` `ON DELETE RESTRICT`; `role ENUM('owner','manager','admin','accountant','viewer','trainer') NOT NULL`; `status ENUM('active','inactive','archived') NOT NULL`; unique `(organizationId, accountId)`; additional unique `(organizationId, id)` as referenced composite key; indexes `(accountId, status, organizationId)` and `(organizationId, role, status)` for discovery and last-owner checks. |
| `MembershipClubAccesses` | Columns `organizationId`, `membershipId`, `clubId` are `NOT NULL`; `roleOverride ENUM('manager','admin','accountant','viewer','trainer') NULL` — `owner` отсутствует в DB enum; `status ENUM('active','inactive','archived') NOT NULL`; PK `(membershipId, clubId)`; FK `(organizationId, membershipId)` → `Memberships(organizationId, id)` `ON DELETE RESTRICT`; FK `(organizationId, clubId)` → `Clubs(organizationId, id)` `ON DELETE RESTRICT`; indexes `(organizationId, membershipId)` and `(organizationId, clubId, status)`. |

Referenced composite keys `(organizationId, id)` намеренно объявлены unique, даже несмотря на global PK `id`: так MySQL FK contract не зависит от permissive non-unique referenced-index behavior. Все tenant records архивируются/status-disable, а не удаляются cascade.

`Account.email` остается global unique: один login может состоять в нескольких организациях. `Account.role` остается compatibility-полем до переключения auth source.

`Membership.staffId` **не входит в Feature 2**. До Staff/access wave существующий `Account.staffId` остается compatibility link. В Feature 5 сначала добавляются и backfill-ятся `Staff.organizationId`, unique `(organizationId, id)` и tenant indexes; только затем в `Membership` добавляется nullable `staffId`, composite FK `(organizationId, staffId) → Staff(organizationId, id)` и unique `(organizationId, staffId)`. Обычный MySQL unique допускает несколько `NULL`, поэтому отдельный partial index не нужен.

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

Токен содержит стабильный `accountId` и session/version metadata, но не является долгоживущим доказательством доступа к tenant. Каждый endpoint декларирует один scope; обязательный transport contract:

| Endpoint scope | Required headers | Как определяется membership и роль |
| --- | --- | --- |
| `global` | tenant headers не нужны | Только allowlisted auth/discovery/health/platform metadata. Global endpoint не читает business rows. |
| `membership` | `X-Organization-Id` | Resolver требует active Account, Organization и Membership по `accountId + organizationId`; client-supplied `membershipId` не является authority. Self-progress/preferences разрешаются внутри этой Membership. |
| `organization` | `X-Organization-Id` | Resolver требует active Account, Organization и Membership. Authorization использует только `Membership.role`; club `roleOverride` никогда не влияет на organization endpoint. |
| `club` | `X-Organization-Id` и `X-Club-Id` | Resolver требует active Account/Organization/Membership/Club и active access row для non-owner. Authorization использует `effectiveRole`. |

Дополнительные правила:

1. Явные headers обязательны на **каждом** organization/club request, включая single-club Padel Park. Их отсутствие дает `400 TENANT_CONTEXT_REQUIRED`; server не подставляет сохраненный context.
2. Server-side last-selected context — только preference/default, который помогает UI выбрать значения и сформировать headers. Он не является authority и не заменяет ни header, ни повторную membership/access проверку.
3. Если доступен один club, frontend автоматически ставит оба headers и скрывает switcher; это сохраняет UX без implicit server fallback.
4. `organizationId`/`clubId` из body, query, saved preference или JWT не используется как authority. Create берет tenant только из проверенного `req.tenant`.
5. `X-Club-Id` обязан принадлежать `X-Organization-Id`; mismatch отклоняется до controller. Недоступный tenant возвращает единообразный `404` или `403` без раскрытия существования.
6. Lookup выполняется как `id + tenant predicate` либо через уже tenant-scoped parent. Один `findByPk(id)` для business entity недопустим.
7. Raw SQL/CTE получает обязательные tenant replacements и фильтрует каждую корневую таблицу до join/aggregation.

Membership-scoped endpoints обслуживают только ресурс текущего authenticated membership: onboarding progress, membership preferences и last-selected context. Global `/auth/me/memberships` может вернуть минимальный список доступных organizations для bootstrap без tenant header. Просмотр/изменение **чужого** membership — organization-scoped administrative endpoint: path `membershipId` всегда ищется вместе с `X-Organization-Id`, а права проверяются по actor `Membership.role`. Любой membership resource с club-bound data становится club-scoped и требует оба headers.

### Roles и owner

- базовая роль находится в `Membership.role`;
- `MembershipClubAccess.roleOverride` применяется только внутри конкретного клуба и не может быть `owner`; значение исключено из DB enum и application validation enum;
- effective role = `owner`, если membership role `owner`, иначе `roleOverride ?? membership.role`;
- organization endpoints проверяют `Membership.role`; club endpoints проверяют `effectiveRole`;
- owner видит все текущие и будущие clubs своей organization, даже без отдельных access rows;
- owner не получает доступ к другой organization;
- обязательная active chain для organization request: `Account.status = active`, `Organization.status = active`, `Membership.status = active`;
- для club request дополнительно обязательны `Club.status = active` и, если Membership не owner, `MembershipClubAccess.status = active`; inactive/archived rows никогда не дают доступ;
- в каждой Organization, независимо от ее собственного status, должен оставаться минимум один active Membership с role `owner`; `Organization.status != active` все равно блокирует request, но не разрешает удалить последнего owner;
- platform support/admin, если когда-либо появится, должен быть отдельным явно audited механизмом и не использовать CRM role `owner`.

Последнего active owner нельзя удалить, архивировать, деактивировать или понизить. Обычный FK/unique не выражает count invariant, поэтому mutation transaction блокирует строку Organization и ее active owner memberships через `SELECT ... FOR UPDATE`, повторно считает owners и отклоняет результат `< 1`. Тот же guard обязателен для bulk/admin/migration paths; startup/release assertion проверяет invariant независимо от application service. Feature 2 содержит concurrency tests двух одновременных demotion/deactivation attempts.

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
- до Feature 9 demo/performance/smoke fixtures создаются только в exact default organization/club; multi-tenant fixtures разрешены лишь в isolated ephemeral DB Feature 9;
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
8. Изоляционные тесты используют минимум две organizations, одинаковые natural keys и пользователя с разными ролями/club access; до Feature 9 это разрешено только в isolated ephemeral test DB.
9. Cross-organization join запрещен по умолчанию. Разрешение требует отдельного ADR и platform-level authorization.
10. SaaS billing entities (`SaasPlan`, `OrganizationSubscription`, `UsageRecord`, SaaS `Invoice`) не создаются в этом эпике.
11. До acceptance Feature 9 production schema содержит ровно default Organization и default Club; provisioning второго tenant запрещен.
12. Organization/club request без обязательных explicit tenant headers отклоняется, даже если server хранит last-selected context.
13. Ни одна Organization, включая inactive/archived, не может остаться без active owner Membership.

## 6. Backfill Padel Park

Общий порядок для будущих migrations (в этом Feature 1 migrations нет):

1. Создать единственный `Organization(name = 'Padel Park', slug = 'padel-park', status = 'active')` и единственный принадлежащий ему `Club(name = 'Padel Park', slug = 'padel-park', status = 'active')`. Константы slugs: `DEFAULT_ORGANIZATION_SLUG=padel-park`, `DEFAULT_CLUB_SLUG=padel-park`; migration aborts, если такой slug уже занят несовместимой строкой.
2. Создать ровно один `Membership` для каждого `Account`, включая inactive/archived: `organizationId = default`, `role = Account.role`, `status = Account.status`. Перед завершением обязан существовать минимум один `active owner`; иначе migration aborts.
3. Для каждого non-owner Membership создать ровно один access row к default Club со status, равным Membership status: active → active, inactive → inactive, archived → archived. Для owner access row не создается; active owner получает все clubs по invariant, inactive/archived owner доступа не имеет из-за active chain. `Account.role/status/staffId` остаются неизменными compatibility fields.
4. Добавлять tenant columns только nullable, backfill-ить корневые таблицы default organization/club, валидировать row counts и orphan paths.
5. Backfill children через parent. Если parent path неоднозначен или отсутствует — остановить migration и записать exception, не назначать tenant по догадке.
6. Добавить dual-write и shadow assertions; старые reads остаются до проверки.
7. Перестроить global unique indexes в tenant-aware только после duplicate preflight.
8. Включить scoped reads domain wave за feature flag; сравнить counts/exports с baseline первого клуба.
9. После QA сделать tenant columns `NOT NULL`, включить cross-tenant guards и только затем удалить compatibility role/context paths.

### Feature 2 rollback preflight

`down` выполняет **все** проверки до первого `DROP`; при одном failure rollback aborts без частичного удаления:

1. В `Organizations` ровно одна строка: active slug `padel-park`. В `Clubs` ровно одна строка: active slug `padel-park`, связанная с этой Organization.
2. `Memberships.count = Accounts.count`; для каждого Account существует ровно одна default Membership, а `role/status` все еще равны compatibility `Account.role/status`. Нет membership другой organization и есть минимум один active owner.
3. Для каждого non-owner Membership существует ровно один default access с тем же status; owner access rows отсутствуют; дополнительных/mismatched rows нет.
4. `INFORMATION_SCHEMA` не содержит FK из других tables на `Organizations`, `Clubs`, `Memberships`, `MembershipClubAccesses` и не содержит tenant columns `organizationId`, `clubId`, `membershipId` вне четырех foundation tables. Это запрещает rollback после merge любой последующей tenant wave.
5. В `SequelizeMeta` отсутствуют migrations Features 3–9. Проверка выполняется по точному allowlist migration names, определенному в Feature 2; prefix/date guessing запрещен.
6. Compatibility `Accounts.role/status/staffId` существуют и не были изменены/удалены; row-count и checksum preflight сохранены в rollback output.

После успешного preflight drop order только такой: `MembershipClubAccesses → Memberships → Clubs → Organizations`. Rollback не изменяет Accounts, Staff или business rows. Повторное применение migration обязано воспроизвести те же counts, roles, statuses и default slugs.

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
| Feature 2 — tenant foundation | Feature 1 QA | Additive models/migrations `Organization`, `Club`, `Membership`, `MembershipClubAccess`; DB-enforced composite same-org FKs; exact default Padel Park backfill; compatibility с `Account.role/status/staffId`; no Membership.staffId yet; startup/migration/release single-default assertion. Merge после DB backup + rollback/reapply на копии. | `down` только после exact six-step preflight; runtime продолжает старую single-club модель. |
| Feature 3 — context plumbing | Feature 2 | `req.tenant`, mandatory explicit header contract, membership resolver, `/auth/me` discovery/preferences, endpoint scope declaration API, feature flag; без массовой фильтрации доменов. Merge при identical UI behavior для default club, но без implicit server context fallback. | Disable flag; старые services остаются источником поведения. |
| Feature 4 — isolation infrastructure | Features 2–3 | Tenant-aware realtime rooms, Redis/query keys, files, worker claim, integration connections, per-tenant locks. Merge до подключения второго club. | Отключить new fanout/cache/worker routing; новые columns остаются additive. |
| Feature 5 — CRM/Staff/access wave | Features 2–4 | `Staff.organizationId` backfill и затем Membership.staffId composite FK; Users/clients, references, visits/scanner, client bases/call tasks; expand → backfill → dual-write → scoped reads → constraints. | Per-domain read flag назад; Account.staffId compatibility и dual-written tenant data сохраняются. |
| Feature 6 — bookings/training wave | Feature 5 org client identity | Courts/settings/bookings/series, training notes/plans, methodology/skill map; cross-parent checks. | Per-domain read flag; не откатывать committed business rows. |
| Feature 7 — finance/prepayments wave | Feature 5 + решения liability scope | Evotor/catalog/finance/payroll/prepayments/certificates/corporate; tenant-aware exports and reconciliation. | Отключить scoped reads/ingress по provider connection; сохранить tenant attribution. |
| Feature 8 — ops/audit/onboarding | Features 5–7 | Shifts/reports/uploads, audit logs, onboarding/training cleanup, default-tenant demo fixtures and backups. | Per-surface flags; attachment layout поддерживает dual-read до copy verification. |
| Feature 9 — enforcement and two-tenant QA | Features 4–8 | `NOT NULL`, composite uniques, orphan/cross-tenant detectors, ephemeral two-org isolation suite, restore drill. Второй tenant разрешен только в isolated test DB до acceptance. | Roll back constraints, не tenant attribution; production остается pinned к default tenant при failure. |
| Feature 10 — club switch UX/rollout | Feature 9 accepted | Только после снятия single-default gate: controlled provisioning contract/UI, switcher, selected preference, owner all-club UX, staged production enablement. | Отключить provisioning/switcher и pin default club; data model остается multi-tenant. |

### Hard rollout gate до Feature 9

- До полного acceptance Feature 9 нельзя создать вторую Organization или второй Club в production/staging data stores, кроме isolated ephemeral DB самой isolation suite.
- Features 2–8 не добавляют provisioning API, CLI, admin action или general-purpose organization/club seeder. Единственный разрешенный insert path — deterministic Feature 2 migration для slugs `padel-park`/`padel-park`.
- Feature 2 обязана добавить один общий assertion, используемый post-migration check, application startup и release gate: `Organizations.count = 1`, `Clubs.count = 1`, exact default slugs/status/relationship совпадают, все Memberships/Access rows принадлежат default tenant и last active owner существует.
- До снятия gate assertion работает fail-closed: migration/release останавливается, application startup не принимает business traffic при втором tenant или нарушенном default mapping.
- Feature 9 может создать второй tenant только test fixture в ephemeral DB. Production gate снимается отдельным release decision после green isolation suite, restore drill и QA; только Feature 10 получает право реализовать provisioning.

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
