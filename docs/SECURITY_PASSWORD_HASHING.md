# Setly ordinary-user password hashing

SEC-A2 extends the existing `auth.service.js` contract for ordinary `Account`
credentials. It does not change installation-operator credentials, sessions,
JWTs, routes, response shapes, roles, tenant authority or UI behavior.

## Runtime contract

- The reader always accepts only two bounded, canonical formats: the exact
  legacy `pbkdf2$120000$salt$hash` format and Argon2id PHC with version 19.
- Legacy verification preserves the historical derivation exactly: the
  canonical base64url salt text, not decoded bytes, is passed to PBKDF2-HMAC-SHA256.
- Argon2id writes use a 16-byte salt, 32-byte output and explicit parameters.
- `AUTH_ARGON2_ENABLED=false` is the default and the kill switch. It keeps the
  dual reader active, but every ordinary-user plaintext writer continues to
  write legacy PBKDF2 and login performs no rehash write.
- `AUTH_ARGON2_ENABLED=true` makes every current ordinary-user plaintext writer
  use Argon2id. After an otherwise fully successful active Account/Staff login,
  a legacy or stale supported hash may be upgraded with an atomic
  `Account.id + exact previous passwordHash` compare-and-swap.
- A failed/unknown/inactive login never writes a hash. A CAS loser is harmless.
  Rehash failure does not fail a valid login and emits only the fixed event
  `auth.password_rehash.persistence_failed`, without errors, identifiers,
  password/hash/token or other request data.
- There is no fallback to PBKDF2 when Argon2 writes are enabled. Invalid config
  fails server initialization before routes accept writes.

## Configuration

| Variable | Default | Accepted values |
| --- | ---: | --- |
| `AUTH_ARGON2_ENABLED` | `false` | exactly `true` or `false` |
| `AUTH_ARGON2_MEMORY_KIB` | `19456` | integer `19456..262144` |
| `AUTH_ARGON2_TIME_COST` | `2` | integer `2..10` |
| `AUTH_ARGON2_PARALLELISM` | `1` | integer `1..4` |

The default `m=19456, t=2, p=1` is the current
[OWASP Argon2id minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
It was selected as the staged starting point because the local benchmark below
meets the developer thresholds while limiting per-attempt memory before
production capacity is known. Local evidence is not a production sizing
decision.

The implementation pins `argon2@0.44.0`, the maintained
[`node-argon2`](https://github.com/ranisalt/node-argon2) binding to the reference
implementation. It supplies async hash/verify, PHC formatting and Node 24
support without using Node's experimental crypto API. Evidence on this candidate:

- local clean `npm ci` on Node `v24.14.1` / macOS ARM64;
- disposable Docker `node:24-bookworm-slim` clean production-dependency
  `npm ci` on `linux/amd64`, followed by a real Argon2id hash/verify:
  Node `v24.18.0`, `argon2 0.44.0`, PHC
  `$argon2id$v=19$m=19456,t=2,p=1`, verification `true`.

The install reports npm audit findings; SEC-A2 records them but does not run an
unreviewed `npm audit fix` or broaden into the separately scoped A13
supply-chain slice.

## Rollout and rollback floor

Production enablement is blocked until both prerequisites are accepted:

1. SEC-A4 rate-limit/abuse containment is accepted in production `enforce` mode
   for login and the other credential-entry points. The default-off SEC-A4a
   application candidate alone does not satisfy this production gate; see
   [`SECURITY_AUTH_RATE_LIMITING.md`](./SECURITY_AUTH_RATE_LIMITING.md).
2. The Team Lead has production-like CPU, memory and concurrent login/rehash
   preflight evidence for the exact release SHA and configuration.

Roll out the dual reader first with the flag off. After the prerequisites, use
a small canary with the flag on and observe the stop conditions. The immediate
kill switch is `AUTH_ARGON2_ENABLED=false`; it stops new Argon2 writes and login
rehash without making any existing account unreadable.

Once even one Argon2 row exists, this dual-reader release is the rollback floor.
Never roll back to a PBKDF2-only reader, bulk-rewrite hashes, or advise a forced
password reset as routine rollback.

Stop or do not enable when any condition is true:

- production-like single-operation Argon2 hash/verify p95 exceeds `250 ms`, or
  login-plus-rehash p95 exceeds `400 ms` at expected concurrency;
- peak RSS is greater than baseline plus
  `memoryCost * active concurrent operations + 64 MiB`, available host memory
  falls below 25%, swapping/OOM/restarts occur, or worker/process health degrades;
- event-loop delay p99 exceeds `100 ms`, sustained process CPU exceeds 70%, or
  the expected concurrency batch exceeds `2 s`;
- hashing errors are non-zero, rehash persistence failures reach `0.1%`, or
  login 5xx/error rate rises more than `0.5` percentage points over baseline;
- SEC-A4 containment or the production-like evidence is absent.

## Capacity and benchmark evidence

Tracked Sequelize `STRING` maps `Accounts.passwordHash` to `VARCHAR(255)`. The
supported legacy hash is 80 characters; supported Argon2id PHC strings are at
most 100 characters. Verify the actual target database rather than relying only
on the model/migration:

```sh
cd server
npm run auth:password-hash:capacity
```

Run the repeatable non-production benchmark on the exact candidate host/runtime:

```sh
cd server
npm run auth:password-hash:benchmark
```

Local Apple ARM64 / Node 24 evidence for the candidate is recorded in the SEC-A2
handoff. The repeatable local run on 2026-07-22 used Node `v24.14.1`, Darwin
ARM64, 8 logical CPUs, 8 GiB RAM, the default libuv threadpool, 12 sequential
samples and `m=19456,t=2,p=1`:

| Local non-production scenario | Result |
| --- | ---: |
| Argon2id hash p50 / p95 | `22.14 / 24.44 ms` |
| Argon2id verify p50 / p95 | `22.88 / 25.49 ms` |
| Legacy verify p50 / p95 | `14.01 / 14.35 ms` |
| 4 concurrent hash / login+rehash batch | `47.22 / 58.10 ms` |
| 8 concurrent hash / login+rehash batch | `49.06 / 82.91 ms` |
| Process RSS baseline / peak / delta | `145.81 / 203.67 / 57.84 MiB` |
| Event-loop delay p99 | `12.15 ms` |
| Errors | `0` |
| PHC length | `97` characters |

Native allocation reuse means per-batch RSS deltas can under-report later
batches; the process high-water mark is the memory evidence to use. This run is
local developer evidence only. Linux CI-equivalent install/runtime evidence is
a separate required artifact; a successful macOS install does not substitute
for it.

## Writer inventory

Plaintext writers routed through the single async contract:

- initial owner bootstrap in `auth.service.js`;
- account create and password update in `accounts.service.js`;
- temporary provisioned-owner secret and activation password in
  `installation-provisioning.service.js`;
- the operational demo-account script;
- the tracked Sequelize demo-data seeder.

`account-lifecycle.service.js`, `account-metadata.service.js` and
`account-seeder-adapter.js` persist already prepared hashes. The seeder adapter
intentionally remains hash-only; it is not a hidden plaintext writer.
