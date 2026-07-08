# Transcriber Server

Дата фиксации: 2026-07-07.

Этот документ - source of truth по текущей инфраструктуре локального GPU transcriber-server для CRM. Он фиксирует только инфраструктурную структуру и operational handoff; CRM-код здесь не меняется.

## Назначение

Локальный Ubuntu laptop с NVIDIA GPU принимает аудиофайлы от CRM/VDS через WireGuard и возвращает JSON транскрибации через ASR HTTP API.

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
ASR API: http://10.8.0.2:9000
```

Внешний публичный доступ к ASR API не нужен. CRM/VDS должен обращаться к ноутбуку по WireGuard IP.

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
curl -I http://10.8.0.2:9000/docs
```

Expected:

- `wg0` has `10.8.0.1/24`;
- laptop peer has recent handshake after traffic;
- ASR docs endpoint returns `HTTP/1.1 200 OK`.

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
- Docker container `transcriber-asr` is `Up`;
- `curl -I http://10.8.0.2:9000/docs` returns `HTTP/1.1 200 OK` from laptop and VDS.

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

`transcriber-asr.service` starts Docker Compose after both `docker.service` and `wg-quick@wg0.service`, because the ASR container binds to `10.8.0.2:9000`.

Current Docker Compose shape:

```yaml
services:
  transcriber-asr:
    image: onerahmet/openai-whisper-asr-webservice:latest-gpu
    container_name: transcriber-asr
    restart: unless-stopped
    gpus: all
    ports:
      - "10.8.0.2:9000:9000"
    environment:
      ASR_ENGINE: faster_whisper
      ASR_MODEL: small
    volumes:
      - ./cache:/root/.cache
```

The bind address `10.8.0.2` is intentional: the ASR API should be reachable over WireGuard, not exposed broadly on LAN/public interfaces.

## ASR Contract

Base URL:

```text
TRANSCRIBER_BASE_URL=http://10.8.0.2:9000
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
  "http://10.8.0.2:9000/asr?task=transcribe&language=en&output=json"
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
docker exec transcriber-asr nvidia-smi
systemctl status wg-quick@wg0 --no-pager
systemctl status transcriber-asr.service --no-pager
docker logs --tail 120 transcriber-asr
curl -I http://10.8.0.2:9000/docs
```

VDS:

```bash
wg show
ping -c 4 10.8.0.2
curl -I http://10.8.0.2:9000/docs
```

## Notes For Future CRM Feature Chats

- Do not change this infrastructure from a CRM feature chat unless the user explicitly asks.
- Use `TRANSCRIBER_BASE_URL=http://10.8.0.2:9000` for real endpoint QA when the runner can reach WireGuard.
- Keep mocked ASR tests for normal CI/local Codex runs where `10.8.0.2` is unavailable.
- Do not store production passwords, WireGuard private keys, API tokens, or SSH private keys in docs/vault/git.
- If adding auth between CRM and ASR, use environment variables and never paste secret values into docs.
- For release-quality transcription UX, use the quality notes in `codex-vault/epics/telephony-transcription.md`.

## Known Follow-Ups

- Temporary test port `8088` was used for Python/nginx HTTP smoke. If still present in UFW, it can be removed after confirming it is no longer needed.
- Direct Mac WireGuard peer is not configured yet; current remote SSH path is via VDS jump host.
- Current production-like ASR model is `small`; quality experiments with `large-v3-turbo float16` belong in a separate hardware QA step.
