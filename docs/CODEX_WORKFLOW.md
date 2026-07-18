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

### Обязательный User Preview Gate

Для каждой фичи, меняющей UI или пользовательский CRM-сценарий, между первой рабочей реализацией и independent QA существует обязательная остановка:

1. Feature-чат доводит один целостный end-to-end сценарий до кликабельного состояния на реальной локальной БД и ставит статус `ready for user preview`.
2. Feature-чат или coordination/QA-чат запускает нужный worktree и возвращает пользователю:
   - frontend/backend URLs и порты;
   - demo account/роль;
   - короткий список изменений глазами пользователя;
   - manual checklist;
   - screenshots ключевых измененных состояний desktop/mobile `390px` и light/dark.
3. Пользователь открывает CRM, смотрит screenshots и присылает замечания либо явное `ок`.
4. При замечаниях feature-чат исправляет их в том же worktree. Preview повторяется, если fix меняет видимый UI или пользовательский сценарий; backend-only/test-only fix новой визуальной приемки не требует.
5. Только после пользовательского `ок` разрешены independent QA, onboarding screenshots, merged integration QA, merge and deploy.

Локальный commit или draft push до приемки допустимы для сохранности и передачи worktree, но не являются product acceptance. Если пользователь еще не подтвердил интерфейс, статус должен оставаться `awaiting user visual acceptance`, даже если tests/build уже зеленые.

Для sidebar, навигации, новых маршрутов, вкладок, крупных layout/redesign и mobile-first изменений добавляется ранний `structure preview`: показать каркас и основные переходы до завершения всей бизнес-логики. Это позволяет исправить неверную информационную архитектуру до дорогих tests, screenshots и onboarding.

Если живой проект невозможно запустить, реальная DB-backed проверка недоступна или screenshots не сделаны, это blocker User Preview Gate, а не обычный handoff gap.

## Дисциплина полей и схемы данных

Новые поля не являются бесплатной заготовкой. Каждое поле увеличивает migration surface, API contracts, generated types, fixtures, тесты и число состояний, которые придется поддерживать. Поэтому действует правило: **нет текущего подтвержденного потребителя — нет поля**.

Перед добавлением persisted/API-поля feature-чат должен показать короткую field matrix:

```md
| Field | Product meaning | Written by | Read/used by | Visible behavior or external consumer | Validation/permissions | Lifecycle/test |
|---|---|---|---|---|---|---|
```

Если колонка или контрактное поле не влияет на текущий UI, backend-процесс или подтвержденную интеграцию, его не добавляют «на будущее». Оно добавляется позже отдельной migration вместе с реальным сценарием.

Допустимые technical-only исключения ограничены фактически используемыми audit/security, idempotency, relation identifiers, integration metadata и служебными вычисляемыми состояниями. Для каждого исключения обязательны конкретный backend-consumer, причина отсутствия в UI и regression test. Dormant enum, selector, role/type field или placeholder без текущего поведения запрещены.

Фраза пользователя «убрать поле» по умолчанию означает удалить его из всей цепочки:

1. UI, формы, карточки, фильтры и client state.
2. Client types, request/response payloads, OpenAPI и generated client.
3. Validation, services, serializers/snapshots и domain model.
4. DB column, index/constraint и связанные fixtures/tests.
5. Документация/onboarding, если поле было частью пользовательского сценария.

Для schema, уже примененной в production, создается новая forward migration с описанным data impact и rollback; исходная migration не переписывается. Исторические immutable snapshots можно оставить только как явно обоснованную историю, но active runtime/API не должны продолжать считать legacy key поддерживаемым полем.

Release gate для добавления или удаления поля включает `rg` по всему классу references, проверку реальной schema, migration up/down/up, сохранность связанных строк и отсутствие OpenAPI/generated drift. QA отдельно сопоставляет field matrix с реальным UI/backend behavior: наличие поля в schema и типах само по себе не доказывает, что оно нужно продукту.

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

В текущей структуре Setly таких постоянных QA-чатов ровно два:

- `QA — Продукт` принимает обычные CRM-фичи, UI, телефонию, аналитику и product hotfixes;
- `QA — SaaS / Multi-tenant` принимает только SaaS/multi-tenant slices, tenant migrations, provisioning и cross-tenant security.

