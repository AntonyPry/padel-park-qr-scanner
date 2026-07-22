# Feature 5.3 — Visits and scanner

Статус: `accepted and integrated; Feature 5.4 not started`.

Exact base: `e727ab95e69804b94cb2d1c65f3d3f49b99dee9f` from `codex/saas-multitenancy-integration`.

Feature branch: `codex/multi-tenant-visits-scanner-v5-3`.

Этот срез расширяет существующие `Visit`, `ScannerEvent`, `VisitCategoryAssignment`, access/reception/scanner flow и visits analytics. Параллельная subsystem не создаётся, HTTP routes, response contracts, роли, capability matrix и клиентский UI не меняются.

## Scope и club visibility policy

- `Visit` — club-local aggregate с обязательными immutable `organizationId` + `clubId`.
- `ScannerEvent` — club-local immutable access history; event без Visit всё равно получает проверенный Organization/Club.
- `VisitCategoryAssignment` — child Visit с тем же Organization/Club; `VisitCategory` остаётся organization-wide из Feature 5.2.
- `User` остаётся organization-wide. Один клиент может иметь независимые Visits в нескольких Clubs той же Organization.
- reception monitor, scanner history, issue/correct key, visit category mutation, visits analytics, segment preview и Excel export показывают только active request Club.
- organization-scoped client profile/history сохраняет существующий organization-wide обзор клиента. Это явный organization read-model, а не расширение club-local access monitor.

В scope не вошли ScannerDevice/AccessPoint: таких server-side roots в текущей модели нет. Web Serial scanner работает внутри authenticated CRM; `deviceLabel` и `scannerSessionId` являются диагностической metadata и никогда не authority. Hardware reconnect bugs, bookings/training aggregate isolation, call tasks, telephony, finance/prepayments/certificates и Feature 5.4 не изменяются.

## Data contract

Forward migration `20260716180000-add-tenant-visits-scanner.js`:

1. Требует exact active default Organization + Club и валидный legacy graph.
2. Добавляет nullable `organizationId` + `clubId` в `Visits`, `ScannerEvents`, `VisitCategoryAssignments`; backfill Visit идёт в default tenant, ScannerEvent выводится через Visit при наличии, assignment — через Visit.
3. После повторной проверки делает attribution `NOT NULL`.
4. Заменяет global visit/scanner idempotency на tenant-scoped unique keys.
5. Добавляет composite FKs Visit→Club/User и Assignment→Visit/VisitCategory. Для `duplicateOfVisitId` сохраняет legacy FK `ON DELETE SET NULL`, а DB insert/update triggers запрещают cross-Organization/cross-Club self-link без изменения прежней delete semantics. ScannerEvent→Visit/User остаются nullable single-column FK `ON DELETE SET NULL`: audit event переживает удаление Visit/User и сохраняет immutable Organization/Club snapshot, а insert/update triggers проверяют, что ссылка принадлежит тому же Organization/Club. Cross-Organization client/category также физически невозможны.
6. Добавляет tenant-leading visited/user/scanned, scanner history/type/QR и assignment indexes.
7. Sequelize hooks и DB triggers запрещают изменение Organization/Club через instance, bulk ORM и raw SQL; Visit triggers дополнительно валидируют self-link на insert/update.

Migration распознаёт `legacy`, `partial` и полностью `ready` schema по columns, всем named constraints/indexes/triggers. Любой pre-existing `partial` state отклоняется до tenant preflight и до DDL/data mutation; автоматического repair path нет. Cleanup разрешён только fresh invocation после успешного exact-single-default + legacy-graph/schema preflight: он удаляет только named артефакты этого запуска и восстанавливает сохранённые exact legacy FK/index definitions. DB regression удаляет по одному named trigger/index/constraint/column из ready schema со вторым tenant и сравнивает полный schema inventory, rows, attribution и checksums до/после отказа. Отдельно подтверждены production-shaped forced failure, `down → up → down → up`, неизменные counts/checksum и rollback refusal при втором Organization. Schema down — только development/emergency path: exact single-default, valid graph и отсутствие later migrations; потенциальный partial repair требует отдельной operator utility с backup/exact-state preflight вне Feature 5.3.

## Runtime authority и ingress

Server-owned flag `TENANT_VISITS_SCANNER_ENABLED` зависит от принятого `TENANT_CLIENTS_REFERENCES_ENABLED` и транзитивно от Features 3–5.2. Flag не публикуется frontend.

При flag on `visit-access-context.service` принимает только frozen club-scoped request TenantContext и внутри transaction/read повторно загружает active Organization, Membership, Club и MembershipClubAccess. Owner сохраняет all-club contract. `organizationId`, `clubId`, scanner label/session и произвольная metadata из body/query/header игнорируются как authority.

Покрытые ingress paths:

- Web Serial `/access/scan` и scanner diagnostic events;
- ручной визит/reception search/registration;
- issue/correct key и visit category assignment;
- recent reception monitor и scanner event history;
- training-mode visit marker/cleanup;
- visits/source/cohort/lifecycle/revenue analytics, segment/base preview и XLSX export.

Telegram/VK/provider flows в этом срезе регистрируют organization-wide клиента через Feature 5.2, но не создают Visit напрямую. Scanner event с Visit повторно проверяет, что Visit находится в authoritative Club; `userId` выводится из Visit и не может быть подменён. Event только с User проверяет Organization.

Visit create блокирует authoritative client row и tenant-local recent Visit. `clientEventId` и repeat window scoped по Organization+Club; concurrent retry даёт одну Visit и один repeated response. Scanner event idempotency scoped по Organization+Club+event type. Issue/correct key и category mutation записывают access history атомарно в той же transaction.

## Analytics, cache и realtime

Все raw SQL roots в `visits-analytics.service` используют один повторно проверенный context, tenant-leading index и predicates `Visit.organizationId + Visit.clubId`. Canonical client CTE ограничен Organization; training clients/Visits и duplicate Visits сохраняют прежние исключения. Формулы source quality, cohort, lifecycle, retention, revenue/LTV не изменены.

Visits sheet в XLSX, source-quality export, segment preview/count/list и client-base snapshot используют тот же context. При flag on `Receipt` фильтруется по authoritative Organization+Club, `ReceiptItem` наследует scope только через Receipt, а `PendingSale` участвует только при согласованной цепочке `PendingSale.receiptId → ReceiptItem.receiptId → Receipt` того же tenant. `ClientSubscription`, `Certificate`, `Booking`, `Finance` и `CorporateLedgerEntry` пока не имеют доказанного club attribution и fail-closed исключены из club revenue/LTV/coverage; для них полная isolation остаётся отдельной domain wave. При flag off прежние global roots и формулы сохранены. Same-org two-Club DB regression подтверждает одинаковый scoped dataset dashboard/source/cohort/LTV, controller API и XLSX export для organization-wide shared client.

Существующие client query keys уже имеют club namespace. Route mutation middleware публикует `access`/`visits_analytics` invalidation в tenant rooms; прямой `scan_result` отправляется только в `club:<id>:domain:access` с server-built tenant envelope. Новых client keys, loader states или background refetch behavior нет.

## Flag-off compatibility и rollout

При `TENANT_VISITS_SCANNER_ENABLED=false` legacy reads остаются global, а новые writes всегда получают exact default Organization/Club. Feature 5.2 client lookup продолжает принимать проверенный request context. Это сохраняет single-default UX и не разрешает второй production tenant: foundation hard guard остаётся обязательным.

Rollout:

1. DB dump и fresh/production-shaped rehearsal.
2. Deploy additive migration/runtime с `TENANT_VISITS_SCANNER_ENABLED=false`.
3. Проверить migration assertion, writer audit, default monitor/scanner/analytics/export parity.
4. Включать capabilities только в порядке Features 3 → 4.1 → 4.2 → 4.3 → 5.1 → 5.2 → 5.3.
5. Повторить two-Organization/two-Club IDOR, stale Membership/access, scanner ingress, realtime и flag-on/off smoke.

Rollback runtime: сначала выключить `TENANT_VISITS_SCANNER_ENABLED`; tenant columns и backfilled attribution не удалять. Push, merge, deploy и provisioning второго production tenant требуют отдельного решения.

## User Preview Gate

Неприменим для feature diff: client files, route paths, HTTP schemas, visible labels/states и scanner/reception workflow не изменены. Сохранены текущие Admin scanner/reception layout, mobile behavior, role/capability contract и realtime refetch UX. Независимый QA всё равно должен выполнить runtime reconciliation smoke существующих экранов после применения migration, но новый user-visible preview/approval не требуется.

## Acceptance commands

```text
server npm run tenant:visit-scanner-writes:audit
server npm run tenant:client-reference-writes:audit
server npm run tenant:staff-membership-writes:audit
server npm run tenant:account-writes:audit
server npm run tenant:routes:audit
server npm run tenant:cache-realtime:audit
server npm run tenant:files-workers:audit
server npm run tenant:providers:audit
server node --test --test-concurrency=1 tests/services/visits-scanner-tenant.db.test.js
server node --test --test-concurrency=1 tests/services/client-references-tenant.db.test.js
server node --test tests/scripts/visit-scanner-write-audit.test.js
server node --test tests/realtime/access-tenant-event.test.js
server npm run typecheck
server npm test
server npm run onboarding:audit:strict
server npm run openapi
client npm test
client npm run lint
client npm run build
git diff --check
```

Independent QA должна проверить exact feature diff, migration rollback graph, flag-on/off, same-org multi-club policy, forged/stale authority, concurrent retries, direct ORM/raw SQL attempts, tenant rooms и XLSX content до promotion.
