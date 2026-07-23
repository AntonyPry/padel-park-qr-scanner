# Setly application ingress abuse throttling

SEC-A4a and SEC-A4b share one staged application containment layer. It covers
the five credential-entry surfaces plus five provider ingress and seven
transcription-worker operations. The candidate is default-off and does not
claim that production enforcement, the I4 proxy contract, provider retry/burst
behavior or exact-release worker/Redis capacity is ready.

## Covered surfaces and v1 budgets

Every request reserves all configured dimensions before validation, database
lookup, password verification, session creation, activation inspection or
activation mutation. A successful request therefore consumes the same temporary
request budget as a failed request; this avoids a post-verification concurrency
race and does not create an account-existence oracle.

| Surface | Pseudonymous subject | Limit / fixed window | Shared peer limit | Shared credential-class limit |
| --- | --- | ---: | ---: | ---: |
| `POST /api/auth/login` | canonical email | `8 / 300s` | `120 / 300s` | `600 / 300s` |
| `POST /api/auth/bootstrap` | canonical email | `3 / 900s` | `12 / 900s` | `30 / 900s` |
| `POST /api/installation/provisioning/session` | canonical operator username | `6 / 600s` | `30 / 600s` | `60 / 600s` |
| `POST /api/installation/provisioning/activation/status` | canonical activation token | `12 / 300s` | `120 / 300s` | `300 / 300s` |
| `POST /api/installation/provisioning/activation/consume` | canonical activation token | `5 / 600s` | `30 / 600s` | `60 / 600s` |

Provider budgets reserve fixed route/provider-class and socket-peer dimensions.
Connection-first routes also reserve pseudonymous connection and credential
dimensions. The rejected legacy Beeline route has no credential input. The
legacy bare Evotor route remains optional-secret when its existing feature
state permits that behavior; throttling contains abuse but does not make that
path authenticated or close the separate A9 finding.

| Provider surface | Connection | Credential | Provider class | Socket peer | Route |
| --- | ---: | ---: | ---: | ---: | ---: |
| `POST /api/webhooks/evotor` | — | `300 / 60s` | `600 / 60s` | `600 / 60s` | `600 / 60s` |
| `POST /api/webhooks/evotor/:connectionPublicId` | `600 / 60s` | `600 / 60s` | `1800 / 60s` | `1200 / 60s` | `1800 / 60s` |
| `POST /api/integrations/beeline/events` | — | — | `120 / 60s` | `120 / 60s` | `120 / 60s` |
| `POST /api/integrations/beeline/events/:connectionPublicId` | `1200 / 60s` | `1200 / 60s` | `3600 / 60s` | `2400 / 60s` | `3600 / 60s` |
| `POST /api/integrations/beeline/events/:connectionPublicId/:callbackToken` | `1200 / 60s` | `1200 / 60s` | `3600 / 60s` | `2400 / 60s` | `3600 / 60s` |

Worker budgets reserve the supplied shared credential plus fixed worker-class,
socket-peer and exact-route dimensions. Worker instance labels, job IDs and
claim tokens are never authority or limiter subjects. These defaults allow 60
Node polls/claims per ten-minute interval and concurrent dashboard polling while
bounding a stolen shared credential and rotating invalid tokens.

| Worker operations | Credential | Worker class | Socket peer | Route |
| --- | ---: | ---: | ---: | ---: |
| queue, claim, audio-reference | `600 / 60s` | `1200 / 60s` | `600 / 60s` | `1200 / 60s` |
| progress | `3000 / 60s` | `6000 / 60s` | `3000 / 60s` | `6000 / 60s` |
| result, fail, worker-retry | `300 / 60s` | `600 / 60s` | `300 / 60s` | `600 / 60s` |

The limit is inclusive: for `8 / 300s`, attempts 1–8 reach the existing handler
and attempt 9 is denied. A fixed window starts on its first reservation, is never
extended by later denials, and expires automatically. There is no Account,
Staff, operator or activation-row lock field and no permanent lockout.

In `enforce`, every surface returns the same response before expensive hashing
or mutations:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: <positive integer seconds>
Content-Type: application/json

{"error":"Слишком много попыток. Повторите позже","status":429,"code":"AUTH_RATE_LIMITED"}
```

Existing success, validation and credential-error responses are unchanged when
the request is within budget. Invalid identifiers use one fixed invalid class;
they cannot manufacture a new key per arbitrary invalid string.

Provider denial is attached after route classification and before connection
resolution, secret/capability comparison, provider body parser and controller.
It returns plain-text `429 Too Many Requests` with a positive `Retry-After` and
does not expose provider or connection details. Existing delivery, success and
non-throttled rejection semantics are unchanged below the limit.

Worker denial is attached after worker route classification and before worker
token/protocol validation, controller, database and lease mutation. The global
`express.json({ limit: '6mb' })` is intentionally unchanged and runs before the
worker router, so SEC-A4b does **not** claim worker pre-parser protection.
Enforced worker denial is stable and generic:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: <positive integer seconds>
Content-Type: application/json

{"error":"Worker request rate limited","status":429,"code":"WORKER_RATE_LIMITED"}
```

