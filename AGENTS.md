# Codex operating rules for this project

Этот файл - короткая инструкция для всех Codex-чатов в проекте. Если правило нужно знать всем чатам, обновляй здесь или в связанных документах, а не копируй его вручную между диалогами.

## Язык и стиль работы

- По умолчанию отвечай пользователю на русском.
- Публичное имя продукта - `Setly`. Используй его в user-facing UI, title, logo и новой документации; legacy-имена репозитория, путей и package identifiers не переименовывай без отдельной задачи.
- Сначала читай локальный контекст проекта: `docs/SPRINT_STATUS.md`, релевантные документы из `docs/`, текущий `git status`.
- Не откатывай чужие незакоммиченные изменения. Если рабочее дерево грязное, работай рядом с ними и явно упоминай важные риски.
- Для поиска используй `rg` / `rg --files`.
- После изменения пользовательских CRM-сценариев проверяй onboarding impact.
- В production UI не добавляй псевдоподсказки, которые пересказывают видимую иерархию, элементы управления или детали реализации. Оставляй только actionable guidance, фактические статусы, validation/recovery и необходимые предупреждения о последствиях.

## Production organization

- Активная организационная модель проекта: один стратегический штаб, один постоянный тимлид интеграции, три постоянных универсальных диспетчера, три закрепленных QA (по одному на диспетчера) и временные Feature-чаты.
- Диспетчеры и QA являются производственными потоками, а не владельцами доменов. Тимлид может назначить любому свободному потоку следующий эпик из любого домена.
- Канонические роли, handoff и ownership проверок описаны в `docs/CODEX_ORGANIZATION.md`. Старые модели с двумя QA, отдельным SaaS-диспетчером или совмещенным integration/QA chat больше не применяются.
- Feature-чат реализует capability и проводит прямой User Preview с пользователем. QA владеет independent test plan и verdict. Диспетчер собирает epic candidate. Тимлид интегрирует эпики, принимает решения о `main`, production rollout и rollback. Штаб обсуждает стратегию и неоднозначные продуктовые вопросы, но не является release gate.

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

После merge/release feature worktree не должен оставаться грязным. Закрепленный диспетчер должен привести его к одному из двух состояний:

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

- Название каждого временного implementation-чата задается сразу в формате `Feature <Короткое имя эпика> — <Конкретная capability>`. Не используй безликие `Feature 1`, `Исправления` или одно только имя эпика.
- В начале нового feature-чата пользователь должен дать ссылку на этот файл, `docs/CODEX_ORGANIZATION.md` и `docs/CODEX_WORKFLOW.md`; если такой ссылки нет, сначала самостоятельно прочитай эти файлы, если они доступны.
- Feature-чат всегда должен проверить `git status --short --branch`, текущую ветку и `docs/SPRINT_STATUS.md` перед реализацией.
- Feature-чат работает в `worktrees/crm-features` на `codex/crm-features`, если пользователь явно не указал другой worktree.
- Instructions/onboarding-чат работает в `worktrees/crm-instructions` на `codex/crm-instructions`, если пользователь явно не указал другой worktree.
- Feature-чат не должен менять onboarding/instructions в feature-ветке без явного запроса; вместо этого он обязан вернуть `Onboarding impact`.
- Если фича релизится отдельно, диспетчер передает ее реальный `Onboarding impact` в instructions/onboarding service после QA.
- Если фича входит в большой эпик/release-chain, диспетчер копит impacts и передает их одной пачкой после стабилизации цепочки, но до release candidate.

## Feature workflow

В feature worktree реализуй продуктовую фичу, но не обновляй onboarding/instructions в этой же ветке без явного запроса пользователя.

Feature-чатам заранее разрешены обычные Git-операции в собственной feature-ветке:

- самостоятельно выполнять `git add` и создавать локальные commits по своей задаче;
- выполнять обычный non-force `git push` только в свою именованную feature-ветку `codex/...`, включая первый push новой remote branch;
- после каждого push проверять clean worktree и exact local/remote SHA parity и указывать SHA в handoff;
- fix-коммиты после QA также можно commit/push в ту же feature-ветку без отдельного подтверждения, если reviewed history не переписывается.

Это разрешение не распространяется на `main`, `codex/saas-multitenancy-integration`, другие integration/release/deploy branches, чужие feature-ветки, merge/rebase/cherry-pick в общие ветки, force-push, удаление remote branches, создание PR, promotion и deploy. Эти действия требуют отдельного release/integration gate и явного разрешения соответствующей стадии.

После green QA закрепленный диспетчер имеет standing permission на обычный non-force promotion accepted exact SHA только в integration branch своего эпика с fresh-ref/race/parity checks. Если reconciliation меняет runtime-код, запускаются только affected checks. Тимлид интегрирует accepted epic candidates, владеет публикацией в `main`, production rollout и rollback. Диспетчер не выполняет эти release-действия самостоятельно.

