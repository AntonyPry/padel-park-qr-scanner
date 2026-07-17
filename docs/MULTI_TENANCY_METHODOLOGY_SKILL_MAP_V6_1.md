# Multi-tenancy Feature 6.1 — Methodology and client skill map

## Scope

Feature 6.1 extends the existing training methodology domain. It does not add a
second methodology engine, skill-map model, recommendation engine, or UI.

Organization-wide roots:

- `TrainingSkill.organizationId`;
- `TrainingExercise.organizationId`.

Inherited organization children (no dormant direct tenant field):

- `TrainingExerciseSkill` inherits through `TrainingExercise` and
  `TrainingSkill`;
- `ClientTrainingSkill` inherits through `User` and `TrainingSkill`;
- `ClientTrainingSkillHistory` inherits through `ClientTrainingSkill`, `User`
  and `TrainingSkill`.

`TrainingNote`, `TrainingPlan`, and their children remain club-local work for a
later slice. Feature 6.1 only adds fail-closed methodology reads and provenance
checks where those tables consume an organization-wide exercise or produce
skill-map history.

## Field matrix

| Field | Product meaning | Written by | Current consumers | Visibility | Validation and lifecycle |
|---|---|---|---|---|---|
| `TrainingSkill.organizationId` | Owning Organization of a methodology skill | Migration backfill; methodology service on create | Methodology CRUD, exercise relations, skill map, recommendations, analytics, DB guards | Technical-only; omitted from response mappers/OpenAPI | Required FK; immutable ORM hook and DB trigger; removed only by guarded development rollback |
| `TrainingExercise.organizationId` | Owning Organization of a methodology exercise | Migration backfill; methodology service on create | Methodology CRUD, notes/plans provenance, recommendations, analytics, DB guards | Technical-only; omitted from response mappers/OpenAPI | Required FK; immutable ORM hook and DB trigger; removed only by guarded development rollback |

No `organizationId` was added to inherited child tables and no `originClubId`
was added to skill history because there is no current consumer for either.

## Runtime contract

`TENANT_METHODOLOGY_SKILL_MAP_ENABLED=true` requires
`TENANT_BOOKINGS_COURTS_ENABLED=true` and therefore all accepted earlier tenant
capabilities.

When enabled:

- every public methodology, skill-map, recommendation, analytics, structured
  note, and plan-methodology boundary accepts only a branded request
  `TenantContext`;
- Account, Membership, Organization, optional Club access, and Staff identity
  are reloaded before domain reads or writes;
- methodology lists, mutations, approvals, archive/restore, recommendations,
  analytics, sync, and history are Organization-scoped;
- client merge moves history together with its authoritative
  `ClientTrainingSkill` parent;
- onboarding training-data summary/cleanup scopes client skill maps through
  the owning `User`.

When disabled:

- reads retain the legacy unscoped behavior;
- new methodology and inherited skill-map writes use the exact default
  Organization;
- automatic skill-map sync is a no-op for a non-default client, so the
  compatibility bridge cannot create a cross-Organization child while the
  capability is off;
- a second production tenant remains unsupported and blocked by the existing
  tenant-foundation rollout contract.

Request body, query, and header tenant IDs are never accepted as service
authority. Route middleware supplies the branded context.

## Database enforcement

The additive migration
`20260718140000-add-tenant-methodology-skill-map.js` adds only the two root
fields, Organization-leading indexes/uniques, Organization FKs, and canonical
triggers.

Triggers protect ORM, bulk, and raw-SQL paths:

- immutable root attribution and same-Organization actor provenance;
- `TrainingExercise.mainSkillId` and `TrainingExerciseSkill` relations;
- `ClientTrainingSkill` User↔Skill ownership;
- history parent, actor, note, trainer, participant, and booking provenance;
- `TrainingNoteExercise` and `TrainingPlanExercise` methodology consumers.

The migration classifies schema as exact `legacy`, `ready`, or `partial` from
canonical column/index/FK/trigger definitions. Partial state is refused before
default-tenant or business-data reads. Forced failure cleanup removes only
artifacts created by the current invocation and restores the legacy global
skill-name unique. Up and down are re-applicable. Down refuses while a second
Organization exists.

## API, UI, cache, realtime, and exports

- Existing response shapes and UI behavior are unchanged; tenant fields stay
  internal.
- Existing OpenAPI declarations already classify methodology, skill-map, and
  recommendations as Organization scope, while notes/plans remain Club scope.
- Existing client query keys are Organization-namespaced.
- Existing realtime route/domain mapping remains authoritative and publishes
  through validated tenant rooms.
- No methodology export exists in the current domain; no export contract was
  added.

## Verification target

The focused DB matrix covers legacy/partial/lookalike/forced-failure migration
states, two Organizations with identical skill names, service and raw-SQL
cross-parent denial, forged/stale context denial, note/booking provenance,
recommendation and analytics isolation, client merge/delete, onboarding
cleanup, flag-off default attribution, second-Organization rollback refusal,
and down→up→reapply preservation.

Full SaaS regression remains the single final release-candidate gate.
