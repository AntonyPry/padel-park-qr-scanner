# Universal Codex Project Workflow

Этот документ описывает универсальный способ работы с Codex в проекте. Его можно использовать как основу для `AGENTS.md`, `CODEX_WORKFLOW.md` или другого project-memory файла в новом проекте.

Документ намеренно не содержит цели конкретного продукта, доменной логики, путей, веток, секретов и текущих задач. Их нужно добавить отдельно в новом проекте.

## Главная идея

- Не превращай один чат в бесконечный комбайн для всего проекта.
- Разделяй работу по ролям чатов:
  - `HQ / штаб` - планирует, декомпозирует, пишет промпты, держит процесс и проектную память.
  - `feature chat` - реализует один конкретный релизный срез.
  - `QA / release chat` - проверяет результат, интеграцию, регрессии, UX, тесты и готовность к merge/deploy.
  - `docs / user-guidance chat` - опционально обновляет документацию, инструкции, help text, runbooks, release notes или onboarding, если такой слой есть в проекте.
- Чаты не должны предполагать, что другие чаты автоматически знают их результат.
- Каждый рабочий чат обязан вернуть понятный handoff.
- Для больших эпиков сначала делай декомпозицию в штабе, потом feature-чаты по срезам, потом QA, потом docs/user-guidance при необходимости.
- Не смешивай реализацию фичи, QA, документацию и релиз в одном чате без явной причины.

## Общие правила работы

- По умолчанию отвечай пользователю на языке проекта или на языке, на котором пользователь ведет работу.
- В начале разработки читай локальный проектный контекст:
  - `AGENTS.md`, если есть;
  - workflow docs, если есть;
  - sprint/status docs, если есть;
  - README и архитектурные заметки, если они релевантны;
  - текущий `git status`.
- Не откатывай чужие незакоммиченные изменения.
- Если рабочее дерево грязное, работай рядом с изменениями и явно отмечай риски.
- Для поиска используй `rg` / `rg --files`.
- Не создавай новую подсистему, пока не проверил, нет ли уже существующей модели, сервиса, API, страницы или доменного файла.
- Предпочитай расширять существующую архитектуру, а не плодить параллельную реализацию.
- Держи scope узким.
- Не записывай секреты, пароли и приватные ключи в `AGENTS.md`, docs, логи или финальные ответы.

## HQ / Штаб

Штабной чат отвечает за процесс, планирование и координацию. Обычно он не реализует фичи напрямую, если пользователь явно не попросил.

Штаб делает:

- обсуждает идею и превращает ее в ТЗ;
- проверяет адекватность требований;
- делит большой эпик на маленькие релизные срезы;
- пишет стартовые промпты для feature/QA/docs чатов;
- поддерживает правила работы и проектную память;
- помогает выбрать, нужен ли новый чат, новая ветка, worktree или сначала ТЗ;
- собирает handoff-и и решает, куда передать работу дальше;
- помогает восстановить качество процесса, если feature-чаты начали делать не то.

Штаб не должен:

- незаметно превращаться в основной feature-chat;
- смешивать реализацию, QA и документацию без явного решения пользователя;
- держать важные правила только в переписке, если они нужны будущим чатам.

## Feature Chat

Правило: `1 feature / 1 chat`, где feature - это один проверяемый релизный срез, а не весь большой эпик.

Feature-chat обязан:

1. Прочитать проектный контекст:
   - `AGENTS.md`;
   - workflow docs;
   - status/sprint docs;
   - project map/domain inventory, если есть;
   - текущий `git status`.
2. Сделать discovery существующей функциональности:
   - найти модели;
   - сервисы;
   - API routes/controllers;
   - frontend pages/components;
   - permissions/access control;
   - tests;
   - generated contracts/types, если есть.
3. Явно решить, что он расширяет существующую реализацию, а не создает дубль.
4. Держать scope в рамках задачи.
5. Не трогать docs/user-guidance без явного запроса.
6. Запустить релевантные проверки.
7. Если изменен UI, дать пользователю способ посмотреть результат:
   - URL локального проекта или прототипа;
   - роль/account, под которым проверять;
   - manual QA checklist;
   - screenshots desktop/mobile, если это UI/design задача.
8. Вернуть финальный handoff.

Feature final должен содержать:

```md
Summary:
- what changed

Changed areas:
- backend:
- frontend:
- data/migrations:
- permissions:
- tests:

Existing integration points checked:
- existing models/services/routes:
- frontend pages/api/lib:
- permissions:
- generated contracts/types:
- related docs/user guidance:
- why this extends existing code, not duplicates it:

Checks run:
- command:
- result:

Manual QA:
- URL:
- account/role:
- scenarios to click:
- screenshots/outputs:

Known risks:
- ...

Docs / user-guidance impact:
- affected users/roles:
- changed workflows:
- changed screens/routes:
- new user actions:
- docs/help/runbooks/release notes to update:
- screenshots/assets to refresh:
- or `none`

QA handoff:
- scope:
- acceptance criteria:
- files/areas changed:
- risks:
- screenshots/outputs:
```

## QA / Release Chat

QA-chat не начинает с реализации новых фич. Он сначала проверяет.

QA-chat получает:

- исходное ТЗ / acceptance criteria;
- feature final / handoff;
- diff;
- test output;
- screenshots / URLs;
- docs/user-guidance impact, если есть.

QA проверяет на трех уровнях:

1. Code and contracts:
   - diff;
   - API contracts;
   - migrations;
   - permissions;
   - data integrity;
   - edge cases;
   - risks of regression.
2. Automated checks:
   - lint;
   - tests;
   - typecheck;
   - build;
   - domain-specific audits.
3. Product / browser QA:
   - desktop;
   - mobile, usually 390px;
   - role-specific access;
   - empty/loading/error states;
   - console/network errors;
   - overflow/layout issues;
   - real user scenarios from acceptance criteria.

QA final должен начинаться с findings by severity:

```md
Findings:
- P0:
- P1:
- P2:
- P3:

Verified:
- commands:
- browser:
- roles:
- screenshots:

Not verified:
- ...

Release status:
- blocked / needs fixes / ready for merge / ready for deploy

Fix prompts:
- prompt for feature chat:
- prompt for docs/user-guidance chat, if needed:

Deploy notes:
- only if release-ready
```

Если QA нашел проблему, пользователь возвращает fix prompt в тот feature-chat или открывает отдельный hotfix-chat.

## Docs / User Guidance Chat

Docs/user-guidance chat нужен только если в проекте есть пользовательская документация, help center, инструкции, onboarding, training mode, runbooks, release notes или другой слой объяснения пользователям/операторам/команде.

Если в проекте такого слоя нет, этот чат не нужен.

Docs/user-guidance обновляется:

- после отдельной релизной фичи, если она выходит отдельно;
- или пачкой после завершения большого эпика;
- но до merge/deploy, если пользователям, операторам или команде нужно понимать новый функционал.

Не надо отправлять пользователя в docs-chat после каждой маленькой фичи большого эпика. QA копит docs/user-guidance backlog и отдает prompt, когда эпик стабилизирован.

Docs/user-guidance chat обязан:

- читать feature diff и impact;
- обновлять релевантные инструкции, docs, runbooks, release notes, help text или training materials;
- не придумывать несуществующие UI-скриншоты или состояния;
- если пользователь нашел ошибку в одном сценарии, проверить весь класс похожих сценариев;
- явно писать, если docs/user-guidance impact отсутствует.

## Handoff Rule

Любой рабочий чат в конце должен оставить результат так, чтобы другой чат мог продолжить без пересказа пользователем.

Минимальный handoff:

```md
Task:
Branch/worktree:
Status:
What changed:
How to run:
How to test:
What was verified:
Known risks:
Next chat should:
```

## Hotfix Rule

Срочные баги чинятся отдельной веткой/коммитом.

Hotfix-chat обязан:

- стартовать от актуального stable/main branch;
- не смешивать unrelated changes;
- не использовать `git add .`;
- stage only конкретные файлы hotfix-а;
- делать минимальный diff;
- не рефакторить соседний код без необходимости;
- проверить релевантный scope плюс build/lint/test, насколько возможно;
- в финале показать changed files и checks.

Hotfix final:

```md
Bug:
Root cause:
Fix:
Changed files:
Checks:
Not checked:
Risk:
Ready for merge:
```

## Project Memory

Если в процессе найдено устойчивое правило, его нельзя оставлять только в чате.

Обновляй:

- `AGENTS.md` - короткие правила, которые нужны всем чатам;
- `docs/CODEX_WORKFLOW.md` или аналог - подробный процесс;
- `docs/SPRINT_STATUS.md` или аналог - статус активных эпиков;
- local vault/project memory - карты доменов, решения, архитектурные заметки, если такой слой есть.

