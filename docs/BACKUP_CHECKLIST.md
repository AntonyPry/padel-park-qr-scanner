# Backup checklist

## Database backup

- Create a dump before every production deploy.
- Use a filename with environment and timestamp: `padel-crm-prod-YYYY-MM-DD-HHMM.sql.gz`.
- Store the dump outside the application server.
- Keep at least one recent local restore-tested copy.

Example command:

```bash
mysqldump --single-transaction --routines --triggers --default-character-set=utf8mb4 "$DB_NAME" | gzip > "padel-crm-prod-$(date +%F-%H%M).sql.gz"
```

## Restore verification

- Restore the dump into a separate test database.
- Start backend against the restored DB.
- Run `/api/health`.
- Run API smoke on the restored environment.
- Open clients, bases, call tasks, finances and motivation in UI smoke or manually.

## Retention

- Daily backups: keep at least 14 days.
- Weekly backups: keep at least 8 weeks.
- Monthly backups: keep at least 12 months.
- Before deleting old dumps, verify the newest restore-tested backup is available.
