# Codex operating rules for this project

Этот файл - короткая инструкция для всех Codex-чатов в проекте. Если правило нужно знать всем чатам, обновляй здесь или в связанных документах, а не копируй его вручную между диалогами.

## Язык и стиль работы

- По умолчанию отвечай пользователю на русском.
- Публичное имя продукта - `Setly`. Используй его в user-facing UI, title, logo и новой документации; legacy-имена репозитория, путей и package identifiers не переименовывай без отдельной задачи.
- Сначала читай локальный контекст проекта: `docs/SPRINT_STATUS.md`, релевантные документы из `docs/`, текущий `git status`.
- Не откатывай чужие незакоммиченные изменения. Если рабочее дерево грязное, работай рядом с ними и явно упоминай важные риски.
- Для поиска используй `rg` / `rg --files`.
- После изменения пользовательских CRM-сценариев проверяй onboarding impact.

## Continuous workflow memory

- Если во время работы появился новый устойчивый способ делать проект лучше, не оставляй его только в чате.
- Если улучшение касается всех будущих Codex-чатов, предложи обновить этот `AGENTS.md`.
- Если улучшение касается процесса handoff, ролей чатов, тестирования, релизного gate или onboarding workflow, обнови `AGENTS.md` и при необходимости `docs/CODEX_WORKFLOW.md`.
- Если в чате найден более точный алгоритм запуска тестов, выбора test scope, диагностики flaky-тестов или проверки фичи перед финалом, зафиксируй его в `AGENTS.md` в виде короткого правила.
- Перед изменением проектной памяти убедись, что это повторяемое правило, а не одноразовое решение для конкретного бага.
- `AGENTS.md` и `docs/CODEX_WORKFLOW.md` являются общими правилами проекта и должны быть доступны во всех worktree. Если меняешь эти правила, коммить и пушь их как обычную проектную память. `codex-vault/` остается local-only и не пушится.

## Local Codex vault

- Локальная проектная память живет в `/Users/antonypry/Documents/padel-park-qr-scanner/codex-vault`.
- Vault не пушится в git и используется как Obsidian-compatible база решений, эпиков, handoff and templates.
- Новый чат после `AGENTS.md` and `docs/CODEX_WORKFLOW.md` должен читать `codex-vault/00_INDEX.md`, а затем только релевантные vault-файлы.
- Перед проектированием новой CRM-фичи feature-chat обязан прочитать `codex-vault/06_PROJECT_MAP.md`, `codex-vault/07_DOMAIN_INVENTORY.md` и релевантный файл из `codex-vault/domains/`.
- Не читай весь vault подряд без причины; цель vault - экономить контекст, а не раздувать его.
- После изменения активного эпика, QA-status или устойчивого процесса обновляй соответствующий vault-файл.

## Worktrees and branches

Основные рабочие ветки проекта:

- Features: `/Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-features`, branch `codex/crm-features`.
- Instructions/onboarding: `/Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-instructions`, branch `codex/crm-instructions`.
- Root repo: `/Users/antonypry/Documents/padel-park-qr-scanner`, usually for coordination docs, release notes, shared process and source-of-truth updates.

Если пользователь просит реализовать CRM-фичу, работай в feature worktree. Если просит обновить инструкции, onboarding, training mode, чекпоинты или release checklist после фичи, работай в instructions worktree.

После merge/release feature worktree не должен оставаться грязным. Штаб или QA должны привести его к одному из двух состояний:

- `git status --short --branch` чистый и ветка синхронизирована с актуальным `origin/main`;
- worktree больше не используется и явно удален/pruned.

Не начинай новую фичу в грязном или устаревшем `crm-features`. Если там есть незакоммиченные изменения от другой задачи, создай отдельный worktree от `origin/main` под новую фичу и явно сообщи пользователю, что старый worktree требует cleanup.

## Transcriber-server memory

