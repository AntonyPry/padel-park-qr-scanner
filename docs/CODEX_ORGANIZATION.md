# Организация работы Codex

Этот документ закрепляет активную производственную модель Setly. Он является
источником правды для ролей чатов, маршрутизации эпиков, User Preview и
распределения проверок. Подробный технический цикл описан в
[`CODEX_WORKFLOW.md`](./CODEX_WORKFLOW.md).

## Структура

В проекте одновременно работают:

- один стратегический штаб;
- один постоянный тимлид интеграции;
- три постоянных универсальных диспетчера;
- три постоянных QA, по одному на каждого диспетчера;
- временные Feature-чаты, создаваемые диспетчерами под законченные capabilities;
- отдельный instructions/onboarding service, который подключается пакетно только
  при фактическом onboarding impact.

Диспетчеры и QA не закрепляются за доменами. Это три производственных потока.
Тимлид назначает потоку эпик с учетом свободной емкости и зависимостей. После
завершения эпика тот же поток может получить работу из совершенно другого домена.

```text
                         Штаб
                           |
                    Тимлид интеграции
              +------------+------------+
              |            |            |
        Диспетчер 1   Диспетчер 2   Диспетчер 3
          |      |      |      |      |      |
       Feature  QA 1 Feature  QA 2 Feature  QA 3
        чаты            чаты            чаты
```

## Штаб

Штаб нужен для свободного обсуждения стратегии, продукта и архитектурных идей.
В штаб возвращаются только вопросы, которые требуют смыслового решения владельца
продукта:

- выбор продуктового поведения или архитектурного направления;
- изменение scope, ролей, permissions, data ownership или visible UX;
- необратимая продуктовая data policy;
- конфликт продуктовых смыслов между эпиками.

Routine handoff, QA findings с однозначным исправлением, публикация веток,
release decisions и production rollout не маршрутизируются через штаб.

## Тимлид

Тимлид владеет общей картиной разработки:

- превращает стратегию в эпики и назначает их трем диспетчерам;
- при назначении переименовывает постоянную пару в `Диспетчер N — <Короткое имя эпика>` / `QA N — <Короткое имя эпика>`, а после финального epic handoff возвращает базовые `Диспетчер N` / `QA N`;
- ограничивает параллельность там, где эпики меняют общий foundation;
- фиксирует межэпиковые contracts и зависимости;
- принимает от диспетчеров только готовые epic candidates;
- собирает общий release candidate без повторной реализации или feature QA;
- разрешает механические конфликты, сохраняя оба принятых контракта;
- возвращается в штаб только при неоднозначном продуктовом выборе;
- принимает решение о публикации в `main`, production rollout и rollback;
- готовит и выполняет consolidated release plan без формального разрешения штаба.

Тимлид не управляет отдельными Feature-чатами и не повторяет работу QA. Он
получает согласованный epic contract, редкие критичные escalation, при длительной
работе компактный epic-level status и один финальный epic candidate. Старт и
завершение каждой обычной фичи, feature SHA, targeted tests, polish, routine QA
findings, fix/re-QA и промежуточные handoff/logs тимлиду не передаются.
Epic operational updates тимлид передаёт только назначенному Dispatcher, не его
Feature/QA напрямую.

## Диспетчеры

Каждый диспетчер владеет своим текущим эпиком и закрепленным производственным
потоком:

- декомпозирует эпик на законченные feature scopes;
- решает, какие Feature-чаты можно запустить параллельно;
- сразу именует новую временную задачу `Feature {Короткое имя эпика} {последовательный номер} - {краткое описание}`;
- выдает каждому Feature-чату branch/worktree, acceptance criteria и boundaries;
- хранит dependency graph, exact SHA и onboarding impact;
- после User Preview маршрутизирует candidate своему закрепленному QA;
- возвращает QA findings исходному Feature-чату;
- после green QA собирает epic candidate в своей integration branch;
- не повторяет тесты Feature-чата или QA без нового сигнала риска;
- передает тимлиду один concise epic handoff.

Одновременно у одного диспетчера обычно не больше трех активных Feature-чатов.
Изменения одного shared foundation выполняются последовательно.

Критичная escalation к тимлиду нужна только при межэпиковом конфликте, изменении
согласованного общего API/schema/authority/security contract, product/scope
ambiguity, блокирующей зависимости от другого потока или инфраструктуры, P0/P1 с
широким blast radius либо необходимости изменить release/rollback policy.

