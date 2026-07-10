from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any


def _text(value: object | None) -> str | None:
    text = " ".join(str(value or "").split()).strip()
    return text or None


def _base_url(value: object | None) -> str:
    return str(value or "").rstrip("/")


def _finite_ms(value: object | None) -> int | None:
    if isinstance(value, (int, float)) and value >= 0:
        return int(value)
    return None


def _segment_id(index: int) -> str:
    return f"s{index + 1}"


def _speaker_label(speaker: str | None) -> str:
    if speaker == "administrator":
        return "Администратор"
    if speaker == "client":
        return "Клиент"
    return "Неизвестно"


def _format_time(ms: int | None) -> str:
    if ms is None:
        return "??:??"
    total = max(0, int(ms / 1000))
    hours = total // 3600
    minutes = (total % 3600) // 60
    seconds = total % 60
    prefix = f"{hours:02d}:" if hours else ""
    return f"{prefix}{minutes:02d}:{seconds:02d}"


def _format_transcript_lines(segments: list[dict[str, Any]]) -> str:
    lines = []
    for segment in segments:
        prefix = ""
        if segment.get("startMs") is not None:
            prefix = f"[{_format_time(segment.get('startMs'))}] "
        lines.append(f"{prefix}{_speaker_label(segment.get('speaker'))}: {segment.get('text') or ''}")
    return "\n".join(lines)


def _flatten_strings(value: object, output: list[str] | None = None) -> list[str]:
    output = output if output is not None else []
    if isinstance(value, str):
        text = _text(value)
        if text:
            output.append(text)
    elif isinstance(value, list):
        for item in value:
            _flatten_strings(item, output)
    return output


def _string_list(value: object, max_items: int = 12) -> list[str]:
    items = []
    seen = set()
    for item in _flatten_strings(value):
        if item in seen:
            continue
        seen.add(item)
        items.append(item)
    return items[:max_items]


def _confidence(value: object) -> str | float | None:
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized if normalized in {"high", "medium", "low"} else None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if number <= 0 or number > 1:
        return None
    return number


def has_forbidden_artifact(text: object) -> bool:
    normalized = (_text(text) or "").lower().replace("ё", "е")
    if not normalized:
        return True
    if "продолжение следует" in normalized:
        return True
    if re.match(r"^контекст(?=$|[\s:;,.!?-])", normalized):
        return True
    if re.match(r"^редактор(?=$|[\s:;,.!?-])", normalized):
        return True
    if re.match(r"^корректор(?=$|[\s:;,.!?-])", normalized):
        return True
    return False


def build_llm_input_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "segmentId": _segment_id(index),
            "speaker": segment.get("speaker") or "unknown",
            "startMs": _finite_ms(segment.get("startMs")),
            "endMs": _finite_ms(segment.get("endMs")),
            "text": _text(segment.get("text")) or "",
        }
        for index, segment in enumerate(segments or [])
    ]


def build_llm_prompt(input_segments: list[dict[str, Any]]) -> str:
    return "\n".join(
        [
            "Ты редактируешь ASR-транскрибацию телефонного звонка падел-клуба.",
            "Исправляй только очевидные ошибки распознавания русской речи и терминов клуба.",
            "Не переписывай диалог целиком, не добавляй новые факты, имена, цены, даты или телефоны.",
            "Не меняй роли, каналы и тайминги. Не возвращай speaker, startMs или endMs.",
            "Не добавляй служебные фразы: Контекст, Продолжение следует, Редактор, Корректор.",
            'Пример безопасной правки: "корт заманировать" -> "корт забронировать".',
            "Верни строго JSON без markdown по схеме:",
            '{"segments":[{"segmentId":"s1","editedText":"...","confidence":"high|medium|low","changes":["..."],"warnings":[]}],"warnings":[]}',
            "Если сегмент не требует правки, верни его с исходным текстом и пустым changes.",
            "",
            json.dumps({"segments": input_segments}, ensure_ascii=False, indent=2),
        ]
    )


