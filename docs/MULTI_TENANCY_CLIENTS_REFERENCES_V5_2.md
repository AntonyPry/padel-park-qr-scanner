# Feature 5.2 — Clients and CRM references

Статус: `implementation complete; ready for independent QA; not accepted or integrated`.

Exact base: `1c5fcea05a8e4bc05e804a0073feb88e435ba2f2` from `codex/saas-multitenancy-integration`.

Feature branch: `codex/multi-tenant-clients-references-v5-2`.

Этот срез расширяет существующие `User`, `ClientSource`, `VisitCategory`, client/reference services и текущие integration points. Он не создаёт параллельную клиентскую подсистему и не меняет UI. Профиль клиента и оба CRM-справочника имеют scope `organization`: один клиент доступен клубам только через проверенную Membership/club authority той же Organization, но у самого клиента нет `clubId`.

## Data contract

Forward migration `20260716160000-add-tenant-clients-references.js`:

1. Требует exact active default Organization, проверяет legacy duplicates, stale source links и merge cycles.
2. Добавляет nullable `organizationId` в `Users`, `ClientSources`, `VisitCategories`, backfill-ит exact default Organization и повторно проверяет граф.
3. Создаёт FK каждой aggregate root к `Organizations`, unique `(organizationId,id)` и tenant-leading list/search indexes.
4. Заменяет global unique identities клиента на `(organizationId,telegramId|vkId|webId)` и global reference names на `(organizationId,name)`.
5. Заменяет legacy links на composite FK `(organizationId,sourceId)` и `(organizationId,mergedIntoUserId)`, поэтому source и canonical merge-chain физически не могут пересечь Organization.
6. Делает все три `organizationId` `NOT NULL` и устанавливает DB triggers, запрещающие изменение tenant attribution через raw SQL; Sequelize hooks блокируют ORM instance/bulk update того же поля.

Forced mid-DDL test подтверждает cleanup только объектов незавершённой попытки и повторяемый `up`. Data-aware single-default roundtrip с реальными source, category и merge-chain проверяет одинаковые counts, полный business-data checksum и legacy/composite FK graph до и после `down → up`. Raw-SQL regression matrix подтверждает `ER_SIGNAL_EXCEPTION` и полную неизменность строк при попытке перенести `Users`, `ClientSources` или `VisitCategories` в другую Organization. Migration down предназначен для development/emergency: preflight требует exact single-default Organization, отсутствие later migration, cross-tenant rows и внешних tenant references. Нормальный rollback — выключение read capability без удаления backfilled attribution.

Demo CRM seeder после migration создаёт, выбирает и удаляет demo clients только в default Organization. Он сохраняет совместимость с historical Feature 2 test schema до появления `Users.organizationId`.

## Runtime authority and isolation

Server-owned flag: `TENANT_CLIENTS_REFERENCES_ENABLED`. Он зависит от `TENANT_STAFF_ACCESS_ENABLED`, а значит транзитивно от принятых capabilities Features 3–4.3. Flag не публикуется frontend.

При flag on authority берётся только из одного из двух проверяемых источников:

- frozen request TenantContext с active Organization + active Membership; organization routes принимают organization scope, club routes дополнительно перепроверяют active Club и MembershipClubAccess, owner сохраняет all-club contract;
- authoritative active `IntegrationConnection` для Telegram/VK/provider ingress; `connectionId`, Organization, Club и provider повторно загружаются из DB, а caller snapshot не считается доверенным.

Client CRUD/list/count/detail/lookup/duplicate/merge/archive/restore/permanent-delete используют organization predicate. `organizationId` не выходит в public client/reference payload. Create/update/messenger mutations берут organization row lock, повторно валидируют tenant внутри transaction, используют organization-namespaced identity locks и записывают только reference той же Organization. Merge и permanent delete повторно валидируют и блокируют target rows внутри transaction.

