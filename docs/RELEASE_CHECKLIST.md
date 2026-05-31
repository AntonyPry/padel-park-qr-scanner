# Release checklist

## Before deploy

- Pull latest `main` and verify there are no unexpected local changes.
- `server`: `npm ci`
- `client`: `npm ci`
- Apply database migrations for the target environment.
- `server`: `npm run typecheck`
- `server`: `npm run test`
- `server`: `npm run onboarding:audit:strict`
- `server`: `npm run openapi`
- `client`: `npm run lint`
- `client`: `npm run test`
- `client`: `npm run build`
- Check `Onboarding impact` for every user-facing feature in the release. Update onboarding catalog, checkpoint events, role paths, skills, badges and in-app instructions before deploy.
- If a feature creates or changes production data, verify its training-mode marker fields and report exclusions, or explicitly mark it as not training-safe yet.
- Create and verify a database backup before switching traffic.

## After deploy

- Check `/api/health`; expected `status: "ok"` and `services.database: "ok"`.
- `server`: `API_SMOKE_URL=<prod-api-url>/api npm run smoke:api`
- Run UI smoke against the deployed frontend and API.
- Save smoke screenshots and `report.json` from `outputs/qa/<date>/ui-smoke`.
- Verify login, client creation, duplicate restore, bases, call tasks, payroll, motivation, catalog, references and access monitor.
- Verify onboarding opens for the changed roles and owner role override can view the affected role path.

## Rollback

- Keep the previous release artifact available until smoke checks pass.
- If DB migrations are not backward-compatible, prepare an explicit rollback migration before deploy.
- If health check is degraded or smoke fails on critical flows, return the previous app version and restore DB from the pre-release backup only when data shape requires it.