Перед дизайном и реализацией новой фичи сначала сделай existing-functionality discovery:

- прочитай project map/domain inventory/domain file из vault;
- найди существующие модели, маршруты, сервисы, страницы, API wrappers and permissions через `rg`;
- явно реши, что расширяешь существующий домен, а не создаешь параллельную подсистему;
- если подходящего domain-файла нет, верни короткий inventory диспетчеру, чтобы он добавил его в vault.

На время multi-tenant эпика каждая новая модель, endpoint, worker/job, cache/query key, file/upload, export, webhook и realtime event должна явно декларировать scope (`global`, `organization`, `club` или `membership`) и источник проверенного tenant context; неизвестный scope блокирует merge.

### Осознанная модель данных

- Не добавляй persisted/API-поля «на будущее». Поле появляется вместе с подтвержденным поведением и реальным consumer.
- Для нового поля до реализации зафиксируй продуктовый смысл, источник, writer, readers, UI/backend effect, permissions, validation, lifecycle/cleanup и regression coverage.
- Поле без UI допустимо только как техническое audit/security/idempotency/relation/integration metadata исключение с текущим backend-consumer и явным обоснованием.
- Удаление поля по умолчанию является end-to-end: UI, state/types, API/OpenAPI/generated client, validation/services, model/schema/index/constraint, fixtures/tests/docs/onboarding.
- Production schema изменяется только forward migration. Не переписывай уже примененную migration; заранее опиши data impact и rollback.
- QA изменения модели проверяет фактическую schema, migration behavior, сохранность связанных строк и отсутствие contract/generated drift по затронутому scope.

Если фича меняет модель данных, добавь в handoff:

```md
Data model impact:
- fields added and current consumers:
- fields removed end to end:
- technical-only exceptions:
- migration/data/rollback risks:
```

Если фича меняет UI или пользовательский workflow, в конце feature-чата нужно не только перечислить проверки, но и дать пользователю способ посмотреть результат:

- запустить или указать уже запущенные локальные серверы для этого worktree;
- написать URL frontend/backend, порты и роль/demo account, под которой проверять;
- дать короткий manual QA checklist: какие экраны открыть и какие сценарии прокликать;
- если сервер не удалось запустить, явно объяснить почему и какую команду запускать в нужном worktree.

### User Preview Gate

- User Preview всегда проводит исходный Feature-чат до independent QA. Он запускает живые frontend/backend URL, указывает роль/demo account и дает короткий manual checklist.
- Пользователь отправляет визуальные замечания прямо в тот же Feature-чат. Диспетчер, QA и тимлид не пересказывают интерфейс и не переносят эти замечания между чатами.
- До явного пользовательского `ок` user-facing candidate не передается QA, не интегрируется и не уходит в onboarding.
- Для navigation/layout/major redesign сначала нужен ранний structure preview, затем целостный preview. Backend-only, test-only и пользовательски одобренный узкий polish не требуют повторного preview.
- Screenshots не являются deliverable по умолчанию и их отсутствие не является blocker/finding. Создавай их только по явному запросу пользователя либо когда они нужны Feature/QA для внутреннего сравнения или диагностики; не выгружай внутренние screenshots в handoff без пользы.
- Product screenshot assets для onboarding-урока являются отдельным контентным требованием и не делают screenshots обязательными для обычного Feature/QA handoff.
- Если dev server или реальная DB-backed проверка недоступны, это blocker для user-facing preview. Описание diff, lint/build или screenshots не заменяют живой URL.

Для design/redesign/UI prototype чатов живой просмотр обязателен: запусти проект или прототип, дай кликабельные frontend/backend URLs, роль/demo account и manual QA сценарии. Если dev server или сама браузерная проверка невозможны, это blocker/known risk.

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

Для развития самой onboarding-системы, структуры уроков, стиля инструкций и массового обновления сценариев используй один постоянный instructions/onboarding service в `worktrees/crm-instructions`, а не новый чат на каждую фичу.

Onboarding подключается пакетно и только при реальном impact:

- Feature-чат возвращает конкретный `Onboarding impact`, но не обновляет onboarding в feature-ветке.
- Диспетчер накапливает impacts эпика. `Onboarding impact: none` не требует отдельного чата или подтверждения.
- Instructions/onboarding service запускается после стабилизации epic/release candidate, если изменились видимый workflow, роли/permissions, routes, actions, checkpoint events, training data или инструкции.
- Targeted onboarding checks выполняются при изменении onboarding-кода. Strict audit, ролевой каталог и полный onboarding gate выполняются один раз на итоговом candidate.