Постоянные пары имеют имя `Диспетчер N — <Короткое имя эпика>` / `QA N —
<Короткое имя эпика>` только пока эпик назначен. Неназначенный поток называется
просто `Диспетчер N` / `QA N`, без суффикса и статусного слова. Номер не меняется.
Feature numbering начинается с 1 и ведётся Dispatcher последовательно внутри
эпика. Номер не переиспользуется и не меняется после создания; fix/re-QA/User
Preview остаются в той же задаче, а новая независимая capability получает
следующий номер. Номер потока/Dispatcher в title не добавляется, описание остаётся
коротким и различимым в sidebar. Существующие задачи ретроактивно не
переименовываются.

## Operational source and queue

Канонические технические источники доступны всем ролям: `AGENTS.md`, process
docs, relevant vault/domain/epic files и exact code/diff/SHA. Feature и QA читают
их самостоятельно; Dispatcher не является единственным носителем технических
правил.

Единый operational source of truth по назначенному эпику получает только его
Dispatcher: current epic brief, priority/scope, acceptance boundaries,
dependencies, Team Lead decisions, queue/status changes и cross-epic constraints.
Dispatcher сам синхронизирует свои Feature/QA и ведёт pending queue.

Перед handoff/follow-up Dispatcher проверяет target task:

- `idle/completed`: перечитать последний результат, удалить stale пункты и
  отправить один цельный handoff;
- `active`: не перебивать routine update, сохранить pending update и дождаться
  idle/completion.

Одна Feature-задача выполняет одну capability/fix-итерацию. Permanent QA
проверяет один exact candidate за раз; следующий candidate ждёт в очереди.
Candidate передаётся QA только после завершённой Feature, применимого User Preview
и готового exact-SHA handoff. Параллельные Feature-задачи допустимы только для
действительно независимых capabilities.

Active task прерывается только при wrong repo/worktree/branch, data/secret loss or
leak risk, unauthorized production mutation, destructive migration/force push,
blocking P0/P1 либо явном stop/task-change пользователя. Routine polish, новая
идея, status question, очередной handoff или некритичная dependency ждут очереди.

## Waiting for user marker

Задача, которая реально не может продолжить без конкретного ответа или действия
пользователя, добавляет к своему текущему динамическому названию один ведущий
`!!!`. Для новой Feature, например: `!!!Feature Security 2 - Argon2id и миграция
старых хешей`. Квадратные скобки не используются, второй marker не добавляется.

Marker применяется для User Preview acceptance/правок, product choice,
credentials/access/manual user action, explicit production/security decision или
ambiguity без безопасного внутреннего решения. Он не применяется для
idle/unassigned, ожидания другой роли, выполняемой команды/долгого теста,
безопасно продолжаемой работы или status update без вопроса.

После ответа задача сама удаляет только ведущий `!!!`, восстанавливает актуальное
role/epic/capability name и продолжает работу. Dispatcher видит marker дочерней
задачи, но не дублирует её вопрос и не снимает marker за неё. Feature продолжает
вести User Preview непосредственно с пользователем.

## Feature-чаты

Feature-чат реализует одну capability end to end и общается с пользователем
напрямую по видимому результату.

Feature-чат обязан:

- выполнить discovery существующей функциональности до реализации;
- работать только в своей именованной ветке/worktree;
- написать или обновить regression tests для измененного поведения;
- выполнять минимальные developer checks, необходимые для уверенной разработки;
- для UI запустить живые frontend/backend URL и провести User Preview;
- принимать визуальные замечания пользователя в том же чате и исправлять их там;
- после пользовательского `ок` сделать commit/push и вернуть exact SHA, краткий
  handoff, риски и onboarding impact диспетчеру.

Feature-чат не проводит independent QA и не запускает широкий проектный gate.
Минимальные developer checks не считаются QA verdict. Это могут быть syntax
check, changed-file lint, один затронутый unit/regression test или локальный smoke,
который нужен для разработки и User Preview. Feature-чат не обязан повторять
DB/browser/security matrices, полный suite, полный lint/build/typecheck и
release audits, если они не нужны для получения рабочего результата.

## User Preview

User Preview всегда остается внутри исходного Feature-чата:

1. Feature-чат доводит UI или пользовательский workflow до целостного состояния.
2. Он запускает backend/frontend и дает пользователю живые URL, роль/demo account
   и короткий manual checklist.
