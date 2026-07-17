# Feature 5.4 — Client bases, saved views and call tasks

Статус: `accepted exact SHA 8b70e9df; integrated by fast-forward; integration gate green; ready as base for the next separately authorized slice`.

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

Forward migration first classifies the complete reserved Feature 5.4 schema using only `INFORMATION_SCHEMA`, then uses nullable → exact-default backfill → graph validation → `NOT NULL` → indexes/constraints/triggers. It covers fresh and production-shaped data and fails closed on pre-existing partial schema before default-tenant/business reads or any mutation.

Required schema rules:

- roots have unique `(organizationId, clubId, id)` and tenant-leading list/status/recurrence indexes;
- saved views have composite Membership/Club FKs and unique `(membershipId, clubId, name)`; legacy Account FK remains;
- CallTask→ClientBase, TelephonyCall→CallTask and analytics source Club are same-tenant composite links;
- CallTaskClient insert/update trigger rejects cross-Organization User and cross-tenant task moves;
- root tenant attribution and analytics provenance are immutable for instance, bulk and raw-SQL writes;
- exact column type/precision/null/default/extra, ordered index columns/uniqueness/type/direction/prefix, ordered FK graph/actions and normalized trigger table/timing/event/body are part of the migration state; missing, extra reserved, replaced, no-op and lookalike artifacts are `partial`, never auto-repaired;
- forced-current-invocation cleanup tracks and removes only definitions created by that invocation; legacy FK/index removal is deferred until the successful tail so forced cleanup restores byte-for-byte equivalent schema/data inventory;
- Account/Membership/Staff authority accepts only `NULL/NULL` or equal non-null Staff links to an active same-Organization Staff; one-sided null, unequal, stale, inactive and cross-Organization links fail in runtime and DB triggers;
- non-null `TelephonyCall.followUpCallTaskId` requires non-null exact task Organization/Club at INSERT and UPDATE; linked tenant attribution cannot be changed, while same-tenant reparent and clearing the link remain allowed;
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
- Assignee/creator/attempt actor проверяются через active Account → Membership → Club access/effective role → строгую Account/Membership/Staff parity. `NULL/NULL` сохраняет compatibility, но любая односторонняя `NULL`, несовпадение или stale/inactive/cross-Organization Staff отклоняется. Reassignment, recurrence и provider-created follow-up links не могут пересечь tenant.
- Telephony follow-up composite FK дополнен `BEFORE INSERT/UPDATE` triggers, закрывающими SQL `NULL` bypass: non-null link требует exact non-null Organization/Club, а linked attribution нельзя очистить или сменить. Same-tenant reparent, link clear и legacy nullable tenant при `followUpCallTaskId=NULL` сохранены; весь Telephony root tenant-safe не объявляется.
- Snapshot/dynamic generation сериализуется parent locks; child uniqueness и transactions защищают population; recurring runner обрабатывает один stored tenant root за транзакцию и повторный concurrent run не создаёт дубль.
- Attempt history нельзя переписать или перенести в другую задачу; разрешён только технический reparent внутри той же `CallTask` при merge клиентских дублей.
- Owner training-data summary/cleanup для `ClientBase`, `CallTask`, `CallTaskClient`, `CallTaskAttempt` теперь Club-scoped; соседний Club остаётся нетронутым.
- Добавлен AST direct-write audit для всех пяти domain models, включая aliases, instance/bulk mutation и raw SQL.

## Data model impact

Все девять новых persisted fields имеют текущего backend-consumer и не раскрываются в public response/OpenAPI/generated client:

