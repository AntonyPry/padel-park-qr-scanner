# Multi-tenancy Feature 7.1 — Client money instruments

## Scope

Feature 7.1 tenant-isolates the existing stored-value and customer-entitlement
domain. It does not add a second prepayment system, redesign the visible CRM
workflow, or implement Finance/P&L and Evotor settlement attribution.

Organization-wide roots:

- `SubscriptionType.organizationId` — reusable subscription definition;
- `CorporateClient.organizationId` — counterparty and shared limit card;
- `User.organizationId` remains the accepted client root.

Club-local roots and events:

- `EvotorSaleSetting.organizationId/clubId`;
- `PendingSale.organizationId/clubId` and `PendingSaleHistory`;
- `ClientSubscription.organizationId/clubId` and its redemptions;
- `Certificate.organizationId/clubId` and its redemptions;
- `CorporateLedgerEntry.organizationId/clubId`.

`Finance.organizationId/clubId` is nullable. This slice writes it only for a
corporate deposit created or linked by the club-local ledger. Other Finance
rows and `ReceiptItem` continue to inherit or defer attribution under their
existing domain contracts.

## Field matrix

| Field(s) | Product meaning | Current writers and consumers | Lifecycle |
|---|---|---|---|
| `SubscriptionType.organizationId` | Organization owning the definition | Migration; subscription-type CRUD; POS mapping validation; subscription issue | Required Organization FK; immutable; Organization-leading name unique |
| `CorporateClient.organizationId` | Organization owning the counterparty | Migration; corporate-client CRUD; dashboards; ledger/export root lookup | Required Organization FK; immutable |
| `EvotorSaleSetting.organizationId/clubId` | Club POS product-to-intent mapping | Migration; catalog sale-settings API; pending-sale ingestion | Required Club attribution; immutable; Club-leading item-name unique |
| `PendingSale.organizationId/clubId` | Club queue event for an attributed receipt item | Migration; Evotor ingestion; link/ignore/cancel; dashboards | Required Club attribution; immutable; receipt, item, setting and client guards |
| `PendingSaleHistory.organizationId/clubId` | Audit event inheriting the pending sale | Migration; pending-sale mutations | Required Club attribution; immutable; same-tenant parent guard |
| `ClientSubscription.organizationId/clubId` | Club-local issued entitlement | Migration; pending-sale issue/cancel; client card; dashboard; redemptions | Required Club attribution; immutable; User and definition guards |
| `ClientSubscriptionRedemption.organizationId/clubId` | Club usage event | Migration; redeem/reverse/list | Required Club attribution; immutable; same-tenant parent and User guard |
| `Certificate.organizationId/clubId` | Club-local issued stored-value/service instrument | Migration; pending-sale issue/cancel; client card; dashboard; redemptions | Required Club attribution; immutable; Club-leading code unique |
| `CertificateRedemption.organizationId/clubId` | Club money/service usage event | Migration; redeem/reverse/list | Required Club attribution; immutable; same-tenant parent and User guard |
| `CorporateLedgerEntry.organizationId/clubId` | Club deposit/spending history | Migration; ledger mutations; balance/dashboard/export; training cleanup | Required Club attribution; immutable; CorporateClient and optional Finance guards |
| `Finance.organizationId/clubId` | Minimal authoritative link for a corporate deposit | Migration backfill; corporate deposit create/link/cancel; training cleanup | Nullable pair; immutable when written; same-Club pair required |

No issue/origin Club field was added to organization-wide definitions, and no
tenant field was added to `ReceiptItem`: there is no independent current
consumer for either field.

## Runtime contract

`TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED=true` requires the accepted
`TENANT_TRAINING_NOTES_PLANS_ENABLED=true` capability chain.

When enabled:

- request boundaries accept only a branded tenant context and revalidate the
  active Organization, Account, Membership, Club access, effective role, and
  linked Staff identity;
- Evotor ingestion revalidates the active point-of-sale
  `IntegrationConnection` and its Organization/Club chain;
- body, query, or header tenant IDs are never service authority;
- definition and counterparty reads use Organization scope; issue, usage,
  queue, ledger, dashboard, and export reads use Club scope;
- mutations revalidate authority inside the transaction and lock mutable
  balance/usage roots;
- onboarding training-data summary and cleanup scope corporate roots by
  Organization and ledger/Finance events by Club.

When disabled, existing reads retain legacy unscoped behavior and new required
domain rows bind to the exact default Organization/Club. Existing second-tenant
rollout guards remain authoritative.

## Database enforcement

Migration `20260719120000-add-tenant-finance-prepayments-wave.js` classifies
the schema as exact `legacy`, `ready`, or `partial` from table-qualified column,
index, FK, and trigger definitions. It validates legacy relation provenance,
refuses partial/lookalike state before mutation, tracks invocation-owned DDL,
restores removed global uniques on failure, and supports deterministic
up/reapply/down/up. Down refuses a second Organization or non-default tenant
data.

Database triggers protect direct ORM, bulk, and raw-SQL paths against tenant
mutation and cross-tenant Club, User, Receipt, pending-sale, definition,
redemption-parent, corporate-client, and Finance relations. The repository AST
audit separately rejects unapproved direct writers.

## API, UI, analytics, realtime, and onboarding

- Existing response bodies, route URLs, roles, actions, statuses, expiry rules,
  unlimited-subscription semantics, certificate money/service behavior, and
  pending-sale link/cancel flow are unchanged.
- Existing OpenAPI tenant scopes already classify definition routes as
  Organization and operational routes/dashboards as Club; no generated client
  type changes are required.
- Existing tenant route publication and client query namespaces remain the
  realtime/cache authority; this domain adds no background job.
- Visits revenue/LTV remains deliberately conservative under tenant context:
  Club-scoped Receipt cash events are safe, while manual entitlement and broad
  Finance attribution stay excluded until their dedicated analytics wave.
- Existing onboarding tasks and checkpoint events do not change. Only
  training-data summary/cleanup gains tenant-safe filtering.

## Verification target

The focused DB matrix covers strict legacy/partial/forced-failure migration
states, down/up/reapply preservation, two Organizations and multiple Clubs with
identical client identity, definition name, certificate code, and POS item;
queue/history idempotency; subscription/certificate usage and expiry behavior;
concurrent overspend prevention; corporate Finance linkage, XLSX export and
dashboard isolation; raw-SQL guards; stale-context denial; training cleanup;
flag-off compatibility; and second-Organization rollback refusal.
