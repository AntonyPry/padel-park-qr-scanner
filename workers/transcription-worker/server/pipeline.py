from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable

from .glossary import normalize_transcript_segments
from .llm_postprocess import postprocess_transcript_with_llm


class PipelineError(RuntimeError):
    pass


Emit = Callable[[str, str | None, dict[str, Any] | None], None]
NOISE_TEXTS = {
    "",
    ".",
    "..",
    "...",
    "…",
    "-",
    "--",
    "шум",
    "[шум]",
    "(шум)",
    "музыка",
    "[музыка]",
    "(музыка)",
}
SHORT_SEGMENT_MAX_MS = 1800
MERGE_GAP_MAX_MS = 650
MERGE_TEXT_MAX_CHARS = 260
LONG_SEGMENT_MIN_MS = 5000
REPLY_MAX_DURATION_MS = 6500
REPLY_MAX_CHARS = 180
WORD_PAUSE_SPLIT_MS = 750
INTERRUPTION_GUARD_MS = 120
MIN_SPLIT_PART_MS = 550


def run_command(command: list[str], timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.CalledProcessError as error:
        stderr = (error.stderr or error.stdout or "").strip()
        suffix = f": {stderr[-1200:]}" if stderr else ""
        raise PipelineError(f"{command[0]} exited with code {error.returncode}{suffix}") from error
    except subprocess.TimeoutExpired as error:
        raise PipelineError(f"{command[0]} timed out after {timeout_seconds} seconds") from error


def check_binary(binary: str) -> dict[str, Any]:
    path = shutil.which(binary)
    return {"available": bool(path), "path": path}


def dependency_status(config: Any) -> dict[str, Any]:
    model_path = Path(config.whisper_model_path)
    return {
        "ffmpeg": check_binary("ffmpeg"),
        "ffprobe": check_binary("ffprobe"),
        "whisperCpp": {
            **check_binary(config.whisper_binary),
            "modelExists": model_path.exists() and model_path.stat().st_size > 0
            if config.asr_backend == "whisper_cpp"
            else None,
        },
    }


def ensure_model(config: Any, emit: Emit) -> None:
    model_path = Path(config.whisper_model_path)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    if model_path.exists() and model_path.stat().st_size > 0:
        return

    script = Path(config.whisper_cpp_dir) / "models" / "download-ggml-model.sh"
    emit("ffmpeg_preprocess", "Downloading whisper.cpp model", {"model": config.whisper_model})
    run_command(
        ["bash", str(script), config.whisper_model, config.whisper_model_cache_dir],
        config.command_timeout_seconds,
    )
    if not model_path.exists():
        raise PipelineError(f"whisper.cpp model was not downloaded: {model_path}")


def download_audio(url: str, target_path: Path, config: Any) -> dict[str, Any]:
    if not url:
        raise PipelineError("audio-reference did not include downloadUrl")
    request = urllib.request.Request(url, method="GET")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=config.download_timeout_seconds) as response:
            with target_path.open("wb") as file:
                shutil.copyfileobj(response, file)
            size = target_path.stat().st_size
            if size <= 0:
                raise PipelineError("Downloaded audio file is empty")
            return {
                "bytes": size,
                "contentType": response.headers.get("content-type"),
                "durationMs": int((time.monotonic() - started) * 1000),
            }
    except urllib.error.HTTPError as error:
        raise PipelineError(f"Audio download failed with HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise PipelineError(f"Audio download failed: {error.reason}") from error


def probe_audio(audio_path: Path, config: Any) -> dict[str, Any]:
    result = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,channels,channel_layout",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(audio_path),
        ],
        config.command_timeout_seconds,
    )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise PipelineError(f"ffprobe returned invalid JSON: {error}") from error

    streams = payload.get("streams") or []
    stream = streams[0] if streams else None
    if not stream:
        raise PipelineError("ffprobe did not find an audio stream")
    codec = stream.get("codec_name")
    channels = int(stream.get("channels") or 0)
    duration = float((payload.get("format") or {}).get("duration") or 0)
    if not codec:
        raise PipelineError("ffprobe did not report an audio codec")
    if channels <= 0:
        raise PipelineError("ffprobe did not report a valid channel count")
    if duration <= 0:
        raise PipelineError("ffprobe did not report a valid audio duration")

    return {
        "codec": codec,
        "channels": channels,
        "channelLayout": stream.get("channel_layout"),
        "durationSeconds": duration,
    }


def prepare_audio(audio_path: Path, temp_dir: Path, probe: dict[str, Any], config: Any) -> dict[str, Any]:
    if int(probe["channels"]) >= 2:
        left = temp_dir / "left.wav"
        right = temp_dir / "right.wav"
        normalize = "loudnorm=I=-18:TP=-2:LRA=11"
        run_command(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(audio_path),
                "-filter_complex",
                (
                    f"[0:a]pan=mono|c0=c0,{normalize}[left];"
                    f"[0:a]pan=mono|c0=c1,{normalize}[right]"
                ),
                "-map",
                "[left]",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(left),
                "-map",
                "[right]",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(right),
            ],
            config.command_timeout_seconds,
        )
        return {
            "mode": "stereo",
            "channels": [
                {"name": "left", "path": left},
                {"name": "right", "path": right},
            ],
        }

    mono = temp_dir / "mono.wav"
    run_command(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(audio_path),
            "-vn",
            "-ac",
            "1",
            "-af",
            "loudnorm=I=-18:TP=-2:LRA=11",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(mono),
        ],
        config.command_timeout_seconds,
    )
    return {"mode": "mono", "channels": [{"name": "mono", "path": mono}]}


