# Feature 10.3 — staged production rollout

Статус документа: implementation contract. Он не разрешает merge в `main`,
production deploy, включение production flags или создание второго production
tenant. Каждое такое действие остаётся отдельным release gate.

## Цель и обязательный инвариант

Текущий единственный живой клуб сохраняется целиком и становится default
`Organization → Club` внутри уже принятой multi-tenant схемы. Rollout считается
неуспешным, если хотя бы одна историческая business-таблица потеряла строку или
изменила множество primary keys, если tenant attribution неполна, либо если
installation-wide backup не восстановился в пустом rehearsal-окружении.

Feature 10.3 расширяет существующие контракты:

- additive tenant migrations и exact-singleton bridge;
- `tenant:integrity:detect` и final enforcement;
- installation-wide backup manifest и attachment detector;
- dependency chain server-owned tenant capabilities;
- installation operator/provisioning Feature 10.2.

Новой tenant-подсистемы, параллельного provisioning API или selective restore
здесь нет.

## Что добавлено

### Full-stop maintenance barrier

`SETLY_ROLLOUT_MAINTENANCE_MODE=full-stop`:

- возвращает `503 ROLLOUT_MAINTENANCE_ACTIVE` для всего `/api`, кроме
  `/api/health`, `/api/openapi.json` и CORS preflight;
- блокирует provider ingress и transcription-worker mutations тем же API gate;
- отклоняет новые Socket.IO handshakes;
- не запускает Telegram/VK bots и background runners после restart.

Любое другое непустое значение fail-closed блокирует startup как неверная
конфигурация. Для consistent capture старый production process всё равно нужно
остановить: env нового release не может остановить старый binary.

### Read-only rollout evidence

Команда `server npm run tenant:rollout:gate` выполняет только `SELECT`-проверки
БД и записывает новый evidence-файл с `wx` semantics — существующий артефакт не
перезаписывается.

Фазы:

1. `before-migrations` — проверяет exact release SHA, clean checkout, full-stop,
   `INSTALLATION_PROVISIONING_ENABLED=false`, все tenant flags
   explicit false, фиксирует exact row count, SHA-256 множества primary keys и
   SHA-256 значений всех существующих колонок каждой таблицы, а также checksums
   frozen DB/files capture.
2. `restore-rehearsal` — в отдельной пустой установке после restore+migrations
   подтверждает тот же набор business primary keys/counts, все migrations up,
   exact default singleton и zero strict tenant-integrity findings.
3. `post-migrations` — повторяет preservation/integrity на production и требует
   restore report, связанный с тем же baseline SHA-256.
4. `stage` — перед каждым открытием трафика проверяет exact допустимый prefix
   capabilities, migrations, singleton и strict integrity. Во всех фазах
   provisioning, bots и background runners должны быть явно выключены. Любой
   пропуск флага или преждевременно включённый later flag блокирует gate.

Каждый prior report проверяется по собственному evidence digest и обязан
принадлежать тому же exact release SHA; отредактированный или смешанный report
не принимается следующей фазой.

Evidence содержит имена таблиц/колонок, counts и необратимые SHA-256 digests,
но не raw primary keys, field values, credentials или attachment contents. Всё
равно хранить reports как protected release artifacts вместе с backup chain.

Control tables `Organizations`, `Clubs`, `Memberships`,
`MembershipClubAccesses`, `IntegrationConnections`,
`InstallationProvisioningOperations` и `SequelizeMeta`, отсутствовавшие или
пустые до migrations, могут быть созданы/заполнены rollout. Для непустой control
table все pre-existing rows должны остаться неизменными по старым колонкам, но
новые control rows разрешены (в частности, новые записи `SequelizeMeta`). Все
прежние business tables сравниваются по counts, PK и значениям всех колонок,
существовавших до migrations; новые tenant columns не подменяют это
доказательство.

## Capability order

Порядок фиксирован зависимостями runtime:

1. `TENANT_CONTEXT_ENABLED`
2. `TENANT_CACHE_REALTIME_ENABLED`
3. `TENANT_FILES_WORKERS_ENABLED`
4. `TENANT_PROVIDER_INTEGRATIONS_ENABLED`
5. `TENANT_STAFF_ACCESS_ENABLED`
6. `TENANT_CLIENTS_REFERENCES_ENABLED`
7. `TENANT_VISITS_SCANNER_ENABLED`
8. `TENANT_CLIENT_BASES_CALL_TASKS_ENABLED`
9. `TENANT_BOOKINGS_COURTS_ENABLED`
10. `TENANT_METHODOLOGY_SKILL_MAP_ENABLED`
11. `TENANT_TRAINING_NOTES_PLANS_ENABLED`
12. `TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED`
13. `TENANT_SHIFTS_REPORTS_ENABLED`
14. `TENANT_AUDIT_LOG_ENABLED`
15. `TENANT_ONBOARDING_ENABLED`
16. `TENANT_ENFORCEMENT_ENABLED`

`TENANT_ENFORCEMENT_ENABLED` — финальный внутренний capability, а не разрешение
на deploy/provisioning. Все 16 переменных должны быть заданы явно как `true` или
`false`; implicit defaults не принимаются production gate.

Рекомендуемые smoke checkpoints: `cache-realtime`, `provider-integrations`,
`bookings-courts`, `shifts-reports`, `enforcement`. Gate разрешает и более
мелкий шаг по одному capability.

## Operator runbook

Ниже — шаблон для отдельного production authorization. Значения секретов не
печатаются и берутся из защищённого server env. Реальный product host —
`setly.tech`, отдельный installation-operator host — `ops.setly.tech`.
Feature 10.3 только документирует следующие действия: DNS, Nginx, TLS и
production env здесь не изменяются.

### 0. DNS, operator host и TLS preflight

На 19 июля 2026 года authoritative NS — `ns1.firstvds.ru` и
`ns2.firstvds.ru`; `setly.tech` и `www.setly.tech` ведут на
`155.212.163.43`. Для `ops.setly.tech` уже создана явная FirstVDS запись `A
155.212.163.43` с TTL `3600`, её публичный ответ подтверждён через Google Public
DNS. Wildcard для остальных subdomain также остаётся активным. FirstVDS, а не
REG.RU, является активным редактором DNS-зоны. DNS work завершён: NS delegation
и DNS records в рамках этого rollout не менять.

Зафиксированный live baseline до production change:

- `http://ops.setly.tech` возвращает Nginx `200`, но ошибочно обслуживает
  обычный CRM default SPA;
- normal TLS verification для `https://ops.setly.tech` не проходит, потому что
  текущий certificate SAN не содержит `ops.setly.tech`.

Это два явных go-live blocker: разрешение DNS само по себе не означает
готовность operator host. До установки отдельного vhost и выпуска корректного
сертификата operator surface не считается production-ready.

Перед production change сохранить вывод:

```bash
dig +short NS setly.tech
dig +short A setly.tech
dig +short A www.setly.tech
dig +short A ops.setly.tech
dig +short AAAA ops.setly.tech
dig +short CNAME ops.setly.tech
```

Gate: NS и три A совпадают с указанными значениями, а для `ops` нет
конфликтующих AAAA/CNAME. Это повторная проверка уже завершённого DNS, а не шаг
создания записи. Не выполнять DNS-операции в REG.RU или FirstVDS.

На FirstVDS Ubuntu server отдельным production change установить dedicated
vhost из `deploy/nginx/ops.setly.tech.conf` и обновлённый product vhost. До
reload обязательно сохранить установленные конфиги для rollback:

```bash
sudo cp -a /etc/nginx/sites-available/setly.tech \
  /etc/nginx/sites-available/setly.tech.pre-ops
sudo nginx -T
sudoedit /etc/nginx/sites-available/setly.tech
sudo install -m 0644 deploy/nginx/ops.setly.tech.conf \
  /etc/nginx/sites-available/ops.setly.tech
sudo ln -sfn /etc/nginx/sites-available/ops.setly.tech \
  /etc/nginx/sites-enabled/ops.setly.tech
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d ops.setly.tech
sudo nginx -t
sudo systemctl reload nginx
```

После первого reload HTTP host больше не должен попадать в ordinary CRM default
server. Только затем выпускать/подключать сертификат с SAN `ops.setly.tech` и
переходить к host/session/API/security smoke ниже.

В существующий Certbot-managed `setly.tech` vhost через `sudoedit` перенести
только deny locations из `deploy/nginx/setly.tech.conf`. Не копировать HTTP
bootstrap-файл поверх установленного TLS-конфига.

