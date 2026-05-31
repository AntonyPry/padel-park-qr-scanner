# CRM onboarding system

## Purpose

The onboarding system teaches CRM users by role and scenario. Instructions live in code, while user progress lives in the database. This keeps onboarding reviewable with feature releases and prevents stale external docs.

## Source of truth

- Catalog: `server/src/onboarding/catalog.js`
- User progress: `OnboardingProgresses`
- API: `/api/onboarding`
- Release guardrail: every user-facing feature must include `Onboarding impact`
- Release workflow: `docs/ONBOARDING_RELEASE_WORKFLOW.md`
- Screenshot workflow: `docs/ONBOARDING_SCREENSHOTS.md`
- Audit command: `server npm run onboarding:audit`

The catalog is file-based by design. New roles, missions, tasks, routes and checkpoint events should be changed in the same pull request as the feature that affects them.

Owner and manager paths also include knowledge guides with keys like `owner.knowledge.finances` and `manager.knowledge.telephony`. These guides explain how each CRM section works, where metrics come from and what decisions the role should make from the data. They are intentionally stored next to action tasks so feature releases can update the workflow instruction and the underlying business explanation together.

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
- `lesson`: instruction card blocks and screenshots for the task detail screen.
- `practice`: technical/future guided route metadata. It is not shown in the current card-reader UI.
- `quiz`: technical/future knowledge-check metadata. It is not shown in the current card-reader UI.

Each path also has `levelLabel` and `completionBadge`. These fields keep the in-app experience gamified without hardcoding copy in the client. When releases add or change a CRM workflow, update the task copy, skills, badge and checkpoint in the same catalog edit.

## Progress model

Progress is stored by `accountId`, target `role` and `taskKey`.

This allows:

- a trainer to have trainer progress;
- an admin to have admin progress;
- an owner to have separate progress for `owner`, `admin`, `trainer`, `accountant` and other role paths.

Statuses are `in_progress`, `completed` and `skipped`. Guided progress metadata can store three independent blocks:

- `lesson.readAt`
- `practice.startedAt`, `practice.completedAt` and completed step keys
- `quiz.attempts`, `quiz.lastAttempt` and `quiz.passedAt`

The current product UI uses the card-reader flow: a task is completed when the user reaches the last instruction card and clicks completion. Under the hood the legacy complete endpoint writes all guided metadata blocks at once, so old APIs and audits remain compatible while practice/quiz are paused.

Guided task APIs:

- `GET /api/onboarding/tasks/:taskKey`
- `POST /api/onboarding/tasks/:taskKey/lesson-read`
- `POST /api/onboarding/tasks/:taskKey/practice-start`
- `POST /api/onboarding/tasks/:taskKey/steps/:stepKey`
- `POST /api/onboarding/tasks/:taskKey/quiz-attempt`

## Instruction Card UI

The onboarding UI has two entry points:

- `/admin/onboarding`: role task list grouped by missions.
- `/admin/onboarding/:taskKey`: one instruction card per screen, with real CRM screenshots when available.

The task detail page uses a simple card-reader flow:

- only one card is visible at a time;
- navigation is `Назад` / `Далее`;
- screenshots are shown inside the card and must be real CRM screenshots for release-quality tasks;
- knowledge guides can be text-only when the card explains calculations, data lineage or management logic rather than a visible UI state;
- the last card completes the instruction;
- there is no `Попробовать`, no quest bar and no mini-test in the current UI.

Practice targets through `data-onboarding-target` may remain in code for future interactive training, but they are not part of the active onboarding experience.

Instruction screenshots live under `client/public/onboarding/<role>/<task-slug>/`.
For release-quality instructions, only cards with an explicit `screenshotIndex` show a CRM screenshot. If a card is conceptual or summarizes a decision, leave it text-only instead of reusing a nearby screenshot that does not describe the text.

Current release-quality coverage:

- `71/71` catalog tasks have instruction-card lessons;
- `34` owner/manager knowledge guides cover CRM sections, metrics and role-specific interpretation;
- `74/74` screenshot-backed instruction cards resolve to real CRM screenshots;
- `183` final, conceptual or knowledge cards are intentionally text-only;
- screenshots live in `client/public/onboarding/<role>/<task-slug>/`;
- role coverage includes `owner`, `manager`, `admin`, `accountant`, `viewer` and `trainer`;
- trainer screenshots are captured in safe mode without phone numbers or excess personal data;
- owner role override is part of the supported QA path and must keep working for every role.

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

`server npm run onboarding:audit` validates catalog shape, route allowlist, checkpoint event usage, screenshot files and whether catalog routes are registered in the client router. In the current baseline every checkpoint event from the catalog must be referenced either by backend product code or by client route-event code; required instruction screenshots must exist under `client/public/onboarding`. Warnings mean a release missed onboarding wiring or content assets. Use `server npm run onboarding:audit:strict` before release so warnings fail the release gate.

## Client-side review checkpoints

Review-only tasks can be completed by opening the relevant CRM screen. The browser records a small allowlisted event through `POST /api/onboarding/events`; action events like booking creation are intentionally blocked from this endpoint and must still come from backend product services.

Current route-view events cover audit, bookings schedule review, call-task report review, finances, onboarding training-data review, references, utilization and visits analytics.

## Checkpoint events

CRM services record semantic events through `onboardingService.recordEventSafe(...)`. The service:

- stores the event in `OnboardingEvents`;
- resolves the target role from training mode or the user's own role;
- finds tasks with the same `checkpoint.event`;
- verifies optional checkpoint conditions against the event payload;
- marks matching task practice as progressed for future interactive training; the current card-reader UI completes tasks from the instruction page.

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

## Local demo role accounts

Use `server npm run seed:demo-accounts` in development to create or refresh local QA accounts for every role. The command is idempotent and local-only unless `ALLOW_DEMO_ACCOUNT_SEED=true` is set intentionally.

Default credentials:

- `owner@padelpark.demo`
- `manager@padelpark.demo`
- `admin@padelpark.demo`
- `accountant@padelpark.demo`
- `viewer@padelpark.demo`
- `trainer@padelpark.demo`

Password for all demo accounts: `Demo1234!`.

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

The onboarding branch then updates `catalog.js`, checkpoint event contracts, in-app instructions, screenshots and smoke coverage before the feature ships.

Recommended update order after a feature release:

- add or adjust checkpoint events in services;
- update affected role missions and task copy in `catalog.js`;
- add task `skills` and `badge` metadata;
- refresh real CRM screenshots in `client/public/onboarding/...` when a taught screen changes;
- mark any training-created entities with the standard training data fields;
- keep production reports filtered away from `isTraining = true`;
- verify owner role override can open the changed role path;
- run catalog and onboarding service tests;
- run the release gate from `docs/ONBOARDING_RELEASE_WORKFLOW.md`.
