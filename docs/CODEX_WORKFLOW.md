# Как эффективно работать с Codex в этом проекте

Этот документ - рабочая схема для нескольких Codex-чатов, worktree и релизного процесса CRM.

## Главная идея

Не держи правила в памяти отдельных чатов. Общие правила живут в `AGENTS.md`, а процессные детали - в документах `docs/`.

Когда появляется новое правило, лучше обновить проектный документ один раз, чем копировать текст в каждый новый чат. В новый чат достаточно дать роль, worktree и задачу.

Если новый чат стартует прямо внутри `worktrees/crm-features` или `worktrees/crm-instructions` и ведет себя так, будто не знает общих правил, первой строкой попроси:

```md
Сначала прочитай /Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md, docs/CODEX_WORKFLOW.md, codex-vault/00_INDEX.md, codex-vault/06_PROJECT_MAP.md и codex-vault/07_DOMAIN_INVENTORY.md, затем работай дальше.
```

## Обязательный старт нового чата

Сразу после создания назови feature-чат по единому правилу: `Feature N — Короткое название` для среза эпика или `Feature — Короткое название` для самостоятельной фичи. Слово `Feature` всегда должно стоять первым.

Для feature-чата всегда начинай примерно так:

```md
Сначала прочитай /Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md, /Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_WORKFLOW.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/00_INDEX.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/06_PROJECT_MAP.md и /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/07_DOMAIN_INVENTORY.md.

Перед дизайном фичи найди релевантный файл в /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/domains/ и проверь существующие модели/маршруты/сервисы/страницы через rg. В начале ответа коротко скажи, что уже существует и что именно расширяешь.

Работай в /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-features на ветке codex/crm-features.

Сначала проверь git status, текущую ветку и docs/SPRINT_STATUS.md.

Фича: ...

Onboarding/instructions в этой ветке не реализуй без отдельного явного запроса. В финале обязательно дай:
- что изменено;
- какие проверки прошли;
- риски/ограничения;
- как мне открыть и проверить результат локально: frontend URL, backend URL, роль/demo account, manual QA checklist;
- Existing integration points checked:
  - domain files:
  - existing models/services/routes:
  - frontend pages/api/lib:
  - permissions:
  - API contracts/generated client:
  - onboarding/training mode:
  - why new code is extension, not duplicate:
- Onboarding impact:
  - roles:
  - scenarios:
  - routes:
  - new actions:
  - checkpoint events:
  - training data:
  - instructions/tasks to update:
```

Для instructions/onboarding-чата после готовой фичи:

```md
Сначала прочитай /Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md, /Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_WORKFLOW.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/00_INDEX.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/06_PROJECT_MAP.md и /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/07_DOMAIN_INVENTORY.md.

Работай в /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-instructions на ветке codex/crm-instructions.

Фича готова в /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-features на ветке codex/crm-features.

Обнови onboarding/instructions по этому Onboarding impact:
- roles:
- scenarios:
- routes:
- new actions:
- checkpoint events:
- training data:
- instructions/tasks to update:

Проверь docs/SPRINT_STATUS.md, docs/ONBOARDING_RELEASE_WORKFLOW.md, server/src/onboarding/catalog.js, checkpoint events, training safety и release checklist. Перед финалом прогони релевантные audit/test/build команды или явно скажи, что не удалось прогнать.
```

Для QA/release review-чата после фичи или пачки фич:

```md
Сначала прочитай /Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md, /Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_WORKFLOW.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/00_INDEX.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/06_PROJECT_MAP.md и /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/07_DOMAIN_INVENTORY.md.

Проведи подробный QA/release review результата.

Проверяем:
- feature branch: /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-features, ветка codex/crm-features;
- instructions branch: /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-instructions, ветка codex/crm-instructions, если onboarding уже обновлялся;
- исходное ТЗ/acceptance criteria: ...
- финалы feature/instructions чатов: ...

Сначала не исправляй код, а сделай review:
- diff и архитектура;
- миграции и data integrity;
- API contracts/OpenAPI/generated client;
- права ролей и trainer-safe данные;
- tests/build/typecheck/audit;
- browser QA desktop/mobile;
- для frontend-нововведений: visual QA desktop и `390px` с реалистичными длинными данными, screenshots, проверкой `document.scrollWidth`, безопасных отступов от краев, console/network/page errors; если БД недоступна, сначала mocked API layout QA, затем DB-backed проверка после восстановления БД;
- onboarding/release checklist;
- соответствие исходному ТЗ.

Если найдешь blockers или high severity bugs, перечисли их первыми с файлами/строками и предложи, в какой feature-чат вернуть задачу. Если мелкие проблемы можно безопасно исправить в этом QA-чате, сначала явно скажи, что именно собираешься править.

В финале дай:
- findings by severity;
- что проверено командами;
- что проверено в браузере;
- что не удалось проверить;
- release status: blocked / needs fixes / ready for merge;
- follow-up prompts для нужных чатов.
- если статус ready for merge/deploy, дай production deploy runbook: git pull, install, migrations, build, pm2 restart/logs, health and smoke.
```

## Как смотреть результат

Отдельные feature-чаты не заменяют живую проверку продукта. После каждой крупной фичи feature-чат должен запустить проект или дать точные команды/URL для проверки в своем worktree.

## Чистота worktree

`worktrees/crm-features` не должен быть складом старых незакоммиченных правок. После merge/release QA или штаб обязаны привести feature worktree в чистое состояние:

- `git status --short --branch` без modified/untracked файлов;
- ветка `codex/crm-features` fast-forward до актуального `origin/main`, если все ее изменения уже влиты;
- remote `origin/codex/crm-features` также обновлен, если эта ветка продолжает использоваться как рабочая;
- если feature worktree больше не нужен, он удален/pruned.

Если новый feature-chat видит грязный или устаревший `crm-features`, он не должен работать поверх него. Правильный выбор: остановиться и попросить cleanup или создать отдельный feature worktree от `origin/main` под конкретную задачу.

## Transcriber-server handoff

Для задач телефонии, записей звонков, транскрибации или ASR-интеграции новый чат должен дополнительно прочитать:

```md
/Users/antonypry/Documents/padel-park-qr-scanner/docs/TRANSCRIBER_SERVER.md
/Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/epics/telephony-transcription.md
```

Текущий infrastructure handoff:

- CRM/VDS WireGuard IP: `10.8.0.1`;
- Ubuntu laptop/transcriber WireGuard IP: `10.8.0.2`;
- ASR base URL: `http://10.8.0.2:9000`;
- ASR endpoint: `POST /asr?task=transcribe&language=...&output=json`;
- multipart audio field: `audio_file`;
- laptop service: `transcriber-asr.service`;
- Docker container: `transcriber-asr`;
- current ASR model: `small`;
- remote SSH via VDS jump: `ssh -J root@155.212.163.43 antonypry@10.8.0.2`.

CRM feature-чаты не должны менять WireGuard/Docker/Ubuntu laptop setup без явного запроса. Если `10.8.0.2` недоступен из Codex sandbox, используй mocked ASR для automated QA и оставь real endpoint QA как hardware/network check.

Для design/redesign/UI prototype чатов это обязательный release gate. Такой чат должен:

- запустить проект или прототип и оставить dev server доступным, пока пользователь смотрит результат;
- дать конкретные URLs, а не только команды;
- приложить screenshots desktop and mobile `390px`;
- указать роль/demo account, если это реальная CRM;
- дать manual QA checklist: какие экраны открыть, что прокликать, на что смотреть;
- явно написать, если URL/screenshots/browser QA не удалось сделать, и считать это blocker/known risk.

Финал дизайн-чата без живого URL и screenshots недостаточен. Его нужно вернуть на доработку до QA.

Минимальный финальный блок feature-чата:

```md
Как проверить локально:
- worktree:
- frontend URL:
- backend URL:
- demo account / роль:
- что открыть:
- что прокликать:
- какие edge cases проверить:
- screenshots:
```

Для длинной цепочки фич заведи отдельный integration/QA chat. Его задача - быть тем самым "живым проектом", который раньше был в одном большом чате:

- работать в одном стабильном worktree;
- запускать server/client и держать понятные URL;
- после каждой feature-фичи принимать handoff;
- прогонять smoke/browser QA;
- собирать твои ручные замечания;
- возвращать точечные fix prompts в нужные feature-чаты;
- перед merge/deploy делать полный release review.

Чаты не общаются друг с другом автоматически. Есть три режима передачи:

- вручную: пользователь копирует handoff из feature-чата в integration/QA или instructions-чат;
- через штаб: пользователь просит coordination chat прочитать/найти нужный thread и отправить туда follow-up prompt через thread tools.
- delegation callback: если штаб передал feature/fix handoff или запрос на финальный QA/promotion через `codex_delegation` с `source_thread_id`, integration/QA chat после завершения сам один раз отправляет итог в исходный штабной thread через `send_message_to_thread`; пользователя не просят копировать ответ вручную.

Для текущего SaaS/multitenancy execution chain действует отдельное standing rule: постоянный `Диспетчер задач — SaaS` сам маршрутизирует Feature/QA/promote loop и использует собственный callback thread `019f7246-8db3-7041-9a74-880788a4f915`. В этом контуре не нужно возвращать routine feature-level callbacks в HQ. В штаб уходят только product/architecture/scope/data-ownership/roles/visible-UX/User-Preview/rollback-policy вопросы, final RC и разрешения на `main`, production, deploy, provisioning, billing или production flags.

Пример запроса в штаб:

```md
Найди feature thread по методической базе, возьми его последний handoff и отправь в integration/QA thread на ревью.
```

Канонический цикл по одной фиче:

1. В coordination chat обсуждаем новую фичу и декомпозируем ее до одного понятного feature-scope.
2. Создаем feature-chat для этой фичи. Он реализует только свой scope и возвращает `QA handoff` + `Onboarding impact`.
3. Передаем `QA handoff` в integration/QA chat. Там уже запущен проект, есть URL и manual QA checklist.
4. Пользователь кликает CRM руками и отправляет замечания в integration/QA chat.
5. Если QA находит проблемы, он формирует точный fix prompt для исходного feature-chat. Фиксы возвращаются в тот же feature-chat.
6. Цикл feature-chat -> QA повторяется, пока QA не даст `ready for merge` или явное `accepted for next step`.
   Если QA-задача пришла через delegation, финальный structured handoff одновременно возвращается в `source_thread_id`: findings P0–P3, accepted/final SHA, gates, status, risks, `Onboarding impact`, следующий разрешенный шаг; при `blocked`/`needs fixes` добавляется полный fix prompt.
7. Если фича будет релизиться отдельно, после QA передаем `Onboarding impact` в instructions/onboarding chat.
8. Если несколько фич идут одной большой release-chain, копим `Onboarding impact` и обновляем onboarding пачкой после стабилизации всей цепочки, но до merge/deploy. QA может вести onboarding backlog, но не должен отправлять пользователя в onboarding-чат после каждой принятой фичи без явного запроса.
9. После onboarding-обновления integration/QA chat делает финальный release review: feature + instructions + tests + browser QA + release checklist.
10. Только после финального QA идем к следующему release/merge решению.

### Автономная SaaS-цепочка

Для согласованного SaaS/multitenancy эпика штаб не участвует в каждом feature milestone. Постоянный `Диспетчер задач — SaaS`:

- запускает следующий уже согласованный slice;
- следит за существующим Feature-чатом и при необходимости revive/continue делает в том же чате;
- принимает implementation handoff и маршрутизирует exact SHA в постоянный `QA — SaaS / Multi-tenant`, передавая свой callback threadId `019f7246-8db3-7041-9a74-880788a4f915`;
- возвращает findings и точный fix prompt в тот же Feature-чат;
- после green QA подтверждает feature-branch publication/parity;
- выполняет или маршрутизирует обычный non-force promotion exact SHA в `codex/saas-multitenancy-integration`;
- автономно делает semantic reconciliation с fresh `main`, если оба принятых контракта сохраняются и affected tests это подтверждают;
- после успешной promotion/reconciliation запускает следующий уже согласованный slice.

В этом SaaS-контуре не отправляй в HQ callbacks уровня `started`, `ready for QA`, `needs fixes` с точным fix prompt, `fix published`, `re-QA green`, `published`, `promoted` или `technical reconciliation complete`. Технические findings и merge conflicts, которые можно закрыть без изменения продуктового контракта, остаются у диспетчера. `main`, production, deploy, provisioning, billing и production flags по-прежнему требуют отдельного разрешения.

### Git-права Feature-чатов

Feature-чат не должен останавливаться ради отдельного разрешения на сохранение собственной работы. В своей именованной ветке `codex/...` ему заранее разрешено:

- выполнять `git add`;
- создавать обычные commits по scope своей задачи;
- делать обычный non-force push в эту же feature-ветку, включая создание remote branch;
- добавлять и публиковать fix-коммиты поверх reviewed SHA без переписывания истории;
- после push подтверждать clean worktree и exact local/tracking/`git ls-remote` SHA parity.

Публикация feature-ветки не означает acceptance, promotion или release и сама по себе не разрешает продолжить integration chain. Feature-чат не может без отдельного stage authorization пушить в `main`, `codex/saas-multitenancy-integration`, release/deploy branches или чужую ветку; делать force-push, rebase/squash reviewed history, merge/cherry-pick в общую ветку, удалять remote branch, создавать PR, выполнять promotion или deploy.

После green QA закреплённые `Диспетчер задач — SaaS` и `QA — SaaS / Multi-tenant` имеют standing permission на обычный non-force promotion exact SHA в `codex/saas-multitenancy-integration` после fresh ref/race/parity checks и affected reconciliation gates. Если semantic reconciliation с fresh `main` нужна и оба принятых контракта можно сохранить, она выполняется в том же integration stage без дополнительного возврата в HQ. Это разрешение не распространяется на `main`, production, deploy, provisioning, billing или production flags.

Когда QA/release chat говорит `ready for merge/deploy`, он должен вернуть временный production runbook с дампом БД перед deploy. Не сохраняй пароль в workflow-файлах; для smoke используй `API_SMOKE_EMAIL=egorsmi19@gmail.com`. Если пароль уже известен проектному контексту, не проси пользователя подставлять `<пароль>` или `<prod-password>` вручную; запускай smoke сам с секретом в защищенном контексте или показывай команду через уже установленную переменную `API_SMOKE_PASSWORD`, не раскрывая значение.

Шаблон runbook:

```bash
cd /opt/padel-park-qr-scanner

cd /opt/padel-park-qr-scanner/server
mkdir -p /opt/backups/padel-park
set -a
. ./.env
set +a
mysqldump -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" > /opt/backups/padel-park/padelpark-$(date +%Y%m%d-%H%M%S).sql

cd /opt/padel-park-qr-scanner
git pull origin main

cd /opt/padel-park-qr-scanner/server
npm install
npx sequelize-cli db:migrate --env production

cd /opt/padel-park-qr-scanner/client
npm install
npm run build

pm2 restart 0 --update-env
pm2 logs 0 --lines 80

cd /opt/padel-park-qr-scanner/server
API_HEALTH_URL=http://127.0.0.1:3000/api npm run health
API_SMOKE_URL=http://127.0.0.1:3000/api API_SMOKE_EMAIL=egorsmi19@gmail.com API_SMOKE_PASSWORD="$API_SMOKE_PASSWORD" npm run smoke:api
```

