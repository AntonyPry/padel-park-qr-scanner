# Transcriber Server

Дата фиксации: 2026-07-10.

Этот документ - source of truth по текущей инфраструктуре локального GPU transcriber-server для CRM. Он фиксирует только инфраструктурную структуру и operational handoff; CRM-код здесь не меняется.

## Назначение

Локальный Ubuntu laptop с NVIDIA GPU принимает аудиофайлы от CRM/VDS через WireGuard, возвращает JSON транскрибации через ASR HTTP API и дает локальный Ollama endpoint для AI-постобработки.

## Network Topology

```text
CRM/VDS
public IP: 155.212.163.43
WireGuard IP: 10.8.0.1
        |
        | WireGuard UDP 51820
        v
Ubuntu laptop / transcriber-laptop
WireGuard IP: 10.8.0.2
ASR API: http://10.8.0.2:9001
LLM API: http://10.8.0.2:11434
```

Внешний публичный доступ к ASR/LLM API не нужен. CRM/VDS должен обращаться к ноутбуку по WireGuard IP.

## VDS

- Hostname/user observed during setup: `root@egorsmi19`.
- Public IP: `155.212.163.43`.
- WireGuard service: `wg-quick@wg0`.
- WireGuard address: `10.8.0.1/24`.
- WireGuard listen port: `51820/udp`.
- Firewall: `ufw` active, `51820/udp` allowed.
- Laptop peer allowed IP: `10.8.0.2/32`.

Verification commands:

```bash
wg show
ip addr show wg0
curl -I http://10.8.0.2:9001/docs
curl -s http://10.8.0.2:11434/api/tags
```

Expected:

- `wg0` has `10.8.0.1/24`;
- laptop peer has recent handshake after traffic;
- ASR docs endpoint returns `HTTP/1.1 200 OK`;
- Ollama tags endpoint returns JSON with local models.

## Ubuntu Laptop

- Hostname: `transcriber-laptop`.
- User: `antonypry`.
- Local LAN IP observed during setup: `192.168.0.170` (not stable source of truth).
- WireGuard IP: `10.8.0.2`.
- GPU: NVIDIA GeForce RTX 4050 Mobile, 6 GB VRAM.
- NVIDIA driver observed: `595.71.05`.
- Docker and NVIDIA Container Toolkit are installed and verified with `docker run --rm --gpus all ... nvidia-smi`.
- Sleep/suspend/hibernate/hybrid-sleep targets are masked.

Important services:

```bash
systemctl status wg-quick@wg0 --no-pager
systemctl status transcriber-asr.service --no-pager
docker ps
```

Expected after reboot:

- `wg-quick@wg0` is `enabled` and `active`;
- `transcriber-asr.service` is `enabled` and `active (exited)`;
- Docker container `transcriber-asr-largev3-turbo` is `Up`;
- `curl -I http://10.8.0.2:9001/docs` returns `HTTP/1.1 200 OK` from laptop and VDS;
- `curl -s http://10.8.0.2:11434/api/tags` returns Ollama model list from laptop and VDS.

## Laptop Files And Services

WireGuard:

```text
/etc/wireguard/wg0.conf
/etc/wireguard/laptop_private.key
/etc/wireguard/laptop_public.key
```

Do not copy private keys into chat, docs, git, vault, or release notes.

ASR app:

```text
/home/antonypry/transcriber-server/docker-compose.yml
/home/antonypry/transcriber-server/cache/
/etc/systemd/system/transcriber-asr.service
```

`transcriber-asr.service` starts Docker Compose after both `docker.service` and `wg-quick@wg0.service`.

Observed ASR Docker shape on 2026-07-09:

```yaml
services:
  transcriber-asr:
    image: onerahmet/openai-whisper-asr-webservice:latest-gpu
    container_name: transcriber-asr-largev3-turbo
    restart: unless-stopped
    gpus: all
    ports:
      - "0.0.0.0:9001:9000"
    environment:
      ASR_ENGINE: faster_whisper
      ASR_MODEL: large-v3-turbo
      ASR_QUANTIZATION: float16
    volumes:
      - ./cache:/root/.cache
```

The current ASR endpoint is used over WireGuard as `http://10.8.0.2:9001`. The observed ASR bind is broader than the Ollama bind. If no LAN access is needed, tighten the ASR bind to `10.8.0.2:9001:9000` in a dedicated infra step and verify from VDS before removing the old container.

## ASR Contract

Base URL:

```text
TRANSCRIBER_BASE_URL=http://10.8.0.2:9001
```

Docs:

```text
GET /docs
```

Transcribe:

```text
POST /asr?task=transcribe&language=...&output=json
```

Request:

- `multipart/form-data`;
- audio file field: `audio_file`.

Smoke command:

```bash
curl -s -X POST \
  -F "audio_file=@$HOME/test-transcriber.wav" \
  "http://10.8.0.2:9001/asr?task=transcribe&language=en&output=json"
```

Observed response shape:

```json
{
  "language": "en",
  "segments": [],
  "text": "..."
}
```

CRM integration must inspect and persist the exact response shape before finalizing DB/API contracts.