Контракт vhost:

- `https://ops.setly.tech/` перенаправляет на `/installation`;
- разрешены только `/installation`, `/installation/provisioning`, статические
  frontend assets под `/assets/`, точные root files `/favicon.ico`,
  `/setly-mark.png`, `/favicon-32x32.png`, `/favicon-16x16.png`,
  `/apple-touch-icon.png`, `/api/health` и operator endpoints `status`,
  `session`, `snapshot`, `organizations`, `activation/reissue`;
- `/api/installation/provisioning/activation/status` и `activation/consume`
  не доступны через `ops`; `/activate-owner` остаётся на `setly.tech`;
- `setly.tech` не отдаёт `/installation` и operator API даже по direct URL;
- обычная CRM не получает operator navigation link и не обслуживается vhost
  `ops`; Socket.IO там тоже не проксируется;
- backend получает исходный `Host` и `X-Forwarded-Proto`; неожиданный Host на
  operator vhost получает connection close; Node слушает только
  `127.0.0.1:3000`, public firewall не открывает port `3000`;
- operator bearer token хранится в `sessionStorage` и поэтому scoped к origin
  `https://ops.setly.tech`; logout удаляет token, закрытие tab завершает его
  browser lifetime, server TTL остаётся 30 минут;
- operator API same-origin, поэтому `ops` не добавляется в `CLIENT_ORIGIN` и
  CORS allowlist без фактической необходимости; operator vhost скрывает
  backend CORS response headers.

Обязательный protected env:

```dotenv
HOST=127.0.0.1
PUBLIC_APP_URL=https://setly.tech
INSTALLATION_ACTIVATION_BASE_URL=https://setly.tech
```

После разрешённого deploy проверить, не печатая credentials/token:

```bash
curl -fsSIL https://ops.setly.tech/
curl -fsS https://ops.setly.tech/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://ops.setly.tech/installation
curl -sS -o /dev/null -w '%{http_code}\n' https://ops.setly.tech/activate-owner
curl -fsS -o /dev/null -w '%{http_code}\n' https://setly.tech/activate-owner
curl -sS -o /dev/null -w '%{http_code}\n' https://setly.tech/installation
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://setly.tech/api/installation/provisioning/status
curl -sS -D - -o /dev/null -H 'Origin: https://untrusted.invalid' \
  https://ops.setly.tech/api/installation/provisioning/status
curl --resolve ops.setly.tech:443:155.212.163.43 -fsSIL \
  https://ops.setly.tech/

umask 077
read -r -p 'Installation operator username: ' SETLY_OPERATOR_USERNAME
read -r -s -p 'Installation operator password: ' SETLY_OPERATOR_PASSWORD
SETLY_OPERATOR_SESSION_FILE="$(mktemp)"
trap 'rm -f "$SETLY_OPERATOR_SESSION_FILE"' EXIT HUP INT TERM
curl -fsS https://ops.setly.tech/api/installation/provisioning/session \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc \
    --arg username "$SETLY_OPERATOR_USERNAME" \
    --arg password "$SETLY_OPERATOR_PASSWORD" \
    '{username:$username,password:$password}')" \
  > "$SETLY_OPERATOR_SESSION_FILE"
SETLY_OPERATOR_TOKEN="$(jq -er '.token' "$SETLY_OPERATOR_SESSION_FILE")"
curl -fsS https://ops.setly.tech/api/installation/provisioning/snapshot \
  -H "Authorization: Bearer $SETLY_OPERATOR_TOKEN" \
  > /dev/null
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://ops.setly.tech/api/installation/provisioning/snapshot
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' --data '{}' \
  https://ops.setly.tech/api/installation/provisioning/organizations
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  https://ops.setly.tech/api/installation/provisioning/organizations/1/activation/reissue
rm -f "$SETLY_OPERATOR_SESSION_FILE"
unset SETLY_OPERATOR_PASSWORD SETLY_OPERATOR_TOKEN SETLY_OPERATOR_USERNAME
trap - EXIT HUP INT TERM

sudo certbot certificates
sudo certbot renew --dry-run
sudo journalctl -u nginx --since '15 minutes ago' --no-pager
pm2 list
: "${SETLY_PM2_APP:?Set SETLY_PM2_APP only after matching pm2 describe to the Setly cwd/script}"
pm2 describe "$SETLY_PM2_APP"
pm2 logs "$SETLY_PM2_APP" --lines 200 --nostream
sudo ss -ltnp 'sport = :3000'
```