- Инфраструктура локального GPU transcriber-server зафиксирована в `docs/TRANSCRIBER_SERVER.md` и `codex-vault/epics/telephony-transcription.md`.
- Если задача касается телефонии, записей звонков, транскрибации или ASR-интеграции, сначала прочитай эти два файла вместе с обычным bootstrap-контекстом.
- Не меняй Ubuntu laptop/VDS/WireGuard/Docker-настройки из CRM feature-чата без явного запроса пользователя; для CRM-интеграции используй documented endpoint.
- Текущий ASR endpoint: `TRANSCRIBER_BASE_URL=http://10.8.0.2:9001`, endpoint `POST /asr?task=transcribe&language=...&output=json`, multipart field `audio_file`.
- Текущий local LLM endpoint для постобработки транскрипций: `LLM_BASE_URL=http://10.8.0.2:11434`, Ollama model `qwen2.5:7b`. Для качества используй segment-level контракт: LLM возвращает только `segmentId`, `editedText`, `confidence`, `changes`, `warnings`; CRM/worker сохраняет исходные speaker/start/end и валидирует JSON.
- Не сохраняй WireGuard private keys, SSH private keys, API tokens или production passwords в docs/vault/git. Public keys and IPs can be documented only when useful for operations.

## New chat bootstrap

- В начале нового feature-чата пользователь должен дать ссылку на этот файл и `docs/CODEX_WORKFLOW.md`; если такой ссылки нет, сначала самостоятельно прочитай эти файлы, если они доступны.
- Feature-чат всегда должен проверить `git status --short --branch`, текущую ветку и `docs/SPRINT_STATUS.md` перед реализацией.
- Feature-чат работает в `worktrees/crm-features` на `codex/crm-features`, если пользователь явно не указал другой worktree.
- Instructions/onboarding-чат работает в `worktrees/crm-instructions` на `codex/crm-instructions`, если пользователь явно не указал другой worktree.
- Feature-чат не должен менять onboarding/instructions в feature-ветке без явного запроса; вместо этого он обязан вернуть `Onboarding impact`.
- Если фича релизится отдельно, после QA пользователь передает ее `Onboarding impact` в instructions/onboarding-чат.
- Если фича входит в большой эпик/release-chain, копи `Onboarding impact` по фичам и обновляй instructions/onboarding пачкой после стабилизации всей цепочки, но до merge/deploy.

## Feature workflow

В feature worktree реализуй продуктовую фичу, но не обновляй onboarding/instructions в этой же ветке без явного запроса пользователя.

Перед дизайном и реализацией новой фичи сначала сделай existing-functionality discovery:

- прочитай project map/domain inventory/domain file из vault;
- найди существующие модели, маршруты, сервисы, страницы, API wrappers and permissions через `rg`;
- явно реши, что расширяешь существующий домен, а не создаешь параллельную подсистему;
- если подходящего domain-файла нет, верни короткий inventory в `QA handoff`, чтобы штаб мог добавить его в vault.

На время multi-tenant эпика каждая новая модель, endpoint, worker/job, cache/query key, file/upload, export, webhook и realtime event должна явно декларировать scope (`global`, `organization`, `club` или `membership`) и источник проверенного tenant context; неизвестный scope блокирует merge.

Если фича меняет UI или пользовательский workflow, в конце feature-чата нужно не только перечислить проверки, но и дать пользователю способ посмотреть результат:

- запустить или указать уже запущенные локальные серверы для этого worktree;
- написать URL frontend/backend, порты и роль/demo account, под которой проверять;
- дать короткий manual QA checklist: какие экраны открыть и какие сценарии прокликать;
- если сервер не удалось запустить, явно объяснить почему и какую команду запускать в нужном worktree.

Для design/redesign/UI prototype чатов это жесткое правило: финал без живого URL и screenshots не считается готовым. Такой чат должен запустить проект или прототип, дать пользователю кликабельные frontend/backend URLs, приложить screenshots desktop и mobile `390px`, указать роль/demo account and manual QA сценарии. Если браузерная проверка или dev server невозможны, это blocker/known risk, а не нормальный финал.

