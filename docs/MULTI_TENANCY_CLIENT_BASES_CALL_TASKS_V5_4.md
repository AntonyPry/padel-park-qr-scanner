# Feature 5.4 — Client bases, saved views and call tasks

Статус: `implementation complete; feature gate green; ready for independent QA; not accepted or integrated`.

Exact base: `3b2ac656c0e861ca9bf0d2898b7866f1539f8161` from `codex/saas-multitenancy-integration`.

Feature branch: `codex/multi-tenant-client-bases-call-tasks-v5-4`.

Этот срез расширяет существующие `ClientSavedView`, `ClientBase`, `CallTask`, `CallTaskClient`, `CallTaskAttempt`, analytics segment actions, client timeline/merge, Telephony follow-up links и recurring runner. Параллельная campaign/CRM subsystem не создаётся. Текущие HTTP routes, response shape, labels, формы, роли и single-default UX сохраняются.

## Discovery и scope decision

Принятый ADR и фактическая бизнес-модель дают следующий контракт:

| Root / child | Scope | Authoritative owner | Почему |
| --- | --- | --- | --- |
| `User` | organization | `Users.organizationId` из Feature 5.2 | Профиль клиента общий для клубов одной Organization. |
| `ClientSavedView` | membership + club | проверенные `organizationId`, `clubId`, `membershipId`; legacy `accountId` сохраняется как compatibility/audit link | Это персональный сохранённый фильтр в операционном контексте конкретного клуба. Один global Account может иметь разные Membership и одинаковые имена views в разных clubs. |
| `ClientBase` | club | обязательные immutable `organizationId`, `clubId` | База управляет club-local snapshot/dynamic selection, SLA и recurring generation. Даже при organization-wide User population фактическая выборка ограничена активным Club. |
| analytics-created `ClientBase` provenance | club/server-owned | root Organization/Club плюс immutable `originOrganizationId`, `originClubId`, `origin`, `originMetadata`, `filters` | Source/cohort/lifecycle/revenue selection строится по Visits активного Club. Source Club нельзя подменить или заменить после создания. |
| `CallTask` | club | обязательные immutable `organizationId`, `clubId` | Назначение, очередь, script, deadlines, recurrence и работа персонала выполняются в одном Club. Direct-client task получает Club только из проверенного request/provider context. |
| `CallTaskClient` | child of `CallTask` | parent task; `User.organizationId` обязан совпадать с task Organization | Snapshot может пережить archive/delete User через nullable `userId`, но не может принять клиента чужой Organization. |
| `CallTaskAttempt` | child/history of `CallTaskClient` | parent chain; actor валидируется в tenant graph во время write | История остаётся в parent scope и не переносится при revoke Membership. |
| `TelephonyCall.followUpCallTaskId` | cross-root club link | `TelephonyCall.organizationId/clubId` должны совпадать с `CallTask` | Телефония остаётся отдельным out-of-scope root, но существующая follow-up связь не может пересечь tenant. |

Organization-wide ClientBase не вводится: это противоречило бы accepted ADR, текущему operational UI и explicit-club mutation contract. Consolidated owner analytics в будущем может быть отдельным read-model, но не implicit multi-club base/task write.

## Existing integration inventory

Models/tables:

- `ClientSavedView`, `ClientBase`, `CallTask`, `CallTaskClient`, `CallTaskAttempt`;
- parents/links: `Organization`, `Club`, `Membership`, `MembershipClubAccess`, `Account`, `Staff`, `User`, `Visit`, `ClientSource`, `VisitCategory`, `TelephonyCall`;
- no separate base-entry table exists: persisted task membership snapshot is `CallTaskClient`; a base itself persists immutable filters/provenance and resolves current population on demand.

Server paths:

- `client-bases.service.js`: generic/manual base create, preview/list/count, immutable analytics filters, SLA, recurrence, archive/restore/permanent-delete;
- `call-tasks.service.js`: base/direct-client task generation, snapshot/dynamic sync, assignment, scripts, statuses, attempts, bulk changes, report, recurrence;
- `clients.service.js`: saved views, organization client list resolver, client timeline, duplicate merge and hard-delete dependency checks;
- `visits-analytics.service.js` and controller: source/cohort/lifecycle/filter segment preview → server-owned base; same resolver provides count/list/XLSX parity under Feature 5.3;
- `telephony.service.js`: missed-call and processed-call follow-up task creation, client linking and TelephonyCall task association;
- `manager-control-dashboard.service.js`: active/overdue call-task read;
- `references.service.js`: permanent-delete guard for source/category filters used by bases;
- `accounts.service.js`: hard-delete guards for creator/assignee/attempt history;
- `server/bot.js`: recurring runner and realtime publication.

HTTP/contracts:

- `/api/clients/views*` (club-declared saved view section on an otherwise mixed Clients page);
- `/api/client-bases*`, `/api/client-bases/:baseId/call-tasks`;
- `/api/clients/:clientId/call-tasks`;
- `/api/call-tasks*`, `/api/call-task-clients/:taskClientId/attempts`;
- `/api/analytics/visits/client-bases` and preview endpoint;
- endpoint registry already classifies `clientBases.*`, `callTasks.*`, `visitsAnalytics.*` as club scope.

Frontend/realtime/cache:

- `ClientBasesPage.tsx`, `CallTasksPage.tsx`, saved views on `ClientsPage.tsx`, visits analytics segment dialog and Telephony follow-up UI;
- pages use existing `apiFetch` tenant headers and partial mixed-page authority; no new visible action is planned;
- realtime domains `client_bases` and `call_tasks` already map to tenant rooms when Feature 4.1 capability is on; event envelopes and client query invalidation must remain Club-scoped;
- frontend pages use local request state rather than a separate domain cache. Existing tenant context lifecycle/unmount is the boundary; no new unscoped cache key may be added.

Permissions remain unchanged:

- client bases view/manage: owner, manager;
- call tasks view/work: owner, manager, admin;
- call tasks manage: owner, manager;
- assignments accept only an active same-Organization Membership with effective Club role owner/manager/admin; Account.role remains flag-off compatibility only.

## Target runtime contract

- Server-owned capability `TENANT_CLIENT_BASES_CALL_TASKS_ENABLED` depends on `TENANT_VISITS_SCANNER_ENABLED`.
- Flag on accepts only frozen club request TenantContext, or an internal background/provider context reloaded from authoritative DB rows. Body/query/legacy headers never supply authority.
- Flag off keeps global legacy reads for exact-default compatibility while every new write receives exact default Organization/Club.
- All root lookups use `id + organizationId + clubId`; children are looked up through a scoped parent.
- Generic base create rejects analytics filters/origin/provenance. Analytics create persists server-generated filters and source tenant; those fields are immutable through service, ORM hooks and DB triggers.
- Base membership may contain only same-Organization Users. Analytics base membership is additionally derived only from Visits of its immutable source Club.
- Task base, direct client, creator, assignee, Staff/Membership and TelephonyCall links are validated against the same tenant graph.
- Explicit/dynamic/recurring generation is transactionally locked and idempotent per base+scheduled run. Recurrence processes one authoritative root tenant at a time.
- Archive preserves task/client/attempt history. Permanent task deletion remains allowed only without call history; permanent base deletion remains blocked when tasks exist.
- Report, manager dashboard, client timeline, sync, bulk update, attempt logging and realtime publication use the same scoped task set.

## Data and migration contract

Forward migration uses nullable → exact-default backfill → graph validation → constraints/indexes/triggers → `NOT NULL` for authoritative root attribution. It covers fresh and production-shaped data and fails closed on pre-existing partial schema.

Required schema rules:

- roots have unique `(organizationId, clubId, id)` and tenant-leading list/status/recurrence indexes;
- saved views have composite Membership/Club FKs and unique `(membershipId, clubId, name)`; legacy Account FK remains;
- CallTask→ClientBase, TelephonyCall→CallTask and analytics source Club are same-tenant composite links;
- CallTaskClient insert/update trigger rejects cross-Organization User and cross-tenant task moves;
- root tenant attribution and analytics provenance are immutable for instance, bulk and raw-SQL writes;
- `down` preflight requires exact single-default tenant, complete attribution/graph, no second tenant and no later migration; runtime rollback is flag-off, not schema erasure.