Ожидания: operator root имеет HTTPS redirect/routing; installation login,
logout и refresh работают; защищённые snapshot/create/reissue без bearer token
дают `401`; чужой Origin не получает `Access-Control-Allow-Origin`;
direct `/installation` и operator API на product host, а также
`/activate-owner` на operator host дают `404`. Создание Organization в этой
проверке запрещено. Rollback vhost: вернуть сохранённый `setly.tech.pre-ops`,
отключить symlink `ops.setly.tech`, выполнить `nginx -t` и reload; DNS/NS и
certificate files не удалять в аварийном порядке.

`ss` обязан показать только loopback listener для Node. Дополнительно проверить
из внешней сети, что `155.212.163.43:3000` недоступен; не открывать этот port для
диагностики.

В browser DevTools после login подтвердить token только в
`sessionStorage` origin `ops.setly.tech`; после кнопки «Выйти» ключ
`setly_installation_operator_token` отсутствует, а refresh/direct
`/installation/provisioning` снова показывает login. Server-side revoke endpoint
не существует: stateless token после client logout живёт только до 30-minute TTL,
поэтому его нельзя сохранять в logs, shell history или долговременный файл.

### 1. Freeze и consistent raw capture

В protected env выставить full-stop, `BOTS_ENABLED=false`,
`BACKGROUND_RUNNERS_ENABLED=false`, `INSTALLATION_PROVISIONING_ENABLED=false`
и все 16 tenant flags в `false`. На live preflight 19 июля 2026 года имена
process были `bot` и `transcription-worker`, но runbook никогда не принимает эти
имена по умолчанию: сначала выполнить `pm2 list`, сопоставить cwd/script через
`pm2 describe`, затем явно экспортировать `SETLY_PM2_APP` и
`SETLY_TRANSCRIPTION_PM2_APP`. Затем:

```bash
cd /opt/padel-park-qr-scanner
export SETLY_RELEASE_SHA="$(git rev-parse HEAD)"
export SETLY_BACKUP_ROOT="/opt/backups/setly/$(date +%Y%m%d-%H%M%S)"

pm2 list
: "${SETLY_PM2_APP:?Set the verified Setly PM2 app name}"
: "${SETLY_TRANSCRIPTION_PM2_APP:?Set the verified transcription worker PM2 app name}"
pm2 describe "$SETLY_PM2_APP"
pm2 describe "$SETLY_TRANSCRIPTION_PM2_APP"
pm2 stop "$SETLY_TRANSCRIPTION_PM2_APP"
pm2 stop "$SETLY_PM2_APP"
sudo ss -ltnp 'sport = :3000'
install -d "$SETLY_BACKUP_ROOT/tenant-storage"
install -d "$SETLY_BACKUP_ROOT/legacy-shift-reports"
install -d "$SETLY_BACKUP_ROOT/legacy-shift-cash"

# Set this variable only after read-only DB/file detector evidence proves every
# named source root is legitimately empty or absent. It may contain only the
# three labels accepted by --expect-empty.
if [[ -z "${SETLY_EXPECT_EMPTY_LABELS+x}" ]]; then
  echo 'SETLY_EXPECT_EMPTY_LABELS must be explicitly set, even when empty' >&2
  exit 1
fi

setly_label_expected_empty() {
  case ",${SETLY_EXPECT_EMPTY_LABELS}," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

setly_freeze_root() {
  local source_root="$1" target_root="$2" label="$3"
  if [[ -L "$source_root" ]] || [[ -e "$source_root" && ! -d "$source_root" ]]; then
    echo "Unsafe source root: $source_root" >&2
    return 1
  fi
  if [[ -d "$source_root" ]] && find "$source_root" -mindepth 1 -print -quit | grep -q .; then
    cp -a "$source_root"/. "$target_root"/
  elif ! setly_label_expected_empty "$label"; then
    echo "Empty or missing source root lacks explicit --expect-empty proof: $label" >&2
    return 1
  fi
}

setly_freeze_root server/var/tenant-storage \
  "$SETLY_BACKUP_ROOT/tenant-storage" tenant-storage
setly_freeze_root server/var/shift-report-attachments \
  "$SETLY_BACKUP_ROOT/legacy-shift-reports" legacy-shift-reports
setly_freeze_root server/var/shift-cash-attachments \
  "$SETLY_BACKUP_ROOT/legacy-shift-cash" legacy-shift-cash
unset -f setly_freeze_root setly_label_expected_empty

cd server
set -a
. ./.env
set +a
set -o pipefail
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host=127.0.0.1 --user="$DB_USER" \
  --single-transaction --routines --triggers --events \
  --default-character-set=utf8mb4 "$DB_NAME" \
  | gzip > "$SETLY_BACKUP_ROOT/database.sql.gz"
test -s "$SETLY_BACKUP_ROOT/database.sql.gz"
gzip -t "$SETLY_BACKUP_ROOT/database.sql.gz"

SETLY_EMPTY_ARGS=()
if [[ -n "${SETLY_EXPECT_EMPTY_LABELS:-}" ]]; then
  SETLY_EMPTY_ARGS=(--expect-empty="$SETLY_EXPECT_EMPTY_LABELS")
fi

npm run tenant:rollout:gate -- \
  --phase=before-migrations \
  --expected-sha="$SETLY_RELEASE_SHA" \
  --db-dump="$SETLY_BACKUP_ROOT/database.sql.gz" \
  --storage-root="$SETLY_BACKUP_ROOT/tenant-storage" \
  --legacy-shift-report-root="$SETLY_BACKUP_ROOT/legacy-shift-reports" \
  --legacy-shift-cash-root="$SETLY_BACKUP_ROOT/legacy-shift-cash" \
  "${SETLY_EMPTY_ARGS[@]}" \
  --output="$SETLY_BACKUP_ROOT/rollout-before.json"
```

