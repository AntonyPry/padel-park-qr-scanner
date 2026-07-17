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

- Название каждого чата, в котором реализуется продуктовая фича, должно начинаться со слова `Feature`. Для срезов эпика используй формат `Feature N — Короткое название`; для самостоятельной фичи — `Feature — Короткое название`.
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

### Осознанная модель данных

- Не добавляй поля в модели, таблицы, API contracts или generated client «на будущее», для возможного сценария или как неиспользуемую заготовку. Поле появляется только вместе с текущим подтвержденным поведением и реальным потребителем.
- Для каждого нового persisted/API-поля до реализации зафиксируй: продуктовый смысл, источник значения, кто его записывает, кто читает, где оно влияет на UI или внешний контракт, permissions, validation, lifecycle/cleanup и тесты. Если ни UI, ни backend-процесс, ни подтвержденная интеграция поле сейчас не используют, поле не добавляй — его дешевле добавить отдельной migration тогда, когда появится реальная потребность.
- Поле без пользовательского отображения допустимо только как осознанное техническое исключение, например audit/security, idempotency, relation identifier, integration metadata или вычисляемое служебное состояние. В таком случае в ТЗ и `QA handoff` явно укажи текущего backend-consumer, причину отсутствия в UI и regression test. Формулировка «может пригодиться позже» исключением не является.
- Рефакторинг UI, API или generated types не должен внезапно раскрывать dormant schema fields. Любое новое поле, подпись, фильтр или selector на клиенте требует отдельного acceptance criterion и подтвержденного продуктового решения.
- Если пользователь просит убрать поле или значение, по умолчанию это означает end-to-end removal: UI/forms/cards, client state/types, API payload/response, OpenAPI/generated client, validation/services, domain model, DB column/index/constraint, fixtures/tests/docs/onboarding. Просто скрыть поле на клиенте недостаточно.
- Для уже примененной production schema удаление делай новой forward migration; старую migration не переписывай. До удаления опиши data impact и rollback. Legacy-ключи допустимо сохранить только в неизменяемой исторической записи/audit snapshot, если это явно обосновано; активные runtime contracts должны их игнорировать.
- QA для изменения модели данных обязан проверить весь класс поля через `rg`, фактическую schema, migration up/down/up, сохранность связанных строк и отсутствие contract/generated drift.

Если фича меняет модель данных, в `QA handoff` добавь:

```md
Data model impact:
- fields added:
- current consumers and visible behavior:
- fields removed end-to-end:
- technical-only exceptions and justification:
- migration/data/rollback risks:
```

Если фича меняет UI или пользовательский workflow, в конце feature-чата нужно не только перечислить проверки, но и дать пользователю способ посмотреть результат:

- запустить или указать уже запущенные локальные серверы для этого worktree;
- написать URL frontend/backend, порты и роль/demo account, под которой проверять;
- дать короткий manual QA checklist: какие экраны открыть и какие сценарии прокликать;
- если сервер не удалось запустить, явно объяснить почему и какую команду запускать в нужном worktree.

### User Preview Gate

Для любой фичи, которая меняет пользовательский интерфейс или CRM-сценарий, обязателен стабильный этап ручной приемки пользователем до independent QA, onboarding, merge and deploy:

1. Как только готова первая целостная кликабельная версия на реальной локальной БД, feature-чат останавливается со статусом `ready for user preview`, а не `ready for QA`.
2. Чат запускает backend/frontend своего worktree и дает живые URL, demo account, короткий список видимых изменений и manual checklist. Дополнительно прикладывает релевантные screenshots desktop/mobile `390px` и light/dark; если пользователь может полноценно проверить все по живому URL, screenshots все равно нужны для ключевых измененных состояний.
3. До явного пользовательского `ок` нельзя начинать independent QA, обновлять onboarding/screenshots, собирать final integration, merge or deploy. Локальный commit или draft push для сохранности допустимы, но не считаются приемкой и не разрешают продолжить release-chain.
4. Замечания пользователя возвращаются в тот же feature-чат. `User Preview Gate` повторяется только если исправление меняет видимый UI или пользовательский сценарий; backend-only и test-only fixes не требуют новой визуальной приемки.
5. Для изменений информационной архитектуры, sidebar, маршрутов, вкладок, крупных layout/redesign и mobile UX нужен дополнительный ранний `structure preview` сразу после готовности каркаса, до полной реализации форм и полного test gate.