Не записывай в project memory:

- одноразовые решения;
- временные догадки;
- секреты;
- пароли;
- приватные ключи;
- случайные команды, которые не являются повторяемым процессом.

Перед изменением project memory убедись, что это повторяемое правило, а не локальное решение одного бага.

## Design / UI Rule

Для UI/design задач финал без визуальной проверки не считается готовым.

UI/design chat обязан:

- запустить проект или прототип;
- дать URL;
- проверить desktop;
- проверить mobile 390px;
- приложить screenshots;
- проверить text overflow;
- проверить horizontal overflow;
- проверить console/network errors;
- не делать landing вместо рабочего экрана, если пользователь просит приложение/инструмент;
- не скрывать важные рабочие данные ради красоты;
- не ломать существующие workflows.

Для UI-фич `lint/build` и login smoke не считаются полноценной проверкой. Нужна реальная visual/browser QA.

## Release Rule

Перед merge/deploy:

- feature готова;
- QA прошел;
- docs/user-guidance impact обработан или явно отложен;
- release checklist обновлен, если он есть;
- deploy runbook написан или актуален;
- smoke/health checks понятны;
- known risks явно названы.

Секреты не писать в docs. В runbook использовать env vars, например `API_SMOKE_PASSWORD`, а не раскрывать значение секрета.

## Branching And Git Hygiene

- Не откатывай чужие изменения без явной просьбы.
- Не используй destructive commands без явного подтверждения пользователя.
- Перед staging смотри `git status --short`.
- Для точечных задач не используй `git add .`.
- Если рабочее дерево содержит чужие изменения, stage только свои файлы.
- Коммиты должны соответствовать одной логической задаче.
- Если feature большая, лучше несколько осмысленных коммитов, чем один огромный коммит без структуры.

## Suggested Chat Flow

Для нового большого запроса:

1. User -> HQ:
   - идея;
   - цель;
   - ограничения;
   - материалы.
2. HQ:
   - уточняет требования;
   - проверяет существующую систему;
   - делит на feature slices;
   - пишет prompt для первого feature-chat.
3. User -> Feature chat:
   - отправляет prompt.
4. Feature chat:
   - реализует;
   - проверяет;
   - возвращает handoff.
5. User -> QA chat:
   - отправляет feature handoff.
6. QA chat:
   - проверяет;
   - если есть проблемы, пишет fix prompt.
7. User -> Feature chat:
   - отправляет fix prompt.
8. Повторять до `ready`.
9. Если нужно, User -> Docs/user-guidance chat:
   - отправляет accumulated impact.
10. QA/release:
   - финальная проверка;
   - merge/deploy notes.

## Start Prompt Template For A New Feature Chat

```md
Прочитай `AGENTS.md` и workflow docs проекта.

Работай в нужной ветке/worktree проекта.

Feature:
...

Scope:
- ...

Out of scope:
- ...

Existing functionality to inspect:
- ...

Acceptance criteria:
- ...

Checks required:
- ...

Before coding:
- run `git status --short --branch`;
- find existing models/services/routes/pages via `rg`;
- explain which existing integration points you will extend.

At the end return:
- summary;
- changed files;
- checks run;
- manual QA;
- screenshots/URLs if UI changed;
- docs/user-guidance impact;
- QA handoff.
```

## Start Prompt Template For QA Chat

```md
Прочитай `AGENTS.md` и workflow docs проекта.

Review this feature/release. Do not start by implementing fixes.

Original task / acceptance criteria:
...

Feature handoff:
...

Branch/worktree:
...

Please check:
- diff;
- tests/build/typecheck/lint;
- migrations/data risks;
- permissions/access;
- API contract drift;
- UI desktop/mobile;
- console/network errors;
- product acceptance.

Return:
- findings by severity;
- verified checks;
- not verified;
- release status;
- exact fix prompts if needed.
```

## Start Prompt Template For Hotfix Chat

```md
Срочный точечный hotfix.

Work from clean current main/stable branch in a separate branch.
Do not include unrelated changes.
Do not use `git add .`.

Bug:
...

Expected:
...

Actual:
...

Suspected area:
...

Scope:
- fix only this bug;
- no redesign;
- no unrelated refactor;
- no docs changes unless required.

Checks:
- ...

Final:
- root cause;
- changed files;
- checks;
- risk;
- ready/not ready.
```

