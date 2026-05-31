# CRM onboarding system

## Purpose

The onboarding system teaches CRM users by role and scenario. Instructions live in code, while user progress lives in the database. This keeps onboarding reviewable with feature releases and prevents stale external docs.

## Source of truth

- Catalog: `server/src/onboarding/catalog.js`
- User progress: `OnboardingProgresses`
- API: `/api/onboarding`
- Release guardrail: every user-facing feature must include `Onboarding impact`
- Release workflow: `docs/ONBOARDING_RELEASE_WORKFLOW.md`
- Audit command: `server npm run onboarding:audit`

The catalog is file-based by design. New roles, missions, tasks, routes and checkpoint events should be changed in the same pull request as the feature that affects them.

## Role behavior

Every user gets the path for their own role by default.

Owners are special: an owner can pass `role` to view and complete onboarding as any role. This is used for training, QA and manager enablement without reducing the owner's real CRM permissions.

## Catalog shape

Each role path contains missions. Each mission contains tasks. Each task has:

- `key`: stable unique identifier, prefixed by role.
- `route`: CRM screen where the task happens.
- `kind`: `action` or `review`.
- `skills`: user-facing skill labels used to build role skill progress.
- `badge`: short reward label for completing the task.
- `checkpoint.event`: semantic event that should eventually auto-complete the task.
- `trainingMode.recommended`: whether the task should preferably be done with safe demo data.

Each path also has `levelLabel` and `completionBadge`. These fields keep the in-app experience gamified without hardcoding copy in the client. When releases add or change a CRM workflow, update the task copy, skills, badge and checkpoint in the same catalog edit.

## Progress model

Progress is stored by `accountId`, target `role` and `taskKey`.

This allows:

- a trainer to have trainer progress;
- an admin to have admin progress;
- an owner to have separate progress for `owner`, `admin`, `trainer`, `accountant` and other role paths.

## Training mode

Training mode is stored on the server in `OnboardingTrainingModes`, one row per account. The state includes whether it is enabled, which role is being trained, and timestamps for enable/disable events.

When the client has training mode enabled, every API request sends:

- `X-Training-Mode: true`
- `X-Training-Role: <role>`

The backend captures those headers on authenticated requests as `req.trainingMode`. Feature services should use that context in future sprints to mark training-created entities and exclude them from production reports.

Current sprint scope:

- persistent training mode state;
- visible in-app training banner;
- API header propagation;
- role validation, including owner training as any role.

Future feature integrations should add `isTraining` or an equivalent sandbox marker to the entities they create during training mode.

## Training data safety

Training-created data is marked with:

- `isTraining`
- `trainingRole`
- `trainingAccountId`

The first protected entity set includes clients, visits, bookings, booking series, manual finance records, client bases, call tasks, call task clients, call attempts and training notes.

Production reports and high-level analytics must exclude `isTraining = true` rows by default. Current protected aggregates include finance reports, booking analytics, visits analytics, call task reports and client-base/client list calculations. Operational screens can later add an explicit training scope if trainees need to inspect their own sandbox records after creation.

Owners can inspect and clean training data from `/api/onboarding/training-data`. The cleanup is role-scoped when `role` is provided and removes training rows plus dependent booking/visit records while leaving onboarding progress intact.

## Metrics and QA

Owners can inspect completion metrics from `/api/onboarding/metrics`. The endpoint aggregates active accounts, role-path starts, completed task slots, role percentages and per-task completion counts. The onboarding page shows these metrics next to training-data controls so the owner can see which roles are actually moving through the learning paths.

`server npm run onboarding:audit` validates catalog shape, route allowlist, checkpoint event usage and whether catalog routes are registered in the client router. In the current baseline every checkpoint event from the catalog must be referenced either by backend product code or by client route-event code; warnings mean a release missed onboarding wiring. Use `server npm run onboarding:audit:strict` before release so warnings fail the release gate.

## Client-side review checkpoints

Review-only tasks can be completed by opening the relevant CRM screen. The browser records a small allowlisted event through `POST /api/onboarding/events`; action events like booking creation are intentionally blocked from this endpoint and must still come from backend product services.

Current route-view events cover audit, bookings schedule review, call-task report review, finances, onboarding training-data review, references, utilization and visits analytics.

## Checkpoint events

CRM services record semantic events through `onboardingService.recordEventSafe(...)`. The service:

- stores the event in `OnboardingEvents`;
- resolves the target role from training mode or the user's own role;
- finds tasks with the same `checkpoint.event`;
- verifies optional checkpoint conditions against the event payload;
- completes matching `OnboardingProgress` rows automatically.

Integrated backend product events:

- `access.visit_created`
- `account.created`
- `booking.cancelled`
- `booking.created`
- `booking.moved`
- `booking.paid`
- `call_task.attempt_logged`
- `client.created`
- `client.viewed`
- `client_base.created`
- `call_task.created`
- `catalog.category_updated`
- `catalog.rule_updated`
- `finance.record_created`
- `motivation.rule_updated`
- `payroll.reviewed`
- `report.exported`
- `shift.approved`
- `training_note.created`
- `training_note.updated`
- `training_level.updated`

Use `recordEventSafe` inside product services so onboarding failures never block the user's real CRM action.

## Feature release workflow

Feature branches should finish with:

```md
Onboarding impact:
- roles:
- scenarios:
- routes:
- new actions:
- checkpoint events:
- instructions/tasks to update:
```

The onboarding branch then updates `catalog.js`, checkpoint event contracts, in-app instructions and smoke coverage before the feature ships.

Recommended update order after a feature release:

- add or adjust checkpoint events in services;
- update affected role missions and task copy in `catalog.js`;
- add task `skills` and `badge` metadata;
- mark any training-created entities with the standard training data fields;
- keep production reports filtered away from `isTraining = true`;
- verify owner role override can open the changed role path;
- run catalog and onboarding service tests.