def parse_silence_events(output: str) -> list[dict[str, Any]]:
    events = []
    for line in str(output or "").splitlines():
        start = re.search(r"silence_start:\s*([0-9.]+)", line)
        if start:
            events.append({"type": "start", "at": float(start.group(1))})
            continue
        end = re.search(r"silence_end:\s*([0-9.]+)", line)
        if end:
            events.append({"type": "end", "at": float(end.group(1))})
    return [event for event in events if event["at"] >= 0]


def build_speech_intervals(events: list[dict[str, Any]], duration_seconds: float, config: Any) -> list[dict[str, float]]:
    duration = float(duration_seconds or 0)
    if duration <= 0:
        return []
    if not events:
        return [{"start": 0.0, "end": duration}]

    intervals = []
    speech_start = 0.0
    in_silence = False
    for event in sorted(events, key=lambda item: item["at"]):
        at = min(float(event["at"]), duration)
        if event["type"] == "start" and not in_silence:
            if at > speech_start:
                intervals.append({"start": speech_start, "end": at})
            in_silence = True
        elif event["type"] == "end" and in_silence:
            speech_start = at
            in_silence = False
    if not in_silence and speech_start < duration:
        intervals.append({"start": speech_start, "end": duration})

    min_speech = float(getattr(config, "chunk_min_speech_seconds", 0.45))
    padding = float(getattr(config, "chunk_padding_ms", 0)) / 1000
    padded = [
        {
            "start": max(0.0, interval["start"] - padding),
            "end": min(duration, interval["end"] + padding),
        }
        for interval in intervals
        if interval["end"] - interval["start"] >= min_speech
    ]

    merged = []
    for interval in padded:
        previous = merged[-1] if merged else None
        if previous and interval["start"] <= previous["end"] + 0.1:
            previous["end"] = max(previous["end"], interval["end"])
        else:
            merged.append(dict(interval))
    return merged


def split_long_intervals(intervals: list[dict[str, float]], config: Any) -> list[dict[str, float]]:
    chunks = []
    max_seconds = float(getattr(config, "chunk_max_seconds", 45))
    min_speech = float(getattr(config, "chunk_min_speech_seconds", 0.45))
    for interval in intervals:
        start = float(interval["start"])
        while start < interval["end"]:
            end = min(float(interval["end"]), start + max_seconds)
            if end - start >= min_speech:
                chunks.append({"start": start, "end": end})
            start = end
    return chunks


def detect_speech_intervals(channel: dict[str, Any], probe: dict[str, Any], config: Any) -> list[dict[str, float]]:
    if not getattr(config, "chunk_silence_detection_enabled", True):
        return split_long_intervals([{"start": 0.0, "end": float(probe["durationSeconds"])}], config)

    result = run_command(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(channel["path"]),
            "-af",
            (
                f"silencedetect=noise=-{float(config.silence_noise_db)}dB:"
                f"d={float(config.silence_min_duration_seconds)}"
            ),
            "-f",
            "null",
            "-",
        ],
        config.command_timeout_seconds,
    )
    events = parse_silence_events(f"{result.stdout}\n{result.stderr}")
    return split_long_intervals(build_speech_intervals(events, probe["durationSeconds"], config), config)


def export_audio_chunk(
    channel: dict[str, Any],
    interval: dict[str, float],
    index: int,
    temp_dir: Path,
    config: Any,
) -> dict[str, Any]:
    chunk_path = temp_dir / f"{channel['name']}-chunk-{index + 1:03d}.wav"
    start = max(0.0, float(interval["start"]))
    duration = max(0.0, float(interval["end"]) - start)
    run_command(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(channel["path"]),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(chunk_path),
        ],
        config.command_timeout_seconds,
    )
    return {
        "durationMs": int(duration * 1000),
        "index": index,
        "offsetMs": int(start * 1000),
        "path": chunk_path,
    }


def create_speech_chunks(channel: dict[str, Any], probe: dict[str, Any], temp_dir: Path, config: Any) -> list[dict[str, Any]]:
    intervals = detect_speech_intervals(channel, probe, config)
    return [
        export_audio_chunk(channel, interval, index, temp_dir, config)
        for index, interval in enumerate(intervals)
    ]


TIMESTAMP_RE = re.compile(
    r"^\s*\[(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+"
    r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.*)$"
)


def _timestamp_ms(match: re.Match[str], offset: int) -> int:
    hours = int(match.group(offset))
    minutes = int(match.group(offset + 1))
    seconds = int(match.group(offset + 2))
    millis = int(match.group(offset + 3))
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis


def parse_whisper_output(output: str) -> list[dict[str, Any]]:
    segments = []
    for line in output.splitlines():
        match = TIMESTAMP_RE.match(line)
        if not match:
            continue
        text = " ".join(match.group(9).split()).strip()
        if not text:
            continue
        segments.append(
            {
                "startMs": _timestamp_ms(match, 1),
                "endMs": _timestamp_ms(match, 5),
                "text": text,
            }
        )
    return segments


