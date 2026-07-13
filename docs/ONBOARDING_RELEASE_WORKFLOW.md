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
5. Update owner/manager knowledge guides when the feature changes a section, metric, formula, data source, permission rule or management interpretation.
6. Update instruction cards and real CRM screenshots when the feature changes a taught screen.
7. Keep the approved card format from `docs/ONBOARDING_INSTRUCTION_FORMAT.md`: first card is the section screenshot, action cards explain what to click/fill/check, and screenshots are attached only when they directly illustrate a form or result state.
8. Update lesson `updatedAt` when text, screenshots, routes, rules, metrics or role visibility change, so users who already completed the lesson see `Обновлено`.
9. If the feature creates data, add training markers or explicitly document why it is not training-safe yet.
10. Run the full release gate:

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

11. Run browser QA for changed instruction cards on desktop and narrow viewport.
12. Verify console/network output has no actionable error or warning.
13. Update `docs/SPRINT_STATUS.md` if the work closes or changes a planned onboarding sprint.

For the onboarding worktree, use the dedicated local ports:

- frontend: `127.0.0.1:5174`
- backend: `127.0.0.1:3005`

## Screenshot refresh

Instruction screenshots are stored under `client/public/onboarding/<role>/<task-slug>/`.
Shared owner/manager knowledge screenshots are stored under `client/public/onboarding/knowledge/<section-slug>/overview.png`.
Release-quality lessons with screenshots use `section-first-cards`: the first card is a concrete `Открой ...` command with one real CRM screenshot of the starting section, card or working screen. Attach later screenshots only to cards where the image directly illustrates a form, modal, changed state or final result. Leave click-only, summary or conceptual cards text-only instead of reusing a nearby screenshot.
Synthetic local demo CRM names and phones are acceptable in admin/accountant/owner/manager screenshots when they are not real client data and do not look like noisy QA artifacts. Trainer-facing screenshots must stay phone-free and must not expose external IDs, call history or client-base management fields.
See `docs/ONBOARDING_SCREENSHOTS.md` for the full convention.

## Knowledge guide depth

Owner and manager knowledge guides should be understandable for a person opening CRM for the first time. When a section changes, check that the guide still answers:

- what the screen is for;
- how to read the screen layout;
- which entities and statuses live there;
- where the data comes from;
- how key metrics and formulas are calculated;
- which lifecycle or workflow the section supports;
- which role is responsible for decisions;
- what edge cases and data-quality traps matter;
- what a good management decision from this section looks like.
- whether the screen-map card still has a current real CRM screenshot.

User-facing formulas must use Russian labels and readable formulas, not raw internal field names. Final owner/manager cards should teach how to use the CRM screen and where to inspect data in the system, not give generic business advice.

## Training methodology releases

When a feature changes the training methodology flow, update onboarding for these scenarios before release:

- methodology base: skills, directions, exercise statuses, formats, exercise steps and approval rules;
- client skill map: level 0-5, last trained date, latest exercise, latest assessment, repeat flag and next exercise step;
- structured training note: exercise results, ratings, repeat flags and safe free-text note;
- skill-map algorithm: how ratings, repeat flags, exercise steps and level ranges affect advancement;
- personal and group recommendations: input data, priority reasons, anti-repeat behavior and manual blocks;
- training plans: planned state, completed state, fact recording and participant training notes;
- booking link: training booking type, responsible trainer, participants and auto-created plan;
- senior trainer analytics: methodology coverage, plan/fact match and deviation examples.

For owner and manager knowledge cards, explain formulas with Russian labels. Example: `Совпадение плана и факта = «Упражнения плана, записанные по факту» / «Упражнения в плане» * 100%`.

For trainer-facing instructions, keep the safe-role boundary explicit: no phones, external IDs, CRM sales notes, call history or full client-base management context.

When wiring checkpoints for methodology scenarios, keep sibling tasks narrow:

- route-review events on shared screens should include `payload.taskKey` from the active onboarding task;
- ordinary training note creation should emit `structured: false`;
- structured training note creation should emit `structured: true`;
- booking schedule review and training-plan-link tasks should not share an unconditional checkpoint.

If the methodology screens are only present in the feature branch, text-only onboarding cards are acceptable in the instructions branch. Capture and attach real screenshots for `/admin/methodology`, `/admin/methodology-analytics`, `/admin/trainer` and changed booking/client states after merging feature + instructions.