## LLM Postprocessing Contract

Base URL:

```text
LLM_BASE_URL=http://10.8.0.2:11434
```

Runtime:

- Docker container: `transcriber-ollama`.
- Image: `ollama/ollama`.
- Port bind: `10.8.0.2:11434:11434`.
- Volume: Docker volume `ollama` mounted to `/root/.ollama`.
- Restart policy: `unless-stopped`.
- GPU: NVIDIA runtime, verified by `nvidia-smi` showing `/usr/lib/ollama/llama-server`.

Request:

```text
POST /api/generate
```

Use:

```json
{
  "model": "qwen2.5:7b",
  "stream": false,
  "format": "json",
  "options": {
    "temperature": 0,
    "num_ctx": 4096
  },
  "prompt": "..."
}
```

Current model decision:

- Primary quality model: `qwen2.5:7b`.
- Segment-level test time on laptop: about `14.7s` for 8 short segments, including model load in the observed run.
- GPU memory while loaded: about `4.6GB` for Ollama llama-server, plus ASR/desktop overhead.
- Do not use `qwen2.5:3b` for quality: faster but merged roles/timings and hallucinated details.
- Do not use `gemma3:4b`, `qwen3:8b`, or `qwen2.5:14b` as current primary: observed outputs were structurally worse than `qwen2.5:7b`.

Important: do not ask the LLM to rebuild the full transcript with roles and timings. The safer contract is segment-level editing:

Input to prompt:

- `segmentId`;
- `speaker`;
- `startMs`;
- `endMs`;
- `text`.

Output from LLM:

```json
{
  "segments": [
    {
      "segmentId": "s1",
      "editedText": "...",
      "confidence": "high",
      "changes": ["..."]
    }
  ],
  "warnings": []
}
```

CRM/worker must preserve original `speaker`, `startMs`, and `endMs` by `segmentId`, validate exact segment IDs, normalize `changes` to string array, keep the raw LLM response, and reject/ignore risky corrections.

Observed useful correction:

```text
raw:    Да, да, здравствуйте, можно на 7 часов корт заманировать?
edited: Да, да, здравствуйте, можно на 7 часов корт забронировать?
```

Observed caution:

- `qwen2.5:7b` returned one `changes` value as nested arrays, so parser must normalize or ignore malformed `changes`;
- last-segment correction `маленького набора нет -> маленького нет` is plausible but should be treated as medium confidence, not blindly trusted.

VDS smoke command:

```bash
curl -s http://10.8.0.2:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:7b","stream":false,"format":"json","options":{"temperature":0,"num_ctx":4096},"prompt":"Верни строго JSON: {\"ok\":true,\"source\":\"vds\"}"}'
```

## SSH Access

From VDS to laptop over WireGuard:

```bash
ssh antonypry@10.8.0.2
```

From Mac via VDS jump host:

```bash
ssh -J root@155.212.163.43 antonypry@10.8.0.2
```

Future optional improvement: add the Mac as a third WireGuard peer, for example `10.8.0.3`, if direct Mac-to-WireGuard access is preferred.

## Operational Checks

Laptop:

```bash
nvidia-smi
docker exec transcriber-asr-largev3-turbo nvidia-smi
systemctl status wg-quick@wg0 --no-pager
systemctl status transcriber-asr.service --no-pager
docker logs --tail 120 transcriber-asr-largev3-turbo
docker ps
curl -I http://10.8.0.2:9001/docs
curl -s http://10.8.0.2:11434/api/tags
```

VDS:

```bash
wg show
ping -c 4 10.8.0.2
curl -I http://10.8.0.2:9001/docs
curl -s http://10.8.0.2:11434/api/tags
```

## Notes For Future CRM Feature Chats

- Do not change this infrastructure from a CRM feature chat unless the user explicitly asks.
- Use `TRANSCRIBER_BASE_URL=http://10.8.0.2:9001` for real endpoint QA when the runner can reach WireGuard.
- Use `LLM_BASE_URL=http://10.8.0.2:11434` and `qwen2.5:7b` for postprocessing experiments.
- LLM postprocessing should be segment-level editing only; CRM/worker must preserve timings and speakers outside the model response.
- Keep mocked ASR tests for normal CI/local Codex runs where `10.8.0.2` is unavailable.
- Do not store production passwords, WireGuard private keys, API tokens, or SSH private keys in docs/vault/git.
- If adding auth between CRM and ASR, use environment variables and never paste secret values into docs.
- For release-quality transcription UX, use the quality notes in `codex-vault/epics/telephony-transcription.md`.

## Known Follow-Ups

- Temporary test port `8088` was used for Python/nginx HTTP smoke. If still present in UFW, it can be removed after confirming it is no longer needed.
- Direct Mac WireGuard peer is not configured yet; current remote SSH path is via VDS jump host.
- Current production-like ASR container observed on 2026-07-09 is `transcriber-asr-largev3-turbo` on `9001`; older `9000` references are historical and should not be used for new QA unless the service is intentionally moved back.
- ASR is currently observed as bound to `0.0.0.0:9001`; tighten to `10.8.0.2:9001:9000` later if LAN exposure is not needed.