def _parse_json_text(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    text = str(value or "").strip()
    if not text:
        raise RuntimeError("LLM returned empty response")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
        if fenced:
            parsed = json.loads(fenced.group(1))
            if isinstance(parsed, dict):
                return parsed
        object_match = re.search(r"\{[\s\S]*\}", text)
        if object_match:
            parsed = json.loads(object_match.group(0))
            if isinstance(parsed, dict):
                return parsed
        raise
    raise RuntimeError("LLM response is not a JSON object")


def _normalize_llm_payload(raw_payload: object) -> dict[str, Any]:
    payload = raw_payload if isinstance(raw_payload, dict) else {}
    segments = payload.get("segments")
    return {
        "rawPayload": payload,
        "segments": segments if isinstance(segments, list) else [],
        "warnings": _string_list(payload.get("warnings")),
    }


def apply_llm_edits_to_transcript(
    transcript: dict[str, Any],
    raw_payload: object,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base_segments = transcript.get("segments") if isinstance(transcript, dict) else []
    base_segments = base_segments if isinstance(base_segments, list) else []
    input_segments = build_llm_input_segments(base_segments)
    output_segments = []
    for index, segment in enumerate(base_segments):
        source_text = _text(segment.get("text")) or ""
        output_segments.append(
            {
                "channel": segment.get("channel"),
                "changes": [],
                "confidence": None,
                "editedText": source_text,
                "endMs": _finite_ms(segment.get("endMs")),
                "segmentId": _segment_id(index),
                "sortOrder": index,
                "sourceText": source_text,
                "speaker": segment.get("speaker") or "unknown",
                "startMs": _finite_ms(segment.get("startMs")),
                "text": source_text,
                "warnings": [],
            }
        )

    by_id = {segment["segmentId"]: segment for segment in output_segments}
    known_ids = [segment["segmentId"] for segment in output_segments]
    accepted_ids: set[str] = set()
    ignored_unknown_segment_ids = []
    rejected_segment_ids = []
    corrections = []
    payload = _normalize_llm_payload(raw_payload)

    for item in payload["segments"]:
        if not isinstance(item, dict):
            continue
        segment_id = _text(item.get("segmentId"))
        if not segment_id or segment_id not in by_id:
            if segment_id:
                ignored_unknown_segment_ids.append(segment_id)
            continue
        edited_text = _text(item.get("editedText"))
        if not edited_text or has_forbidden_artifact(edited_text):
            rejected_segment_ids.append(segment_id)
            continue
        target = by_id[segment_id]
        changes = _string_list(item.get("changes"))
        warnings = _string_list(item.get("warnings"))
        target["text"] = edited_text
        target["editedText"] = edited_text
        target["confidence"] = _confidence(item.get("confidence"))
        target["changes"] = changes
        target["warnings"] = warnings
        accepted_ids.add(segment_id)
        if target["sourceText"] != edited_text or changes or warnings:
            corrections.append(
                {
                    "channel": target.get("channel"),
                    "changes": changes,
                    "confidence": target.get("confidence"),
                    "endMs": target.get("endMs"),
                    "original": target.get("sourceText"),
                    "normalized": edited_text,
                    "segmentId": segment_id,
                    "speaker": target.get("speaker"),
                    "startMs": target.get("startMs"),
                    "type": "llm_edit",
                    "warnings": warnings,
                }
            )

    next_metadata = {
        **(metadata or {}),
        "acceptedSegmentIds": sorted(accepted_ids, key=lambda item: int(item[1:]) if item[1:].isdigit() else 999999),
        "ignoredUnknownSegmentIds": sorted(set(ignored_unknown_segment_ids)),
        "inputSegments": len(input_segments),
        "missingSegmentIds": [segment_id for segment_id in known_ids if segment_id not in accepted_ids],
        "rejectedSegmentIds": sorted(set(rejected_segment_ids)),
        "returnedSegments": len(payload["segments"]),
        "status": "completed",
        "warnings": payload["warnings"],
    }

    return {
        "aiCorrections": corrections,
        "aiMetadata": next_metadata,
        "aiTranscriptSegments": output_segments,
        "aiTranscriptText": _format_transcript_lines(output_segments),
    }


def _call_ollama_generate(prompt: str, config: Any) -> dict[str, Any]:
    url = f"{_base_url(config.transcription_llm_base_url)}/api/generate"
    body = json.dumps(
        {
            "model": config.transcription_llm_model,
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0,
                "num_ctx": config.transcription_llm_num_ctx,
            },
            "prompt": prompt,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.transcription_llm_timeout_seconds) as response:
            outer = _parse_json_text(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {error.code}: {payload}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(str(error.reason)) from error
    except TimeoutError as error:
        raise RuntimeError(f"timeout after {config.transcription_llm_timeout_seconds}s") from error

    return {
        "outerPayload": outer,
        "payload": _parse_json_text(outer.get("response") or outer),
    }


def postprocess_transcript_with_llm(transcript: dict[str, Any], config: Any) -> dict[str, Any]:
    if not getattr(config, "transcription_ai_postprocessing_enabled", False):
        return {
            **transcript,
            "aiCorrections": [],
            "aiMetadata": {"enabled": False, "status": "disabled"},
            "aiTranscriptSegments": [],
            "aiTranscriptText": None,
        }

    input_segments = build_llm_input_segments(transcript.get("segments") or [])
    if not input_segments:
        return {
            **transcript,
            "aiCorrections": [],
            "aiMetadata": {
                "enabled": True,
                "status": "skipped",
                "warnings": ["Нет сегментов для AI-редактуры."],
            },
            "aiTranscriptSegments": [],
            "aiTranscriptText": None,
        }

    prompt = build_llm_prompt(input_segments)
    attempts = max(0, int(getattr(config, "transcription_llm_retry_count", 0))) + 1
    started = time.monotonic()
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            response = _call_ollama_generate(prompt, config)
            applied = apply_llm_edits_to_transcript(
                transcript,
                response["payload"],
                {
                    "attempts": attempt,
                    "baseUrl": _base_url(config.transcription_llm_base_url),
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "enabled": True,
                    "model": config.transcription_llm_model,
                    "numCtx": config.transcription_llm_num_ctx,
                    "provider": "ollama",
                    "rawResponse": response["payload"],
                    "timeoutSeconds": config.transcription_llm_timeout_seconds,
                },
            )
            return {**transcript, **applied}
        except Exception as error:  # noqa: BLE001 - fallback must not fail the job
            last_error = error

    return {
        **transcript,
        "aiCorrections": [],
        "aiMetadata": {
            "attempts": attempts,
            "baseUrl": _base_url(config.transcription_llm_base_url),
            "durationMs": int((time.monotonic() - started) * 1000),
            "enabled": True,
            "error": str(last_error) if last_error else "LLM postprocessing failed",
            "fallback": "normalized_transcript_saved"
            if getattr(config, "transcription_llm_fallback_enabled", True)
            else "none",
            "model": config.transcription_llm_model,
            "provider": "ollama",
            "status": "failed",
            "timeoutSeconds": config.transcription_llm_timeout_seconds,
        },
        "aiTranscriptSegments": [],
        "aiTranscriptText": None,
    }
