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


def _parse_asr_response(payload: Any, offset_ms: int, duration_ms: int | None) -> dict[str, Any]:
    raw_segments = payload.get("segments") if isinstance(payload, dict) else []
    raw_segments = raw_segments if isinstance(raw_segments, list) else []
    segments = []
    for segment in raw_segments:
        if not isinstance(segment, dict):
            continue
        text = " ".join(str(segment.get("text") or segment.get("transcript") or segment.get("phrase") or "").split()).strip()
        if not text:
            continue
        confidence = segment.get("confidence")
        segments.append(
            {
                "confidence": max(0, min(1, float(confidence)))
                if isinstance(confidence, (int, float))
                else None,
                "startMs": _asr_time_ms(segment, "start", offset_ms),
                "endMs": _asr_time_ms(segment, "end", offset_ms),
                "text": text,
            }
        )
    text = ""
    if isinstance(payload, dict):
        text = " ".join(str(payload.get("text") or payload.get("transcript") or "").split()).strip()
    if not segments and text:
        segments.append(
            {
                "confidence": None,
                "startMs": int(offset_ms),
                "endMs": int(offset_ms + duration_ms) if duration_ms else None,
                "text": text,
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


def merge_adjacent_short_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for segment in segments:
        previous = merged[-1] if merged else None
        if previous:
            same_voice = (
                previous.get("speaker") == segment.get("speaker")
                and previous.get("channel") == segment.get("channel")
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
                }
            )

    merged.sort(
        key=lambda item: (
            item.get("startMs") if item.get("startMs") is not None else 999999999,
            item["channelIndex"],
            item["originalOrder"],
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
            return {
                "transcript": transcript,
                "probe": probe,
                "prepared": prepared,
                "segments": len(transcript["segments"]),
            }
        finally:
            if self.config.delete_audio_after:
                shutil.rmtree(temp_dir_path, ignore_errors=True)
