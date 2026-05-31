# Onboarding release workflow

This is the handoff process for keeping CRM instructions current after feature releases.

## In the feature chat

Every user-facing feature should finish with this block:

```md
Onboarding impact:
- roles:
- scenarios:
- routes:
- new actions:
- checkpoint events:
- training data:
- instructions/tasks to update:
```

Use concrete route names, event names and role names. If the feature does not affect onboarding, write `none` and explain why.

## In the instructions chat

After a feature lands or is ready for review:

1. Read the feature branch diff and its `Onboarding impact`.
2. Update `server/src/onboarding/catalog.js` for affected role paths.
3. Add or adjust checkpoint events in product services.
4. Update task `skills`, `badge`, training-mode recommendation and route.
5. Update instruction cards and real CRM screenshots when the feature changes a taught screen.
6. If the feature creates data, add training markers or explicitly document why it is not training-safe yet.
7. Run the full release gate:

```bash
cd server
npm run onboarding:audit:strict
npm test
npm run typecheck
npm run health
npm run smoke:api
cd ../client
npm test
npm run build
UI_SMOKE_BASE_URL=http://127.0.0.1:5174 UI_SMOKE_API_URL=http://127.0.0.1:3005/api npm run smoke:ui
```

8. Run browser QA for changed instruction cards on desktop and narrow viewport.
9. Verify console/network output has no actionable error or warning.
10. Update `docs/SPRINT_STATUS.md` if the work closes or changes a planned onboarding sprint.

For the onboarding worktree, use the dedicated local ports:

- frontend: `127.0.0.1:5174`
- backend: `127.0.0.1:3005`

## Screenshot refresh

Instruction screenshots are stored under `client/public/onboarding/<role>/<task-slug>/`.
Every visible instruction card must resolve to a real CRM screenshot before release; final summary cards can reuse the closest task screenshot when they describe the same screen.
See `docs/ONBOARDING_SCREENSHOTS.md` for the full convention.

When a feature changes an instructed screen:

1. Open the changed screen locally with the matching demo role account.
2. Capture the exact state described by the instruction card.
3. Replace or add the PNG under `client/public/onboarding/<role>/<task-slug>/`.
4. Update `lesson.screenshots`, `alt`, `caption` and card `screenshotIndex` in `server/src/onboarding/catalog.js`.
5. Run `server npm run onboarding:audit:strict`.
6. Run browser QA for `/admin/onboarding/:taskKey` on desktop and narrow viewport.

## Audit command

`npm run onboarding:audit` validates the catalog and prints:

- role path counts;
- task counts and XP;
- training-safe task count;
- checkpoint events used by tasks;
- checkpoint events referenced in product code;
- instruction screenshots and required card coverage;
- warnings for routes, allowed events, checkpoint events or screenshot files that may need wiring.

Use `npm run onboarding:audit` while diagnosing a feature branch. Before release, use `npm run onboarding:audit:strict`; in strict mode catalog errors and warnings are treated as release failures.

## Demo account QA

Before release, verify that the local demo accounts still work:

- `owner@padelpark.demo`
- `manager@padelpark.demo`
- `admin@padelpark.demo`
- `accountant@padelpark.demo`
- `viewer@padelpark.demo`
- `trainer@padelpark.demo`

Password for all local demo accounts: `Demo1234!`.

The owner account must be able to open `/admin/onboarding?role=<role>` for every role path and open at least one task detail page per role.

## Release-ready baseline

The current Guided Onboarding card-reader baseline is release-ready when:

- every catalog task has a `lesson`;
- every release-quality `step` card has a real CRM screenshot;
- `server npm run onboarding:audit:strict` reports screenshot coverage with no warnings;
- all backend and frontend release gate commands pass;
- browser QA verifies card navigation, image loading and no return of `Попробовать`, `Практика` or `Мини-тест`.

## Handoff text for another Codex chat

Use this when the feature chat needs to hand work back here:

```md
Я работаю в feature worktree. После этой фичи обнови onboarding/instructions worktree.

Onboarding impact:
- roles:
- scenarios:
- routes:
- new actions:
- checkpoint events:
- training data:
- instructions/tasks to update:

Проверь `docs/SPRINT_STATUS.md`, обнови каталог, события, training safety и прогони `npm run onboarding:audit:strict`.
```