def is_noise_text(text: str) -> bool:
    normalized = " ".join(str(text or "").split()).strip().lower()
    if normalized in NOISE_TEXTS:
        return True
    stripped = normalized.strip(".,!?;:—-–()[]{} ")
    return not stripped


def clean_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned = []
    for segment in segments:
        text = " ".join(str(segment.get("text") or "").split()).strip()
        if is_noise_text(text):
            continue
        start_ms = segment.get("startMs")
        end_ms = segment.get("endMs")
        if (
            isinstance(start_ms, int)
            and isinstance(end_ms, int)
            and end_ms <= start_ms
        ):
            continue
        cleaned.append({**segment, "text": text})
    return cleaned


def run_whisper(channel: dict[str, Any], config: Any, offset_ms: int = 0, allow_empty: bool = False) -> dict[str, Any]:
    started = time.monotonic()
    result = run_command(
        [
            config.whisper_binary,
            "-m",
            config.whisper_model_path,
            "-f",
            str(channel["path"]),
            "-l",
            config.whisper_language,
            "-t",
            str(config.whisper_threads),
        ],
        config.command_timeout_seconds,
    )
    segments = [
        {
            **segment,
            "startMs": segment["startMs"] + offset_ms,
            "endMs": segment["endMs"] + offset_ms,
        }
        for segment in clean_segments(parse_whisper_output(f"{result.stdout}\n{result.stderr}"))
    ]
    if not segments and not allow_empty:
        raise PipelineError(f"whisper.cpp produced no transcript for {channel['name']}")
    return {
        "channel": channel["name"],
        "durationMs": int((time.monotonic() - started) * 1000),
        "segments": segments,
    }


def _asr_endpoint_candidates(config: Any) -> list[dict[str, str]]:
    default_endpoint = {"profile": "default", "baseUrl": config.asr_base_url.rstrip("/")}
    quality = (config.asr_quality_base_url or "").rstrip("/")
    if config.asr_profile == "quality" and quality and quality != default_endpoint["baseUrl"]:
        quality_endpoint = {"profile": "quality", "baseUrl": quality}
        return [quality_endpoint, default_endpoint] if config.asr_quality_fallback_enabled else [quality_endpoint]
    return [default_endpoint]


def _asr_url(base_url: str, config: Any) -> str:
    query = {
        "task": config.asr_task,
        "language": config.whisper_language,
        "output": config.asr_output,
        "vad_filter": "false",
        "word_timestamps": "true" if config.asr_word_timestamps else "false",
    }
    if config.asr_initial_prompt_enabled and config.asr_initial_prompt:
        query["initial_prompt"] = config.asr_initial_prompt
    return f"{base_url.rstrip('/')}/asr?{urllib.parse.urlencode(query)}"


def _multipart_audio_body(file_path: Path) -> tuple[bytes, str]:
    boundary = f"----padelpark-{uuid.uuid4().hex}"
    audio = file_path.read_bytes()
    parts = [
        f"--{boundary}\r\n".encode("utf-8"),
        (
            'Content-Disposition: form-data; name="audio_file"; '
            f'filename="{file_path.name}"\r\n'
        ).encode("utf-8"),
        b"Content-Type: audio/wav\r\n\r\n",
        audio,
        b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ]
    return b"".join(parts), boundary


def _asr_time_ms(segment: dict[str, Any], field: str, offset_ms: int) -> int | None:
    ms_value = segment.get(f"{field}Ms")
    if isinstance(ms_value, (int, float)) and ms_value >= 0:
        return int(ms_value + offset_ms)
    value = segment.get(field)
    if not isinstance(value, (int, float)) or value < 0:
        return None
    relative_ms = value * 1000 if value <= 36 * 60 * 60 else value
    return int(relative_ms + offset_ms)


