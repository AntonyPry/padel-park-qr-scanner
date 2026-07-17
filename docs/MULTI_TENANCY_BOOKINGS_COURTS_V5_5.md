# Feature 5.5 — tenant-safe бронирования и корты

Статус документа: accepted exact SHA
`d9ff18c27bb663203c5713ce27b8a9e513f67770` после независимого re-review без
P0–P3 findings и fast-forwarded в `codex/saas-multitenancy-integration` без
reconciliation merge. `main` и production не изменялись.

## Domain classification

- Club-local roots: `Court`, `BookingSettings`, `BookingPriceRule`,
  `BookingScheduleException`, `BookingSeries`, `Booking`, `Utilizations`.
- Organization-wide relation: `Booking.userId` / `BookingSeries.userId` указывают
  на `User` той же Organization.
- Inherited children: `CourtBlock` наследует tenant от `Court`;
  `BookingParticipant` и `BookingChangeLog` — от `Booking`. Отдельные tenant-поля
  этим children не добавлены, потому что текущим consumers достаточно
  authoritative parent, а DB triggers валидируют reparenting.
- `TrainingPlan` остаётся частью отдельного trainer/training slice. Booking routes
  сначала доказывают club-scoped parent, после чего используют существующий
  training workflow.
- Provider/bot/import booking ingress в текущей системе отсутствует. Нового
  ingress и dormant provider fields Feature 5.5 не создаёт.

## Persisted fields

| Field | Meaning and authority | Writer / consumers | Visibility and lifecycle |
|---|---|---|---|
| `organizationId`, `clubId` on all seven roots | Immutable owner Organization/Club. Источник — revalidated frozen club `TenantContext`; flag-off — exact default tenant. | Booking/court/rules/utilization services; scoped lists, conflicts, analytics, training cleanup, DB constraints/triggers. | Hidden from response mappers/OpenAPI. Set on insert, immutable; removed only by guarded migration rollback. |
| `Booking.creationKeyHash`, `creationPayloadHash` | SHA-256 of optional `Idempotency-Key` and canonical create request. | `createBooking`; scoped unique index prevents duplicate retries. | Hidden, nullable for legacy/no-key rows, creation-immutable. |
| `Booking.lastMutationKeyHash`, `lastMutationPayloadHash` | Last optional idempotent update/status request. | `updateBooking` / status route; suppresses repeated mutation, history and onboarding event. | Hidden, nullable, replaced only by a later keyed mutation. |
| `BookingSeries.creationKeyHash`, `creationPayloadHash` | Optional idempotent recurring-series creation. | `createBookingSeries`; protects the series and generated occurrence set. | Hidden, nullable, creation-immutable. |
| `BookingSeries.lastMutationKeyHash`, `lastMutationPayloadHash` | Optional idempotent series archive/cancel-future request. | `archiveBookingSeries`; rejects key reuse with a different payload. | Hidden, nullable, replaced only by a later keyed mutation. |

Request body/query/header `organizationId` and `clubId` are never authority and
are never copied into these fields. Existing response shapes deliberately omit
all tenant and idempotency columns.

Frozen object shape is not authority. Feature 3 `TenantContext` instances are
registered by the foundation resolver in a module-private `WeakSet`; copied or
hand-built objects are rejected. Every public booking/court/rules/utilization
service boundary reloads the active Account → Membership → Organization → Club
and non-owner access graph. Internally resolved booking contexts use a separate
non-forgeable brand but are revalidated again when they cross a public boundary.

## Invariants and runtime scope

- Every root references the same active `Club(organizationId,id)`; root tenant
  attribution and creation idempotency attribution are DB- and ORM-immutable.
- Booking/series → Court is same Organization/Club; → User is same Organization.
- Responsible Staff must satisfy active
  `Account.staffId = Membership.staffId = Staff.id`, same Organization and owner
  or active `MembershipClubAccess` for the authoritative Club.
- Booking → series is checked by DB trigger without replacing the legacy
  `ON DELETE SET NULL` lifecycle.
- Participant insert/update validates User Organization and rejects cross-tenant
  parent movement. CourtBlock may change Court only inside the old tenant.
  BookingChangeLog parent is immutable. Existing creator/updater/training Account
  references on Booking/series/blocks/history must have a Membership in the
  authoritative parent Organization; historical inactive memberships remain
  valid provenance and no new actor field is introduced.
- Court locks are acquired in sorted order after the active Club row is locked.
  Availability, overlap, series preview/create, reschedule and cancellation query
  only the authoritative Club. An optional `Idempotency-Key` serializes at Club
  level and has a scoped unique DB fallback.
- Client detail became a club endpoint because its payload contains booking
  history. Organization-scoped client mutations retain exact-default behavior;
  when an Organization has more than one active Club they return empty booking
  sections rather than guessing a Club.
- Existing Socket.IO middleware and frontend query keys already include
  Organization/Club. Feature 5.5 keeps those contracts and makes every backend
  booking producer/consumer use the same frozen context. There is no server-side
  booking cache or dedicated booking export endpoint.
- Visits analytics may calculate its informational booking payment reference only
  from Booking rows attributed to the active Organization/Club. Finance,
  certificates and subscriptions remain out of scope and are not declared safe.

## Capability and default parity

`TENANT_BOOKINGS_COURTS_ENABLED=true` requires the accepted
`TENANT_CLIENT_BASES_CALL_TASKS_ENABLED=true` chain. Flag-off reads keep legacy
single-club behavior; all new writes still receive exact default Organization and
Club. The foundation guard and migration rollback both refuse a second
production tenant.

## Migration contract

Migration `20260718120000-add-tenant-bookings-courts.js` is additive and
data-aware:

1. It inventories the exact reserved column/table multiset and compares full
   canonical column metadata: authoritative integer type/signedness, varchar
   length, nullability, default, `EXTRA`, charset/collation, comment and
   generation expression. Index definitions include table/name/uniqueness,
   exact ordered fields, prefix length, direction and index type; FK order/actions
   and normalized trigger definitions remain exact. Classification is only
   `legacy`, `ready` or `partial`.
2. Any partial/lookalike state fails before default-tenant/business preflight and
   before DDL/DML.
3. Legacy preflight requires the exact active default Organization/Club and a
   valid booking/court/client/staff/actor/child graph.
4. Tenant columns are added nullable, backfilled, validated and made `NOT NULL`;
   hidden idempotency hashes remain nullable.
5. Global unique Court name, schedule date and utilization date indexes are
   replaced with Club-scoped uniques, allowing identical values in different
   Clubs.
6. Forced-stage cleanup captures the INFORMATION_SCHEMA signature of every
   artifact created or removed by the current invocation. Before any cleanup it
   reloads all signatures; a same-name changed/moved artifact is preserved and
   cleanup fails with an ownership error instead of deleting it. Only exact
   owned artifacts are removed and only exact captured global uniques restored.
7. Down migration requires exact ready definitions, exact single-default data,
   no later migrations and no external tenant references. A second tenant or
   partial schema is mutation-free refusal.

## Rollout and rollback

1. Apply migration with runtime flag off.
2. Run DB/security/concurrency, direct-write, route, foundation and full test
   gates.
3. Enable the server-owned flag and reconcile six roles plus two Organizations /
   two Clubs fixtures.
4. Runtime rollback: disable the flag. Schema rollback is optional and only via
   the guarded down migration; second-tenant provisioning, merge, deploy and
   production enablement require a separate headquarters decision.
