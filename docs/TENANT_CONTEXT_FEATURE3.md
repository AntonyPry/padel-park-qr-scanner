# Feature 3 — tenant context plumbing

Статус: implemented behind `TENANT_CONTEXT_ENABLED`, pending independent SaaS QA.

Base: `75ad6b62294c49ce5606160635f9930fc2dd0f06` from `origin/codex/saas-multitenancy-integration`.

## Runtime contract

`TENANT_CONTEXT_ENABLED=false` keeps the legacy Account/JWT transport and authorization path. `true` enables this sequence for every authenticated business request:

1. Feature 2 bootstrap/foundation gate runs first.
2. JWT resolves the active global `Account` identity.
3. The audited endpoint manifest declares `global`, `membership`, `organization` or `club` scope.
4. The resolver reads explicit tenant headers, then reloads active Membership/Organization/Club/access rows from MySQL.
5. A frozen `req.tenant` is installed before permission middleware and controllers.
6. Organization authorization uses `Membership.role`; club authorization and request-scoped service actor use the effective role.

Required headers:

| Scope | Headers |
| --- | --- |
| `global` | none |
| `membership` | `X-Organization-Id` |
| `organization` | `X-Organization-Id` |
| `club` | `X-Organization-Id`, `X-Club-Id` |

Missing headers return `400 TENANT_CONTEXT_REQUIRED`; malformed, duplicate or non-positive values return `400 TENANT_CONTEXT_INVALID`; an inactive, mismatched or inaccessible chain returns the same safe `404 TENANT_CONTEXT_NOT_FOUND`. Tenant IDs in JWT, body, query or local preference are not authority.

## Discovery and frontend bootstrap

`GET /api/auth/me/memberships` is an authenticated global endpoint and deliberately receives no tenant headers. It returns only active membership identity, organization `id/name/slug`, accessible active clubs `id/name/slug/timezone`, and effective role. Owner clubs are read from Organization without requiring access rows; non-owner clubs require active access rows.

`GET /api/auth/status` and login/bootstrap sessions expose `capabilities.tenantContext`, so the server is the feature-flag source of truth. When enabled, the client completes `session → discovery → validated selection` before mounting domain queries, realtime or training providers. The generated endpoint contract drives header injection: membership/organization requests receive only Organization, club requests receive both IDs, and global discovery receives neither.

The current hard rollout gate permits one club. The client auto-selects that club and renders no switcher. `setly_tenant_context_preference` stores only a UI preference; every restore is checked against fresh discovery. No Account tenant columns or server-side cross-organization preference were added. Persisted cross-organization selection and visible switching remain Feature 10.

## Audited route inventory

The canonical registry is the OpenAPI `endpointContracts` list plus `server/src/tenant-context/route-scope-declarations.js`. `npm run tenant:routes:audit` locks the exact method/path/scope manifest with a SHA-256 digest, rejects missing/duplicate declarations and reports:

| Classification | Endpoints | Main domains |
| --- | ---: | --- |
| `global` | 7 | health, OpenAPI, auth status/bootstrap/login, `/auth/me`, discovery |
| `membership` | 10 | onboarding self progress, task, lesson/practice/quiz, training-mode preference |
| `organization` | 83 | accounts, staff, CRM client identity/skill map, references, methodology, categories, motivation policy, payroll, audit, shift templates |
| `club` | 163 | access/visits, bookings, client bases/call tasks, telephony, finance operations, sales/catalog mapping, subscriptions/certificates usage, corporate ledger, shifts/reports, utilization/analytics, training notes/plans |
| `provider_ingress` | 2 | Evotor and Beeline webhooks; explicitly not ordinary global business endpoints |
| `worker` | 7 | transcription worker queue/claim/progress/result/failure endpoints |

Runtime protected-route middleware rejects an endpoint missing from the registry before controller/service execution. OpenAPI publishes `x-tenant-scope` and required header parameters; the generated client publishes endpoint scope, `TenantHeadersForScope` and the typed discovery response.

## Intentional boundaries

- Existing business tables and queries are not tenant-filtered in Feature 3; domain waves start in Feature 5.
- Query-key/cache partitioning, tenant-aware Socket.IO rooms, files, integrations and worker routing remain Feature 4.
- Socket.IO keeps the accepted single-tenant Account/role room behavior. Because the frontend mounts realtime only after initial context bootstrap, it does not expose domain UI before context readiness.
- No Organization/Club CRUD, provisioning route, second tenant, visible switcher or new tenant migration was added.
- The Feature 2 migration, state classifier, bootstrap gate and Account lifecycle bridge are unchanged.

## Implementation evidence

- Route-scope audit: `272/272` declared endpoints, digest `a8febd9420088e248b64866e29ee386b7cfd4e60a5ffb13e1058987cd13df88e`.
- Tenant context unit/contract gate: `22/22`; isolated DB-backed API/context gate: `10/10`.
- Full server suite with `--test-concurrency=1`: `342/342`; server typecheck, Account direct-write audit and strict onboarding audit pass.
- Full client suite: `95/95`; lint and production build pass.
- Initialized local API/browser smoke passed separately with the capability enabled and disabled. Owner, manager, admin, accountant, trainer and viewer retained identical visible navigation; enabled requests carried the declared Organization/Club headers, disabled requests carried neither; discovery remained global and header-free.
- Manual API smoke returned `400 TENANT_CONTEXT_REQUIRED`, `400 TENANT_CONTEXT_INVALID` and safe `404 TENANT_CONTEXT_NOT_FOUND` as specified. Correct organization/club requests and legacy flag-off requests returned `200`.
- Socket.IO connected in both flag modes with the existing single-tenant room contract. Desktop and mobile `390px` CRM smoke had no horizontal overflow, visible switcher, console errors, failed network requests or page errors.

## Rollback

Set `TENANT_CONTEXT_ENABLED=false` and restart the server. Clients learn the disabled capability from auth/status or session and immediately use the legacy Account-based transport without tenant headers. Additive discovery and route metadata may remain deployed.
