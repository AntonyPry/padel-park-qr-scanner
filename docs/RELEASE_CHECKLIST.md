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
- For training methodology releases, verify onboarding covers methodology base, client skill map, structured training notes, skill-map update algorithm, personal recommendations, group recommendations, planned and completed training plans, booking links and senior trainer analytics.
- For prepayments releases, verify onboarding covers Evotor sale settings, pending sale binding, subscriptions, subscription redemption, certificates, certificate redemption, corporate deposits, corporate spendings, corporate export and the unified prepayments screen.
- For prepayments training safety, verify corporate clients and ledger entries are training-cleanup safe, linked corporate finance records stay training-marked, and subscriptions/certificates/pending sales are either training-safe or kept out of action training tasks.
- Verify trainer-facing instructions and screens do not expose phones, external IDs, CRM sales notes, call history or full client-base management context.
- Create and verify a database backup before switching traffic.

## After deploy

- Check `/api/health`; expected `status: "ok"` and `services.database: "ok"`.
- `server`: `API_SMOKE_URL=<prod-api-url>/api npm run smoke:api`
- Run UI smoke against the deployed frontend and API.
- Save smoke screenshots and `report.json` from `outputs/qa/<date>/ui-smoke`.
- Verify login, client creation, duplicate restore, bases, call tasks, payroll, motivation, catalog, references and access monitor.
- Verify methodology, methodology analytics, trainer cabinet, client skill map, training recommendations, training plan lifecycle and training booking plan link.
- Verify prepayments dashboard, catalog sale settings, pending sale binding, client subscriptions, certificate search/redemption and corporate client ledger/export.
- Verify onboarding opens for the changed roles and owner role override can view the affected role path.

## Rollback

- Keep the previous release artifact available until smoke checks pass.
- If DB migrations are not backward-compatible, prepare an explicit rollback migration before deploy.
- If health check is degraded or smoke fails on critical flows, return the previous app version and restore DB from the pre-release backup only when data shape requires it.