Если source root отсутствовал, сначала подтвердить по read-only DB/file detector,
что в нём действительно нет исторических файлов, затем явно добавить label в
`SETLY_EXPECT_EMPTY_LABELS`; создавать фиктивный source root не нужно. На live
preflight отсутствовали `tenant-storage` и `shift-report-attachments`, а
`shift-cash-attachments` был пуст, поэтому все три состояния требуют явного
expected-empty evidence перед freeze. Без `--expect-empty` пустой backup root
fail-closed; с флагом non-empty/missing backup root тоже fail-closed. Symlink и
special file запрещены. Не возобновлять production traffic до green restore и
post-migration evidence.

Перед dump отдельно остановить/drain внешний transcription worker в его
supervisor-контуре. Full-stop/остановленный API не примет его claim/complete
mutations, но worker не должен сохранить незавершённый local attempt и replay-ить
его после cutover. `pm2 describe` обязан подтвердить оба process через явно
заданные `SETLY_PM2_APP` и `SETLY_TRANSCRIPTION_PM2_APP`; не использовать
неразобранный numeric process id или предполагаемое имя.

### 2. Restore rehearsal — только empty installation

На изолированном host/DB восстановить dump в новую пустую БД и скопировать все
три frozen file roots. Установить тот же exact release SHA и full-stop/all-flags-off
env. Read-only copy `rollout-before.json` держать рядом с capture, а новый
rehearsal output — в отдельном каталоге. Затем выполнить migrations, provider
bootstrap и attachment dry-run.

