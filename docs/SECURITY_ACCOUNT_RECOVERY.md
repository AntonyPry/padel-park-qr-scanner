# Account recovery v1

Account recovery is an operator/club-owner assisted password reset. It does not implement email, SMS, callback, approval, or notification delivery.

## Flow

1. An operator selects an active account in a specific club, optionally edits only its email/display name/phone, and creates a request.
2. The operator issues a one-time reset link. A new issuance revokes older active links for that account. The raw link is shown once and is never persisted or logged.
3. A club owner may create and issue a request only for an active employee in the owner’s selected club. The owner cannot recover themself, another owner, roles, memberships, or any account outside that club.
4. The user opens the link and supplies a new password. The token is hash-only, expires after 30 minutes, and is single-use.
5. Successful reset invalidates all normal active sessions for the account and disconnects realtime sockets. MFA is not reset or bypassed.

Request statuses (`created`, `issued`, `used`, `revoked`, `expired`) are displayed only inside the request card for the affected account.

## Data model

- `AccountRecoveryRequests`: organization/club/account scope, status, initiating actor.
- `AccountRecoveryTokens`: SHA-256 digest only, immutable identity, bounded expiry, issued actor, consumed/revoked timestamps.
- Token history cannot be deleted, identity cannot be changed, and consumption/revocation is irreversible. Migration rollback refuses non-empty history.

The internal security journal records actor, account, club, fixed action code, timestamp, and result; it never records a user-entered reason, token, password, or secret. No audit table is shown in the recovery UI.

## API boundaries

- Public: `POST /api/auth/recovery/status`, `POST /api/auth/recovery/reset`.
- Installation operator: scoped account list/detail/profile update, request creation, issue, and revoke under `/api/installation/provisioning/organizations/:organizationId/clubs/:clubId/recovery`.
- CRM owner: `POST /api/accounts/:id/recovery`, list for the account, issue, and revoke. The server derives the organization from the active tenant and validates the requested club and employee membership.

The service returns generic safe errors and never echoes secret values. Existing session, CSRF, origin, and MFA boundaries remain unchanged.

## Rollback and release

Keep the migration additive until all recovery history is intentionally expired or retained. Do not enable recovery routes without the migration and server/client contract generated from the same source. Production HTTPS, cookie, and deployment controls remain separate release prerequisites.
