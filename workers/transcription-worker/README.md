# Docker transcription worker dashboard для Mac MVP

Локальный transcriber запускается в Docker, ходит в CRM API, забирает запись звонка, режет stereo на роли, отправляет speech chunks в ASR `/asr` и показывает состояние в web dashboard.

Dashboard: `http://127.0.0.1:8090`

## Что внутри

- Local server: Python stdlib HTTP server без внешних pip-зависимостей.
- Dashboard client: static HTML/CSS/JS, отдается тем же server.
- Live updates: `GET /api/events` через SSE.
- Local storage: SQLite `/data/transcription-worker.sqlite3` внутри Docker volume.
- ASR backend по умолчанию: HTTP endpoint `ASR_BASE_URL=http://10.8.0.2:9000`.
- Quality endpoint: `ASR_PROFILE=quality` + `ASR_QUALITY_BASE_URL=http://10.8.0.2:9001`; если quality endpoint недоступен, worker по умолчанию падает обратно на `ASR_BASE_URL`.
- `whisper.cpp` оставлен как fallback backend через `ASR_BACKEND=whisper_cpp`.
- Domain glossary: `config/domain-glossary.json`; из него строится короткий `initial_prompt`, а normalized transcript хранит correction metadata.

## Env

```env
CRM_API_URL=http://host.docker.internal:3005/api
CRM_FRONTEND_URL=http://127.0.0.1:5174
CRM_WORKER_TOKEN=replace-with-shared-secret
ASR_BACKEND=http_asr
ASR_BASE_URL=http://10.8.0.2:9000
ASR_PROFILE=default
ASR_QUALITY_BASE_URL=http://10.8.0.2:9001
ASR_QUALITY_FALLBACK_ENABLED=true
ASR_INITIAL_PROMPT_ENABLED=true
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
5. Следи за этапами `downloading_audio`, `ffmpeg_preprocess`, `transcribing_admin_channel`, `transcribing_client_channel`, `merging_segments`, `uploading_result`.
6. После success задача появится в completed history, а transcript будет виден в CRM.
7. В CRM transcript modal normalized text показывается основным, ниже доступны `Raw ASR без правок` и список `Автоматические правки`.

## Где лежат данные

- SQLite history: `/data/transcription-worker.sqlite3`.
- Docker volume с историей: `transcription-worker_worker-data`.
- Model cache нужен только для `ASR_BACKEND=whisper_cpp`: `/models/ggml-small.bin` или `/models/ggml-medium.bin`.
- Docker volume с моделями нужен только для `whisper_cpp`: `transcription-worker_whisper-models`.
- Временные audio files создаются в `/tmp` и удаляются после обработки при `DELETE_AUDIO_AFTER=true`.

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
- Temporary recording URLs не сохраняются полностью в lifecycle events.
- Dashboard показывает `jobId/callId`; телефоны и имена не выводятся.

## Dev sample

Sample-файл можно использовать только для проверки `whisper.cpp` локально. Он не заменяет CRM end-to-end.

```bash
docker compose --env-file .env run --rm \
  -v "$PWD/sample.wav:/audio/sample.wav:ro" \
  transcription-worker \
  python -m server.sample /audio/sample.wav
```
