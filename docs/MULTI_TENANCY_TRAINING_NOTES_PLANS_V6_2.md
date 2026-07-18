# Multi-tenancy Feature 6.2 — Club-local training notes and plans

## Scope

Feature 6.2 extends the existing trainer workflow. It does not add another
training diary, plan lifecycle, recommendation engine, methodology library, or
skill map.

Club-local roots:

- `TrainingNote.clubId`;
- `TrainingPlan.clubId`.

Inherited club-local children and provenance:

- `TrainingNoteExercise` inherits through `TrainingNote`;
- `TrainingPlanParticipant` and `TrainingPlanExercise` inherit through
  `TrainingPlan`;
- the optional Booking link must resolve to the same Club;
- a participant's optional `trainingNoteId` must resolve to the same Club and
  User;
- structured `ClientTrainingSkillHistory` keeps its accepted Feature 6.1
  organization-wide parent and inherits note provenance without a dormant
  direct Club field.

Accepted organization-wide roots remain unchanged: `TrainingSkill`,
`TrainingExercise`, and `User`.

## Field matrix

| Field | Product meaning | Written by | Current consumers | Visibility | Validation and lifecycle |
|---|---|---|---|---|---|
| `TrainingNote.clubId` | Club that owns the operational trainer note | Migration backfill; training-notes service on create | note list/detail/mutations, structured history provenance, onboarding training-data summary/cleanup, DB guards | Technical-only; omitted from response mappers and OpenAPI | Required Club FK; immutable ORM hook and DB trigger; guarded development rollback only |
| `TrainingPlan.clubId` | Club that owns the plan lifecycle | Migration backfill; training-plans service on create | plan list/detail/mutations, booking link, participants, completion and quick-complete, onboarding cleanup, DB guards | Technical-only; omitted from response mappers and OpenAPI | Required Club FK; immutable ORM hook and DB trigger; guarded development rollback only |

No direct Club field is added to inherited children or skill-map history.

## Runtime contract

`TENANT_TRAINING_NOTES_PLANS_ENABLED=true` requires the accepted
`TENANT_METHODOLOGY_SKILL_MAP_ENABLED=true` chain.

When enabled:

- note, plan, booking-plan, and recommendation public boundaries require a
  branded Club request context;
- Account, Membership, Organization, Club access, effective role, and linked
  Staff identity are reloaded before reads and under a transaction lock before
  mutations;
- structurally similar, cloned, forged, revoked, or stale contexts fail closed;
- note and plan reads use the root `clubId`, not inference from User,
  participants, or an optional Booking;
- creates bind the authoritative Club inside the transaction; update, delete,
  exercise replacement, complete, and quick-complete re-lock the root;
- recommendation endpoints are Club-scoped because anti-repeat consumes
  Club-local notes, while exercises and skill maps remain Organization-scoped;
- client-detail and recommendation query keys include Club authority;
- optional corporate-ledger spending provenance can reference a note only from
  the authoritative Club;
- onboarding training-data summary and cleanup filter `TrainingNote` and
  `TrainingPlan` by Club.

When disabled, existing reads retain legacy behavior and new writes bind to the
exact default Organization and Club. The existing hard block on a second
production tenant remains unchanged.

## Database enforcement

The additive migration
`20260718160000-add-tenant-training-notes-plans.js` classifies the schema as
exact `legacy`, `ready`, or `partial` using canonical column, index, FK, and
trigger definitions. Partial/lookalike state is refused before default-tenant
or business-data reads. Forced-failure cleanup removes only artifacts created
by the current invocation. Up/down/reapply are idempotent; down refuses a
second Organization and non-default Club data.

Database triggers protect ORM, bulk, and raw-SQL paths:

- immutable root Club attribution;
- User Organization and trainer/training-account Club authority;
- Booking-to-plan same-Club linkage;
- participant User and training-note provenance;
- note/plan exercise Organization compatibility through the root Club.

## API, UI, cache, realtime, exports, and onboarding

- Existing response bodies, screens, roles, actions, lifecycle states, and
  onboarding checkpoint events are unchanged.
- OpenAPI changes only the two recommendation endpoints from Organization to
  Club tenant headers; no response/generated data type changes exist.
- Existing route-driven realtime publication uses the verified Club room.
- Corporate-ledger export has no note join, but its existing optional
  `trainingNoteId` metadata writer now validates the Club before persisting the
  provenance. No training note/plan background job exists.
- Organization-scoped client aggregates and methodology analytics remain the
  accepted explicit Organization consumers; the Club-scoped operational
  list/detail APIs and recommendation anti-repeat history never use those
  aggregate paths.
- Existing onboarding tasks `admin.booking.training-plan-link` and
  `trainer.training-plan.lifecycle` keep the same user workflow; training data
  summary/cleanup now isolates the two operational roots by Club.

## Verification target

The focused DB matrix covers legacy/partial/forced-failure migration states,
two Organizations and two Clubs, same-Organization methodology reuse,
cross-Club list/detail/write/complete/quick-complete and booking-link denial,
raw-SQL relation guards, cloned/stale context denial, training cleanup,
flag-off compatibility, rollback refusal, and down/up/reapply preservation.
