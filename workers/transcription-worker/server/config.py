from __future__ import annotations

import os
import socket
from dataclasses import dataclass, replace
from pathlib import Path

from .glossary import build_initial_prompt, load_domain_glossary


ALLOWED_BACKENDS = {"http_asr", "whisper_cpp"}
ALLOWED_MODELS = {"base", "small", "medium"}
ALLOWED_CHANNELS = {"left", "right"}


def _text(value: object | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def _bool(value: object | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _int(value: object | None, default: int, minimum: int = 1) -> int:
    try:
        number = int(float(str(value)))
    except (TypeError, ValueError):
        return default
    return number if number >= minimum else default


def _float(value: object | None, default: float, minimum: float = 0) -> float:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return default
    return number if number >= minimum else default


def _channel(value: object | None, name: str) -> str:
    channel = str(value or "").strip().lower()
    if channel not in ALLOWED_CHANNELS:
        raise ValueError(f"{name} must be left or right")
    return channel


@dataclass(frozen=True)
class Config:
    asr_backend: str
    asr_base_url: str
    asr_initial_prompt: str | None
    asr_initial_prompt_enabled: bool
    asr_output: str
    asr_profile: str
    asr_quality_base_url: str | None
    asr_quality_fallback_enabled: bool
    asr_task: str
    asr_timeout_seconds: int
    asr_vad_filter: bool
    asr_word_timestamps: bool
    channel_admin: str
    channel_client: str
    chunk_max_seconds: float
    chunk_min_speech_seconds: float
    chunk_padding_ms: int
    chunk_silence_detection_enabled: bool
    command_timeout_seconds: int
    crm_api_url: str
    crm_frontend_url: str | None
    crm_worker_token: str | None
    dashboard_bind_host: str
    dashboard_external_host: str
    dashboard_port: int
    delete_audio_after: bool
    download_timeout_seconds: int
    domain_glossary: dict[str, object]
    domain_glossary_path: str | None
    poll_interval_seconds: int
    start_paused: bool
    state_db_path: str
    temp_root: str
    whisper_binary: str
    whisper_cpp_dir: str
    whisper_language: str
    whisper_model: str
    whisper_model_cache_dir: str
    whisper_model_path: str
    whisper_threads: int
    silence_min_duration_seconds: float
    silence_noise_db: float
    worker_id: str

    @property
    def token_configured(self) -> bool:
        return bool(self.crm_worker_token)

    @property
    def dashboard_url(self) -> str:
        return f"http://{self.dashboard_external_host}:{self.dashboard_port}"


def read_config(env: dict[str, str] | None = None) -> Config:
    env = env or os.environ
    asr_backend = _text(env.get("ASR_BACKEND")) or "http_asr"
    if asr_backend not in ALLOWED_BACKENDS:
        raise ValueError("ASR_BACKEND must be http_asr or whisper_cpp")

    whisper_model = _text(env.get("WHISPER_MODEL")) or "small"
    if whisper_model not in ALLOWED_MODELS:
        raise ValueError("WHISPER_MODEL must be base, small or medium")

    channel_admin = _channel(env.get("CHANNEL_ADMIN") or "left", "CHANNEL_ADMIN")
    channel_client = _channel(env.get("CHANNEL_CLIENT") or "right", "CHANNEL_CLIENT")
    if channel_admin == channel_client:
        raise ValueError("CHANNEL_ADMIN and CHANNEL_CLIENT must point to different channels")

    cpu_count = os.cpu_count() or 1
    default_threads = max(1, min(cpu_count - 1 if cpu_count > 1 else 1, 6))
    model_cache = _text(env.get("WHISPER_MODEL_CACHE_DIR")) or _text(env.get("MODEL_CACHE_DIR")) or "/models"
    crm_worker_token = (
        _text(env.get("CRM_WORKER_TOKEN"))
        or _text(env.get("TELEPHONY_TRANSCRIPTION_WORKER_TOKEN"))
        or _text(env.get("TRANSCRIPTION_WORKER_TOKEN"))
    )
    worker_id = _text(env.get("WORKER_ID")) or f"transcription-dashboard-{socket.gethostname()}"
    dashboard_external_host = _text(env.get("DASHBOARD_HOST")) or "127.0.0.1"

    return Config(
        asr_backend=asr_backend,
        asr_base_url=(
            _text(env.get("ASR_BASE_URL"))
            or _text(env.get("TRANSCRIBER_BASE_URL"))
            or "http://10.8.0.2:9000"
        ).rstrip("/"),
        asr_initial_prompt=None,
        asr_initial_prompt_enabled=_bool(env.get("ASR_INITIAL_PROMPT_ENABLED"), True),
        asr_output=_text(env.get("ASR_OUTPUT")) or "json",
        asr_profile=_text(env.get("ASR_PROFILE")) or "default",
        asr_quality_base_url=(
            _text(env.get("ASR_QUALITY_BASE_URL"))
            or _text(env.get("TRANSCRIBER_QUALITY_BASE_URL"))
        ),
        asr_quality_fallback_enabled=_bool(env.get("ASR_QUALITY_FALLBACK_ENABLED"), True),
        asr_task=_text(env.get("ASR_TASK")) or "transcribe",
        asr_timeout_seconds=_int(env.get("ASR_TIMEOUT_SECONDS"), 15 * 60, 10),
        asr_vad_filter=False,
        asr_word_timestamps=_bool(env.get("ASR_WORD_TIMESTAMPS"), True),
        channel_admin=channel_admin,
        channel_client=channel_client,
        chunk_max_seconds=_float(env.get("ASR_CHUNK_MAX_SECONDS"), 45, 5),
        chunk_min_speech_seconds=_float(env.get("ASR_CHUNK_MIN_SPEECH_SECONDS"), 0.45, 0.1),
        chunk_padding_ms=_int(env.get("ASR_CHUNK_PADDING_MS"), 250, 0),
        chunk_silence_detection_enabled=_bool(env.get("ASR_SILENCE_DETECTION_ENABLED"), True),
        command_timeout_seconds=_int(env.get("COMMAND_TIMEOUT_SECONDS"), 60 * 60, 10),
        crm_api_url=(_text(env.get("CRM_API_URL")) or "").rstrip("/"),
        crm_frontend_url=(_text(env.get("CRM_FRONTEND_URL")) or "http://127.0.0.1:5174").rstrip("/"),
        crm_worker_token=crm_worker_token,
        dashboard_bind_host=_text(env.get("DASHBOARD_BIND_HOST")) or dashboard_external_host,
        dashboard_external_host=dashboard_external_host,
        dashboard_port=_int(env.get("DASHBOARD_PORT"), 8090, 1),
        delete_audio_after=_bool(env.get("DELETE_AUDIO_AFTER"), True),
        download_timeout_seconds=_int(env.get("DOWNLOAD_TIMEOUT_SECONDS"), 5 * 60, 5),
        domain_glossary={},
        domain_glossary_path=_text(env.get("ASR_DOMAIN_GLOSSARY_PATH")),
        poll_interval_seconds=_int(env.get("POLL_INTERVAL_SECONDS"), 10, 1),
        start_paused=_bool(env.get("START_PAUSED"), not bool(crm_worker_token)),
        state_db_path=_text(env.get("STATE_DB_PATH")) or "/data/transcription-worker.sqlite3",
        temp_root=_text(env.get("WORKER_TMP_DIR")) or "/tmp",
        whisper_binary=_text(env.get("WHISPER_CPP_BINARY")) or "whisper-cli",
        whisper_cpp_dir=_text(env.get("WHISPER_CPP_DIR")) or "/opt/whisper.cpp",
        whisper_language=_text(env.get("WHISPER_LANGUAGE")) or "ru",
        whisper_model=whisper_model,
        whisper_model_cache_dir=model_cache,
        whisper_model_path=str(Path(model_cache) / f"ggml-{whisper_model}.bin"),
        whisper_threads=_int(env.get("WHISPER_THREADS"), default_threads, 1),
        silence_min_duration_seconds=_float(env.get("ASR_SILENCE_MIN_DURATION_SECONDS"), 1.2, 0.2),
        silence_noise_db=_float(env.get("ASR_SILENCE_NOISE_DB"), 45, 1),
        worker_id=worker_id,
    )


def public_config(config: Config) -> dict[str, object]:
    return {
        "asrBackend": config.asr_backend,
        "asrBaseUrl": config.asr_base_url,
        "asrProfile": config.asr_profile,
        "asrQualityBaseUrl": config.asr_quality_base_url,
        "channelAdmin": config.channel_admin,
        "channelClient": config.channel_client,
        "chunkMaxSeconds": config.chunk_max_seconds,
        "chunkSilenceDetectionEnabled": config.chunk_silence_detection_enabled,
        "crmApiUrl": config.crm_api_url,
        "crmFrontendUrl": config.crm_frontend_url,
        "dashboardUrl": config.dashboard_url,
        "deleteAudioAfter": config.delete_audio_after,
        "modelName": config.whisper_model if config.asr_backend == "whisper_cpp" else config.asr_profile,
        "modelPath": config.whisper_model_path,
        "pollIntervalSeconds": config.poll_interval_seconds,
        "stateDbPath": config.state_db_path,
        "tokenConfigured": config.token_configured,
        "workerId": config.worker_id,
    }


def load_quality_config(config: Config) -> Config:
    glossary = load_domain_glossary(config.domain_glossary_path)
    return replace(
        config,
        asr_initial_prompt=build_initial_prompt(glossary),
        domain_glossary=glossary,
    )