Node and Python workers accept only a positive decimal-seconds `Retry-After`,
cap it at 300 seconds and otherwise keep the configured poll interval. Poll,
claim, dashboard queue and manual retry scheduling honor the resulting cooldown.
There is no recursive HTTP retry. A 429 from audio-reference, progress, result,
fail or worker-retry does not trigger an automatic replay; specifically, a
rate-limited claimed operation is left for the existing lease lifecycle rather
than generating a new `fail` mutation.

## Configuration contract

`AUTH_RATE_LIMIT_MODE` accepts exactly `off`, `report` or `enforce` and defaults
to `off`. Off mode performs no counter work, emits no decision event, requires no
new secret or store, and adds no 429 response.

Every active (`report` or `enforce`) process fails startup unless all required
values are valid:

- `AUTH_RATE_LIMIT_VERSION=v1`;
- `AUTH_RATE_LIMIT_SECRET`: external random secret, 32–1024 UTF-8 bytes;
- `AUTH_RATE_LIMIT_SECRET_ID`: non-secret rotation label matching
  `[A-Za-z0-9][A-Za-z0-9._-]{0,31}`;
- `AUTH_RATE_LIMIT_STORE=local|redis`;
- in Redis mode, a `redis:`/`rediss:` `AUTH_RATE_LIMIT_REDIS_URL` or existing
  `REDIS_URL`;
- bounded integer controls: `AUTH_RATE_LIMIT_SHARDS=1024` (`64..65536`),
  `AUTH_RATE_LIMIT_LOCAL_MAX_KEYS=4096` (`16..100000`), Redis timeout
  `500ms` (`25..10000`) and retry backoff `30000ms` (`100..300000`);
- optional `AUTH_RATE_LIMIT_POLICY_JSON`, a strict partial override containing
  only the 17 known surfaces, their existing dimensions, and integer
  `limit=1..1000000`, `windowSeconds=1..86400`.

The secret and its value never enter keys, events, error payloads or source
control. Provision it through the protected runtime configuration used by every
process. Keep the secret and ID stable across processes and restarts. Rotate
them atomically; rotation intentionally grants at most one fresh temporary
budget while old namespaced keys expire within the longest configured window.
Retain the previous secret only for an authorized, time-bounded rollback window
outside runtime and source control.

The kill switch is `AUTH_RATE_LIMIT_MODE=off`. Rollback may also return
`enforce -> report` while preserving safe decisions. Do not delete Account,
Staff, operator-session or activation data to recover from a limiter problem.

## Pseudonymization, peer input and cardinality

The limiter immediately applies an O(1) UTF-16 length guard before trim, NFKC,
regex, UTF-8 scan or HMAC. It canonicalizes only the required email, username,
activation token, provider connection/capability/credential or supplied worker
credential. Passwords, cookies, session IDs, job/claim tokens, worker instance
labels, body/query data and PII are never ingress inputs. Raw provider/worker
tokens and `Authorization` values never enter keys, events or errors.
HMAC-SHA-256 with the external limiter secret maps the canonical value to one
of a fixed number of numeric shards. Storage keys
contain only the fixed namespace, contract/secret ID, surface, dimension and
numeric shard. Decision events contain only the same keyed shard pseudonym,
counts, limits, outcome and store state; they do not enter `AuditLog` and do not
create a parallel audit pipeline.

The source dimension reads only `req.socket.remoteAddress`, the exact network
peer connected to Node. It never reads `req.ip`, `X-Forwarded-For` or
`X-Real-IP`, and this slice does not set Express `trust proxy`. Behind Nginx the
exact peer may therefore be the proxy shared by many real users. Production
peer enforcement remains blocked until I4 provides exact hop/CIDR topology,
direct-backend closure, overwrite semantics, spoof tests, distinct-client
evidence, IPv4/IPv6/NAT behavior and a missing-signal fallback. Default-off and
report evidence do not satisfy that dependency.

With the default 1024 shards, the Redis namespace has at most 66,560 live
surface/dimension shard keys, plus old secret-ID namespaces waiting for their
bounded TTL after an authorized rotation. The local store hard-caps live keys;
after reserving its final slot, unseen shards share one temporary overflow
bucket. Expired entries are deleted on access and periodic/capacity cleanup.
This trades a bounded temporary collision/denial radius for non-negotiable
memory and attacker-cardinality bounds.