Для action-onboarding задач формат должен быть операционным, а не обзорным: что нажать, какие поля заполнить, что сохранить и как проверить результат. Не подставляй конкретные тестовые имена/телефоны как обязательное действие, если пользователь просит объяснить общий процесс. Если карточке урока нужен screenshot asset, используй реальный CRM screenshot; графические аннотации необязательны без прямого запроса. Сгенерированные или схематичные картинки нельзя выдавать за CRM screenshot.

Если пользователь нашел ошибку в одном onboarding-сценарии, считай это сигналом проверить весь затронутый класс сценариев: все action-lessons, всю тестовую пачку или всю роль/эпик, где мог быть применен тот же шаблон. Не исправляй только один видимый пример, если вероятны такие же ошибки в соседних задачах. В fix handoff явно перечисли scope массовой проверки, что найдено, что исправлено и что осталось missing.

Когда пользователь передает `Onboarding impact` из feature worktree:

1. Прочитай diff feature branch и сам impact.
2. Обнови ролевые сценарии, training mode, чекпоинты, подсказки, задания и release checklist по необходимости.
3. Используй `server/src/onboarding/catalog.js` как источник задач обучения.
4. Для checkpoint events предпочитай реальные product/service events, а review-only события - через allowlist client-side events.
5. Для владельца сохраняй механику "пройти обучение как роль": owner может выбирать admin/trainer/accountant/etc без потери owner-прав.
6. Обнови `docs/SPRINT_STATUS.md`, если работа закрывает или меняет onboarding sprint.
7. На итоговом onboarding candidate прогони `server npm run onboarding:audit:strict` и targeted onboarding checks; общий server/client release gate не повторяй.

## Review and QA workflow

- В проекте постоянно существуют ровно три QA-чата, по одному на каждого универсального диспетчера. QA не привязан к домену и не создается заново под отдельную фичу.
- Feature-чат пишет/обновляет regression tests, но запускает только минимальные developer checks, необходимые для разработки и живого preview. Это не independent QA и не широкий gate.
- Закрепленный QA владеет test plan, independent risk-based checks и verdict на exact SHA. Он использует developer evidence и не повторяет ту же команду без причины.
- Диспетчер не тестирует candidate заново: он проверяет SHA, ancestry, scope, conflicts и запускает affected checks только если integration/reconciliation изменила runtime-код.
- Тимлид на общем release candidate проверяет cross-epic contracts, artifact/build/migration readiness и production guards. Принятые feature-level DB/browser/security matrices повторно не запускаются без нового сигнала риска.
- Автоматический CI может выполнить общий suite один раз на release candidate. Это не основание вручную повторять его в Feature, QA, dispatcher и release chats.
- Новый commit инвалидирует только evidence затронутых областей. Re-QA проверяет исходный finding, regression и affected neighbors; полный gate нужен только при расширении риска или shared-foundation изменении.
- OpenAPI/generated regeneration и no-drift gate запускаются только при изменении API contract, route manifest, tenant scope или generated consumer.
- Для UI independent QA проверяет измененные состояния, desktop/mobile, overflow и console/network по риску, но не проводит User Preview вместо Feature-чата.
- Feature-чат в финальном ответе дает диспетчеру `QA handoff`: exact branch/SHA/base, scope, acceptance criteria, changed areas, developer checks, known risks, manual QA hints and `Onboarding impact`.
- Полный server test suite запускай через `server npm test`: DB-backed fixtures должны идти с `--test-concurrency=1`, иначе параллельная очистка связанных MySQL-таблиц может давать ложные deadlock failures.
- GitHub Actions server job должен поднимать MySQL, задавать test `DB_*`, применять migrations и только затем запускать полный `server npm test`; DB-backed suite без test database не является рабочим CI gate.
- Финал QA-чата содержит findings by severity, covered scope, exact evidence, gaps и verdict `blocked` / `needs fixes` / `accepted`.
- Диспетчер копит onboarding impact эпика. Тимлид подключает onboarding service пакетно только при реальном impact и собирает production runbook после готовности общего release candidate.
- Для production smoke используй email `egorsmi19@gmail.com`.
- Не сохраняй production passwords или другие секреты в `AGENTS.md`/workflow docs.
- Если production password уже был передан пользователем в проектном контексте, не проси пользователя вручную подставить `<пароль>`/`<prod-password>` и не пиши такие placeholder-команды в финале. Либо запускай smoke сам с известным секретом в защищенном контексте, либо показывай команду без раскрытия значения, например через уже установленную переменную `API_SMOKE_PASSWORD`.
- В письменных runbook/docs не раскрывай значение секрета; используй имя env var и коротко укажи, что секрет не печатается открытым текстом.

## Coordination workflow

Штаб обсуждает стратегию и неоднозначные продуктовые решения. Он не маршрутизирует routine execution и не является release gate.

