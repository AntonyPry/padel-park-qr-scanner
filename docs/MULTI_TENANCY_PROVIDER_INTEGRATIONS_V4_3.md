# Feature 4.3 — Tenant-aware provider integrations

Статус: `QA fixes implemented; independent re-QA required before promotion`.

Exact base: `d24021d9d88f685983ba9bebfd5e5c05888aa5b2` from `codex/saas-multitenancy-integration`.

Feature branch: `codex/multi-tenant-providers-v4-3`.

Этот срез расширяет существующие Beeline, Evotor, Telegram/VK и background-runner entry points. Он не создаёт второй integration stack и не объявляет `TelephonyCall`, `Receipt`, `User`, client registration или finance/telephony downstream domains готовыми ко второму production tenant.

## IntegrationConnection contract

`IntegrationConnection` — server-owned источник provider identity и tenant attribution:

- opaque lowercase public ID `ic_<32 hex>`; tenant ID не принимается из webhook payload, query или произвольного header;
- immutable `organizationId`, `clubId`, `provider`, `purpose`, `connectionKey` и public ID;
- статусы `active`, `disabled`, `revoked`; ingress и runners используют только active connection с active organization/club chain;
- tenant slot unique: `(organizationId, clubId, provider, purpose, connectionKey)`;
- composite FK `(integrationConnectionId, organizationId, clubId)` не позволяет связать provider row с чужим tenant; все provider tenant/connection FKs используют `ON UPDATE RESTRICT`;
- config/metadata принимают только JSON без credential-shaped keys; secret fields живут только в encrypted bundle;
- default model scope и public serializer никогда не возвращают ciphertext, key version или decrypted secrets.

Централизованный secret contract использует AES-256-GCM, random IV, authentication tag и AAD `provider + publicId`. `INTEGRATION_SECRETS_MASTER_KEY` — base64-encoded 32-byte key, `INTEGRATION_SECRETS_KEY_VERSION` — operational key label. Ключ не хранится в DB/git/docs. Ротация выполняется через чтение старым ключом и запись нового bundle до переключения runtime key; автоматический KMS не входит в этот срез.

## Connection-first ingress

Новые canonical routes:

- `POST /api/integrations/beeline/events/:connectionPublicId`;
- `POST /api/webhooks/evotor/:connectionPublicId`.

При `TENANT_PROVIDER_INTEGRATIONS_ENABLED=true` middleware выполняет до body parser:

1. валидирует opaque public ID и provider/purpose;
2. находит active connection;
3. проверяет active organization/club chain;
4. decrypts required secret bundle и timing-safe проверяет webhook secret;
5. проверяет exact-default downstream guard;
6. передаёт controller immutable `req.providerConnection`.

Unknown, disabled, revoked, provider-mismatched, secret-mismatched и legacy URL без connection ID отклоняются fail-closed. Business payload не записывается и не разбирается. `ProviderIngressDiagnostic` хранит только provider, controlled reason code и SHA-256 fingerprints public ID/request; body, header value, tenant attribution и secrets отсутствуют.

Legacy routes сохраняются для flag-off rollout. При flag-on отсутствие canonical connection URL является ошибкой конфигурации, а не fallback к env/default tenant.

## Idempotency, attribution and locks

Namespace строится из `provider + organizationId + clubId + connectionId`. В него входят:

- Beeline `TelephonyRawEvent.idempotencyKey`;
- Beeline call/subscription `providerNamespace` uniqueness;
- Evotor `Receipt.idempotencyKey`;
- MySQL advisory lock name.

Одинаковый external ID допустим между connections. Replay внутри одной connection увеличивает delivery metadata существующего raw event и не переписывает original body/tenant identity. Instance и bulk application hooks запрещают смену attribution. DB `BEFORE UPDATE` triggers защищают identity `IntegrationConnection` и attribution всех четырёх provider roots от ORM bypass/raw SQL, а composite FKs с `ON UPDATE RESTRICT` блокируют forged relations и parent cascades. Единственное разрешённое DB-изменение provider identity существующей business row — контролируемая однонаправленная привязка legacy `NULL` connection к connection того же неизменяемого organization/club во время rollout reconciliation; повторная привязка и любое перемещение tenant запрещены.

Connection lock сериализует весь canonical webhook, manual statistics/recordings sync и subscription renewal одной connection. Reentrant lock context не создаёт второй advisory lock, когда manual sync передаёт строки во внутренний ingress. Connections разных clubs получают разные locks и работают параллельно. Beeline renewal перечисляет active connections отдельно через isolated `Promise.all`; failure одного provider context возвращает redacted result и не останавливает остальные.

## Existing provider adaptation

