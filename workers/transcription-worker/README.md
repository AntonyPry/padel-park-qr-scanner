# Docker transcription worker dashboard для Mac MVP

Локальный transcriber запускается в Docker, ходит в CRM API, забирает запись звонка, режет stereo на роли, отправляет speech chunks в ASR `/asr` и показывает состояние в web dashboard.

Dashboard: `http://127.0.0.1:8090`

## Что внутри

- Local server: Python stdlib HTTP server без внешних pip-зависимостей.
- Dashboard client: static HTML/CSS/JS, отдается тем же server.
- Live updates: `GET /api/events` через SSE.
- Local storage: SQLite `/data/transcription-worker.sqlite3` внутри Docker volume.
- ASR backend по умолчанию: HTTP endpoint `ASR_BASE_URL=http://10.8.0.2:9001`.
- Quality endpoint: `ASR_PROFILE=quality` + `ASR_QUALITY_BASE_URL=http://10.8.0.2:9001`; если quality endpoint недоступен, worker по умолчанию падает обратно на `ASR_BASE_URL`.
- `whisper.cpp` оставлен как fallback backend через `ASR_BACKEND=whisper_cpp`.
- Domain glossary: `config/domain-glossary.json`; из него строится короткий `initial_prompt`, а normalized transcript хранит correction metadata.
- AI postprocessing: включается `TRANSCRIPTION_AI_POSTPROCESSING_ENABLED=true`, ходит в Ollama `TRANSCRIPTION_LLM_BASE_URL=http://10.8.0.2:11434`, сохраняет отдельный AI edited слой and не перезаписывает raw ASR/normalized transcript.

## Env

```env
CRM_API_URL=http://host.docker.internal:3005/api
CRM_FRONTEND_URL=http://127.0.0.1:5174
CRM_WORKER_TOKEN=replace-with-shared-secret
ASR_BACKEND=http_asr
ASR_BASE_URL=http://10.8.0.2:9001
ASR_PROFILE=default
ASR_QUALITY_BASE_URL=
ASR_QUALITY_FALLBACK_ENABLED=true
ASR_INITIAL_PROMPT_ENABLED=true
TRANSCRIPTION_AI_POSTPROCESSING_ENABLED=false
TRANSCRIPTION_LLM_BASE_URL=http://10.8.0.2:11434
TRANSCRIPTION_LLM_MODEL=qwen2.5:7b
TRANSCRIPTION_LLM_TIMEOUT_SECONDS=90
TRANSCRIPTION_LLM_RETRY_COUNT=1
TRANSCRIPTION_LLM_FALLBACK_ENABLED=true
TRANSCRIPTION_LLM_NUM_CTX=4096
ASR_SILENCE_DETECTION_ENABLED=true
ASR_CHUNK_MAX_SECONDS=45
CHANNEL_ADMIN=left
CHANNEL_CLIENT=right
POLL_INTERVAL_SECONDS=10
START_PAUSED=true
DELETE_AUDIO_AFTER=true
DASHBOARD_HOST=127.0.0.1
DASHBOARD_PORT=8090
```

На стороне CRM backend должен быть настроен тот же secret в `CRM_WORKER_TOKEN` или `TELEPHONY_TRANSCRIPTION_WORKER_TOKEN`. Dashboard показывает только `token configured: yes/no`, значение секрета не отдается в UI.

Worker использует protocol v2: отправляет `X-Worker-Protocol-Version: 2`, получает tenant routing и одноразовый claim lease от CRM. Token аутентифицирует audited platform worker, но не выбирает tenant. `audio-reference`, progress, result and fail принимаются только для активного lease/attempt. При включенном `TENANT_FILES_WORKERS_ENABLED` старый protocol получает `426 WORKER_PROTOCOL_UPGRADE_REQUIRED`.

`START_PAUSED=true` защищает локальный запуск от polling spam, если token еще не настроен. Для постоянного polling после проверки `.env` выставь `START_PAUSED=false`; ручная кнопка `Взять следующую задачу` работает и в paused mode.

## Запуск на Mac

```bash
cd /Users/antonypry/Documents/padel-park-qr-scanner/worktrees/crm-features/workers/transcription-worker

cp .env.example .env
# заполнить CRM_WORKER_TOKEN в .env

docker compose --env-file .env up --build
```

Открыть:

```text
http://127.0.0.1:8090
```

## Взять следующую задачу

Через UI нажать `Взять следующую задачу`.

Через API dashboard:

```bash
curl -sS -X POST http://127.0.0.1:8090/api/control/claim-one
```

