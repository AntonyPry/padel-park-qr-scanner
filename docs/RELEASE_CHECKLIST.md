# Release checklist

## Before deploy

- Pull latest `main` and verify there are no unexpected local changes.
- `server`: `npm ci`
- `client`: `npm ci`
- Apply database migrations for the target environment.
- `server`: `npm run typecheck`
- `server`: `npm run test`
- `server`: `npm run onboarding:audit:strict`
- `server`: `npm run tenant:files-workers:audit`
- `server`: `npm run tenant:files-workers:attachments` and review missing/mismatch/orphan counts before any apply
- `server`: `npm run openapi`
- `client`: `npm run lint`
- `client`: `npm run test`
- `client`: `npm run build`
- Check `Onboarding impact` for every user-facing feature in the release. Update onboarding catalog, checkpoint events, role paths, skills, badges and in-app instructions before deploy.
- If a feature creates or changes production data, verify its training-mode marker fields and report exclusions, or explicitly mark it as not training-safe yet.
- For training methodology releases, verify onboarding covers methodology base, client skill map, structured training notes, skill-map update algorithm, personal recommendations, group recommendations, planned and completed training plans, booking links and senior trainer analytics.
- For prepayments releases, verify onboarding covers Evotor sale settings, pending sale binding, subscriptions, subscription redemption, certificates, certificate redemption, corporate deposits, corporate spendings, corporate export and the unified prepayments screen.
- For prepayments training safety, verify corporate clients and ledger entries are training-cleanup safe, linked corporate finance records stay training-marked, and subscriptions/certificates/pending sales are either training-safe or kept out of action training tasks.
- For Manager Control releases, verify owner/manager onboarding covers `/admin/manager-control`, the daily control queue, filters, pending sales, overdue/missed calls, problem bookings, expiring subscriptions, expiring certificates and low corporate balances.
- For booking cleanup releases, verify onboarding covers schedule quick actions, payment/conflict/active-prepayment warnings, group participants and the client-card link from a booking.
- For Visits Analytics releases, verify onboarding covers the four tabs of `/admin/visits-analytics`: overview, source quality, cohorts/lifecycle and revenue/LTV; owner/manager segment-to-client-base-to-call-task handoff; accountant/viewer read-only filters and exports; canonical clients, mature windows, Europe/Moscow timezone, LTV coverage and no extra checkpoint events beyond `report.viewed`.
- Verify trainer-facing instructions and screens do not expose phones, external IDs, CRM sales notes, call history or full client-base management context.
- Create and verify a complete database + uploads + checksum manifest backup before switching traffic. A DB-only backup is incomplete.

## After deploy

- Check `/api/health`; expected `status: "ok"` and `services.database: "ok"`.
- `server`: `API_SMOKE_URL=<prod-api-url>/api npm run smoke:api`
- Run UI smoke against the deployed frontend and API.
- Save smoke screenshots and `report.json` from `outputs/qa/<date>/ui-smoke`.
- Verify login, client creation, duplicate restore, bases, call tasks, payroll, motivation, catalog, references and access monitor.
- Verify Manager Control Dashboard `/admin/manager-control` for owner/manager: daily queue loads, filters apply, links open the source screens and route-view onboarding checkpoint is recorded only with active task context.
- Verify booking cleanup in `/admin/bookings`: quick status/payment/cancel/edit actions, payment/conflict/active-prepayment warnings, group participants and client-card link.
- Verify Visits Analytics `/admin/visits-analytics` for owner/manager/accountant/viewer: four tabs load, source/cohort/lifecycle filters apply, exports work for read-only roles, owner/manager can create a client base from a segment and hand it off to the existing call-task flow, and onboarding checkpoint remains `report.viewed`.
- Verify methodology, methodology analytics, trainer cabinet, client skill map, training recommendations, training plan lifecycle and training booking plan link.
- Verify prepayments dashboard, catalog sale settings, pending sale binding, client subscriptions, certificate search/redemption and corporate client ledger/export.
- Verify onboarding opens for the changed roles and owner role override can view the affected role path.

## Rollback

- Keep the previous release artifact available until smoke checks pass.
- If DB migrations are not backward-compatible, prepare an explicit rollback migration before deploy.
- If health check is degraded or smoke fails on critical flows, return the previous app version and restore DB from the pre-release backup only when data shape requires it.
