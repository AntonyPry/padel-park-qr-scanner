# Feature 8.1: Club-local shifts and shift reports

## Scope and ownership

Feature 8.1 extends the existing shift and shift-report subsystem. It does not
introduce a parallel payroll, motivation, reporting, onboarding or file-storage
domain.

- `Shift`, `ShiftReportTemplate` and `ShiftReport` are Club-local roots with a
  required immutable technical `clubId`.
- `ShiftReportTemplateItem` inherits from `ShiftReportTemplate`.
- `ShiftReportAnswer` and attachment metadata/files inherit from
  `ShiftReport` through the answer parent.
- `Staff`, `Account`, `Membership` and Club access remain authoritative
  Organization/access references. No dormant tenant field is added to them.
- `PayrollPeriod`, motivation rules, `AuditLog` and onboarding schema remain
  outside this slice. Payroll continues to be Organization-scoped, but its
  shift and receipt inputs are now selected through verified tenant roots.

The new root fields are not exposed in API responses. Their current consumers
are tenant filtering, immutable attribution, relation provenance, storage
partitioning, payroll input isolation and training-data cleanup.

## Runtime contract

`TENANT_SHIFTS_REPORTS_ENABLED` is server-owned and depends on
`TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED` and the accepted tenant capability
chain. When enabled, every public shift/report/cash boundary accepts only a
branded frozen Club `TenantContext`, reloads current Account, Membership, Club
access and effective role, and binds the actor to the authoritative account.
Request body, query and header IDs never become tenant authority.

Root reads and writes are Club-scoped. DB triggers enforce immutable root
attribution and same-Club/same-Organization staff, shift, template, answer and
template-item provenance for ORM, bulk and raw SQL paths. Report slot creation
is idempotent under concurrent calls. Attachment storage keys and metadata are
derived from the verified report parent; wrong-Club reads and deletes fail
closed.

When the flag is disabled, existing reads keep legacy behavior and new root
writes receive the exact default Club. This bridge is valid only for the
single-default deployment; second-tenant rollout remains blocked.

## Migration and operations

Migration `20260719160000-add-tenant-shifts-reports.js` is additive and
definition-aware. It distinguishes exact legacy, ready and partial/lookalike
states. Partial state is refused before business-data mutation. Legacy rows are
backfilled to the exact default Club, then canonical indexes, foreign keys and
triggers are installed.

Forced-failure cleanup is invocation-owned. Before its first mutation it
verifies unchanged signatures for every tracked column, index, foreign key and
trigger and refuses ownership loss with operator-repair semantics. `up` is
idempotent, `down/up/reapply` preserves data, and rollback refuses a second
Organization or non-default Club root data. MySQL DDL still requires the normal
exclusive migration window.

## Integration boundaries

- Shift cash sessions and expenses inherit Club from `Shift`; cash attachments
  use verified parent-derived storage metadata.
- Payroll remains Organization-scoped and may aggregate sibling Clubs, but
  receipts are Organization-filtered and matched to shifts only within the
  same Club. The global legacy `CatalogRule` behavior is unchanged.
- Motivation current-sales reads use Club-scoped receipts. Broad motivation
  redesign remains out of scope.
- Onboarding keeps existing `shift.approved` behavior. Training summary and
  cleanup limit shift-cash children through the current Club's Shift parent.
- Template, report and shift routes keep response shapes and roles. Template
  transport changes from Organization to Club tenant scope, matching the new
  authoritative root.
- No shift export exists. Realtime continues through the existing Club-scoped
  shift domain.

## Release gate

Promotion requires the Feature 8.1 real-MySQL fresh/legacy/partial/lookalike,
forced-failure, ownership, down/up/reapply and two-Organization/two-Club matrix;
the direct-write AST audit; affected service, route, capability and file tests;
server typecheck; client contract checks; OpenAPI/generated no-drift; and clean
Git checks. Full SaaS regression remains the final release-candidate gate.
