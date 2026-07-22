# Как работать с Codex в Setly

Этот документ описывает технический цикл разработки. Активная организационная
модель и границы ролей закреплены в
[`CODEX_ORGANIZATION.md`](./CODEX_ORGANIZATION.md).

## Активная модель

Setly использует один штаб, одного тимлида интеграции, три универсальных
диспетчерских потока, три закрепленных QA и временные Feature-чаты.

- Штаб обсуждает стратегию и неоднозначные продуктовые вопросы.
- Тимлид назначает эпики, интегрирует их, владеет `main`, rollout и rollback.
- Диспетчер ведет один или несколько согласованных эпиков в своем потоке.
- Feature-чат реализует одну capability и проводит прямой User Preview.
- Закрепленный QA владеет independent test plan и verdict.
- Instructions/onboarding service подключается пакетно при реальном impact.

Диспетчеры и QA не привязаны к доменам. После завершения эпика поток получает
следующий приоритетный эпик из любого домена.

## Старт чата

Название implementation-чата начинается с `Feature`:

- `Feature N — Короткое название` для среза эпика;
- `Feature — Короткое название` для самостоятельной capability.

Перед работой Feature-чат читает:

```text
/Users/antonypry/Documents/padel-park-qr-scanner/AGENTS.md
/Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_ORGANIZATION.md
/Users/antonypry/Documents/padel-park-qr-scanner/docs/CODEX_WORKFLOW.md
/Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/00_INDEX.md
/Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/06_PROJECT_MAP.md
/Users/antonypry/Documents/padel-park-qr-scanner/codex-vault/07_DOMAIN_INVENTORY.md
```

Затем проверяет `git status --short --branch`, текущую ветку,
`docs/SPRINT_STATUS.md` и релевантный domain-файл vault. Для телефонии,
транскрибации и ASR дополнительно читает `docs/TRANSCRIBER_SERVER.md` и
`codex-vault/epics/telephony-transcription.md`.

## Декомпозиция

Тимлид передает диспетчеру эпик с целью, product boundaries и зависимостями.
Диспетчер создает Feature-чаты не под отдельные файлы или кнопки, а под
законченные capabilities.

Хороший Feature scope содержит:

- пользовательский или технический результат;
- `in scope` и `out of scope`;
- affected contracts и shared-foundation boundaries;
- acceptance criteria;
- risk class;
- worktree/branch;
- expected handoff и onboarding impact.

У одного диспетчера обычно не больше трех активных Feature-чатов. Два изменения
одного auth/schema/tenant/money foundation не выполняются параллельно без
явного integration plan.

## Feature-цикл

1. Feature-чат делает discovery существующих models/services/routes/pages,
   permissions и generated contracts.
2. Реализует только свой scope в отдельной ветке/worktree.
3. Пишет или обновляет regression tests для измененного поведения.
4. Запускает минимальные developer checks, нужные для разработки.
5. Для user-facing изменения запускает живой проект и проводит User Preview.
6. После пользовательского `ок` делает обычный commit/non-force push в свою
   feature-ветку.
7. Возвращает диспетчеру exact SHA, concise handoff, риски и onboarding impact.
8. Диспетчер передает candidate своему закрепленному QA.
9. При findings диспетчер возвращает точный fix prompt в тот же Feature-чат.
10. После green QA диспетчер интегрирует accepted exact SHA в ветку эпика.

Feature-чат не создает QA-чат, не пушит в integration/main и не выполняет deploy.

## User Preview

User Preview не передается между чатами.

1. Исходный Feature-чат запускает backend/frontend своего worktree.
2. Дает пользователю URL, роль/demo account и короткий manual checklist.
3. Пользователь открывает интерфейс и пишет замечания прямо в Feature-чат.
4. Feature-чат исправляет их и сохраняет тот же живой preview.
5. Candidate уходит диспетчеру и QA только после явного пользовательского `ок`.

Для navigation, sidebar, routes, tabs, крупных layout/redesign и mobile UX сначала
проводится ранний `structure preview`. Backend-only, test-only и явно одобренный
узкий polish повторного User Preview не требуют.

Screenshots не создаются и не прикладываются по умолчанию. Их отсутствие не
является blocker или finding. Screenshots допустимы по прямому запросу либо для
внутреннего сравнения/диагностики; внутренние изображения не нужно выгружать в
handoff без пользы. Реальные screenshots, являющиеся контентом onboarding-урока,
регулируются отдельно.

Минимальный preview handoff:

```md
Как проверить:
- frontend URL:
- backend URL:
- роль/demo account:
- что открыть:
- что прокликать:
- известные ограничения:
```

## Ответственность за проверки

Feature-чат пишет regression tests, но QA владеет независимой проверкой. Это не
означает, что Feature-чат передает заведомо неработающий код: он выполняет только
минимальные developer checks, необходимые для разработки и preview.

| Этап | Проверки |
|---|---|
| Feature implementation | Syntax/changed-file check, нужный unit/regression test, локальный smoke |
| Feature QA | Independent risk-based acceptance: diff, regression, API/DB/browser/security matrix по риску |
| Fix/re-QA | Исходный reproducer, новый regression и affected neighbors |
| Epic integration | SHA, ancestry, scope, conflicts; affected checks только при runtime reconciliation |
| Release integration | Cross-epic contracts, artifact/build/migration readiness; accepted matrices не повторяются |
| Production | Backup/guards, health и короткий smoke измененных критичных сценариев |