## Boundaries

Out of scope: TelephonyCall/provider/recording/transcription root isolation, bookings/training, prepayments/certificates/finance, campaign delivery channels, billing, second production tenant, switcher and redesign. Existing Telephony links are only validated against already authoritative provider tenant columns.

## User Preview Gate

Final status: `N/A`. Итоговый diff не содержит файлов из `client/`, не меняет public routes, actions, statuses, labels, response shapes или пользовательский workflow. Поэтому новый preview approval не требуется. Независимый QA всё ещё должен выполнить обычный runtime/API reconciliation для tenant security, но desktop/mobile screenshots не являются feature gate этого server-only среза.

## Implementation result

- Добавлена server-owned capability `TENANT_CLIENT_BASES_CALL_TASKS_ENABLED` с зависимостью от Feature 5.3.
- `ClientSavedView`, `ClientBase` и `CallTask` получили authoritative tenant attribution; `CallTaskClient` и `CallTaskAttempt` остаются дочерними сущностями, ограниченными parent graph.
- Все CRUD/list/detail/archive/delete/report/sync/history paths для баз и задач получают tenant только из повторно валидированного frozen request context. Flag-off сохраняет current exact-default bridge.
- Analytics filters/provenance создаются только server-owned visits analytics path, сохраняют source Organization/Club и immutable через service, ORM hooks и DB triggers.
- Assignee/creator/attempt actor проверяются через active Account → Membership → Club access/effective role → optional Staff graph. Reassignment, recurrence и provider-created follow-up links не могут пересечь tenant.
- Snapshot/dynamic generation сериализуется parent locks; child uniqueness и transactions защищают population; recurring runner обрабатывает один stored tenant root за транзакцию и повторный concurrent run не создаёт дубль.
- Attempt history нельзя переписать или перенести в другую задачу; разрешён только технический reparent внутри той же `CallTask` при merge клиентских дублей.
- Owner training-data summary/cleanup для `ClientBase`, `CallTask`, `CallTaskClient`, `CallTaskAttempt` теперь Club-scoped; соседний Club остаётся нетронутым.
- Добавлен AST direct-write audit для всех пяти domain models, включая aliases, instance/bulk mutation и raw SQL.

## Verification at feature handoff

- Fresh isolated database: все `89/89` migrations, production-shaped legacy backfill, forced failure cleanup, pre-existing partial fail-closed, down/up/reapply и second-tenant rollback refusal — green.
- Реальная локальная production-shaped DB: Feature 5.4 `down 1.169s → up 0.473s`, schema/data preflight green.
- Feature 5.4 DB/security/concurrency/IDOR/training-cleanup matrix: `1/1` comprehensive DB-backed test green; historical analytics → preview → base → task population parity также green.
- Full server suite с `--test-concurrency=1`: `486/486`, failures `0`.
- Targeted onboarding service: `22/22`; infrastructure/foundation/Socket.IO rerun: `30/30`.
- Client unchanged: `31/31` test files, `205/205` tests; lint and production build green.
- Server typecheck and JS syntax checks green.
- Tenant route audit: `284` endpoints, digest `373ec5dd4bb9389f11b9f516df6611d3e8b0036da6adde2c2fd76a019c1439aa`.
- Account, Staff/Membership, User/reference, Visit/scanner, ClientBase/CallTask, cache/realtime, files/workers and provider audits — green.
- Strict onboarding audit: PASS; `177/177` required screenshot-backed cards, `40/40` checkpoint events.
- OpenAPI and generated client hashes identical before/after generation; contract drift отсутствует.

## Handoff boundaries

- Independent QA ещё не выполнен; feature не accepted и не promoted.
- Второй production tenant по-прежнему hard-blocked; provisioning, billing и tenant switcher не входят в этот срез.
- Telephony provider/call/recording/transcription roots остаются out of scope; проверена только уже существующая task link tenant parity.
- Следующий разрешённый шаг: independent QA/release review exact feature commit. Push, merge, integration promotion и deploy требуют отдельного разрешения HQ.
