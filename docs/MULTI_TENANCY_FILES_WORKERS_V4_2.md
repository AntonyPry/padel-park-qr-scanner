# Feature 4.2 — Files and workers isolation

Статус: `implemented on feature branch — pending independent SaaS QA`.

Base: `a3129af5bab40864a4dd62f04b0203874277902f` from `origin/codex/saas-multitenancy-integration`.

Feature branch: `codex/multi-tenant-files-workers-v4-2`.

Этот срез расширяет принятые tenant foundation/context/cache/realtime contracts. Он не добавляет tenant columns в `ShiftReport`, `TelephonyCall`, provider connections или остальные business tables и не снимает hard single-default rollout guard.

## Runtime file inventory

Статический gate: `server npm run tenant:files-workers:audit`.

| Path | Scope | Persistence | Feature 4.2 decision |
| --- | --- | --- | --- |
| Shift report photo upload/download/delete | club | local disk + JSON metadata in `ShiftReportAnswer.attachments` | migrated first production path; new tenant storage writes, controlled legacy dual-read |
| Legacy `server/var/shift-report-attachments/<reportId>/<uuid>.<ext>` | default club only | local disk | read/delete only after exact legacy metadata + default tenant proof; no new writes when flag is on |
| Tenant storage `server/var/tenant-storage` or `SETLY_STORAGE_ROOT` | organization/club | local disk | canonical atomic storage primitive |
| Finance/payroll/visits/corporate XLSX exports | route scope of parent domain | in-memory response buffer | no persistent file; deferred tenant business filtering follows parent domain waves |
| Node/Python transcription input, split channels and chunks | claimed job tenant | ephemeral | opaque tenant/claim namespace; attempt-owned cleanup |
| Python dashboard SQLite | platform worker local state | persistent Docker volume | partitioned by opaque organization/club/job/attempt; claim token, phone, names, URLs and transcript bodies are not persisted |
| Checked-in transcription glossary | global configuration | read-only | remains global |
| Optional whisper model cache | global worker infrastructure | persistent volume | remains global; contains no CRM/customer identity |
| Explicit local sample commands | global developer command | ephemeral | unchanged and excluded from CRM claim flow |
| Worker stdout/dashboard lifecycle events | platform operational | operational logs/SQLite events | redacted; safe IDs/stage only, no credential, recording URL, phone, raw audio/transcript |
| OpenAPI/QA/generated development outputs | developer tooling | generated outside runtime business storage | not a production business file path |

No second generic attachment subsystem or `FileObject` model was introduced: production file persistence is currently limited to shift-report attachments. The common primitive is only the storage key/path implementation reused by that real integration point.

## Tenant storage contract

Canonical key layout:

```text
<opaque-org>/<opaque-club-or-org>/<domain>/<opaque-record>/<opaque-file>
```

`buildTenantStorageKey` accepts only server-owned numeric organization/club identity plus server-owned domain/record/file identity. Every physical component except the audited domain is a versioned SHA-256-derived opaque value. Original filename remains response metadata and never affects disk layout.

Security properties:

- exactly five normalized relative components; absolute paths, backslashes, `.`/`..` and malformed domains are rejected;
- resolved parent and object must stay below the configured real storage root;
- storage root, intermediate namespace and object symlinks are rejected;
- new write creates an exclusive temp file inside the final tenant namespace, writes and `fsync`s it, atomically links it into place without replacement, removes the temp name and `fsync`s the directory;
- a conflicting key is not overwritten and partial temp files are removed;
- DB failure after a file write triggers best-effort file cleanup; failure to delete after metadata removal leaves a detectable orphan for manifest audit;
- metadata verification recomputes the expected key from immutable tenant/report/answer/file identity before read/delete;
- cross-tenant mismatch returns the same safe not-found result.

Existing upload contract remains: maximum 10 photos per answer, 5 MiB per photo, JPEG/PNG/WEBP/GIF/HEIC/HEIF allowlist and current owner/manager/admin/report access rules.

## Shift-report legacy dual-read and migration

New attachment JSON metadata contains schema version, organization/club, domain, report/answer/file identity, storage key, size and SHA-256 checksum. Public serialization removes internal storage key/path and tenant metadata.

Legacy fallback is allowed only when all conditions hold:

1. metadata has no tenant-storage fields;
2. attachment ID is a UUID;
3. MIME maps to the exact expected extension;
4. relative path equals `<numeric reportId>/<same UUID>.<extension>`;
5. request context resolves to the exact active default organization/club;
6. real file is regular, non-symlinked and contained by the legacy root.

Migration utility:

```text
server npm run tenant:files-workers:attachments              # dry-run
server npm run tenant:files-workers:attachments -- --apply   # copy + metadata switch
server npm run tenant:files-workers:attachments -- --rollback
```

It is idempotent and reports schema/version/generatedAt, roots, per-tenant/domain counts/bytes/checksum, individual opaque storage keys/checksums, missing files, mismatches and hashed orphan paths. Apply copies/verifies before changing metadata. Rollback requires a checksum-matching legacy copy and changes metadata only. Neither direction deletes physical files automatically.

`ShiftReport` is not tenant-scoped yet. Attachment metadata is therefore an additional immutable file boundary, not a substitute for Feature 8 scoped report reads.

## Transcription job attribution

The existing `TelephonyTranscriptionJob` queue is extended, not duplicated.

Additive fields:

- immutable `organizationId`, `clubId`;
- `claimId`, SHA-256 `claimTokenHash`, `claimExpiresAt`;
- trusted `claimWorkerCredentialId`, `workerProtocolVersion`.

Migration finds the exact default slugs from the ADR, requires exactly one active default organization/club, detects orphan parent calls, backfills all existing jobs deterministically and then adds the composite `(organizationId, clubId) -> Clubs(organizationId, id)` FK plus tenant queue/call indexes. It never reads tenant IDs from environment variables.

Before/after job count and checksum cover business identity/status/attempt. Down removes only Feature 4.2 attribution/lease columns and indexes after the FK; transcript/job rows and physical files remain. Reapply restores the same attribution. An ambiguous second tenant fails before adding columns.

New enqueue, auto-enqueue, backfill and retry preserve server-resolved tenant attribution. Current `TelephonyCall` has no tenant columns: while the production hard gate remains single-default, attribution is verified against the exact default tenant/request context. A second-tenant call relation is deliberately not simulated and remains deferred to the telephony domain wave.

User list/detail queries include tenant predicates when isolation is enabled. A different tenant ID yields an empty list or safe not-found. List/worker queue projections still omit raw transcript, AI payload and transcript bodies.

## Worker credential and lease protocol

Chosen credential contract: audited internal **platform transcription worker**.

`CRM_WORKER_TOKEN` authenticates a configured platform credential; it is not tenant authority and grants no normal CRM list/export permission. Credential ID comes from trusted server config (`CRM_WORKER_CREDENTIAL_ID`, with a non-secret default), never from request body. The server selects the next tenant-attributed job.

Protocol version: `2`.

- worker sends `X-Worker-Protocol-Version: 2` and an informational opaque instance label;
- claim returns minimal job, opaque tenant routing metadata and a random claim ID/token/expiry/attempt;
- only the token hash is stored in CRM DB;
- audio-reference, progress, result and fail require the active claim ID/token plus matching configured credential/protocol;
- each heartbeat/audio-reference extends only the current lease;
- expiration permits a new claim with a new claim ID/token and incremented attempt;
- stale, expired, wrong-credential or old-attempt mutations return the same safe 404;
- worker-supplied organization/club values are ignored and cannot reassign a job;
- bootstrap-pending/invalid foundation remains blocked by the existing global request gate.

When `TENANT_FILES_WORKERS_ENABLED=false`, legacy protocol v1 remains accepted for the rollout window and current single-club behavior is preserved. When enabled, v1 receives `426 WORKER_PROTOCOL_UPGRADE_REQUIRED`; there is no indefinite insecure fallback.

## Node and Python worker parity

Both implementations:

- send protocol v2 and bind every job mutation to the in-memory lease;
- build temp paths from opaque organization/club/claim identity, never call ID, name, phone or URL;
- remove only their active attempt directory when `DELETE_AUDIO_AFTER=true`;
- preserve crash-reclaim semantics: an abandoned token expires and cannot complete the reclaimed attempt;
- send only audio to ASR and normalized segment text to the optional LLM;
- accept LLM edits by `segmentId` while retaining CRM-owned speaker/channel/start/end and tenant/job identity;
- redact credential, URL, phone, filesystem path and transcript bodies from operational logs.