Если dev server, реальная БД или screenshots недоступны, это blocker для User Preview Gate. Нельзя заменять просмотр только описанием diff, lint/build или unit tests.

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

Onboarding работает как release-service, а не как обязательный этап каждой фичи:

- не запускай onboarding-чат для backend-only изменений, внутренних migrations/indexes, tenant attribution, refactoring, performance fixes и других срезов с доказанным `Onboarding impact: none`;
- запускай onboarding только при фактическом изменении видимого workflow, ролей/permissions, маршрутов, действий, checkpoint events, training data или пользовательских инструкций;
- для эпика или release-chain накапливай impact принятых фич и передавай его в onboarding одной пачкой после стабилизации release candidate;
- `onboarding:audit:strict`, полную сверку screenshots и ролевого каталога выполняй один раз на release candidate; внутри отдельной фичи запускай только targeted onboarding tests, если onboarding действительно затронут;
- не буди onboarding-чат только для подтверждения `none`: достаточно конкретного impact в feature/QA handoff и scope audit.

Для action-onboarding задач формат должен быть операционным, а не обзорным: что нажать, какие поля заполнить, что сохранить и как проверить результат. Не подставляй конкретные тестовые имена/телефоны как обязательное действие, если пользователь просит объяснить общий процесс. Release-quality action task не считается готовой без реальных CRM screenshots, на которых хорошо видны нужный экран и состояние. Стрелки, номера и другие графические аннотации не обязательны; не проси добавлять их без прямого запроса пользователя. Сгенерированные или схематичные картинки нельзя выдавать за CRM screenshot; если реального скриншота нет, явно пометь asset как missing и верни это в QA handoff.

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
- В проекте используются ровно два постоянных QA-чата: `QA — Продукт` для обычных CRM/UI/интеграционных фич и `QA — SaaS / Multi-tenant` для SaaS-эпика и cross-tenant security. Feature-, instructions- и другие чаты не создают новые QA-чаты и не форкают QA под отдельную фичу.
- Feature-чат после реализации только возвращает `QA handoff` операционному координатору. До завершения текущего SaaS/multiclub эпика им остаётся штаб; после отдельного handoff о завершении эпика эту роль принимает постоянный `Диспетчер задач`. Координатор выбирает один из двух постоянных QA-чатов и отправляет туда exact branch/SHA/base, scope и callback threadId. Если feature-чат уже создал лишний QA-чат, координатор останавливает и архивирует его, а проверку переносит в соответствующий постоянный QA-чат.
- Independent QA принимает user-facing фичу только после пройденного `User Preview Gate`. Если явного пользовательского подтверждения еще нет, QA сначала запускает проект, возвращает URL/screenshots и завершает этап статусом `awaiting user visual acceptance`, не переходя к onboarding или release.
- Feature-чат в финальном ответе должен давать отдельный `QA handoff`: scope, acceptance criteria, changed areas, commands run, known risks, manual QA hints and `Onboarding impact`.
- QA использует risk-based gates и не повторяет полный проектный gate на каждом этапе:
  - feature gate: targeted tests затронутого домена, нужный typecheck/lint, migration/API checks по scope;
  - independent feature QA: review diff и главных рисков, targeted regression и только релевантный browser/API/DB matrix;
  - release gate: один полный server/client/migrations/audits/browser/onboarding прогон на собранный release candidate или отдельную самостоятельно релизящуюся high-risk фичу.