def _asr_confidence(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return None
    return max(0, min(1, number))


def _asr_word_text(word: dict[str, Any]) -> str:
    return " ".join(str(word.get("word") or word.get("text") or word.get("token") or "").split()).strip()


def _normalize_asr_words(words: Any, offset_ms: int) -> list[dict[str, Any]]:
    if not isinstance(words, list):
        return []
    normalized = []
    for index, word in enumerate(words):
        if not isinstance(word, dict):
            continue
        text = _asr_word_text(word)
        start_ms = _asr_time_ms(word, "start", offset_ms)
        end_ms = _asr_time_ms(word, "end", offset_ms)
        if not text or start_ms is None or end_ms is None:
            continue
        normalized.append(
            {
                "confidence": _asr_confidence(word.get("confidence", word.get("probability"))),
                "endMs": end_ms,
                "index": index,
                "startMs": start_ms,
                "text": text,
            }
        )
    normalized.sort(key=lambda item: (item["startMs"], item["index"]))
    for item in normalized:
        item.pop("index", None)
    return normalized


def _parse_asr_response(payload: Any, offset_ms: int, duration_ms: int | None) -> dict[str, Any]:
    raw_segments = payload.get("segments") if isinstance(payload, dict) else []
    raw_segments = raw_segments if isinstance(raw_segments, list) else []
    response_words = _normalize_asr_words(payload.get("words") if isinstance(payload, dict) else None, offset_ms)
    segments = []
    for segment in raw_segments:
        if not isinstance(segment, dict):
            continue
        text = " ".join(str(segment.get("text") or segment.get("transcript") or segment.get("phrase") or "").split()).strip()
        if not text:
            continue
        words = _normalize_asr_words(
            segment.get("words") if isinstance(segment.get("words"), list)
            else payload.get("words") if isinstance(payload, dict) and len(raw_segments) == 1
            else None,
            offset_ms,
        )
        start_ms = _asr_time_ms(segment, "start", offset_ms)
        end_ms = _asr_time_ms(segment, "end", offset_ms)
        segments.append(
            {
                "confidence": _asr_confidence(segment.get("confidence")),
                "startMs": start_ms if start_ms is not None else words[0]["startMs"] if words else None,
                "endMs": end_ms if end_ms is not None else words[-1]["endMs"] if words else None,
                "text": text,
                "words": words,
            }
        )
    text = ""
    if isinstance(payload, dict):
        text = " ".join(str(payload.get("text") or payload.get("transcript") or "").split()).strip()
    if not segments and (text or response_words):
        segments.append(
            {
                "confidence": None,
                "startMs": response_words[0]["startMs"] if response_words else int(offset_ms),
                "endMs": response_words[-1]["endMs"] if response_words else int(offset_ms + duration_ms) if duration_ms else None,
                "text": text or " ".join(word["text"] for word in response_words).strip(),
                "words": response_words,
            }
        )
    return {"segments": segments, "text": text or " ".join(segment["text"] for segment in segments).strip()}


def _post_asr(file_path: Path, endpoint: dict[str, str], config: Any, chunk: dict[str, Any]) -> dict[str, Any]:
    body, boundary = _multipart_audio_body(file_path)
    request = urllib.request.Request(
        _asr_url(endpoint["baseUrl"], config),
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=config.asr_timeout_seconds) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")[:500]
        raise PipelineError(f"HTTP {error.code}: {payload}") from error
    except urllib.error.URLError as error:
        raise PipelineError(str(error.reason)) from error
    except TimeoutError as error:
        raise PipelineError(f"timeout after {config.asr_timeout_seconds}s") from error

    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        payload = {"text": raw}
    parsed = _parse_asr_response(payload, int(chunk["offsetMs"]), int(chunk["durationMs"]))
    return {
        "durationMs": int((time.monotonic() - started) * 1000),
        "endpointProfile": endpoint["profile"],
        "endpointUrl": endpoint["baseUrl"],
        "parsed": parsed,
        "rawResponse": payload,
    }


def run_http_asr(chunk: dict[str, Any], config: Any) -> dict[str, Any]:
    failures = []
    for endpoint in _asr_endpoint_candidates(config):
        try:
            result = _post_asr(Path(chunk["path"]), endpoint, config, chunk)
            if failures:
                result["fallbackFrom"] = [failure["endpointUrl"] for failure in failures]
            return result
        except PipelineError as error:
            failures.append({"endpointUrl": endpoint["baseUrl"], "error": str(error)})
    raise PipelineError(
        "ASR endpoint недоступен: "
        + "; ".join(f"{failure['endpointUrl']} ({failure['error']})" for failure in failures)
    )


def transcribe_channel(channel: dict[str, Any], probe: dict[str, Any], temp_dir: Path, config: Any) -> dict[str, Any]:
    chunks = create_speech_chunks(channel, probe, temp_dir, config)
    started = time.monotonic()
    segments = []
    raw_responses = []
    for chunk in chunks:
        if config.asr_backend == "http_asr":
            result = run_http_asr(chunk, config)
            segments.extend(result["parsed"]["segments"])
            raw_responses.append(
                {
                    "chunk": {
                        "durationMs": chunk["durationMs"],
                        "index": chunk["index"],
                        "offsetMs": chunk["offsetMs"],
                    },
                    "durationMs": result["durationMs"],
                    "endpointProfile": result["endpointProfile"],
                    "endpointUrl": result["endpointUrl"],
                    "fallbackFrom": result.get("fallbackFrom"),
                    "response": result["rawResponse"],
                }
            )
        else:
            result = run_whisper(
                {"name": channel["name"], "path": chunk["path"]},
                config,
                offset_ms=int(chunk["offsetMs"]),
                allow_empty=True,
            )
            segments.extend(result["segments"])
            raw_responses.append(
                {
                    "chunk": {
                        "durationMs": chunk["durationMs"],
                        "index": chunk["index"],
                        "offsetMs": chunk["offsetMs"],
                    },
                    "durationMs": result["durationMs"],
                }
            )
    return {
        "channel": channel["name"],
        "chunks": [
            {
                "durationMs": chunk["durationMs"],
                "index": chunk["index"],
                "offsetMs": chunk["offsetMs"],
            }
            for chunk in chunks
        ],
        "durationMs": int((time.monotonic() - started) * 1000),
        "rawResponses": raw_responses,
        "segments": segments,
    }


def speaker_for_channel(channel_name: str, config: Any) -> str:
    if channel_name == config.channel_admin:
        return "administrator"
    if channel_name == config.channel_client:
        return "client"
    return "unknown"


def stage_for_channel(channel_name: str, config: Any) -> str:
    speaker = speaker_for_channel(channel_name, config)
    if speaker == "administrator":
        return "transcribing_admin_channel"
    if speaker == "client":
        return "transcribing_client_channel"
    return "transcribing_unknown_channel"


def _format_time(ms: int | None) -> str:
    if ms is None:
        return "??:??"
    total = max(0, int(ms / 1000))
    hours = total // 3600
    minutes = (total % 3600) // 60
    seconds = total % 60
    prefix = f"{hours:02d}:" if hours else ""
    return f"{prefix}{minutes:02d}:{seconds:02d}"


def _speaker_label(speaker: str) -> str:
    return {
        "administrator": "Администратор",
        "client": "Клиент",
    }.get(speaker, "Неизвестно")


def _format_transcript_lines(segments: list[dict[str, Any]]) -> str:
    return "\n".join(
        f"[{_format_time(segment.get('startMs'))}] {_speaker_label(segment['speaker'])}: {segment['text']}"
        for segment in segments
    )


def _segment_duration_ms(segment: dict[str, Any]) -> int | None:
    start_ms = segment.get("startMs")
    end_ms = segment.get("endMs")
    if not isinstance(start_ms, int) or not isinstance(end_ms, int):
        return None
    return max(0, end_ms - start_ms)


def _finite_ms(value: Any) -> int | None:
    if isinstance(value, (int, float)) and value >= 0:
        return int(value)
    return None


def _word_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _normalize_word_timestamps(words: Any) -> list[dict[str, Any]]:
    if not isinstance(words, list):
        return []
    normalized = []
    for index, word in enumerate(words):
        if not isinstance(word, dict):
            continue
        text = _word_text(word.get("text") or word.get("word") or word.get("token"))
        start_ms = _finite_ms(word.get("startMs"))
        end_ms = _finite_ms(word.get("endMs"))
        if not text or start_ms is None or end_ms is None or end_ms < start_ms:
            continue
        normalized.append(
            {
                "confidence": _asr_confidence(word.get("confidence")),
                "endMs": end_ms,
                "index": index,
                "startMs": start_ms,
                "text": text,
            }
        )
    normalized.sort(key=lambda item: (item["startMs"], item["index"]))
    for item in normalized:
        item.pop("index", None)
    return normalized


def _join_words(words: list[dict[str, Any]]) -> str:
    text = " ".join(_word_text(word.get("text")) for word in words if _word_text(word.get("text")))
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"([([{«])\s+", r"\1", text)
    text = re.sub(r"\s+([)\]}»])", r"\1", text)
    return " ".join(text.split()).strip()