DB concurrency regression фиксирует принятый runtime-контракт: одновременный одинаковый phone или messenger identity внутри одной Organization даёт ровно один success, один безопасный `409` и одну итоговую строку; те же phone + messenger identity одновременно создаются по одной строке в двух разных Organizations. Отдельная authoritative provider matrix принимает валидные Telegram/VK connections и после DB reload отклоняет forged Organization/Club/provider, а также `disabled` и `revoked` connections.

Reference list/cache/create/update/archive/restore/delete используют organization namespace. Cached references получают tenant cache key и tenant-local invalidation. Reference mutation повторно валидирует tenant под lock; permanent delete считает только client usage той же Organization.

Existing client integrations не обходят aggregate boundary:

- reception/manual access и visit category selection передают request tenant;
- booking participant/client resolution проверяет client/source той же Organization;
- Telegram/VK registration and start lookup используют authoritative provider connection;
- telephony phone lookup, link-call и create-client используют tenant-aware client service;
- client-base/call-task compatibility paths передают tenant при client snapshot/count/list и direct-client selection;
- client training skill/recommendation entrypoints в client controller сначала подтверждают, что каждый client ID принадлежит request Organization.

Новый AST gate `npm run tenant:client-reference-writes:audit` разрешает прямые `User`/`ClientSource`/`VisitCategory` mutations только утверждённым writers и demo seeder; migrations исключены как immutable history. Unit test проверяет exact allowlists и model/instance/QueryInterface/raw-SQL bypasses.

## Flag-off compatibility

При `TENANT_CLIENTS_REFERENCES_ENABLED=false` legacy reads остаются global, чтобы rollback runtime не менял single-default UX. Все новые writes уже получают default Organization и проходят composite DB constraints. Это осознанный compatibility bridge, а не разрешение обслуживать второй production tenant с выключенным flag.

## Rollout and hard boundaries

Rollout:

1. DB dump и fresh migration rehearsal.
2. Deploy additive migration/runtime с `TENANT_CLIENTS_REFERENCES_ENABLED=false`.
3. Проверить migration assertion, identity/reference parity, demo seed up/down и writer audit.
4. Включать capabilities только в порядке Features 3 → 4.1 → 4.2 → 4.3 → 5.1 → 5.2.
5. Повторить flag-on/off API smoke для шести ролей, Telegram/VK registration и two-Organization IDOR matrix.

Rollback: сначала выключить `TENANT_CLIENTS_REFERENCES_ENABLED`; tenant columns, composite FKs и backfilled attribution не удалять. Schema down допустим только после exact single-default preflight.

Hard boundaries:

- production остаётся exact single-default; provisioning и второй production tenant запрещены;
- `Visits`/scanner history, training roots, bookings/series, telephony calls, client saved views/bases/call tasks, prepayments и finance ещё не объявлены tenant-safe только из-за scoped client relation; их aggregate migrations остаются следующими waves;
- compatibility propagation в этих сервисах защищает client selection, но не меняет scope их собственных aggregate roots;
- UI switcher, visual redesign, SaaS billing, push, merge и deploy вне scope.

## Acceptance commands

```text
server npm run tenant:client-reference-writes:audit
server npm run tenant:staff-membership-writes:audit
server npm run tenant:account-writes:audit
server npm run tenant:routes:audit
server npm run tenant:cache-realtime:audit
server npm run tenant:files-workers:audit
server npm run tenant:providers:audit
server node --test tests/services/client-references-tenant.db.test.js
server node --test tests/scripts/client-reference-write-audit.test.js
server npm run typecheck
server npm test
server npm run onboarding:audit:strict
server npm run openapi
client npm test
client npm run lint
client npm run build
git diff --check
```

Independent QA must review the exact feature diff, repeat fresh migration plus down/up, test flag-on/off, forged/stale authority, concurrent identity writes, two-Organization IDOR denial and authoritative provider registration before promotion. Этот документ не разрешает push, merge или deploy.
