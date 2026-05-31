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
5. If the feature creates data, add training markers or explicitly document why it is not training-safe yet.
6. Run:

```bash
cd server
npm run onboarding:audit
npm run onboarding:audit:strict
npm run test
npm run typecheck
cd ../client
npm run test
npm run build
```

7. Update `docs/SPRINT_STATUS.md` if the work closes or changes a planned onboarding sprint.

## Audit command

`npm run onboarding:audit` validates the catalog and prints:

- role path counts;
- task counts and XP;
- training-safe task count;
- checkpoint events used by tasks;
- checkpoint events referenced in product code;
- warnings for routes, allowed events or checkpoint events that may need wiring.

Use `npm run onboarding:audit` while diagnosing a feature branch. Before release, use `npm run onboarding:audit:strict`; in strict mode catalog errors and warnings are treated as release failures.

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
