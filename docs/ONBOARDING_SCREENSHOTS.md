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

- every visible card requires a real CRM screenshot by default;
- `screenshotIndex` points to `lesson.screenshots[index]`;
- cards can reuse the closest screenshot from the same task when the explanation describes the same screen state;
- set `screenshotRequired: false` only for a rare card that intentionally should not have an image, and document why in the review.

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
- every required instruction card has a real CRM screenshot.

Current release baseline:

- `37/37` onboarding tasks have instruction-card lessons;
- `111/111` visible instruction cards resolve to screenshots;
- `74` CRM screenshot assets are wired into the catalog;
- QA screenshots belong in `outputs/qa/...` and must not be wired into the catalog.