Чтобы поставить polling на паузу:

```bash
curl -sS -X POST http://127.0.0.1:8090/api/control/pause
```

Чтобы продолжить:

```bash
curl -sS -X POST http://127.0.0.1:8090/api/control/start
```

## Проверить один реальный callId

1. Запусти CRM backend с миграциями и тем же worker secret.
2. Убедись, что у звонка `callId` есть `recordingStatus=available`.
3. Создай transcription job из CRM UI в `/admin/telephony?callId=<CALL_ID>` или через CRM user token:

```bash
CRM_API_URL=http://127.0.0.1:3005/api
CALL_ID=123
CRM_USER_TOKEN=replace-with-user-jwt

curl -sS -X POST \
  "$CRM_API_URL/telephony/calls/$CALL_ID/transcription-jobs" \
  -H "Authorization: Bearer $CRM_USER_TOKEN"
```

4. Открой dashboard и нажми `Взять следующую задачу`.
5. Следи за этапами `downloading_audio`, `ffmpeg_preprocess`, `transcribing_admin_channel`, `transcribing_client_channel`, `merging_segments`, `ai_postprocessing`, `uploading_result`.
6. После success задача появится в completed history, а transcript будет виден в CRM.
7. В CRM transcript modal доступны отдельные вкладки `AI-редактура`, `Очищенная транскрибация`, `Raw ASR` и `Автоматические правки`.

Если LLM endpoint недоступен, worker завершает job с обычной очищенной транскрибацией и сохраняет ошибку в `aiMetadata`; `status=failed` у всей transcription job не ставится.

## Где лежат данные

- SQLite history: `/data/transcription-worker.sqlite3`; state partitioned by opaque organization/club/job/attempt, claim token and CRM PII are not persisted.
- Docker volume с историей: `transcription-worker_worker-data`.
- Model cache нужен только для `ASR_BACKEND=whisper_cpp`: `/models/ggml-small.bin` или `/models/ggml-medium.bin`.
- Docker volume с моделями нужен только для `whisper_cpp`: `transcription-worker_whisper-models`.
- Временные audio files создаются в opaque tenant/claim namespace under `/tmp/setly-transcription` и удаляются только для текущего attempt при `DELETE_AUDIO_AFTER=true`.

## Остановить worker

```bash
docker compose --env-file .env down
```

Очистить локальную историю:

```bash
docker volume rm transcription-worker_worker-data
```

Очистить model cache:

```bash
docker volume rm transcription-worker_whisper-models
```

## Dashboard API

- `GET /health`
- `GET /api/status`
- `GET /api/config`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/control/start`
- `POST /api/control/pause`
- `POST /api/control/claim-one`
- `POST /api/jobs/:id/retry`
- `GET /api/events`

## Live stages

Dashboard пишет lifecycle events:

- `waiting_in_crm`
- `queued`
- `claimed`
- `downloading_audio`
- `ffmpeg_preprocess`
- `transcribing_admin_channel`
- `transcribing_client_channel`
- `transcribing_unknown_channel`
- `merging_segments`
- `uploading_result`
- `completed`
- `failed`

Верхние counters берутся из worker-token CRM endpoint `/telephony/transcription-jobs/worker-queue`, поэтому dashboard показывает CRM queue, active processing, completed today and failed jobs без user JWT.

## Безопасность

- Docker публикует dashboard только на `127.0.0.1:${DASHBOARD_PORT}`.
- `CRM_WORKER_TOKEN` не показывается в UI и редактируется из technical details/log strings.
- Recording URLs, temp paths, phones and transcript bodies не сохраняются в lifecycle events.
- Dashboard показывает opaque tenant routing, `jobId/attempt/claimId`; телефоны, имена и claim token не выводятся.
- При CRM `429` Node worker и Python dashboard принимают только положительный
  integer `Retry-After`, ограничивают паузу 300 секундами и не выводят заголовки
  или body в лог. Poll/claim/ручной retry ждут cooldown; progress/result/fail и
  worker-retry не повторяются рекурсивно. Если 429 получен после claim, worker не
  отправляет автоматический `fail`, а оставляет восстановление существующему
  lease/retry lifecycle.

## Dev sample

Sample-файл можно использовать только для проверки `whisper.cpp` локально. Он не заменяет CRM end-to-end.

```bash
docker compose --env-file .env run --rm \
  -v "$PWD/sample.wav:/audio/sample.wav:ro" \
  transcription-worker \
  python -m server.sample /audio/sample.wav
```
