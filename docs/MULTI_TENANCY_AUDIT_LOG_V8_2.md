# Feature 8.2 — Tenant-safe AuditLog

## Scope

Срез расширяет существующие `AuditLog`, `/api/audit-logs` и `/admin/audit`. Новый журнал, route, filter или user-facing field не создается. `FinanceChangeLog`, `BookingChangeLog`, onboarding events/progress/training mode и другие domain histories остаются в своих принятых контурах.

## Ownership and actor contract

| Field | Product meaning | Written by | Read/used by | Visible behavior or external consumer | Validation/permissions | Lifecycle/test |
| --- | --- | --- | --- | --- | --- | --- |
| `organizationId` | Immutable owner каждого generic audit event | `audit.service` from fresh request Membership; flag-off hook uses exact default Organization | list/count/filter/pagination scope, FK, indexes, DB insert trigger | Hidden from API/UI; current backend security boundary | active Organization + active Account/Membership; owner/manager list permission | backfill to default Organization; two-Organization denial; down refuses ownership loss |
| `clubId` nullable | Exact provenance only when the completed mutation route is club-scoped | `audit.service` from fresh effective-role context | DB provenance/FK validation and security tests | Hidden from API/UI; organization audit view remains consolidated | null for membership/organization routes; active same-Organization Club for club routes | legacy rows remain null because exact historical Club is unknowable; immutable after insert |
| existing `accountId` | Global actor identity snapshot | existing audit middleware/service | account join and audit response | Existing account name/email behavior | fresh active Account and same-Organization Membership at write boundary | account FK removed so hard deletion cannot mutate immutable history; numeric snapshot remains |
| existing `role` | Membership role or effective Club role at event time | fresh audit writer boundary | response account role fallback and DB actor-authority trigger | Existing response shape; no new UI field | must equal current Membership role or effective Club override on insert | immutable historical snapshot survives later role/membership changes |

`membershipId` is intentionally absent: it has no current reader or visible/technical consumer once writer authorization has been revalidated. Persisting it would create a dormant lifecycle FK and would make membership cleanup mutate or block immutable history.

## Runtime boundary

- `TENANT_AUDIT_LOG_ENABLED` depends on the accepted `TENANT_SHIFTS_REPORTS_ENABLED` chain.
- With the flag on, writer and list boundaries reject plain/cloned/stale request contexts and reload active Organization, Account, Membership, Staff identity, Club access and effective role inside the current transaction.
- Writer stores `organizationId` always and `clubId` only for a declared club route. Failed business requests that reached the audit middleware use the same async `finish` writer.
- List, count, filters and deterministic pagination always include `organizationId`; joined Staff name is constrained to the same Organization.
- The existing client timeline reader applies the same Organization predicate to its `AuditLog` slice instead of introducing a parallel history store.
- With the flag off, existing global list behavior and default-tenant writes remain compatible. Second production tenant/provisioning stays blocked by the existing rollout gate.

## Immutability and migration

- ORM instance update/destroy and bulk mutation hooks fail closed.
- MySQL `BEFORE UPDATE` and `BEFORE DELETE` triggers reject raw, ORM and bulk mutation bypasses.
- MySQL insert trigger validates active Organization, exact Club provenance and actor Membership/effective role.
- The legacy `accountId ON DELETE SET NULL` FK is removed: deleting an Account no longer rewrites history. Organization/Club FKs use `RESTRICT`.
- Migration classification is exact and definition-aware for reserved columns, indexes, FKs, triggers and the legacy account FK: `legacy`, `ready` or refused `partial`.
- Failed-up cleanup removes only artifacts whose captured definition is unchanged; ownership loss requires operator repair.
- Legacy rows backfill only `organizationId`; `clubId` remains null. Down refuses second-Organization state, cross-Organization ownership loss, orphan actor snapshots and constraint-name collision.

## Realtime, cache, export and onboarding

- Audit is not Redis-cached and has no export endpoint.
- Successful async AuditLog insert publishes an organization-scoped `audit` invalidation only after the row commits. Realtime permission stays equal to existing `auditView` (`owner`, `manager`).
- Public response/OpenAPI/generated client shape is unchanged; tenant fields are not selected by the public mapper.
- Audit history is immutable and is not training-data cleanup material. Onboarding routes, actions, events, training data and instructions are unchanged.
