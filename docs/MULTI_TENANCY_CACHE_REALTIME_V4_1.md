# Feature 4.1 — cache and realtime isolation

Статус: `implemented on feature branch — pending independent SaaS QA`.

Base: `7d2185b15f31213babca4aa42f829bc313a205b6`.

Scope этого среза ограничен frontend TanStack Query cache, реально используемым server Redis cache и Socket.IO. Он не добавляет tenant predicates в business tables, второй production tenant, provisioning, files/workers isolation или provider connections.

## Capability и rollback

Server-owned flag: `TENANT_CACHE_REALTIME_ENABLED`.

- `true` разрешен только вместе с `TENANT_CONTEXT_ENABLED=true`; invalid combination дает `TENANT_CAPABILITY_DEPENDENCY_INVALID` при создании app/socket server.
- capability возвращается auth status/login/bootstrap как `capabilities.tenantCacheRealtime`; отдельного Vite flag нет.
- `false` сохраняет legacy query keys, Redis keys и role/domain Socket.IO rooms.
- `true` атомарно включает tenant query namespaces, Redis namespaces и tenant Socket.IO handshake/rooms.
- rollback: выключить `TENANT_CACHE_REALTIME_ENABLED`; schema/data migration отсутствует, старые Redis keys не читаются новым path и могут истечь по прежнему TTL.
- rolling deploy выполняется в два шага: сначала новый server/client код выкатывается везде с flag `false`, затем capability включается только после завершения mixed-version окна; для rollback сначала выключается flag, затем откатываются binaries. Так старый client не попадает на tenant-only handshake, а новый client не переключает namespace по локальному build flag.
- этот flag не снимает production hard-rollout gate и не означает готовность второго tenant до Features 5–8.

## Frontend query cache inventory

Единый factory: `client/src/api/query-keys.ts`.

Key contract при включенном flag:

```text
global       [domain, ...parts]
membership   [tenant, organizationId, membership, membershipId, domain, ...parts]
organization [tenant, organizationId, org, domain, ...parts]
club         [tenant, organizationId, clubId, domain, ...parts]
```

Scope реальных TanStack queries:

| Scope | Query domains |
| --- | --- |
| membership | onboarding overview/task/training mode |
| organization | audit, clients, methodology, references, onboarding metrics, shift-report templates |
| club | bookings, manager control, onboarding training data, shift reports, telephony, training plans, utilization, visits analytics |
| mixed invalidation groups | catalog, corporate clients, finance, motivation, onboarding, shift reports; каждый key строится в scope своего endpoint/section |

Inventory direct `queryClient` calls закрыт тем же factory. AST gate `server npm run tenant:cache-realtime:audit` запрещает новые literal `queryKey`/direct queryClient keys вне factory.

Lifecycle:

- `AuthGate` не монтирует domain queries до готовности Feature 3 context.
- context transition сначала отменяет in-flight incompatible queries и удаляет старый club/organization namespace, затем монтирует новый context.
- logout и `401 auth:expired` удаляют tenant/scoped legacy domains, но не global/public cache.
- organization/membership cache сохраняется при switch клуба внутри той же authority; старый club cache удаляется.
- background invalidation использует обычный `invalidateQueries`, поэтому загруженные данные остаются видимыми во время refetch.
- realtime event другого tenant или delayed event старого context игнорируется до invalidation/browser dispatch.
- reconnect refresh coalesced; initial connect не вызывает лишний full refetch.

## Server Redis inventory

Расширен существующий `cache.service.ts`; параллельного cache service нет.

Реальные cached paths:

| Domain | Scope | Read/write/invalidation owners |
| --- | --- | --- |
| references: client sources, visit categories | organization | `references.service.js`, validated `req.tenant` из references controller |
| catalog categories | organization | `catalog.service.js`, validated organization `req.tenant` |
| catalog rules | club | `catalog.service.js`, validated club `req.tenant` |

Key prefix:

```text
setly:{REDIS_CACHE_DEPLOYMENT|DEPLOYMENT_ENV|NODE_ENV}:{organizationId}:{clubId|org|membership}:{domain}:...
```

Membership keys дополнительно включают `membershipId`. Global cache разрешен только allowlist domain `platform`; customer domains нельзя пометить global.

Category mutation инвалидирует organization category cache и server-derived same-organization club rule caches. Internal service calls, которые пока не получают request tenant context, в isolation mode идут напрямую в DB и не используют unsafe shared cache.

TTL, Redis unavailable fallback, cache miss semantics и aggregate health stats сохранены. Invalidation publish envelope содержит `scope`, `organizationId`, nullable `clubId`/`membershipId`, `domain` и scoped prefix; health не возвращает keys или payload.

## Socket.IO inventory и contract

Реальные emit paths:

1. HTTP mutation middleware → `publishRealtimeChange`.
2. Access monitor `scan_result` → `publishTenantSocketEvent`.
3. Recurring call-task and Beeline subscription runners → explicit legacy-only publisher.

Handshake при flag on:

- JWT дает только Account identity.
- client передает `organizationId`/`clubId` как preference.
- server повторно вызывает Feature 3 resolver и проверяет active Account/Staff/Organization/Membership/Club/access.
- owner не требует access row; non-owner role override вычисляется тем же resolver, что HTTP.
- client API для произвольного join отсутствует.

Rooms:

```text
org:{organizationId}
club:{clubId}
membership:{membershipId}
org:{organizationId}:domain:{domain}
club:{clubId}:domain:{domain}
```

Organization domain rooms рассчитываются по `Membership.role`, club rooms — по `effectiveRole`. Membership event идет только в private membership room. Global system room доступен только через explicit allowlist (`system:maintenance`).

Tenant `crm:changed` envelope содержит `organizationId`, nullable `clubId`, `membershipId`, `tenantScope`, `domain`, `event`, minimal entity/action hints и не содержит response payload. Перед каждой tenant delivery sockets в target room повторно валидируются; revoked/inactive/role-changed socket disconnect-ится до emit. Дополнительно socket revalidates periodically.

Provider ingress, transcription worker и global background runners пока не имеют validated tenant routing по принятому feature chain. При flag on их legacy fanout подавляется fail-closed; tenant routing появится в Features 4.2/4.3. Их business data processing этим срезом не меняется и остается запрещенным для второго tenant production gate.

## Automated gates

```text
server npm run tenant:cache-realtime:audit
server node --test tests/services/cache.test.js tests/realtime/*.test.js tests/tenant-context/capabilities.test.js
client npm test
server npm test                 # already uses --test-concurrency=1
server npm run typecheck
server npm run tenant:account-writes:audit
server npm run tenant:routes:audit
server npm run onboarding:audit:strict
client npm run lint
client npm run build
```

Two-tenant Socket.IO fixture создается только в отдельной ephemeral test DB и передает test-only foundation assertion dependency в socket server. Production classifier, migrations и provisioning surface не изменены.