```bash
export SETLY_RELEASE_SHA="$(git -C /opt/padel-park-qr-scanner rev-parse HEAD)"
export SETLY_CAPTURE_ROOT="/secure/read-only-setly-capture"
export SETLY_REHEARSAL_ROOT="/opt/setly-restore-rehearsal"
export SETLY_EXPECT_EMPTY_LABELS="$(jq -r \
  '[.backup.artifacts[] | select(.expectedEmpty == true) | .label] | join(",")' \
  "$SETLY_CAPTURE_ROOT/rollout-before.json")"
SETLY_EMPTY_ARGS=()
if [[ -n "$SETLY_EXPECT_EMPTY_LABELS" ]]; then
  SETLY_EMPTY_ARGS=(--expect-empty="$SETLY_EXPECT_EMPTY_LABELS")
fi
install -d -m 0700 "$SETLY_REHEARSAL_ROOT"

cd /opt/padel-park-qr-scanner/server
npx sequelize-cli db:migrate --env production
npm run tenant:providers:bootstrap
npm run tenant:files-workers:attachments -- \
  --output="$SETLY_REHEARSAL_ROOT/attachments.json"

npm run tenant:backup:manifest -- \
  --output="$SETLY_REHEARSAL_ROOT/manifest.json" \
  --db-dump="$SETLY_REHEARSAL_ROOT/database.sql.gz" \
  --storage-root="$SETLY_REHEARSAL_ROOT/tenant-storage" \
  --legacy-shift-report-root="$SETLY_REHEARSAL_ROOT/legacy-shift-reports" \
  --legacy-shift-cash-root="$SETLY_REHEARSAL_ROOT/legacy-shift-cash" \
  --attachment-manifest="$SETLY_REHEARSAL_ROOT/attachments.json" \
  "${SETLY_EMPTY_ARGS[@]}"

npm run tenant:backup:manifest -- \
  --verify --manifest="$SETLY_REHEARSAL_ROOT/manifest.json"

npm run tenant:rollout:gate -- \
  --phase=restore-rehearsal \
  --expected-sha="$SETLY_RELEASE_SHA" \
  --baseline="$SETLY_CAPTURE_ROOT/rollout-before.json" \
  --backup-manifest="$SETLY_REHEARSAL_ROOT/manifest.json" \
  --output="$SETLY_REHEARSAL_ROOT/rollout-restore.json"
```

Rehearsal target обязан быть пустым до restore. Selective tenant restore,
restore поверх существующей installation и replay локального worker state
запрещены.

### 3. Production migrations и singleton preservation

При остановленном production process:

```bash
export SETLY_RESTORE_REPORT="/secure/qa-evidence/rollout-restore.json"
export SETLY_EXPECT_EMPTY_LABELS="$(jq -r \
  '[.backup.artifacts[] | select(.expectedEmpty == true) | .label] | join(",")' \
  "$SETLY_BACKUP_ROOT/rollout-before.json")"
SETLY_EMPTY_ARGS=()
if [[ -n "$SETLY_EXPECT_EMPTY_LABELS" ]]; then
  SETLY_EMPTY_ARGS=(--expect-empty="$SETLY_EXPECT_EMPTY_LABELS")
fi

cd /opt/padel-park-qr-scanner/server
npx sequelize-cli db:migrate --env production
npm run tenant:providers:bootstrap
npm run tenant:files-workers:attachments -- \
  --output="$SETLY_BACKUP_ROOT/attachments.json"

npm run tenant:backup:manifest -- \
  --output="$SETLY_BACKUP_ROOT/manifest.json" \
  --db-dump="$SETLY_BACKUP_ROOT/database.sql.gz" \
  --storage-root="$SETLY_BACKUP_ROOT/tenant-storage" \
  --legacy-shift-report-root="$SETLY_BACKUP_ROOT/legacy-shift-reports" \
  --legacy-shift-cash-root="$SETLY_BACKUP_ROOT/legacy-shift-cash" \
  --attachment-manifest="$SETLY_BACKUP_ROOT/attachments.json" \
  "${SETLY_EMPTY_ARGS[@]}"

npm run tenant:rollout:gate -- \
  --phase=post-migrations \
  --expected-sha="$SETLY_RELEASE_SHA" \
  --baseline="$SETLY_BACKUP_ROOT/rollout-before.json" \
  --backup-manifest="$SETLY_BACKUP_ROOT/manifest.json" \
  --restore-report="$SETLY_RESTORE_REPORT" \
  --output="$SETLY_BACKUP_ROOT/rollout-post.json"

npm run tenant:files-workers:attachments -- --apply
npm run tenant:files-workers:attachments -- \
  --output="$SETLY_BACKUP_ROOT/attachments-after-apply.json"
```

Каждый `--output` attachment detector указывает на новый файл в уже
существующем writable real directory. CLI пишет JSON атомарно, не перезаписывает
existing file и отказывается от symlink/special target; тот же manifest остаётся
в stdout. Destination проверяется и резервируется до DB authentication и до
apply/rollback mutation; при controlled failure собственная reservation
удаляется. Exit code `2` означает unsafe detector counts и блокирует следующий
шаг, даже если evidence file был успешно сохранён.

