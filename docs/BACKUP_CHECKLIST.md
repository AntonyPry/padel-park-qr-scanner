# Backup checklist

## Complete Setly backup

- Put API mutations, provider ingress and background workers into maintenance mode for the capture window. A database dump and file snapshot taken at unrelated times are not a consistent backup.
- Create a database dump **and a consistent copy of uploads** before every production deploy. A DB-only backup is incomplete.
- Include legacy `server/var/shift-report-attachments`, legacy `server/var/shift-cash-attachments` and tenant `SETLY_STORAGE_ROOT` (default `server/var/tenant-storage`).
- Run `server npm run tenant:files-workers:attachments` and retain its shift-report dry-run manifest with the backup. Inventory/checksum the legacy Shift Cash root separately; its automatic copy/backfill is not implemented.
- Use filenames with environment and timestamp, for example `setly-prod-YYYY-MM-DD-HHMM.sql.gz` and `setly-prod-YYYY-MM-DD-HHMM-uploads.tar`.
- Store the dump outside the application server.
- Keep at least one recent local restore-tested copy.
- Export only non-secret `IntegrationConnection` identity metadata (`organizationId`, `clubId`, provider, purpose, connection key and status). Encrypted credentials and provider payloads stay inside the encrypted database dump and must never be copied into a plaintext manifest.
- Local transcription-worker state is not authoritative backup data. After restore it is rebuilt from database jobs; stale local claims must not be replayed.

Example command:

```bash
mysqldump --single-transaction --routines --triggers --default-character-set=utf8mb4 "$DB_NAME" | gzip > "setly-prod-$(date +%F-%H%M).sql.gz"
```

The uploads manifest must contain schema/version, `generatedAt`, storage root, and relative opaque storage object keys with file counts/bytes/checksums grouped by tenant and domain. It must not copy user-supplied original filename metadata, credentials, phones, recording URLs or transcript/audio content.

The installation manifest has five mandatory, unique artifact labels: `database`, `tenant-storage`, `legacy-shift-reports`, `legacy-shift-cash` and `attachment-orphan-detector`. Empty inventories, unknown or duplicate labels, missing roots, symlinks and special files are refused. Restore overrides must map one-to-one to these labels; they cannot substitute a different artifact class.

Create and verify the installation-wide manifest after the dump and storage snapshot are complete:

```bash
npm run tenant:files-workers:attachments -- --output=/secure/backup/attachments.json
npm run tenant:backup:manifest -- \
  --output=/secure/backup/setly-manifest.json \
  --db-dump=/secure/backup/setly.sql.gz \
  --storage-root=/secure/backup/tenant-storage \
  --legacy-shift-report-root=/secure/backup/shift-report-attachments \
  --legacy-shift-cash-root=/secure/backup/shift-cash-attachments \
  --attachment-manifest=/secure/backup/attachments.json
npm run tenant:backup:manifest -- --verify --manifest=/secure/backup/setly-manifest.json
```

For an empty-environment restore rehearsal, point verification at the restored artifacts instead of the capture roots:

```bash
npm run tenant:backup:manifest -- \
  --verify \
  --manifest=/secure/backup/setly-manifest.json \
  --db-dump=/restore/setly.sql.gz \
  --storage-root=/restore/tenant-storage \
  --legacy-shift-report-root=/restore/shift-report-attachments \
  --legacy-shift-cash-root=/restore/shift-cash-attachments \
  --attachment-manifest=/restore/attachments.json
```

The verifier fails on missing files, checksum/size mismatches and files that were added after manifest creation. It parses the retained attachment detector rather than trusting only that file's checksum: `checksumMismatch`, `invalidMetadata`, `missingLegacy`, `missingStorage`, orphan counts and orphan lists must all be empty/zero at both capture and restore verification. The retained attachment audit is the DB-to-file orphan detector for shift reports; Shift Cash remains a separately inventoried legacy root until its DB-to-file detector is implemented.

## Restore verification

- Restore the dump into a separate test database.
- Start backend against the restored DB.
- Restore both legacy roots and the tenant storage root before enabling traffic.
- Verify DB attachment metadata against physical SHA-256 checksums; investigate every missing file, mismatch and orphan.
- Run `/api/health`.
- Run API smoke on the restored environment.
- Open clients, bases, call tasks, finances and motivation in UI smoke or manually.
- Verify legacy default-tenant shift-report and shift-cash attachments plus new tenant-storage attachments can be downloaded through their authorized CRM routes.
- Verify the manifest before boot, then run migrations, `tenant:foundation:assert`, provider reconciliation/audit, onboarding write audit and attachment orphan detection on the restored installation.
- Confirm worker jobs are recoverable from database state and clear any local worker cache/state before workers are enabled.
- Record the restored database row counts, tenant storage counts/checksums, non-secret connection identity count and smoke result in the rehearsal evidence.

Selective tenant restore is unsupported until Setly has a formal complete PK/FK/provider-id/file-key remap contract. Restore is installation-wide and must target an empty environment. Local disk remains a known availability limitation; object storage/S3 is a separate architecture decision.

## Retention

- Daily backups: keep at least 14 days.
- Weekly backups: keep at least 8 weeks.
- Monthly backups: keep at least 12 months.
- Before deleting old dumps, verify the newest restore-tested backup is available.
