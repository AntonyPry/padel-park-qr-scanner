# Backup checklist

## Complete Setly backup

- Create a database dump **and a consistent copy of uploads** before every production deploy. A DB-only backup is incomplete.
- Include both legacy `server/var/shift-report-attachments` and tenant `SETLY_STORAGE_ROOT` (default `server/var/tenant-storage`).
- Run `server npm run tenant:files-workers:attachments` and retain its dry-run manifest with the backup.
- Use filenames with environment and timestamp, for example `setly-prod-YYYY-MM-DD-HHMM.sql.gz` and `setly-prod-YYYY-MM-DD-HHMM-uploads.tar`.
- Store the dump outside the application server.
- Keep at least one recent local restore-tested copy.

Example command:

```bash
mysqldump --single-transaction --routines --triggers --default-character-set=utf8mb4 "$DB_NAME" | gzip > "setly-prod-$(date +%F-%H%M).sql.gz"
```

The uploads manifest must contain schema/version, `generatedAt`, storage root, and file counts/bytes/checksums grouped by tenant and domain. It must not contain credentials, original filenames, phones, recording URLs or transcript/audio content.

## Restore verification

- Restore the dump into a separate test database.
- Start backend against the restored DB.
- Restore both storage roots before enabling traffic.
- Verify DB attachment metadata against physical SHA-256 checksums; investigate every missing file, mismatch and orphan.
- Run `/api/health`.
- Run API smoke on the restored environment.
- Open clients, bases, call tasks, finances and motivation in UI smoke or manually.
- Verify a legacy default-tenant shift attachment and a new tenant-storage attachment can be downloaded through the authorized CRM route.

Selective tenant restore is unsupported until Setly has a formal FK/identity remap contract. Restore is installation-wide. Local disk remains a known availability limitation; object storage/S3 is a separate architecture decision.

## Retention

- Daily backups: keep at least 14 days.
- Weekly backups: keep at least 8 weeks.
- Monthly backups: keep at least 12 months.
- Before deleting old dumps, verify the newest restore-tested backup is available.