Первое сообщение для integration/QA chat:

```md
Сначала прочитай /Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md, /Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_WORKFLOW.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/00_INDEX.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/06_PROJECT_MAP.md и /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/07_DOMAIN_INVENTORY.md.

Ты integration/QA chat для большой цепочки фич.

Работай с /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-features на ветке codex/crm-features.

Задача:
- проверить текущий git status и ветку;
- запустить backend/frontend для этого worktree;
- дать мне frontend/backend URL и demo accounts/роли для ручной проверки;
- после каждой завершенной feature-фичи принимать ее handoff, прогонять smoke/browser QA и давать список точечных фиксов;
- не реализовывать новые фичи без отдельного запроса, кроме мелких QA-fix если я явно разрешу.

Когда проект запущен, дай:
- URL;
- какие страницы открыть первыми;
- что я должен прокликать руками;
- куда присылать мои замечания.
```

## Роли чатов

### 1. Coordination chat

Назначение: управляет процессом, правилами и handoff между чатами.

Используй его для:

- обновления `AGENTS.md` и workflow-документов;
- подготовки промптов для новых feature/instructions/QA чатов;
- проверки, что фича передает нормальный `Onboarding impact`;
- решения, где лучше делать задачу: feature, onboarding, QA, release.

Хороший запрос:

```md
Помоги разложить эту задачу по чатам и worktree. Нужно: ...
```

### 2. Feature chat

Назначение: одна продуктовая фича или один связный кусок CRM-функциональности.

Стартовый промпт:

```md
Сначала прочитай /Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md, /Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_WORKFLOW.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/00_INDEX.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/06_PROJECT_MAP.md и /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/07_DOMAIN_INVENTORY.md.
Найди релевантный файл в /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/domains/ и через rg проверь существующие модели/маршруты/сервисы/страницы.

Работай в /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-features на ветке codex/crm-features.

Сначала проверь git status и docs/SPRINT_STATUS.md. Реализуй фичу: ...

Onboarding/instructions в этой ветке не реализуй. В финале обязательно дай Existing integration points checked и Onboarding impact:
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

Правило "1 фича - 1 чат" полезно, когда фича имеет понятный результат и может быть проверена отдельно. Если фича большая, лучше разбить ее на несколько релизных частей, а не держать один бесконечный чат.

### 3. Instructions/onboarding chat

Назначение: обновляет обучение, ролевые сценарии, training mode, чекпоинты, подсказки и release checklist после готовой фичи.

Обычно это один постоянный чат для `worktrees/crm-instructions`. Для редизайна onboarding, нового стандарта уроков и постепенного перевода ролей не создавай новый onboarding-chat на каждый сценарий; веди итерации в том же чате и проверяй их через QA.

Для action-инструкций стандарт качества строгий: урок должен объяснять общий процесс, а не заставлять создать конкретного тестового клиента; шаги должны говорить, что нажать, какие поля заполнить и как проверить результат; screenshots должны быть реальными скриншотами CRM с видимыми стрелками/номерами/выделениями. Если реального скриншота нет, это missing asset, а не повод использовать сгенерированную картинку.

Если в одном onboarding-сценарии найден дефект формата, проверяй весь класс похожих сценариев: тестовую пачку, роль или эпик. Не ограничивайся одной карточкой, если тот же шаблон мог размножить ошибку.

Стартовый промпт:

```md
Сначала прочитай /Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md, /Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_WORKFLOW.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/00_INDEX.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/06_PROJECT_MAP.md и /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/07_DOMAIN_INVENTORY.md.

Работай в /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-instructions на ветке codex/crm-instructions.

Фича готова в ветке codex/crm-features. Освежи инструкции и onboarding.

Onboarding impact:
- roles:
- scenarios:
- routes:
- new actions:
- checkpoint events:
- training data:
- instructions/tasks to update:

Проверь docs/SPRINT_STATUS.md, server/src/onboarding/catalog.js, checkpoint events, training safety и release checklist. Перед финалом прогони релевантные audit/test команды или явно скажи, что не удалось прогнать.
```

### 4. QA/release chat

Назначение: проверяет сборку, тесты, smoke, релизный чеклист и риски перед деплоем.

Хороший запрос:

```md
Сначала прочитай /Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md, /Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_WORKFLOW.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/00_INDEX.md, /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/06_PROJECT_MAP.md и /Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/07_DOMAIN_INVENTORY.md.

Проведи release readiness review для веток codex/crm-features и codex/crm-instructions.
Проверь docs/RELEASE_CHECKLIST.md, onboarding audit, тесты, build и список незакрытых рисков.
```

## ТЗ отдельно от реализации

Разделять ТЗ и реализацию стоит, когда задача размытая, затрагивает несколько ролей или может расползтись по backend/frontend/onboarding.

Схема:

1. В coordination или planning chat подготовить короткое ТЗ: цель, роли, сценарии, API/UI, права, edge cases, acceptance criteria, проверки.
2. Передать ТЗ в feature chat.
3. Feature chat реализует только согласованный scope.
4. Instructions chat обновляет onboarding по `Onboarding impact`.

Если задача маленькая и понятная, отдельный ТЗ-чат не нужен.

## Минимальный handoff между чатами

Feature -> Instructions:

```md
Фича готова в /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-features на ветке codex/crm-features.

Что изменилось:
- ...

Проверки:
- ...

Onboarding impact:
- roles:
- scenarios:
- routes:
- new actions:
- checkpoint events:
- training data:
- instructions/tasks to update:
```

Instructions -> Release:

```md
Onboarding обновлен в /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-instructions на ветке codex/crm-instructions.

Что обновлено:
- ...

Проверки:
- server npm run onboarding:audit:strict
- ...

Релизные риски:
- ...
```

## Как формулировать задачи Codex

Лучшие запросы содержат:

- где работать: путь и ветка;
- что является источником правды;
- что нужно изменить;
- что не нужно менять;
- какие проверки нужны;
- какой формат финального ответа нужен.

Пример:

```md
Работай в worktrees/crm-features. Нужно добавить ...
Не меняй onboarding в этой ветке, только верни Onboarding impact.
Перед изменениями проверь текущие паттерны API и UI. После реализации прогони server/client тесты по затронутым модулям.
```

## Когда открывать новый чат

Открывай новый чат, если:

- начинается новая независимая фича;
- текущий чат стал слишком длинным и Codex начал терять детали;
- меняется роль работы: планирование -> реализация -> onboarding -> QA;
- нужна параллельная работа в другом worktree;
- нужно сделать review чужого diff без риска смешать контекст.

Оставайся в том же чате, если:

- задача является прямым продолжением текущей реализации;
- нужно исправить баг, найденный только что;
- Codex уже держит важный локальный контекст и worktree тот же.

## Проверки перед финалом

Codex должен явно сказать, что было проверено. Для user-facing CRM-фич обычно нужны:

- backend tests/typecheck по затронутым зонам;
- frontend tests/build по затронутым зонам;
- `server npm run onboarding:audit` или `server npm run onboarding:audit:strict`, если менялись routes/events/tasks/onboarding;
- обновление OpenAPI/generated contracts, если менялись API contracts;
- ручная браузерная проверка для заметных UI-изменений.

Если проверку нельзя запустить из-за окружения, это должно быть явно указано в финальном ответе.

## Source of truth

- Общие правила для Codex: `AGENTS.md`.
- Статус продукта и спринтов: `docs/SPRINT_STATUS.md`.
- Onboarding workflow: `docs/ONBOARDING_RELEASE_WORKFLOW.md`.
- Onboarding system: `docs/ONBOARDING_SYSTEM.md`.
- Release gate: `docs/RELEASE_CHECKLIST.md`.
- Feature branch diff and final `Onboarding impact`.
