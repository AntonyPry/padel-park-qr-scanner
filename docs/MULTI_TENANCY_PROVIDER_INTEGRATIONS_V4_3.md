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

Feature 10.3 заменяет Beeline rollout transport: legacy bare route теперь всегда
fail-closed, а flag-off rollback использует тот же connection-attributed
canonical route, а не env/default-tenant fallback. Evotor legacy flag-off
поведение этим уточнением не меняется.

### Feature 10.3 Beeline capability amendment

Для production Beeline без provider-supported custom header canonical route —
`POST /api/integrations/beeline/events/:connectionPublicId/:callbackToken`.
`publicId` задаёт identity, но не аутентифицирует. Отдельный random 256-bit
capability timing-safe проверяется до body parser и любой DB write. Он хранится
только в AES-256-GCM secret bundle; config содержит лишь
`webhookAuthMode=capability_uri` и callback base URL. Shared header route
сохраняется только для connection, явно созданной в
`shared_secret_header` mode.

Caller-controlled `skipSecret` удалён. HTTP ingress всегда требует canonical
auth; manual statistics sync использует private service boundary после
аутентифицированного outbound provider request и не экспортирует обход в
controller/routes. Bare route и query secrets запрещены.

Capability route работает при provider flag off/on. Только во время global
full-stop отдельный Feature 10.3 cutover env может пропустить именно этот route
после успешной authentication; остальные API и bare/header callbacks остаются
закрыты. Bootstrap принимает complete Beeline base/token/callback configuration
без webhook secret как capability mode, генерирует token внутри общей provider
transaction и атомарно reconciles historical calls/raw events/subscriptions.
Rerun переиспользует exact connection и secret ciphertext без rotation.

## Idempotency, attribution and locks

Namespace строится из `provider + organizationId + clubId + connectionId`. В него входят:

- Beeline `TelephonyRawEvent.idempotencyKey`;
- Beeline call/subscription `providerNamespace` uniqueness;
- Evotor `Receipt.idempotencyKey`;
- MySQL advisory lock name.

Одинаковый external ID допустим между connections. Replay внутри одной connection увеличивает delivery metadata существующего raw event и не переписывает original body/tenant identity. Instance и bulk application hooks запрещают смену attribution. DB `BEFORE UPDATE` triggers защищают identity `IntegrationConnection` и attribution всех четырёх provider roots от ORM bypass/raw SQL, а composite FKs с `ON UPDATE RESTRICT` блокируют forged relations и parent cascades. Единственное разрешённое DB-изменение provider identity существующей business row — контролируемая однонаправленная привязка legacy `NULL` connection к authoritative connection того же неизменяемого organization/club: `beeline + telephony + default` для telephony roots и `evotor + point_of_sale + default` для Receipt. Cross-provider и same-provider non-default attribution запрещены; runtime reconciliation повторно читает connection из DB внутри транзакции и не доверяет переданному serialized snapshot. Повторная привязка и любое перемещение tenant запрещены.

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
- `20260716100000-harden-tenant-provider-integrations.js` — `ON UPDATE RESTRICT` и DB immutable triggers;
- `20260716120000-validate-provider-reconciliation-connections.js` — authoritative provider/purpose/default validation для разрешённого legacy binding.

Первая migration требует exact active default organization/club, создаёт connection/diagnostic tables, добавляет nullable attribution к существующим provider roots, детерминированно backfill-ит существующие single-default rows, устанавливает composite tenant/connection FKs и заменяет global provider unique indexes connection namespaces. Вторая forward migration добавляет immutable DB boundary, третья закрывает cross-provider/non-default исключение legacy reconciliation. Принятые migrations не переписываются.

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
3. до full-stop выполнить root-aware provider preflight, затем в maintenance run `npm run tenant:providers:bootstrap`: одна DB transaction создаёт/находит exact-default connections, связывает legacy rows только для Beeline/Evotor и не печатает secrets; Telegram/VK не передаются в legacy reconciliation, а exact existing rows переиспользуются без rotation/config/metadata/status mutation;
4. для Beeline выполнить maintenance-only capability callback cutover из Feature 10.3 runbook; Evotor продолжает использовать opaque public ID и explicit secret header;
5. до включения flag повторно run bootstrap, provider audit и canonical flag-off webhook smoke; все новые Beeline events уже connection-attributed, bare Beeline route остаётся закрытым;
6. enable Features 3 → 4.1 → 4.2 → 4.3 server flags;
7. verify canonical Beeline/Evotor ingress, Beeline renewal and one Telegram/VK instance.

Runtime rollback: disable only `TENANT_PROVIDER_INTEGRATIONS_ENABLED`; canonical
Beeline capability route и connection attribution остаются доступны. Legacy
bare Beeline route не восстанавливается. Не удалять connection rows, attribution
columns или encrypted data. При утечке capability production остаётся под
full-stop до controlled provider URI replacement/credential rotation.

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
