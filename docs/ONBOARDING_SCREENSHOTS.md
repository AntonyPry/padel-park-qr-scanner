# Onboarding screenshots

This document defines how instruction card screenshots are stored and refreshed.

## Asset structure

Store release-quality instruction screenshots under:

```text
client/public/onboarding/<role>/<task-slug>/<screen-name>.png
```

Shared owner/manager knowledge guide screenshots live under:

```text
client/public/onboarding/knowledge/<section-slug>/overview.png
```

Example:

```text
client/public/onboarding/admin/client-create/client-list.png
client/public/onboarding/admin/client-create/client-form.png
```

Use stable, descriptive file names. Prefer PNG for UI screenshots. Keep QA screenshots under `outputs/qa/...`; do not reference QA output files from the onboarding catalog.

## Catalog wiring

Screenshots are referenced from `server/src/onboarding/catalog.js`:

```js
lesson: {
  blocks: [
    {
      screenshotIndex: 0,
      title: 'Открой клиентскую базу',
      type: 'step',
      text: '...',
    },
  ],
  screenshots: [
    {
      src: '/onboarding/admin/client-create/client-list.png',
      alt: 'Список клиентов с кнопкой создания клиента',
      caption: 'Начинай с кнопки «Клиент» на странице клиентской базы.',
    },
  ],
}
```

For instruction cards:

- release-quality lessons with screenshots use `section-first-cards`;
- the first screenshot-backed card is always a concrete `Открой ...` command with one real screenshot of the starting CRM section, card or working screen;
- add `screenshotIndex` only when the screenshot directly illustrates the card text;
- `screenshotIndex` points to `lesson.screenshots[index]`;
- form/fill/result cards should have screenshots when the screenshot helps the user recognize the state;
- do not reuse a screenshot just to fill space;
- leave click-only, conceptual, summary or decision cards text-only;
- do not use CSS callouts, generated illustrations or crop fragments in release screenshots;
- by default avoid arrows, frames and numbers; for complex analytics/review screens, small embedded numbered arrows are allowed only when the screenshot is a real CRM screenshot, the markers do not cover content, and `lesson.screenshots[].callouts` explains every number.
- synthetic demo CRM names and phones are allowed only when they are clearly local demo data, not real client data;
- do not use noisy QA labels such as `QA DND ...`, `[training]`, random IDs or mandatory test names in visible release screenshots;
- trainer-facing screenshots must not expose phones, external IDs, call history or client-base management fields.

## Refresh workflow

When a feature changes a screen used in onboarding:

1. Run the local app in the onboarding worktree.
2. Open the changed CRM screen with a demo account for the affected role.
3. Capture the exact state the instruction explains.
4. Save the new file under `client/public/onboarding/<role>/<task-slug>/`.
5. Update `lesson.screenshots`, `alt`, `caption` and card `screenshotIndex`.
6. Run `server npm run onboarding:audit:strict`.
7. Run frontend build and browser QA for the changed instruction card.

## Audit expectations

`server npm run onboarding:audit` checks:

- screenshot paths start with `/onboarding/`;
- referenced files exist under `client/public/onboarding`;
- card `screenshotIndex` values point to existing screenshots;
- every card with `screenshotIndex` has a real CRM screenshot;
- every screenshot-backed lesson starts with a starting screen screenshot;
- text-only cards do not reserve image space in the UI.

Current release baseline:

- `114/114` onboarding tasks have instruction-card lessons;
- `46` owner/manager knowledge guides are text-first deep guides with starting screen screenshots;
- `99` lessons with screenshots use `section-first-cards`;
- `15` lessons are text-only until a dedicated screenshot refresh adds real CRM assets;
- `157/157` screenshot-backed instruction cards resolve to screenshots;
- `698` action, review, final, conceptual or knowledge cards are intentionally text-only;
- QA screenshots belong in `outputs/qa/...` and must not be wired into the catalog.