Новый QA-чат на каждую фичу не создаётся. Feature-чат не вызывает `create_thread` для independent QA: он завершает реализацию, возвращает exact `QA handoff` операционному координатору и ждёт маршрутизации. До завершения SaaS/multiclub этим координатором остаётся штаб; после завершения эпика — постоянный `Диспетчер задач`. Только координатор отправляет handoff в один из двух постоянных QA-чатов. Исключение возможно только после явного решения пользователя изменить эту структуру.

### Ускоренный risk-based gate

Одинаковый полный набор проверок нельзя последовательно запускать в feature-чате, independent QA, re-QA, promotion и onboarding. Проверки распределяются по уровням:

1. **Feature gate** — targeted tests измененного домена, нужный typecheck/lint и migration/API checks по реальному scope.
2. **Independent feature QA** — diff review, исходные acceptance criteria, главные риски и релевантный DB/API/browser matrix. QA использует результаты feature gate на том же exact SHA и не повторяет их без причины.
3. **Re-QA** — исходный reproducer, regression test и соседние affected contracts. Полный проектный gate нужен только при P0/P1, изменении shared foundation/schema/API или заметном расширении diff.
4. **Promotion** — remote SHA parity, ancestry, scope, migration status и integration conflicts. Если runtime-код не менялся, full tests не повторяются. Code reconciliation требует affected tests.
5. **Release gate** — один полный server/client/migrations/audits/browser/onboarding прогон на собранный release candidate или самостоятельную high-risk фичу перед merge/deploy.

Минимальная матрица выбора:

| Change class | Feature / independent QA | Release candidate |
|---|---|---|
| Backend без schema/API/UI | domain tests + typecheck | full server gate |
| UI/workflow | client targeted + User Preview + changed browser states | full client/browser gate |
| Migration/data model | targeted DB migration/data matrix + contract drift | full migrations/server gate |
| Auth/tenant/money/shared foundation | focused DB/security/concurrency review | full integration gate |
| Narrow fix | finding reproducer + affected regression | covered by release gate |

Server-only change без client/API-visible, route/permission и onboarding impact не запускает client browser matrix, screenshots и strict onboarding. Полная six-role browser matrix нужна при изменении permissions/navigation или на release gate.

Каждый handoff хранит evidence, привязанное к exact SHA: команды, counts/result, covered scope, screenshots/artifacts. На том же SHA green evidence повторно используется. Новый commit инвалидирует только проверки затронутых областей. QA prompt должен быть коротким: exact SHA/base, scope, risk class, unresolved leads и callback threadId; длинные повторяющиеся checklist и сырые логи остаются в repo handoff/artifacts.

### Пакетный onboarding

Onboarding-чат не подтверждает каждое `Onboarding impact: none`. Он запускается только при изменении видимого workflow, ролей/permissions, маршрутов, действий, checkpoint events, training data или инструкций. Для большого эпика impacts накапливаются и передаются одной пачкой после стабилизации release candidate. Полный `onboarding:audit:strict`, сверка ролевого каталога и screenshots выполняются один раз на release candidate; feature-level targeted onboarding tests нужны только когда onboarding действительно менялся.

Чаты не общаются друг с другом автоматически. Есть два режима передачи:

- вручную: пользователь копирует handoff из feature-чата в integration/QA или instructions-чат;
- через штаб: пользователь просит coordination chat прочитать/найти нужный thread и отправить туда follow-up prompt через thread tools.

Для QA используется дополнительное устойчивое правило: coordination chat передает в QA prompt свой `threadId`. После обычного финального ответа QA отправляет тот же полный handoff обратно в coordination thread через thread tools независимо от verdict. Coordination chat принимает дальнейшее решение и сам маршрутизирует fixes, onboarding, merged QA или release; пользователь не должен вручную переносить QA handoff.

Пример запроса в штаб:

```md
Найди feature thread по методической базе, возьми его последний handoff и отправь в integration/QA thread на ревью.
```

Канонический цикл по одной фиче:

1. В coordination chat обсуждаем новую фичу и декомпозируем ее до одного понятного feature-scope.
2. Создаем feature-chat для этой фичи. Он реализует один целостный сценарий и останавливается на `User Preview Gate` со статусом `ready for user preview`.
3. Feature-чат или coordination/QA-чат запускает worktree и дает пользователю URL, screenshots и manual checklist. Для navigation/layout сначала проводится ранний `structure preview`.
4. Пользователь кликает CRM руками. Замечания возвращаются в тот же feature-chat, preview повторяется до явного пользовательского `ок`.
5. После пользовательской приемки feature-чат выполняет targeted feature gate, commit/push и возвращает evidence-backed `QA handoff` + `Onboarding impact` операционному координатору; сам QA-чат не создаёт.
6. Операционный координатор присваивает risk class и передает короткий handoff в один из двух постоянных QA-чатов. QA использует evidence exact SHA и выполняет только независимые/непокрытые проверки соответствующего риска.
7. Если QA находит проблемы, он формирует точный fix prompt для исходного feature-chat. Re-QA проверяет finding и affected scope; User Preview повторяется только для видимого изменения.
8. Green feature попадает в integration queue. Promotion exact SHA не повторяет полный QA без runtime reconciliation.
9. `Onboarding impact: none` закрывается без onboarding-чата. Реальные impacts накапливаются и передаются одной пачкой после стабилизации release candidate либо сразу для отдельно релизящейся фичи.
10. Integration/QA выполняет один полный release gate: merged feature set + onboarding changes + tests + migrations + audits + browser QA + release checklist.
11. QA автоматически отправляет итоговый handoff в указанный coordination thread. Только после решения coordination chat по release gate выполняются merge/deploy.

### Git-права Feature-чатов

Feature-чат не должен останавливаться ради отдельного разрешения на сохранение собственной работы. В своей именованной ветке `codex/...` ему заранее разрешено:

- выполнять `git add`;
- создавать обычные commits по scope своей задачи;
- делать обычный non-force push в эту же feature-ветку, включая создание remote branch;
- добавлять и публиковать fix-коммиты поверх reviewed SHA без переписывания истории;
- после push подтверждать clean worktree и exact local/tracking/`git ls-remote` SHA parity.

Публикация feature-ветки не означает acceptance, promotion или release и сама по себе не разрешает продолжить integration chain. Feature-чат не может без отдельного stage authorization пушить в `main`, `codex/saas-multitenancy-integration`, release/deploy branches или чужую ветку; делать force-push, rebase/squash reviewed history, merge/cherry-pick в общую ветку, удалять remote branch, создавать PR, выполнять promotion или deploy.

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

Назначение штаба: целеполагание, roadmap, архитектура, приоритеты, декомпозиция и правила проекта.

Переходный режим: уже начатый SaaS/multiclub эпик штаб доводит до итогового release handoff. После явного статуса `SaaS/multiclub завершён` штаб больше не создаёт feature-чаты, не запускает QA и не следит за выполнением. Эти обязанности переходят постоянному `Диспетчеру задач`, включая heartbeat, оживление ошибок и маршрутизацию в два постоянных QA-чата.

Используй штаб для:

- обновления `AGENTS.md` и workflow-документов;
- подготовки промптов для новых feature/instructions/QA чатов;
- проверки, что фича передает нормальный `Onboarding impact`;
- решения, где лучше делать задачу: feature, onboarding, QA, release.

Используй `Диспетчер задач` для фактического запуска и контроля согласованных feature/fix/onboarding/QA chains. Если исполнению не хватает продуктового или архитектурного решения, диспетчер возвращает вопрос в штаб, а не принимает такое решение молча.

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

Не запускай этот чат для каждого feature handoff. `Onboarding impact: none` закрывается координатором без отдельного прогона. Для release-chain собирай реальные impacts в backlog и передавай их сюда одной пачкой на стадии release candidate; strict audit и массовую сверку screenshots не повторяй после каждого backend-only fix.

Для action-инструкций стандарт качества строгий: урок должен объяснять общий процесс, а не заставлять создать конкретного тестового клиента; шаги должны говорить, что нажать, какие поля заполнить и как проверить результат; screenshots должны быть реальными скриншотами CRM, на которых видны нужный экран и состояние. Стрелки, номера и другие графические аннотации не нужно требовать без прямого запроса пользователя. Если реального скриншота нет, это missing asset, а не повод использовать сгенерированную картинку.

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

Используй существующий `QA — Продукт` или `QA — SaaS / Multi-tenant` по типу задачи. Не создавай третий QA-чат для отдельной фичи.

QA выбирает глубину по risk class и использует green evidence exact SHA из feature handoff. Он не обязан заново выполнять полный server/client/browser/onboarding gate для каждой фичи. Полный gate обязателен на release candidate; re-QA обычно ограничен finding reproducer и affected regression.

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