В конце каждой user-facing фичи обязательно добавь в финальный ответ блок:

```md
Existing integration points checked:
- domain files:
- existing models/services/routes:
- frontend pages/api/lib:
- permissions:
- API contracts/generated client:
- onboarding/training mode:
- why new code is extension, not duplicate:

Onboarding impact:
- roles:
- scenarios:
- routes:
- new actions:
- checkpoint events:
- training data:
- instructions/tasks to update:
```

Пиши конкретные роли, маршруты, события и действия. Если фича не влияет на onboarding, напиши `none` и объясни почему.

## Instructions/onboarding workflow

Для развития самой onboarding-системы, структуры уроков, стиля инструкций и массового обновления сценариев предпочитай один постоянный instructions/onboarding chat в `worktrees/crm-instructions`, а не новый чат на каждый onboarding-сценарий. Новый onboarding-chat нужен только если старый потерял контекст, стал слишком тяжелым или пользователь явно просит параллельную независимую ветку.

Для action-onboarding задач формат должен быть операционным, а не обзорным: что нажать, какие поля заполнить, что сохранить и как проверить результат. Не подставляй конкретные тестовые имена/телефоны как обязательное действие, если пользователь просит объяснить общий процесс. Release-quality action task не считается готовой без реальных CRM screenshots с видимыми стрелками/номерами/выделениями для ключевых шагов. Сгенерированные или схематичные картинки нельзя выдавать за CRM screenshot; если реального скриншота нет, явно пометь asset как missing и верни это в QA handoff.

Если пользователь нашел ошибку в одном onboarding-сценарии, считай это сигналом проверить весь затронутый класс сценариев: все action-lessons, всю тестовую пачку или всю роль/эпик, где мог быть применен тот же шаблон. Не исправляй только один видимый пример, если вероятны такие же ошибки в соседних задачах. В fix handoff явно перечисли scope массовой проверки, что найдено, что исправлено и что осталось missing.

Когда пользователь передает `Onboarding impact` из feature worktree:

1. Прочитай diff feature branch и сам impact.
2. Обнови ролевые сценарии, training mode, чекпоинты, подсказки, задания и release checklist по необходимости.
3. Используй `server/src/onboarding/catalog.js` как источник задач обучения.
4. Для checkpoint events предпочитай реальные product/service events, а review-only события - через allowlist client-side events.
5. Для владельца сохраняй механику "пройти обучение как роль": owner может выбирать admin/trainer/accountant/etc без потери owner-прав.
6. Обнови `docs/SPRINT_STATUS.md`, если работа закрывает или меняет onboarding sprint.
7. Перед релизом стремись прогнать `server npm run onboarding:audit:strict` и релевантные тесты/build.

## Review and QA workflow

