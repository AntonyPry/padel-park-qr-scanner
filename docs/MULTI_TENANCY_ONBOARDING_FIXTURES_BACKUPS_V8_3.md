# Feature 8.3 — Tenant-safe onboarding, fixtures and backups

## Extension decision

Feature 8.3 extends the existing onboarding catalog, progress, training-mode and event services. Catalog/task definitions remain global versioned metadata. No parallel onboarding store, provisioning API/CLI, second production tenant or visible CRM workflow is introduced.

## Persisted fields and current consumers

| Field | Meaning and source | Current consumer |
| --- | --- | --- |
| `OnboardingProgress.organizationId/membershipId` | authoritative active Membership reloaded from request context | membership-scoped progress reads/writes/reset/metrics and DB constraints |
| `OnboardingProgress.clubId` nullable | Club that supplied an action checkpoint | prevents another Club from completing the same in-progress action lesson |
| `OnboardingTrainingMode.organizationId/membershipId/clubId` | exact owner Membership and Club of the one allowed session | training-mode lookup, marker generation, summary/cleanup ownership and expiry |
| `sessionId/expiresAt` | random UUID on a new enable transition; 24-hour default expiry | exact artifact tagging, cleanup, stale-session disable |
| `OnboardingEvent.organizationId/membershipId/clubId` | immutable event authority snapshot | isolation, idempotency and cleanup selection |
| `OnboardingEvent.idempotencyKey` | SHA-256 of tenant, event and entity identity | prevents a replay from progressing a lesson twice |
| `trainingSessionId` on existing training-tagged roots | current training session copied by existing writers | exact summary/cleanup and training-scope mutation guards |

`accountId` remains a technical actor/compatibility snapshot on onboarding rows and existing artifacts. It is not the ownership key; DB triggers require it to match the authoritative Membership.

## Runtime and lifecycle

- `TENANT_ONBOARDING_ENABLED` depends on `TENANT_AUDIT_LOG_ENABLED` and therefore the accepted capability chain.
- Public membership/organization/club boundaries reject cloned, forged or stale contexts and reload active Account, Membership, Organization, Club, Staff/access and effective role.
- Training mode is Club-scoped. Only one row/session exists per Membership; an enabled session cannot be moved to another Club.
- Expired mode is disabled on access. Cleanup remains available for its retained session ID, deletes only exact account/session/role artifacts inside the verified tenant, then clears the session marker.
- Onboarding event ownership is immutable; deletion remains allowed only through the canonical session cleanup lifecycle.
- Public response payloads and visible routes/tasks remain unchanged. Only generated tenant scope metadata for training-mode and practice-start becomes Club-scoped.

## Fixtures and operations

- Demo account/data and performance seed paths require the exact initialized default `padel-park` Organization and Club and fail when another Organization/Club exists. They are not provisioning mechanisms.
- Account fixture writes preserve Account/Membership/access parity and the last-owner invariant through the existing lifecycle adapter.
- Performance cleanup and creation use explicit Organization/Club predicates and attribution.
- API smoke and performance benchmark discover the authenticated recommended context and send explicit tenant headers.
- Multi-tenant test fixtures remain test-helper-only and are permitted only in isolated test databases.

## Backup/restore

`tenant:backup:manifest` inventories and checksums the consistent database dump, tenant storage, legacy upload roots and retained attachment orphan-detector output. It records non-secret integration connection identity metadata and the worker-state rebuild policy. Verification fails for missing, changed or orphaned files. Restore is installation-wide into an empty environment; tenant-selective restore is unsupported without a complete identity/FK/file/provider remap contract.