| Existing entry point | Feature 4.3 behavior |
| --- | --- |
| Beeline webhook | connection/secret resolved before body parser; raw event, call and transcription enqueue receive trusted additive attribution |
| Beeline manual sync/recording/subscription | tenant request resolves exactly one connection; provider client reads DB config/encrypted token; subscription uniqueness/lock is per connection |
| Beeline auto-renew | iterates active connections independently; global legacy advisory lock remains only when flag is off |
| Evotor webhook | connection-first middleware, per-connection lock/idempotency and additive Receipt attribution; forged payload tenant fields ignored |
| Telegram/VK bootstrap | token/proxy read from encrypted connection; provider middleware preserves immutable context before handler |
| recurring call-task runner | remains deferred to Feature 5 because `ClientBase`/`CallTask` are not tenant-scoped |

Telegram/VK deliberately permit no multi-connection client registration yet: `User`/client roots are global. More than one active connection for a bot provider is blocked, and any non-default tenant context fails the downstream guard.

## Migration

Forward migrations:

- `20260715160000-add-tenant-provider-integrations.js` — foundation/attribution/indexes;
- `20260716100000-harden-tenant-provider-integrations.js` — `ON UPDATE RESTRICT` и DB immutable triggers.

Первая migration требует exact active default organization/club, создаёт connection/diagnostic tables, добавляет nullable attribution к существующим provider roots, детерминированно backfill-ит существующие single-default rows, устанавливает composite tenant/connection FKs и заменяет global provider unique indexes connection namespaces. Вторая forward migration усиливает уже установленную Feature 4.3 schema без переписывания принятых migrations.

Schema down is a development/emergency pre-data operation only. It refuses rollback when connections, diagnostics or connection-attributed business rows exist. Runtime rollback does not down-migrate: disable the Feature 4.3 flag and retain additive attribution/ciphertext.

## Capability, rollout and rollback

Server-owned flag: `TENANT_PROVIDER_INTEGRATIONS_ENABLED`.

It depends on all accepted capabilities:

- `TENANT_CONTEXT_ENABLED=true` (Feature 3);
- `TENANT_CACHE_REALTIME_ENABLED=true` (Feature 4.1);
- `TENANT_FILES_WORKERS_ENABLED=true` (Feature 4.2).

Invalid combinations fail at app construction. Foundation bootstrap-pending/invalid blocks ingress and direct provider runners. The flag is not exposed to frontend capability/UI.

Rollout sequence:

1. DB backup; deploy migration with provider flag off;
2. set protected master key/key version on server;
3. остановить provider ingress/loops на короткое rollout-окно и run `npm run tenant:providers:bootstrap` in `server`: команда создаёт/находит exact-default connections, затем детерминированно связывает flag-off rows с default connection, не печатая secrets;
4. configure provider callbacks with returned opaque public IDs and verify secret headers;
5. до включения flag повторно run bootstrap/reconciliation после drain, затем provider audit и flag-off webhook smoke; новые flag-off Beeline/Evotor rows уже имеют default organization/club, но до reconciliation сохраняют legacy connection namespace;
6. enable Features 3 → 4.1 → 4.2 → 4.3 server flags;
7. verify canonical Beeline/Evotor ingress, Beeline renewal and one Telegram/VK instance.

Runtime rollback: disable only `TENANT_PROVIDER_INTEGRATIONS_ENABLED`; legacy env routes/default behavior remain available. Do not remove connection rows, attribution columns or encrypted data. A leaked/invalid connection is revoked in DB and its provider credential is rotated before re-enable.

## Hard boundary and deferred work

- Production stays exact single-default; second production tenant provisioning remains forbidden until Features 9/10.
- Connection attribution is not proof of tenant-safe reads/writes in Telephony, Finance, Clients or Users.
- Beeline/Evotor/Telegram/VK second-tenant business processing is rejected by exact-default downstream guard.
- Full tenant-scoped `TelephonyCall`, `Receipt`, `User`, clients, pending sales and related roots remain their domain waves.
- UI connection management, SaaS billing, SMS/messaging, provisioning/switcher, main merge and deploy are out of scope.

## Acceptance commands

```text
server npm run tenant:providers:audit
server node --test --test-concurrency=1 tests/provider-integrations/*.test.js
server npm run tenant:account-writes:audit
server npm run tenant:routes:audit
server npm run tenant:cache-realtime:audit
server npm run tenant:files-workers:audit
server npm run typecheck
server npm test
server npm run onboarding:audit:strict
server npm run openapi
client npm test
client npm run lint
client npm run build
git diff --check
```

Independent QA must review the exact feature diff and rerun DB migration rollback/reapply plus flag-on/off API smoke before promotion. No merge, push or deploy is authorized by this document.