`rollout-post.json` обязан показать `preservation.ok=true`, unchanged business
PK/counts/historical column values, exact one default Organization/Club и
`integrity.ok=true`. Это и есть
техническое доказательство, что прежний клуб и история стали частью новой
инфраструктуры без потери строк.

### 4. Staged flag cutover

Для каждого checkpoint:

1. включить full-stop;
2. выставить exact capability prefix до выбранного stage;
3. restart backend;
4. выполнить gate и `/api/health`;
5. выключить full-stop, restart и выполнить stage-specific API/browser smoke;
6. только после сохранения green evidence переходить к следующему checkpoint.

Bots/runners остаются выключены и в smoke windows, чтобы async writes не
пересекали capability boundary. После final `enforcement` и permanent SaaS QA их
включение по одному — отдельный production action с provider/worker smoke и
rollback обратно в `false` при ошибке.

Пример gate:

```bash
cd /opt/padel-park-qr-scanner/server
npm run tenant:rollout:gate -- \
  --phase=stage \
  --stage=cache-realtime \
  --expected-sha="$SETLY_RELEASE_SHA" \
  --preservation-report="$SETLY_BACKUP_ROOT/rollout-post.json" \
  --output="$SETLY_BACKUP_ROOT/stage-cache-realtime.json"
```

На checkpoints проверить:

- `cache-realtime`: login/discovery, explicit tenant headers, club switch,
  delayed query/mutation/socket teardown;
- `provider-integrations`: Beeline/Evotor ingress/idempotency, attachments
  download и no cross-tenant delivery через controlled requests;
  реальные bots/runners/worker остаются остановлены до отдельного final source
  cutover;
- `bookings-courts`: шесть ролей, clients/visits/bases/tasks/bookings/scanner,
  same-Organization multi-Club policy;
- `shifts-reports`: methodology/training, client money, shifts/reports/files,
  exports и training cleanup;
- `enforcement`: audit/onboarding, full API smoke, desktop/mobile `390px`,
  console/network/overflow, OpenAPI no-drift и final strict integrity.

### 5. Rollback

Runtime rollback всегда идёт назад к последнему green capability prefix:

1. `SETLY_ROLLOUT_MAINTENANCE_MODE=full-stop` и restart;
2. выключить failing flag и все flags после него;
3. restart, выполнить `tenant:rollout:gate --phase=stage` для предыдущего stage;
4. health/smoke;
5. открыть трафик только после green.

Tenant columns, backfilled attribution, provider connections и copied storage
не удалять. Schema down не является штатным production rollback.
Installation-wide restore baseline допустим только до возобновления user writes
либо после отдельного решения о потере/переносе post-cutover writes. Selective
tenant restore по-прежнему unsupported.

## Second-tenant boundary

До final stage + permanent SaaS QA + отдельного production authorization:

- не использовать `/installation` для создания второй Organization;
- не выдавать/не активировать owner activation link второго tenant;
- не считать наличие Feature 10.2 разрешением на provisioning;
- не включать billing/usage limits.

После отдельного разрешения сначала создать новый installation-wide backup,
затем provision второй tenant через принятый installation-operator flow и
повторить cross-tenant API/provider/file/cache/realtime/browser smoke. После
появления второго tenant rollback на legacy flag-off path запрещён exact-singleton
guard и должен fail closed.

## Acceptance gate

- before/restore/post/stage evidence имеют `ok: true` и exact release SHA;
- frozen backup manifest и restore verification green;
- все прежние business table counts/PK/historical-value digests сохранены;
- current club находится в exact default Organization/Club graph;
- strict tenant integrity: zero findings;
- capabilities включены только допустимым prefix;
- stage smokes и final six-role desktop/mobile QA green;
- authoritative DNS, dedicated `ops.setly.tech` vhost/TLS, Host/CORS/direct-route
  checks green в отдельно разрешённый production day;
- owner activation link указывает на `https://setly.tech/activate-owner`, не на
  operator host;
- no production deploy/flag/provisioning action выполнен в feature branch.

## Onboarding impact

CRM roles/routes/actions не меняются. Maintenance и rollout gate — internal
operator/release workflow, не пользовательский onboarding. Отложенный onboarding
impact Features 10.1/10.2 (club switcher и installation operator UI) должен быть
закрыт общей onboarding-пачкой до фактического SaaS go-live.