## Redis, degraded mode and concurrency

Redis mode uses the repository's existing `redis` dependency but not
`cache.service`: security counters have a dedicated
`setly:security:auth-rate-limit:v1:<secret-id>` namespace, a separate client,
no boot-random namespace and no cache fail-open behavior. One Lua operation
per dimension atomically increments the fixed-window counter and creates or
repairs its TTL. Concurrent requests can pass only up to the configured limit
for each Redis bucket.

Connection, command, timeout or invalid-result failure immediately uses the
bounded local store and records `local_degraded`; it never silently becomes
unlimited. The Redis client retries only after the configured backoff. If an
unexpected limiter failure escapes both stores, active middleware fails closed
with a generic 503 before the credential handler.

Degraded local counters are process-local. A Redis outage can therefore add at
most one local window budget per process/bucket beyond already accepted Redis
reservations. Redis recovery does not merge local counters. A Redis restart
without persisted keys, application process restart in local mode, or secret
rotation grants one fresh temporary budget. Multiple local-mode processes each
enforce their own budget, so production-wide containment requires Redis plus
capacity/restart evidence; local mode and local degraded mode are bounded
containment, not a claim of cluster-wide exactness.

## Rollout, tuning and evidence

1. Deploy with `off`; confirm current A2/A3 credential, provider delivery/reject
   and worker token/protocol/claim/lease regressions on the exact release.
2. Configure one stable secret/ID and the intended store, then use `report`.
   Capture the versioned safe decision stream by surface/dimension/store and
   verify Redis/local cardinality, TTL expiry, latency and degraded behavior.
3. Tune only from report evidence. Required metrics: allowed/would-deny counts,
   retry windows, store errors/degraded duration, live keys/overflow use,
   login/operator/activation and provider/worker success/reject/429/5xx rates,
   provider-specific event bursts and retry cadence, worker fleet size/poll
   interval/progress concurrency, Argon hash/verify concurrency, CPU, RSS,
   event-loop delay and process restarts.
4. Stop and return to `report` or `off` on unexpected legitimate would-deny/429,
   overflow use, persistent degraded mode, Redis latency/errors, CPU/memory or
   event-loop threshold breach, 5xx increase, operator recovery-path failure,
   or missing I4/source and exact-release capacity evidence.
5. Enable provider/worker `enforce` only on an exact release candidate after
   Team Lead accepts I4/source evidence, provider burst/retry soak and
   production-like Redis/restart/multi-process plus CPU/RSS/concurrency/recovery
   and rollback evidence. Start with a small canary and keep the kill switch
   immediately available.

This default-off candidate is an application prerequisite, not production
readiness. A2 ordinary-user Argon writes/rehash and A3 operator Argon verification
remain production-disabled until A4 enforcement for their surfaces and Team Lead
production-like CPU/memory/concurrent-login preflight are both accepted on the
exact release SHA. I4 remains required before production relies on the peer
dimension.

## Future attachment and non-goals

The A12 recovery foundation now attaches `limitCredentialEntry(surface)` after
route classification and before validation, lookup, password verification or
mutation. It declares bounded `AUTH_RECOVERY_ISSUE` and `AUTH_RECOVERY_USE`
policies with fixed credential classes, a bounded token class and the exact peer
dimension, HMAC-sharded storage, generic denial, expiry and Redis/local-degraded
semantics. Recovery is an explicit operator/club-owner action; no email/SMS,
callback, approval, or notification provider is implied. Any future external
delivery or factor route must add its own declared surface and focused
enumeration/concurrency/outage/no-mutation tests before rollout.

CORS/CSP/headers (A8), structured security audit events (A10), dependency
findings (A13), provider fail-closed work (A9), session/JWT/cookie/Socket.IO
changes, MFA/recovery and production infrastructure mutation remain outside
SEC-A4.

## Data and API impact

- API: A12 adds generic recovery status/reset and installation recovery contracts;
  every recovery operation carries the same generic `429`/`Retry-After` contract
  when enforcement is enabled.
- Data model/migrations/grants: A12 adds tenant/account-scoped recovery requests
  and digest-only one-time tokens. Rollback refuses non-empty history; no
  production grant change is implied by the application branch.
- Persisted lock fields: none.
- Tenant scope: installation/global route classification is unchanged; limiter
  counters are installation-wide security metadata derived only from fixed
  route surfaces and ephemeral request subjects.
- User Preview: required for the operator account cabinet and owner employee
  recovery action before QA or release promotion.
- Onboarding: none; roles, routes, visible actions, checkpoint events, training
  data and instructions remain unchanged in default-off mode.