Запрещено последовательно запускать одинаковый широкий набор в Feature-чате, QA,
диспетчере, тимлиде и onboarding. Green evidence привязано к exact SHA и
переиспользуется. Новый commit инвалидирует только затронутый scope.

Автоматический CI может выполнить общий suite один раз на итоговом release
candidate. Ручной полный regression нужен только при конкретном сигнале:

- reconciliation изменила runtime-код;
- несколько эпиков меняют shared foundation;
- затронуты schema, auth, tenant authority, money или public API contracts;
- QA не может локализовать системный finding;
- выпускается самостоятельная high-risk фича.

OpenAPI/generated regeneration запускается только при изменении API contract,
route manifest, tenant scope или generated consumer. Full lint/build/typecheck не
повторяется после каждого CSS/copy/test-only fix: достаточно affected checks, а
нужный итоговый build выполняется владельцем candidate один раз.

DB-backed полный server suite запускается с `--test-concurrency=1`. CI обязан
поднять test MySQL и применить migrations до server tests.

## QA

Три постоянных QA закреплены за тремя диспетчерами. QA получает короткий handoff:

```md
QA handoff:
- dispatcher callback:
- branch / exact SHA / base:
- scope and acceptance criteria:
- risk class:
- changed contracts:
- developer checks already green:
- unresolved leads:
- User Preview status:
- Onboarding impact:
```

QA сначала читает diff и evidence, затем выбирает непокрытые проверки. Он не
начинает с реализации, не проводит User Preview за Feature-чат и не запускает
полный gate автоматически.

Вердикт:

- `blocked`;
- `needs fixes` с точным reproducer/fix boundary;
- `accepted` с exact SHA и covered risks.

QA возвращает verdict своему диспетчеру. Routine callbacks не идут в штаб.

## Epic integration

После green QA диспетчер:

- подтверждает local/tracking/fresh-remote SHA parity;
- выполняет обычный non-force promotion exact SHA в integration branch эпика;
- проверяет scope, ancestry и migration order;
- при code reconciliation запускает только affected checks;
- хранит onboarding impacts и остаточные риски;
- после завершения всех capabilities передает тимлиду один epic candidate.

Диспетчер не повторяет Feature QA и не принимает решение о `main`/production.

## Release integration

Тимлид принимает только accepted epic candidates и владеет общей интеграцией:

- сверяет межэпиковые contracts и migration order;
- разрешает механические конфликты без изменения принятого поведения;
- при runtime reconciliation назначает affected checks правильному QA;
- создает точный release candidate и immutable evidence;
- принимает решение о публикации в `main`, production rollout и rollback;
- обращается в штаб только за неоднозначным продуктовым решением.

Release gate не является повторным feature QA. Он подтверждает только свойства,
которые появляются после объединения: совместимость эпиков, build artifact,
migration chain, конфигурацию, rollback и production readiness.

Production checklist находится в [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md).

## Onboarding

Feature-чат всегда возвращает:

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

`none` с объяснением закрывается диспетчером без отдельного onboarding-чата.
Реальные impacts накапливаются и передаются instructions/onboarding service одной
пачкой после стабилизации epic/release candidate.

Targeted onboarding tests запускаются при изменении onboarding-кода. Strict audit,
полная сверка каталога и screenshot assets выполняются один раз на итоговом
candidate. Общие правила находятся в
[`ONBOARDING_RELEASE_WORKFLOW.md`](./ONBOARDING_RELEASE_WORKFLOW.md).

## Git и worktree

Feature-чат в своей именованной `codex/...` ветке заранее может:

- выполнять `git add` и обычные commits по scope;
- делать non-force push в ту же feature-ветку;
- добавлять fix-коммиты без переписывания reviewed history;
- подтверждать clean worktree и exact remote parity.

Feature-чат не может пушить в чужую/integration/release/main ветку, делать
force-push, rebase/squash reviewed history, promotion или deploy.

Диспетчер может продвигать accepted SHA только в integration branch своего эпика.
Тимлид владеет release branch, `main`, production и rollback.

После merge/release диспетчер очищает feature worktree: либо синхронизирует его с
актуальным `origin/main`, либо удаляет/prune, если он больше не нужен. Новая фича
не стартует поверх грязного или устаревшего worktree.

## Штаб

Штаб не получает routine handoff и не разрешает технически готовый release. Он
используется для:

- обсуждения стратегии и приоритетов продукта;
- выбора между несколькими продуктовыми/архитектурными вариантами;
- решения о ролях, permissions, data ownership и visible behavior;
- обсуждения необратимых продуктовых последствий.

Когда решение принято, выполнение возвращается тимлиду и соответствующему
диспетчерскому потоку.

## Первый запуск модели

- Поток 1 получает `Security Foundation v1`.
- Потоки 2 и 3 получают продуктовые эпики по приоритету тимлида.
- Инфраструктурную часть Security Foundation пользователь делает с
  DevOps-наставником; application contracts и evidence маршрутизируются через
  диспетчера потока 1.
- DevOps-наставник не является четвертым диспетчером или QA.
