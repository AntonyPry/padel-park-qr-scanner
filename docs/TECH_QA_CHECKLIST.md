# Технический QA-чеклист

Этот чеклист запускаем после изменений, которые затрагивают архитектуру, API, роли, формы, таблицы, кеш, права или производительность.

## Обязательный минимум

- `client`: `npm run lint`
- `client`: `npm run test`
- `client`: `npm run build`
- `server`: `npm run test`
- `server`: `npm run typecheck`
- `server`: `npm run openapi`
- `git diff --check`

## Когда подняты backend и preview

- `server`: `npm run smoke:api`
- `server`: `npm run health`
- `client`: `npm run smoke:ui`

Переменные для smoke-проверок:

- `API_SMOKE_URL`, по умолчанию `http://127.0.0.1:3004/api`
- `API_SMOKE_EMAIL`, по умолчанию `owner@padelpark.demo`
- `API_SMOKE_PASSWORD`, по умолчанию `Demo1234!`
- `UI_SMOKE_BASE_URL`, по умолчанию `http://127.0.0.1:4173`
- `UI_SMOKE_API_URL`, по умолчанию `http://127.0.0.1:3004/api`
- `UI_SMOKE_OUTPUT`, по умолчанию `outputs/qa/<date>/ui-smoke`

После `npm run smoke:ui` обязательно сохранить и открыть:

- `outputs/qa/<date>/ui-smoke/report.json`;
- PNG-скриншоты всех проверенных разделов.

## Что смотреть руками по скриншотам

- нет перекрытия текста и кнопок;
- таблицы не распирают экран;
- сайдбар не закрывает полезный контент;
- модалки читаемые и не обрезают поля;
- на dashboard-метриках есть понятные tooltip-ы;
- console `warn/error` пустой или предупреждение явно принято как безопасное.

## Роли и безопасность

- trainer не видит телефоны и внешние ID клиентов;
- viewer не может менять данные;
- accountant не управляет операционкой;
- manager видит финансы, но не делает действия, которые разрешены только owner/accountant;
- owner сохраняет полный доступ.

## Производительность

- после крупных изменений запускать `node scripts/performance-benchmark.js --label=<name>`;
- сравнивать p95 с последним стабильным отчетом;
- новые read-only endpoint не должны запускать тяжелые синхронизации или массовые пересчеты.

## Контракты и релиз

- `docs/openapi.json` должен обновляться через `server npm run openapi`;
- `client/src/api/generated.ts` не редактируется руками;
- перед продакшен-релизом пройти `docs/RELEASE_CHECKLIST.md`;
- перед релизом с миграциями пройти `docs/BACKUP_CHECKLIST.md`.