| Fields | Текущий смысл и authoritative writer | Текущие consumers | Visibility, lifecycle и regression |
| --- | --- | --- | --- |
| `ClientSavedViews.organizationId`, `clubId`, `membershipId` | membership-owned saved view активного Club; только `createSavedView` из повторно проверенного request context | `savedViewWhere`, per-membership/Club uniqueness, composite Membership/Club FKs и DB immutability triggers | `mapSavedView` скрывает attribution; row удаляется штатным saved-view delete; cross-tenant/ORM/raw/bulk tests и writer audit |
| `ClientBases.organizationId`, `clubId` | club-local base root; только base create/analytics create из server-owned context | list/detail/count, archive/delete, dynamic sync, task generation, recurring runner и training cleanup | `mapBase` не публикует tenant IDs; immutable до permanent delete; two-Organization/two-Club IDOR, concurrency и writer audit |
| `ClientBases.originOrganizationId`, `originClubId` | server-owned source Club только для `visits_analytics`; manual bases получают `NULL/NULL` | provenance graph validation, immutable analytics filters, exact population resolver и DB triggers | public mapper публикует business `origin/originMetadata`, но не raw tenant IDs; immutable для analytics base; preview→base→task parity и forged provenance tests |
| `CallTasks.organizationId`, `clubId` | club-local operational task root; base/direct/provider/runner writers получают tenant только из validated context | list/detail/report, task clients/attempts, dynamic sync, recurring runner, manager dashboard, realtime и constrained Telephony follow-up | `mapTask` скрывает raw tenant IDs; immutable до permitted permanent delete; snapshot/dynamic/runner concurrency, actor graph, Telephony link и writer audit |

Dormant «future» fields, accidental client selectors или новые API-visible tenant fields не добавлены.

## Verification at feature handoff

- Fresh isolated database: все `89/89` migrations и migration status `89 up`; production-shaped legacy backfill, exact deep-equal forced failure cleanup, down/up/reapply и mutation-free second-tenant rollback refusal — green.
- Definition-aware migration и comprehensive DB/security/concurrency/IDOR/training matrix: `22/22`, включая exact canonical set из девяти `(table, column)` pairs, все `6/6` wrong-table cross-product cases, no-op/lookalike body, wrong timing/event/table, wrong FK/index/column definitions, extra reserved artifacts, production-shaped backfill, forced cleanup, down/up/reapply и second-tenant rollback refusal — green.
- Account/Membership/Staff runtime + DB matrix покрывает обе one-sided-NULL стороны, unequal/missing/inactive/cross-Organization Staff, inactive Account/Membership/Organization/Club, revoked Club access, creator/assignee/attempt/training paths и ORM/raw/bulk INSERT/UPDATE. `NULL/NULL` valid compatibility — green.
- Telephony follow-up matrix покрывает INSERT/UPDATE/raw/bulk `NULL` attribution bypass, cross-Organization/Club, inconsistent reparent, linked attribution clear/change, valid same-tenant link/reparent/clear и legacy `followUp=NULL` — green.
- Historical analytics → preview → base → task exact population parity: `1/1` green после отдельного DB-backed запуска с явной QA DB.
- Full server suite с `--test-concurrency=1`: `507/507`, failures/skips `0`.
- Six-role flag-on/off HTTP reconciliation для saved views, Client Bases, Call Tasks, Visits Analytics и Telephony list соответствует access matrix; missing tenant headers `400`, forged Organization `404`.
- Client unchanged: `31/31` test files, `205/205` tests; lint and production build green.
- Server typecheck and JS syntax checks green.
- Tenant route audit: `284` endpoints, digest `373ec5dd4bb9389f11b9f516df6611d3e8b0036da6adde2c2fd76a019c1439aa`.
- Account, Staff/Membership, User/reference, Visit/scanner, ClientBase/CallTask, cache/realtime, files/workers and provider audits — green.
- Strict onboarding audit: PASS; `177/177` required screenshot-backed cards, `174` instruction screenshots, `40/40` checkpoint events.
- OpenAPI and generated client hashes identical before/after generation; contract drift отсутствует.

## Handoff boundaries

- Independent QA отклонил reviewed parent `4b973484060183337475e88347c02f1d59a5a5be` по трём P1; remediation `bb35f000353bf623cb6c17db04a00521eaf83b27` и narrow pair-set fix `8b70e9df8edbb113d593b059a4d2280f2c2b9dea` приняты без P0–P3. Все три feature commits сохранены и fast-forwarded в SaaS integration без rewrite.
- Второй production tenant по-прежнему hard-blocked; provisioning, billing и tenant switcher не входят в этот срез.
- Telephony provider/call/recording/transcription roots остаются out of scope; проверена только уже существующая task link tenant parity.
- Актуальный `origin/main` `bf902a7bf476b2a68e7bf0aff8ba83abea644912` уже входит в accepted feature history, поэтому reconciliation merge не потребовался. Следующий product slice, merge в `main` и deploy требуют отдельного решения HQ.
