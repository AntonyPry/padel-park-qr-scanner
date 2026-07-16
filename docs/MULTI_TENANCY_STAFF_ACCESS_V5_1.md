# Feature 5.1 — Staff and membership identity

Статус: `implemented; independent SaaS QA required before promotion`.

Exact base: `882aa24399186f660efc7d78113185f88ceef2ac` from `codex/saas-multitenancy-integration`.

Feature branch: `codex/multi-tenant-staff-access-v5-1`.

Этот срез расширяет существующие `Staff`, `Account`, `Membership`, staff/account services, bootstrap и demo seeders. Он не создаёт параллельную identity/access подсистему и не захватывает Feature 5.2: `User`, CRM client references, visits/scanner, client bases/call tasks и другие downstream-домены остаются отдельными волнами.

## Data contract

Forward migration `20260716140000-add-tenant-staff-access-identity.js` выполняет порядок, необходимый для безопасного composite link:

1. Проверяет exact active default Organization и целостность принятого tenant foundation.
2. Проверяет каждую non-null `Account.staffId`: Staff существует, один Staff не назначен нескольким Accounts, Account имеет однозначную default Membership.
3. Добавляет nullable `Staff.organizationId`, backfill-ит exact default Organization, затем создаёт tenant-leading indexes, unique `(organizationId,id)` и FK к `Organization`.
4. Добавляет nullable `Membership.staffId` и backfill-ит его из compatibility `Account.staffId`.
5. Создаёт unique `(organizationId,staffId)` с допустимыми multiple `NULL` и composite FK `(organizationId,staffId) → Staff(organizationId,id)`.
6. Повторно проверяет Account/Membership/Staff parity и только после этого делает `Staff.organizationId NOT NULL`.

Foundation classifier обнаруживает `legacy`, `partial` и `ready` schema. Partial application и stale/cross-organization/duplicate Staff links fail closed. Legacy snapshots не читают новые колонки, поэтому принятая Feature 2 migration остаётся неизменной и её historical up/down tests продолжают работать.

Если первый `up` аварийно обрывается между DDL-шагами, migration удаляет только созданные этой незавершённой попыткой Staff/Membership schema objects и оставляет legacy `Account.staffId`; forced mid-DDL DB-test подтверждает возврат в legacy schema и успешный повторный `up`. Migration down предназначен только для development/emergency rollback. Он делает explicit preflight: exact default tenant, полная Account/Membership/Staff parity, отсутствие второго Organization, later migrations и внешних composite references. Проверенный down удаляет сначала Membership FK/unique/column, затем Staff FK/indexes/column; Account compatibility data остаётся. Normal production rollback — сначала выключить read capability, не удаляя backfilled tenant attribution.

## Runtime identity and writers

`Account.staffId` остаётся compatibility field для auth/JWT/session и legacy downstream includes. При этом `staffId` больше не является metadata-only field:

- create/update выполняются через `account-lifecycle.service.js`;
- Organization row lock берётся первым и сериализует Account/Membership/Staff relation updates внутри tenant;
- target Staff ищется только по `(organizationId,id)` и должен быть active;
- `Account.staffId` и `Membership.staffId` изменяются в одной DB transaction;
- forced failure после Account или Membership write откатывает обе стороны;
- unique composite key и service preflight не позволяют назначить Staff двум Memberships одной Organization;
- bootstrap создаёт Staff organization attribution и owner Membership link атомарно;
- archive/restore/permanent delete сохраняют last-active-owner и access-row invariants;
- permanent Account delete сначала удаляет access/Membership, затем Account; Staff не удаляется автоматически.

Staff create/update/archive/restore/permanent delete также транзакционны. Permanent delete блокируется при ссылке из Account, Membership или Shift. Деактивация/архивация Staff, связанного с последним active owner Membership, запрещена. `MembershipClubAccess` остаётся только authorization/access моделью; у Staff нет `clubId`, owner all-club discovery не изменён.

Demo Account seeder и demo CRM seeder создают scoped Staff, dual-write Membership link и делают cleanup внутри default Organization. Новый AST gate `npm run tenant:staff-membership-writes:audit` разрешает Staff/Membership mutations только lifecycle/staff/seeder writers; migrations исключены как immutable history. Существующий Account write audit продолжает контролировать compatibility field.

## Capability, reads and IDOR

Server-owned flag: `TENANT_STAFF_ACCESS_ENABLED`.

Он зависит от всех принятых capabilities Features 3–4.3:

- `TENANT_CONTEXT_ENABLED=true`;
- `TENANT_CACHE_REALTIME_ENABLED=true`;
- `TENANT_FILES_WORKERS_ENABLED=true`;
- `TENANT_PROVIDER_INTEGRATIONS_ENABLED=true`.

Flag не публикуется frontend как продуктовая настройка. При flag off Staff/Account list behavior остаётся legacy single-default, но все writes уже поддерживают tenant attribution и dual-write. При flag on каждый Staff/account read и mutation повторно проверяет active Organization + actor Membership из immutable organization TenantContext. Staff list/search/detail/update/delete используют organization predicate; foreign ID, forged Membership context и stale Membership возвращают одинаковый safe `404`.

Flag-on Account list/detail authority идёт через scoped Membership; Staff для ответа берётся из `Membership.staffId`. Realtime mutation middleware уже публикует `staff`/`accounts` changes только в organization rooms, а frontend query keys уже включают tenant key. Staff/account workflow и background refresh не менялись; единственная UI-правка переносит существующие controls карточки Staff на 390 px без изменения действий или desktop layout.

## Rollout and hard boundary

Rollout:

1. DB dump и fresh migration rehearsal.
2. Deploy additive migration и runtime с `TENANT_STAFF_ACCESS_ENABLED=false`.
3. Проверить foundation assertion, writer audits, demo seed up/down и Account/Membership parity.
4. Включать capabilities только в порядке Features 3 → 4.1 → 4.2 → 4.3 → 5.1.
5. Выполнить six-role API/browser smoke существующих `/admin/staff` и `/admin/users`.

Rollback: сначала выключить `TENANT_STAFF_ACCESS_ENABLED`; backfilled `Staff.organizationId` и `Membership.staffId` не удалять. Schema down допустим только после rollback preflight на exact single-default DB.

Hard boundaries:

- production остаётся exact single-default; второй production tenant и provisioning запрещены;
- `Account.staffId` пока не удаляется и не перестаёт обслуживать auth/JWT compatibility;
- scoped Staff не означает готовность User/clients, shifts/bookings, finance, visits/scanner, client bases/call tasks или provider downstream roots ко второму tenant;
- UI switcher, visual redesign, SaaS billing, merge, push и deploy вне scope.

## Acceptance commands

```text
server npm run tenant:staff-membership-writes:audit
server npm run tenant:account-writes:audit
server npm run tenant:routes:audit
server npm run tenant:cache-realtime:audit
server npm run tenant:files-workers:audit
server npm run tenant:providers:audit
server node --test tests/services/staff-access-identity.db.test.js
server npm run typecheck
server npm test
server npm run onboarding:audit:strict
server npm run openapi
client npm test
client npm run lint
client npm run build
git diff --check
```

Independent QA must review the exact feature diff and repeat migration down/up, flag-on/off API/browser smoke and two-organization IDOR tests before promotion. This document does not authorize push, merge or deploy.