Python SQLite stores opaque routing, CRM job ID, attempt, claim ID, protocol and non-sensitive stage metrics. The claim token remains only in controller memory. A uniqueness constraint prevents duplicate `(organization, club, job, attempt)` local state.

Ubuntu laptop, WireGuard, Docker endpoints, ASR and Ollama addresses are unchanged.

## Background runners

| Component | Isolation-on classification | Decision |
| --- | --- | --- |
| transcription worker | tenant-routed platform worker | enabled through attributed job + lease |
| recurring call-task scan | deferred to Feature 5 | fail closed; `ClientBase`/`CallTask` are not tenant-scoped |
| Beeline subscription runner | deferred to Feature 4.3 | fail closed; provider connection resolution/locks absent |
| Telegram/VK bots | deferred to Feature 4.3 | fail closed; provider/bot connection routing absent |

Startup prints an audited deferred component list and does not silently start a global scan when isolation is on. Direct recurring-run service calls receive `TENANT_BACKGROUND_COMPONENT_DEFERRED`. Provider fanout, connection secrets, idempotency and advisory locks are not implemented here.

## Capability, rollout and rollback

Server-owned flag: `TENANT_FILES_WORKERS_ENABLED`.

- requires both `TENANT_CONTEXT_ENABLED=true` and accepted Feature 4.1 `TENANT_CACHE_REALTIME_ENABLED=true`; invalid combinations fail at app construction;
- it is intentionally not exposed to frontend auth capabilities because UX does not branch on it;
- off: legacy attachment writes and worker v1 remain during the finite rollout window;
- on: new tenant attachment writes, immutable job attribution, minimal worker payload and lease-aware API are mandatory;
- legacy attachment dual-read stays enabled for eligible default-tenant metadata;
- rollback turns this flag off but never removes attribution columns, new files or transcript data.

Rollout order:

1. back up DB **and uploads**; run attachment manifest dry-run;
2. deploy/migrate server with flag off;
3. deploy both Node/Python worker v2 and verify protocol headers/claim;
4. wait for old worker processes to drain/stop;
5. enable Feature 3, Feature 4.1 and Feature 4.2 flags together;
6. apply attachment copy after dry-run review; retain legacy files until separate backup/copy verification decision;
7. verify claim → audio → ASR/LLM → result and shift attachment upload/download.

Rollback order: disable `TENANT_FILES_WORKERS_ENABLED`, keep additive DB columns/new storage, restore previous binaries only after v2 requests stop, and use metadata rollback only when checksum-matching legacy copies are confirmed.

## Backup and restore

A DB dump without tenant storage/legacy uploads is incomplete. Full installation backup contains:

- DB dump;
- legacy and tenant storage roots;
- manifest with schema/version/generatedAt/root and per-tenant/domain counts/bytes/checksums;
- no secrets, original names, phone numbers or transcript/audio content in the manifest.

Restore verifies DB attachment metadata against physical checksum and reports missing/mismatched/orphan files before traffic. Selective tenant restore is unsupported until a documented FK/identity remap contract exists. Local disk remains an explicit availability/scale limitation; S3/object storage is not introduced by this feature.

## Automated acceptance commands

```text
server npm run tenant:files-workers:audit
server node --test --test-concurrency=1 tests/files-workers/*.test.js
server DB_* node --test --test-concurrency=1 tests/migrations/files-workers-attribution.db.test.js
server DB_* node --test --test-concurrency=1 tests/services/telephony.files-workers.db.test.js
workers/transcription-worker npm test
server npm run tenant:account-writes:audit
server npm run tenant:routes:audit
server npm run tenant:cache-realtime:audit
server npm run onboarding:audit:strict
server npm run openapi
server npm run typecheck
server npm test
client npm run lint && npm test && npm run build
git diff --check
```

Hardware ASR smoke against the laptop is optional. Local code acceptance uses mocked ASR/LLM and DB-backed CRM claim/lease checks.

## Deferred limitations

- Shift-report and TelephonyCall parent business rows remain single-default until their domain waves.
- Provider connections, webhook routing/idempotency, Beeline subscription fanout/locks and bots remain Feature 4.3.
- Recurring call-task tenant fanout remains Feature 5.
- Exports remain in-memory and inherit their current parent-domain scope; no persistent export storage was added.
- Local disk has no multi-host replication and no object-storage durability.
- No provisioning, visible club switcher, second production tenant, SaaS billing, merge or deploy is part of this slice.