def _has_hard_punctuation(text: str) -> bool:
    return bool(re.search(r"[.!?…;:]$", " ".join(str(text or "").split()).strip()))


def _has_soft_punctuation(text: str) -> bool:
    return " ".join(str(text or "").split()).strip().endswith(",")


def _same_segment_lane(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return left.get("speaker") == right.get("speaker") and left.get("channel") == right.get("channel")


def _split_group_id(segment: dict[str, Any], index: int) -> str:
    return f"{segment.get('channel') or 'channel'}:{segment.get('originalOrder', index)}:{segment.get('startMs', 'x')}:{segment.get('endMs', 'x')}"


def _intersections(segment: dict[str, Any], segments: list[dict[str, Any]]) -> list[dict[str, int]]:
    start_ms = _finite_ms(segment.get("startMs"))
    end_ms = _finite_ms(segment.get("endMs"))
    if start_ms is None or end_ms is None:
        return []
    items = []
    for other in segments:
        if other is segment or _same_segment_lane(segment, other):
            continue
        other_start = _finite_ms(other.get("startMs"))
        other_end = _finite_ms(other.get("endMs"))
        if other_start is None or other_end is None:
            continue
        if other_start < end_ms - INTERRUPTION_GUARD_MS and other_end > start_ms + INTERRUPTION_GUARD_MS:
            items.append({"startMs": max(start_ms, other_start), "endMs": min(end_ms, other_end)})
    return sorted(
        [item for item in items if item["endMs"] > item["startMs"]],
        key=lambda item: (item["startMs"], item["endMs"]),
    )


def _interruption_between_words(left_word: dict[str, Any], right_word: dict[str, Any], intersections: list[dict[str, int]]) -> bool:
    return any(
        item["startMs"] >= left_word["endMs"] - INTERRUPTION_GUARD_MS
        and item["endMs"] <= right_word["startMs"] + INTERRUPTION_GUARD_MS
        for item in intersections
    )


def _word_part(segment: dict[str, Any], words: list[dict[str, Any]], group_id: str, part: int) -> dict[str, Any] | None:
    text = _join_words(words)
    if not text:
        return None
    return {
        **segment,
        "endMs": words[-1]["endMs"],
        "splitGroupId": group_id,
        "splitPart": part,
        "startMs": words[0]["startMs"],
        "text": text,
        "words": words,
    }


def _split_by_words(segment: dict[str, Any], intersections: list[dict[str, int]], segment_index: int) -> list[dict[str, Any]] | None:
    words = _normalize_word_timestamps(segment.get("words"))
    if len(words) < 2:
        return None
    groups = []
    current = []
    for index, word in enumerate(words):
        current.append(word)
        next_word = words[index + 1] if index + 1 < len(words) else None
        if not next_word:
            groups.append(current)
            continue
        current_text = _join_words(current)
        current_duration = current[-1]["endMs"] - current[0]["startMs"]
        gap = next_word["startMs"] - word["endMs"]
        should_split = (
            gap >= WORD_PAUSE_SPLIT_MS
            or _interruption_between_words(word, next_word, intersections)
            or (_has_hard_punctuation(current_text) and current_duration >= MIN_SPLIT_PART_MS)
            or (_has_soft_punctuation(current_text) and (current_duration >= 2500 or len(current_text) >= REPLY_MAX_CHARS))
            or (current_duration >= REPLY_MAX_DURATION_MS and len(current) >= 3)
            or len(current_text) >= REPLY_MAX_CHARS
        )
        if should_split:
            groups.append(current)
            current = []
    if len(groups) <= 1:
        return None
    group_id = _split_group_id(segment, segment_index)
    return [part for index, group in enumerate(groups) if (part := _word_part(segment, group, group_id, index))]


def _split_text_by_punctuation(text: str) -> list[str]:
    units = re.findall(r"[^.!?…;:]+[.!?…;:]?|[^.!?…;:]+$", " ".join(str(text or "").split()).strip())
    parts = []
    current = ""
    for unit in units:
        next_text = " ".join(f"{current} {unit}".split()).strip()
        if current and len(next_text) > REPLY_MAX_CHARS:
            parts.append(current)
            current = " ".join(unit.split()).strip()
        else:
            current = next_text
    if current:
        parts.append(current)
    return [part for part in parts if part]


def _split_text_into_count(text: str, count: int) -> list[str]:
    normalized = " ".join(str(text or "").split()).strip()
    if count <= 1:
        return [normalized]
    punctuation_parts = _split_text_by_punctuation(normalized)
    if len(punctuation_parts) == count:
        return punctuation_parts
    if len(punctuation_parts) > count:
        merged = ["" for _ in range(count)]
        for index, part in enumerate(punctuation_parts):
            bucket = min(count - 1, (index * count) // len(punctuation_parts))
            merged[bucket] = " ".join(f"{merged[bucket]} {part}".split()).strip()
        return [part for part in merged if part]
    words = normalized.split()
    if len(words) <= count:
        return words
    parts = []
    for index in range(count):
        start = (index * len(words)) // count
        end = ((index + 1) * len(words)) // count
        parts.append(" ".join(words[start:max(start + 1, end)]))
    return [part for part in parts if part]


def _speech_windows(segment: dict[str, Any], intersections: list[dict[str, int]]) -> list[dict[str, int]]:
    start_ms = _finite_ms(segment.get("startMs"))
    end_ms = _finite_ms(segment.get("endMs"))
    if start_ms is None or end_ms is None or not intersections:
        return []
    windows = []
    cursor = start_ms
    for item in intersections:
        before_end = max(cursor, item["startMs"] - INTERRUPTION_GUARD_MS)
        if before_end - cursor >= MIN_SPLIT_PART_MS:
            windows.append({"startMs": cursor, "endMs": before_end})
        cursor = max(cursor, item["endMs"] + INTERRUPTION_GUARD_MS)
    if end_ms - cursor >= MIN_SPLIT_PART_MS:
        windows.append({"startMs": cursor, "endMs": end_ms})
    return windows


def _timed_text_parts(segment: dict[str, Any], parts: list[str], group_id: str) -> list[dict[str, Any]] | None:
    start_ms = _finite_ms(segment.get("startMs"))
    end_ms = _finite_ms(segment.get("endMs"))
    if start_ms is None or end_ms is None or len(parts) <= 1:
        return None
    duration = end_ms - start_ms
    total_chars = sum(max(1, len(part)) for part in parts)
    cursor = start_ms
    output = []
    for index, part in enumerate(parts):
        part_end = end_ms if index == len(parts) - 1 else round(cursor + duration * (max(1, len(part)) / total_chars))
        output.append(
            {
                **segment,
                "endMs": max(cursor, part_end),
                "splitGroupId": group_id,
                "splitPart": index,
                "startMs": cursor,
                "text": part,
                "words": [],
            }
        )
        cursor = output[-1]["endMs"]
    return output


def _split_by_text(segment: dict[str, Any], intersections: list[dict[str, int]], segment_index: int) -> list[dict[str, Any]] | None:
    duration = _segment_duration_ms(segment)
    text = " ".join(str(segment.get("text") or "").split()).strip()
    if not duration or not text:
        return None
    group_id = _split_group_id(segment, segment_index)
    windows = _speech_windows(segment, intersections)
    if len(windows) > 1:
        parts = _split_text_into_count(text, len(windows))
        if len(parts) != len(windows):
            return None
        return [
            {
                **segment,
                "endMs": windows[index]["endMs"],
                "splitGroupId": group_id,
                "splitPart": index,
                "startMs": windows[index]["startMs"],
                "text": part,
                "words": [],
            }
            for index, part in enumerate(parts)
        ]
    if duration < LONG_SEGMENT_MIN_MS and len(text) < REPLY_MAX_CHARS:
        return None
    parts = _split_text_by_punctuation(text)
    if len(parts) <= 1 and duration >= REPLY_MAX_DURATION_MS:
        parts = _split_text_into_count(text, max(2, -(-duration // REPLY_MAX_DURATION_MS)))
    if len(parts) <= 1:
        return None
    return _timed_text_parts(segment, parts, group_id)


def split_long_conversation_segments(segments: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    stats = {
        "inputSegments": len(segments),
        "outputSegments": 0,
        "splitSegments": 0,
        "wordTimestampSegments": 0,
    }
    refined = []
    for index, segment in enumerate(segments):
        intersections = _intersections(segment, segments)
        duration = _segment_duration_ms(segment)
        words = _normalize_word_timestamps(segment.get("words"))
        if len(words) > 1:
            stats["wordTimestampSegments"] += 1
        should_split = (
            len(words) > 1
            or bool(intersections)
            or (duration is not None and duration >= LONG_SEGMENT_MIN_MS)
            or len(str(segment.get("text") or "")) >= REPLY_MAX_CHARS
        )
        split = (_split_by_words(segment, intersections, index) or _split_by_text(segment, intersections, index)) if should_split else None
        if split and len(split) > 1:
            stats["splitSegments"] += 1
            refined.extend(split)
        else:
            refined.append({**segment, "words": words})
    stats["outputSegments"] = len(refined)
    return refined, stats


def merge_adjacent_short_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for segment in segments:
        previous = merged[-1] if merged else None
        if previous:
            same_voice = (
                previous.get("speaker") == segment.get("speaker")
                and previous.get("channel") == segment.get("channel")
            )
            same_split_group = (
                same_voice
                and previous.get("splitGroupId")
                and previous.get("splitGroupId") == segment.get("splitGroupId")
            )
            previous_end = previous.get("endMs")
            current_start = segment.get("startMs")
            gap = (
                current_start - previous_end
                if isinstance(previous_end, int) and isinstance(current_start, int)
                else None
            )
            current_duration = _segment_duration_ms(segment)
            combined_text = f"{previous['text']} {segment['text']}".strip()
            if (
                same_voice
                and not same_split_group
                and gap is not None
                and 0 <= gap <= MERGE_GAP_MAX_MS
                and current_duration is not None
                and current_duration <= SHORT_SEGMENT_MAX_MS
                and len(combined_text) <= MERGE_TEXT_MAX_CHARS
            ):
                previous["text"] = combined_text
                previous["endMs"] = segment.get("endMs")
                continue
        merged.append(dict(segment))
    return merged


def build_transcript(channel_results: list[dict[str, Any]], probe: dict[str, Any], config: Any, extra: dict[str, Any]) -> dict[str, Any]:
    merged = []
    for channel_index, result in enumerate(channel_results):
        speaker = speaker_for_channel(result["channel"], config)
        for index, segment in enumerate(result["segments"]):
            merged.append(
                {
                    "channel": result["channel"],
                    "channelIndex": channel_index,
                    "confidence": segment.get("confidence")
                    if isinstance(segment.get("confidence"), (int, float))
                    else None,
                    "originalOrder": index,
                    "speaker": speaker,
                    "startMs": segment.get("startMs"),
                    "endMs": segment.get("endMs"),
                    "text": segment["text"],
                    "words": _normalize_word_timestamps(segment.get("words")),
                }
            )

    merged, split_stats = split_long_conversation_segments(merged)
    merged.sort(
        key=lambda item: (
            item.get("startMs") if item.get("startMs") is not None else 999999999,
            item["channelIndex"],
            item["originalOrder"],
            item.get("splitPart", 0),
        )
    )
    merged = merge_adjacent_short_segments(merged)
    if not merged:
        raise PipelineError("whisper.cpp produced no transcript segments")

    raw_segments = [
        {
            "channel": item["channel"],
            "confidence": item.get("confidence"),
            "endMs": item.get("endMs"),
            "sortOrder": index,
            "speaker": item["speaker"],
            "startMs": item.get("startMs"),
            "text": item["text"],
        }
        for index, item in enumerate(merged)
    ]
    raw_transcript_text = _format_transcript_lines(raw_segments)
    normalized = normalize_transcript_segments(raw_segments, getattr(config, "domain_glossary", {}) or {})
    transcript_text = _format_transcript_lines(normalized["segments"])

    return {
        "corrections": normalized["corrections"],
        "language": config.whisper_language,
        "metadata": {
            "asrBackend": config.asr_backend,
            "audio": probe,
            "channelMapping": {
                "administrator": config.channel_admin,
                "client": config.channel_client,
            },
            "merge": {
                "gapMaxMs": MERGE_GAP_MAX_MS,
                "shortSegmentMaxMs": SHORT_SEGMENT_MAX_MS,
            },
            "preprocessing": {
                "audioFilter": "loudnorm=I=-18:TP=-2:LRA=11",
                "sampleRate": 16000,
            },
            "segmentation": {
                **split_stats,
                "mergedSegments": len(merged),
                "replyMaxChars": REPLY_MAX_CHARS,
                "replyMaxDurationMs": REPLY_MAX_DURATION_MS,
                "wordPauseSplitMs": WORD_PAUSE_SPLIT_MS,
            },
            "workerId": config.worker_id,
            "whisper": {
                "language": config.whisper_language,
                "model": config.whisper_model,
                "threads": config.whisper_threads,
            },
            **extra,
        },
        "rawAsrJson": {
            "channels": [
                {
                    "channel": result["channel"],
                    "chunks": result.get("chunks"),
                    "parsedSegments": [
                        {
                            "endMs": segment.get("endMs") if isinstance(segment.get("endMs"), int) else None,
                            "startMs": segment.get("startMs") if isinstance(segment.get("startMs"), int) else None,
                            "text": " ".join(str(segment.get("text") or "").split()).strip(),
                            "words": _normalize_word_timestamps(segment.get("words")),
                        }
                        for segment in result.get("segments") or []
                    ],
                    "rawResponses": result.get("rawResponses"),
                }
                for result in channel_results
            ]
        },
        "rawTranscriptText": raw_transcript_text,
        "segments": normalized["segments"],
        "transcriptText": transcript_text,
    }


class PipelineRunner:
    def __init__(self, config: Any):
        self.config = config

    def run(self, job: dict[str, Any], audio_reference: dict[str, Any], emit: Emit) -> dict[str, Any]:
        temp_dir_path = Path(tempfile.mkdtemp(prefix=f"crm-transcription-{job.get('id', 'job')}-", dir=self.config.temp_root))
        try:
            audio_path = temp_dir_path / "recording.audio"
            emit("downloading_audio", "Downloading recording", {"target": str(audio_path)})
            download = download_audio(audio_reference["audio"].get("downloadUrl"), audio_path, self.config)
            emit("downloading_audio", "Recording downloaded", {"bytes": download["bytes"], "contentType": download.get("contentType")})

            emit("ffmpeg_preprocess", "Inspecting audio stream", None)
            probe = probe_audio(audio_path, self.config)
            emit("ffmpeg_preprocess", "Audio stream inspected", probe)

            emit("ffmpeg_preprocess", "Splitting and normalizing audio", {"channels": probe["channels"]})
            prepared = prepare_audio(audio_path, temp_dir_path, probe, self.config)
            emit("ffmpeg_preprocess", "Audio prepared for ASR", {"mode": prepared["mode"], "channels": [item["name"] for item in prepared["channels"]]})

            if self.config.asr_backend == "whisper_cpp":
                emit("ffmpeg_preprocess", "Preparing whisper.cpp model", {"model": self.config.whisper_model, "modelPath": self.config.whisper_model_path})
                ensure_model(self.config, emit)
            channel_results = []
            for channel in prepared["channels"]:
                channel_stage = stage_for_channel(channel["name"], self.config)
                emit(channel_stage, "Transcribing channel", {"channel": channel["name"]})
                result = transcribe_channel(channel, probe, temp_dir_path, self.config)
                channel_results.append(result)
                emit(
                    channel_stage,
                    "Channel transcription completed",
                    {
                        "channel": channel["name"],
                        "chunks": len(result.get("chunks") or []),
                        "durationMs": result["durationMs"],
                        "segments": len(result["segments"]),
                    },
                )

            transcript = build_transcript(
                channel_results,
                probe,
                self.config,
                {
                    "audioDeleted": self.config.delete_audio_after,
                    "asr": {
                        "baseUrl": self.config.asr_base_url,
                        "initialPromptEnabled": self.config.asr_initial_prompt_enabled,
                        "profile": self.config.asr_profile,
                        "qualityBaseUrl": self.config.asr_quality_base_url,
                        "qualityFallbackEnabled": self.config.asr_quality_fallback_enabled,
                        "vadFilter": False,
                        "wordTimestamps": self.config.asr_word_timestamps,
                    },
                    "chunking": {
                        "maxSeconds": self.config.chunk_max_seconds,
                        "minSpeechSeconds": self.config.chunk_min_speech_seconds,
                        "paddingMs": self.config.chunk_padding_ms,
                        "silenceDetectionEnabled": self.config.chunk_silence_detection_enabled,
                        "silenceMinDurationSeconds": self.config.silence_min_duration_seconds,
                        "silenceNoiseDb": -abs(float(self.config.silence_noise_db)),
                    },
                    "glossary": {
                        "aliases": len((self.config.domain_glossary or {}).get("aliases") or []),
                        "canonicalTerms": len((self.config.domain_glossary or {}).get("canonicalTerms") or []),
                        "initialPrompt": self.config.asr_initial_prompt,
                    },
                    "preparedAudioMode": prepared["mode"],
                    "asrDurationsMs": {item["channel"]: item["durationMs"] for item in channel_results},
                },
            )
            emit("merging_segments", "Segments merged by timestamp", {"segments": len(transcript["segments"])})
            if self.config.transcription_ai_postprocessing_enabled:
                emit(
                    "ai_postprocessing",
                    "Running AI transcript postprocessing",
                    {
                        "baseUrl": self.config.transcription_llm_base_url,
                        "model": self.config.transcription_llm_model,
                    },
                )
            transcript = postprocess_transcript_with_llm(transcript, self.config)
            if self.config.transcription_ai_postprocessing_enabled:
                ai_metadata = transcript.get("aiMetadata") or {}
                emit(
                    "ai_postprocessing",
                    "AI transcript postprocessing finished",
                    {
                        "acceptedSegments": len(ai_metadata.get("acceptedSegmentIds") or []),
                        "ignoredUnknownSegmentIds": len(ai_metadata.get("ignoredUnknownSegmentIds") or []),
                        "missingSegmentIds": len(ai_metadata.get("missingSegmentIds") or []),
                        "status": ai_metadata.get("status"),
                    },
                )
            return {
                "transcript": transcript,
                "probe": probe,
                "prepared": prepared,
                "segments": len(transcript["segments"]),
            }
        finally:
            if self.config.delete_audio_after:
                shutil.rmtree(temp_dir_path, ignore_errors=True)