- Server-only изменение без client/API-visible, route/permission или onboarding impact не требует client browser matrix, screenshots и onboarding audit. UI QA проверяет измененные состояния; полная six-role browser matrix нужна при изменении permissions/navigation либо на release gate.
- Re-QA после fix-коммита проверяет исходный reproducer, добавленный regression test и затронутые соседние контракты. Полный gate повторяется только при P0/P1, изменении shared foundation/API/schema contracts или существенном расширении diff.
- Результат проверки привязан к exact commit SHA. `QA handoff` должен перечислять команды, результаты и covered scope. Неизменившийся gate на том же SHA повторно не запускай; новый commit инвалидирует только проверки затронутых областей.
- Promotion принятого exact SHA без runtime reconciliation не повторяет полный feature QA: достаточно remote parity, ancestry, scope, migration status и clean worktree. При code conflict/reconciliation запускай affected tests; полный общий regression остается release gate.
- Не передавай QA огромный повторяющийся threat/checklist prompt. Передавай exact SHA, scope, risk class, unresolved leads и ссылку на repo handoff; детали QA читает из diff и проектных контрактов.
- Не жди завершения всех фич, чтобы впервые открыть продукт. После каждой крупной feature-фичи должен быть локальный manual QA проход.
- Для длинной цепочки фич используй отдельный integration/QA chat, который держит живой проект в одном worktree, запускает server/client, принимает finished feature handoffs, прогоняет smoke/browser QA and returns fixes to the right feature chat.
- QA/review chat не должен начинать с реализации новых фич. Сначала он читает diff, финальные ответы feature/instructions чатов, `Onboarding impact`, `docs/SPRINT_STATUS.md` и `docs/RELEASE_CHECKLIST.md`.
- В code review stance сначала ищи bugs, regressions, missing tests, permission leaks, data migration risks, API contract drift, UX dead ends and onboarding gaps.
- На release gate проверяй результат на трех уровнях: automated tests/build/typecheck/audit, ручной browser QA основных сценариев, product acceptance по исходному ТЗ. На feature QA применяй только уровни, относящиеся к измененному поведению и risk class.
- Для UI-фич запускай локальные серверы и проверяй в браузере desktop/mobile, console/network, empty/loading/error states and role-specific access.
- Для frontend-нововведений `lint/build` и login smoke не считаются полноценной проверкой. Обязательно делай visual QA desktop и мобильного `390px` с реалистичными длинными данными, screenshots, проверкой `document.scrollWidth`, безопасных отступов от краев, console/network/page errors. Если локальная БД недоступна, сначала используй mocked API для layout QA, а после восстановления БД повтори DB-backed сценарий.
- Полный server test suite запускай через `server npm test`: DB-backed fixtures должны идти с `--test-concurrency=1`, иначе параллельная очистка связанных MySQL-таблиц может давать ложные deadlock failures.
- GitHub Actions server job должен поднимать MySQL, задавать test `DB_*`, применять migrations и только затем запускать полный `server npm test`; DB-backed suite без test database не является рабочим CI gate.
- Для redesign-срезов и дизайн-прототипов QA должен проверять не только diff/build, но и реальные URLs, screenshots, desktop/mobile layout, light/dark theme, role-specific pages and basic interactions. Если feature-chat не дал URL/screenshots, QA возвращает это как handoff gap.
- Финал QA-чата должен содержать: findings by severity, что проверено, что не удалось проверить, release/blocker status, ссылки на screenshots/outputs if created, и список точечных follow-up задач.
- Если в стартовом prompt QA-чату передан `coordination threadId`, после своего обычного финального ответа QA обязан тем же полным handoff автоматически отправить сообщение в coordination chat через thread tools. Это правило действует и для зеленого verdict, и для findings/blocker; QA не маршрутизирует работу дальше сам и не просит пользователя вручную копировать handoff.
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
- текущий SaaS/multiclub эпик штаб доводит по уже начатой цепочке и принимает его QA callbacks;
- после явного статуса `SaaS/multiclub завершён` штаб используется только для целеполагания, roadmap, архитектуры, приоритетов и декомпозиции: он больше не создаёт и не контролирует feature/fix/QA execution chains;
- постоянный `Диспетчер задач` после этого статуса создаёт feature-чаты, контролирует выполнение, оживляет прерванные задачи и маршрутизирует handoff в два постоянных QA-чата;
- новые QA-чаты не создаются, пока пользователь явно не изменит решение о двух постоянных QA-чатах.

Чаты не должны предполагать, что другие чаты автоматически узнают об их результате. Каждый feature/instructions/QA chat должен возвращать handoff в финале. Если coordination thread указан в prompt, QA дополнительно отправляет handoff туда автоматически; в остальных случаях штабной чат может переслать handoff через thread tools по запросу пользователя.

Подробная инструкция по использованию Codex в проекте: `docs/CODEX_WORKFLOW.md`.

## Large feature decomposition

- Если пользователь приносит большое ТЗ, docx или идею подсистемы, сначала разложи ее в штабном чате на релизные срезы.
- Новый feature-чат должен получать один конкретный срез: цель, scope, out of scope, affected files, acceptance criteria, tests and required `Onboarding impact`.
- Не отдавай feature-чату весь большой документ как прямую задачу на реализацию, если из него можно выделить несколько независимых релизных шагов.
- Первый срез должен создавать устойчивую основу данных и UX без сложной аналитики, если последующие алгоритмы зависят от этой основы.