Тимлид:

- назначает эпики трем универсальным диспетчерам;
- при назначении сразу переименовывает постоянную пару в `Диспетчер N — <Короткое имя эпика>` / `QA N — <Короткое имя эпика>`, а после финального epic handoff и освобождения capacity возвращает базовые `Диспетчер N` / `QA N` без суффикса и статусного слова;
- управляет межэпиковыми dependencies и shared foundation;
- принимает только accepted epic candidates;
- собирает release candidate, принимает решение о `main`, rollout и rollback;
- обращается в штаб только за продуктовым или архитектурным смысловым выбором.

Тимлид управляет portfolio эпиков, а не отдельными Feature-задачами. По умолчанию ему не передаются старт/завершение каждой фичи, каждый feature SHA, targeted tests, polish, routine findings, fix/re-QA и промежуточные handoff/logs. Он получает согласованный epic contract, редкие критичные escalation, при длительной работе компактный epic-level status и один финальный epic candidate с exact epic SHA, итоговым QA verdict, migrations/data/rollback, onboarding impact, unresolved risks and dependencies.

Каждый диспетчер ведет полный цикл своего эпика: `Feature -> User Preview -> QA -> fix/re-QA -> epic integration`. Callback target QA всегда его диспетчер. Диспетчер сразу именует временную задачу `Feature <Короткое имя эпика> — <Конкретная capability>`. Routine статусы и однозначные findings не уходят тимлиду или в штаб. Пользователь не переносит handoff вручную, кроме прямых визуальных замечаний в исходном Feature-чате.

### Operational source and queue

- Канонические технические источники доступны всем ролям: `AGENTS.md`, organization/workflow docs, релевантные vault/domain/epic files и exact code/diff/SHA. Feature и QA обязаны читать их самостоятельно.
- Epic operational source of truth получает только назначенный Dispatcher: current brief, priority/scope, acceptance boundaries, dependencies, Team Lead decisions, queue/status changes и cross-epic constraints. Team Lead не рассылает эти обновления напрямую Feature/QA и не управляет ими в обход Dispatcher.
- Перед новым handoff/follow-up в Feature или QA Dispatcher проверяет task state. Для `idle/completed` он перечитывает последний результат, удаляет устаревшие пункты и отправляет один цельный handoff. Для `active` он сохраняет pending update в своей очереди и ждёт idle/completion.
- Не дроби одно задание на серию сообщений вслед работающему чату. Routine уточнения консолидируются в следующий handoff.
- Одна Feature-задача выполняет одну capability/fix-итерацию; permanent QA проверяет один exact candidate за раз. Candidate B ждёт, пока QA закончит candidate A.
- QA получает candidate только после завершённой Feature, применимого User Preview и готового exact-SHA handoff.
- Active task можно срочно прервать только при wrong repo/worktree/branch, риске потери/утечки данных или секрета, unauthorized production mutation, destructive migration/force push, blocking P0/P1 либо явном stop/task-change пользователя. Scope polish, дополнительная идея, новый handoff, status question и некритичная dependency не являются причиной прерывания.

### Waiting for user marker

- Если задача реально остановлена до конкретного ответа или действия пользователя, она сама добавляет к текущему динамическому названию один ведущий `!!!`, например `!!!Feature Security — MFA`.
- Маркер ставится только для User Preview acceptance/правок, product choice, credentials/access/manual user action, explicit production/security decision или ambiguity без безопасного внутреннего решения.
- Не ставь `!!!` для idle/unassigned, ожидания другой роли, команды/долгого теста, безопасно продолжаемой работы или обычного status update без вопроса. Не добавляй второй `!!!`.
- Сразу после ответа пользователя удали только ведущий `!!!`, восстанови актуальное role/epic/capability name и продолжи работу.
- Каждая задача владеет своим marker. Dispatcher не дублирует пользовательский вопрос дочерней задачи и не снимает marker за неё. Feature сохраняет прямой User Preview dialogue с пользователем.

Подробные роли и границы описаны в `docs/CODEX_ORGANIZATION.md`.

Подробная инструкция по использованию Codex в проекте: `docs/CODEX_WORKFLOW.md`.

## Large feature decomposition

- Если пользователь приносит большое ТЗ, docx или идею подсистемы, сначала разложи ее в штабном чате на релизные срезы.
- Новый feature-чат должен получать один конкретный срез: цель, scope, out of scope, affected files, acceptance criteria, tests and required `Onboarding impact`.
- Не отдавай feature-чату весь большой документ как прямую задачу на реализацию, если из него можно выделить несколько независимых релизных шагов.
- Первый срез должен создавать устойчивую основу данных и UX без сложной аналитики, если последующие алгоритмы зависят от этой основы.
