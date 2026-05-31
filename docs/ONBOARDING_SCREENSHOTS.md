# Onboarding screenshots

This document defines how instruction card screenshots are stored and refreshed.

## Asset structure

Store release-quality instruction screenshots under:

```text
client/public/onboarding/<role>/<task-slug>/<screen-name>.png
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

- add `screenshotIndex` only when the screenshot directly illustrates the card text;
- `screenshotIndex` points to `lesson.screenshots[index]`;
- do not reuse a screenshot just to fill space;
- leave conceptual, summary or decision cards text-only.

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
- every `step` card, and every card with `screenshotIndex`, has a real CRM screenshot;
- text-only cards do not reserve image space in the UI.

Current release baseline:

- `37/37` onboarding tasks have instruction-card lessons;
- `74/74` screenshot-backed instruction cards resolve to screenshots;
- `37` final or conceptual cards are intentionally text-only;
- QA screenshots belong in `outputs/qa/...` and must not be wired into the catalog.