3. Пользователь открывает интерфейс и отправляет замечания прямо в Feature-чат.
4. Feature-чат исправляет замечания и обновляет тот же preview.
5. Только после явного пользовательского `ок` candidate передается диспетчеру и QA.

QA, диспетчер и тимлид не пересказывают пользователю интерфейс и не переносят
визуальные замечания между чатами. Screenshots не создаются по умолчанию и их
отсутствие не является finding. Они нужны только по прямому запросу пользователя
или для внутренней разработки/диагностики. Product screenshot assets для уроков
onboarding регулируются отдельно.

Backend-only, test-only и пользовательски одобренный узкий polish не требуют
повторного User Preview. Существенное изменение видимого сценария требует.

## QA

QA закреплен за диспетчером, а не за доменом. Он сохраняет контекст потока и
проверяет exact SHA после User Preview.

QA владеет test plan и independent verdict:

- читает diff, acceptance criteria, developer evidence и risk class;
- выбирает только проверки, которые подтверждают измененное поведение и главные
  риски;
- запускает targeted regression, API/DB/browser/security matrices по необходимости;
- проверяет соседние контракты только там, где есть реальный blast radius;
- возвращает findings по severity или exact accepted SHA;
- при fix-коммите проверяет исходный reproducer и затронутый scope;
- не реализует новые фичи и не делает пользовательский preview.

QA может переиспользовать green evidence Feature-чата на том же SHA. Он повторяет
команду только когда нужна независимость результата, другой environment или есть
сомнение в покрытии. Полный gate после каждого fix-коммита запрещен без расширения
риска.

## Проверки

Одна и та же дорогая проверка не запускается последовательно Feature-чатом, QA,
диспетчером, тимлидом и onboarding.

| Этап | Владелец | Что запускается |
|---|---|---|
| Реализация | Feature-чат | Минимальные developer checks и локальный smoke |
| User Preview | Feature-чат + пользователь | Только живой измененный сценарий |
| Feature QA | Закрепленный QA | Independent risk-based acceptance на exact SHA |
| Epic integration | Диспетчер | SHA/ancestry/conflicts и affected checks только при reconciliation |
| Release integration | Тимлид + затронутые QA | Cross-epic risks, artifact/build/migrations readiness; accepted feature matrices не повторяются |
| Production | Тимлид | Backup, rollout guards, health и короткий production smoke |

Автоматический CI может выполнить общий suite на release candidate один раз. Это
не причина вручную повторять те же команды в каждом чате. Новый commit
инвалидирует только evidence затронутых областей.

Полный общий regression запускается только когда:

- несколько эпиков сошлись в shared foundation;
- изменились schema, auth, tenant authority, money или public API contracts;
- reconciliation реально изменила runtime-код;
- QA обнаружил системный сигнал, который нельзя локализовать;
- release является самостоятельным high-risk изменением.

## Onboarding

Feature-чаты возвращают конкретный `Onboarding impact`, но не обновляют обучение
в своей ветке. Диспетчер накапливает impacts эпика. Instructions/onboarding service
подключается одной пачкой после стабилизации epic/release candidate и только если
изменились видимый workflow, роли, routes, actions, checkpoint events, training
data или инструкции.

`Onboarding impact: none` не требует отдельного чата. Strict onboarding audit и
полная проверка каталога запускаются один раз на итоговом candidate, а не после
каждой фичи.

## Ветки

- Feature-чат публикует только свою `codex/...` feature-ветку обычным non-force push.
- Диспетчер интегрирует только accepted exact SHA в ветку своего эпика.
- Тимлид интегрирует accepted epic candidates в release candidate.
- `main`, production, deploy и rollback находятся в зоне ответственности тимлида.
- Штаб подключается только когда release требует нового продуктового решения, а не
  для формального разрешения технически готового rollout.
- Force-push и переписывание уже reviewed history запрещены.

## Активные потоки

Первое назначение новой модели:

- поток 1: `Security Foundation v1`;
- потоки 2 и 3: продуктовые эпики или компактные improvement chains по приоритету
  тимлида;
- инфраструктурные задачи Security Foundation выполняются пользователем с
  DevOps-наставником, а их application contracts и evidence входят в поток 1;
- DevOps-наставник не образует четвертого диспетчера или четвертый QA.