- Для подробной проверки результата используй отдельный QA/release review chat, особенно после крупной фичи, пачки связанных фич или перед merge/deploy.
- Feature-чат в финальном ответе должен давать отдельный `QA handoff`: scope, acceptance criteria, changed areas, commands run, known risks, manual QA hints and `Onboarding impact`.
- Не жди завершения всех фич, чтобы впервые открыть продукт. После каждой крупной feature-фичи должен быть локальный manual QA проход.
- Для длинной цепочки фич используй отдельный integration/QA chat, который держит живой проект в одном worktree, запускает server/client, принимает finished feature handoffs, прогоняет smoke/browser QA and returns fixes to the right feature chat.
- QA/review chat не должен начинать с реализации новых фич. Сначала он читает diff, финальные ответы feature/instructions чатов, `Onboarding impact`, `docs/SPRINT_STATUS.md` и `docs/RELEASE_CHECKLIST.md`.
- В code review stance сначала ищи bugs, regressions, missing tests, permission leaks, data migration risks, API contract drift, UX dead ends and onboarding gaps.
- Проверяй результат на трех уровнях: automated tests/build/typecheck/audit, ручной browser QA основных сценариев, product acceptance по исходному ТЗ.
- Для UI-фич запускай локальные серверы и проверяй в браузере desktop/mobile, console/network, empty/loading/error states and role-specific access.
- Для frontend-нововведений `lint/build` и login smoke не считаются полноценной проверкой. Обязательно делай visual QA desktop и мобильного `390px` с реалистичными длинными данными, screenshots, проверкой `document.scrollWidth`, безопасных отступов от краев, console/network/page errors. Если локальная БД недоступна, сначала используй mocked API для layout QA, а после восстановления БД повтори DB-backed сценарий.
- Полный server test suite запускай через `server npm test`: DB-backed fixtures должны идти с `--test-concurrency=1`, иначе параллельная очистка связанных MySQL-таблиц может давать ложные deadlock failures.
- GitHub Actions server job должен поднимать MySQL, задавать test `DB_*`, применять migrations и только затем запускать полный `server npm test`; DB-backed suite без test database не является рабочим CI gate.
- Для redesign-срезов и дизайн-прототипов QA должен проверять не только diff/build, но и реальные URLs, screenshots, desktop/mobile layout, light/dark theme, role-specific pages and basic interactions. Если feature-chat не дал URL/screenshots, QA возвращает это как handoff gap.
- Финал QA-чата должен содержать: findings by severity, что проверено, что не удалось проверить, release/blocker status, ссылки на screenshots/outputs if created, и список точечных follow-up задач.
- Для большого эпика QA-чат не должен отправлять пользователя в onboarding-чат после каждой принятой фичи. Он должен копить onboarding backlog/impact и давать onboarding prompt только когда завершены все фичи эпика, фича релизится отдельно или пользователь явно попросил.
- После полного QA/release review большого эпика и статуса `ready for merge/deploy` QA-чат должен дать временный production deploy runbook: server-side DB dump before deploy, git pull, install, migrations, client build, pm2 restart/logs, health and smoke commands.
- Для production smoke используй email `egorsmi19@gmail.com`.
- Не сохраняй production passwords или другие секреты в `AGENTS.md`/workflow docs.
- Если production password уже был передан пользователем в проектном контексте, не проси пользователя вручную подставить `<пароль>`/`<prod-password>` и не пиши такие placeholder-команды в финале. Либо запускай smoke сам с известным секретом в защищенном контексте, либо показывай команду без раскрытия значения, например через уже установленную переменную `API_SMOKE_PASSWORD`.
- В письменных runbook/docs не раскрывай значение секрета; используй имя env var и коротко укажи, что секрет не печатается открытым текстом.

## Coordination workflow

Этот чат может быть "штабом" проекта:

- держит `AGENTS.md` и `docs/CODEX_WORKFLOW.md` актуальными;
- готовит короткие промпты для feature/instructions/QA чатов;
- проверяет, что handoff между чатами содержит нужные данные;
- помогает решить, нужен ли отдельный чат, отдельный worktree или сначала ТЗ;
- не смешивает реализацию фичи и onboarding-обновление без явного запроса.
- при явном запросе пользователя может читать другие Codex threads и отправлять им сообщения через thread tools, выступая диспетчером между feature, instructions and QA chats.

Чаты не должны предполагать, что другие чаты автоматически узнают об их результате. Каждый feature/instructions/QA chat должен возвращать handoff в финале, а штабной чат может переслать этот handoff дальше, если пользователь попросит.

Подробная инструкция по использованию Codex в проекте: `docs/CODEX_WORKFLOW.md`.

## Large feature decomposition

- Если пользователь приносит большое ТЗ, docx или идею подсистемы, сначала разложи ее в штабном чате на релизные срезы.
- Новый feature-чат должен получать один конкретный срез: цель, scope, out of scope, affected files, acceptance criteria, tests and required `Onboarding impact`.
- Не отдавай feature-чату весь большой документ как прямую задачу на реализацию, если из него можно выделить несколько независимых релизных шагов.
- Первый срез должен создавать устойчивую основу данных и UX без сложной аналитики, если последующие алгоритмы зависят от этой основы.