## Prepayments releases

When a feature changes prepayments, subscriptions, certificates or corporate balances, update onboarding for these scenarios before release:

- Evotor sale settings: how a receipt item remains normal revenue or creates a subscription/certificate obligation;
- pending sale queue: why an item waits for client binding, what to check before binding, and when to ignore/cancel;
- subscription lifecycle: type, activation from sale, remaining sessions, expiry, redemption, reversal and status;
- certificate lifecycle: code, money/service type, expiry, remaining value or units, redemption, reversal and status;
- corporate balances: client card, deposit, linked manual finance income, spending, reversal, period details and export;
- unified prepayments screen: summary cards, filters, expiry/low-balance indicators and quick links.

Prefer backend product events for action checkpoints. Before strict release, the feature branch should record semantic events for:

- sale setting saved;
- pending sale linked, ignored or canceled;
- subscription type saved;
- client subscription redeemed and redemption reversed;
- certificate redeemed and redemption reversed;
- corporate client created/updated;
- corporate deposit created/canceled;
- corporate spending created/reversed;
- corporate details exported.

Until those backend events exist, onboarding tasks for these flows should stay review/instruction-first and use allowlisted route-view events only for reading screens. Shared route-view checkpoints must include active `taskKey` conditions so opening `/admin/prepayments`, `/admin/catalog`, `/admin/clients`, `/admin/certificates` or `/admin/corporate-clients` does not progress sibling tasks.

Training safety gate for this epic:

- corporate clients and corporate ledger entries must use standard training markers and cleanup;
- any training-mode deposits must keep linked `Finance` records training-marked;
- pending sales, client subscriptions, certificates and redemption history must either support training markers/cleanup or remain outside action training tasks;
- production reports, prepayments summaries, certificate lists and corporate balances must exclude training rows by default.

If prepayment screens are only present in the feature branch, text-only onboarding cards are acceptable in the instructions branch. Capture real screenshots for `/admin/prepayments`, `/admin/certificates`, `/admin/corporate-clients`, changed `/admin/catalog` tabs and changed client subscription cards after merging feature + instructions.

## Manager control releases

When a feature changes the daily manager control queue, update onboarding for:

- owner/manager review tasks for `/admin/manager-control`;
- the owner/manager knowledge guide for how the queue groups pending sales, calls, problem bookings, expiring subscriptions, expiring certificates and low corporate balances;
- the route-view checkpoint `manager_control.viewed`;
- real CRM screenshots under `client/public/onboarding/knowledge/manager-control/overview.png`.

Manager-control route checkpoints must include active `taskKey` conditions. Opening `/admin/manager-control` should not progress both owner and manager tasks or any future sibling review tasks without the active onboarding context.

Training safety gate for this screen:

- pending sales, subscriptions, certificates and redemptions stay review-first unless feature code has training markers, report exclusions and cleanup;
- corporate balances and ledger entries must stay training-cleanup safe;
- manager-control screenshots may use local synthetic demo data, but must not show noisy QA labels, random test names or real client data.

If `/admin/manager-control` exists only in the feature branch, strict audit in the isolated instructions branch can warn that the catalog route is missing from the client router. Treat that as an expected merged-branch gate item, then rerun strict audit after feature + instructions are merged.

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
- owner and manager knowledge guides cover every CRM section they can use;
- every screenshot-backed lesson starts with a real section screenshot;
- form/result cards have real screenshots when they directly illustrate the taught state;
- complex analytics/review screenshots may use small embedded numbered arrows only when they are real CRM screenshots and every number has a caption in the lesson;
- click-only, conceptual and formula cards are intentionally text-only;
- every lesson has `updatedAt`, and completed lessons updated afterwards are visibly marked until acknowledged again;
- `server npm run onboarding:audit:strict` reports screenshot coverage with no warnings;
- all backend and frontend release gate commands pass;
- browser QA verifies card navigation, image loading and no return of `Попробовать`, `Практика` or `Мини-тест`.

For Visits Analytics releases, the handoff must also verify owner/manager segment-to-client-base-to-call-task flow, accountant/viewer read-only filters and exports, the four tabs of `/admin/visits-analytics`, and no new checkpoint event beyond the existing `report.viewed` route-review event.

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
