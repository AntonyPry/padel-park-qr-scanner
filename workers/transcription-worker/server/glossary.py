from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


DEFAULT_GLOSSARY_PATH = Path(__file__).resolve().parents[1] / "config" / "domain-glossary.json"
FILLER_WORDS = {"угу", "ага", "мгм", "мм", "эм"}


def _text(value: object | None) -> str | None:
    text = " ".join(str(value or "").split()).strip()
    return text or None


def normalize_glossary(source: dict[str, Any]) -> dict[str, Any]:
    aliases = []
    for rule in source.get("aliases") or []:
        rule_aliases = [_text(item) for item in rule.get("aliases") or []]
        rule_aliases = [item for item in rule_aliases if item]
        canonical = _text(rule.get("canonical"))
        if not rule_aliases or not canonical:
            continue
        aliases.append(
            {
                "aliases": rule_aliases,
                "canonical": canonical,
                "contextAny": [
                    item
                    for item in (_text(value) for value in rule.get("contextAny") or [])
                    if item
                ],
                "rule": _text(rule.get("rule")) or "domain_alias",
            }
        )
    return {
        "aliases": aliases,
        "canonicalTerms": [
            item for item in (_text(value) for value in source.get("canonicalTerms") or []) if item
        ],
        "promptTerms": [
            item for item in (_text(value) for value in source.get("promptTerms") or []) if item
        ],
    }


def load_domain_glossary(path: str | None = None) -> dict[str, Any]:
    glossary_path = Path(path) if path else DEFAULT_GLOSSARY_PATH
    return normalize_glossary(json.loads(glossary_path.read_text(encoding="utf-8")))


def build_initial_prompt(glossary: dict[str, Any], max_chars: int = 420) -> str | None:
    terms = []
    seen = set()
    for term in glossary.get("promptTerms") or []:
        normalized = _text(term)
        if not normalized or normalized.lower() in seen:
            continue
        seen.add(normalized.lower())
        terms.append(normalized)
    if not terms:
        return None

    prompt = "Термины клуба и CRM: "
    for term in terms:
        next_part = term if prompt.endswith(": ") else f", {term}"
        if len(f"{prompt}{next_part}.") > max_chars:
            break
        prompt += next_part
    return f"{prompt}."


def _match_text(value: str) -> str:
    return " ".join(str(value or "").split()).strip().lower()


def _has_context(text: str, terms: list[str]) -> bool:
    if not terms:
        return True
    normalized = _match_text(text)
    return any(_match_text(term) in normalized for term in terms)


def _correction_base(segment: dict[str, Any], segment_index: int) -> dict[str, Any]:
    return {
        "channel": segment.get("channel"),
        "endMs": segment.get("endMs") if isinstance(segment.get("endMs"), int) else None,
        "segmentIndex": segment_index,
        "speaker": segment.get("speaker"),
        "startMs": segment.get("startMs") if isinstance(segment.get("startMs"), int) else None,
    }


def _apply_domain_rules(text: str, segment: dict[str, Any], segment_index: int, glossary: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    normalized = _text(text) or ""
    corrections = []
    for rule in glossary.get("aliases") or []:
        if not _has_context(normalized, rule.get("contextAny") or []):
            continue
        for alias in rule.get("aliases") or []:
            pattern = re.compile(rf"(?<![\w])({re.escape(alias)})(?![\w])", re.IGNORECASE)

            def replace(match: re.Match[str]) -> str:
                matched = match.group(1)
                corrections.append(
                    {
                        **_correction_base(segment, segment_index),
                        "alias": matched,
                        "canonical": rule["canonical"],
                        "charIndex": match.start(1),
                        "original": matched,
                        "normalized": rule["canonical"],
                        "reason": "domain_alias_with_context"
                        if rule.get("contextAny")
                        else "domain_alias",
                        "rule": rule.get("rule") or "domain_alias",
                        "type": "domain_term",
                    }
                )
                return rule["canonical"]

            normalized = pattern.sub(replace, normalized)
    return normalized, corrections


def _filler_tokens(text: str) -> list[str]:
    cleaned = re.sub(r"[.,!?;:()[\]{}\"']", " ", _match_text(text))
    return [token for token in cleaned.split() if token]


def is_filler_only(text: str) -> bool:
    tokens = _filler_tokens(text)
    return bool(tokens) and all(token in FILLER_WORDS for token in tokens)


def _collapse_filler(text: str) -> tuple[str, bool]:
    tokens = _filler_tokens(text)
    if len(tokens) < 3 or not all(token in FILLER_WORDS for token in tokens):
        return text, False
    return ("Угу." if tokens[0] == "угу" else f"{tokens[0].capitalize()}.", True)


def _same_filler_run(previous: dict[str, Any] | None, segment: dict[str, Any]) -> bool:
    if not previous:
        return False
    if previous.get("channel") != segment.get("channel"):
        return False
    if previous.get("speaker") != segment.get("speaker"):
        return False
    current_start = segment.get("startMs")
    previous_end = previous.get("endMs")
    if not isinstance(current_start, int) or previous_end is None:
        return True
    return current_start - previous_end <= 15000


def normalize_transcript_segments(
    segments: list[dict[str, Any]],
    glossary: dict[str, Any],
    drop_repeated_fillers: bool = True,
) -> dict[str, Any]:
    normalized_segments = []
    corrections = []
    previous_filler = None
    for segment_index, segment in enumerate(segments or []):
        raw_text = _text(segment.get("text"))
        if not raw_text:
            continue
        text, domain_corrections = _apply_domain_rules(raw_text, segment, segment_index, glossary)
        corrections.extend(domain_corrections)
        collapsed_text, collapsed = _collapse_filler(text)
        if collapsed:
            corrections.append(
                {
                    **_correction_base(segment, segment_index),
                    "original": text,
                    "normalized": collapsed_text,
                    "reason": "repeated_filler_inside_segment",
                    "rule": "collapse_repeated_filler",
                    "type": "filler_collapse",
                }
            )

        next_segment = {**segment, "rawText": raw_text, "text": collapsed_text}
        filler_only = is_filler_only(collapsed_text)
        if drop_repeated_fillers and filler_only and _same_filler_run(previous_filler, next_segment):
            corrections.append(
                {
                    **_correction_base(segment, segment_index),
                    "original": raw_text,
                    "normalized": "",
                    "reason": "repeated_filler_same_channel",
                    "rule": "drop_repeated_filler_segment",
                    "type": "filler_drop",
                }
            )
            continue
        if filler_only:
            previous_filler = {
                "channel": next_segment.get("channel"),
                "endMs": next_segment.get("endMs") if isinstance(next_segment.get("endMs"), int) else None,
                "speaker": next_segment.get("speaker"),
            }
        else:
            previous_filler = None
        next_segment["sortOrder"] = len(normalized_segments)
        normalized_segments.append(next_segment)
    return {"segments": normalized_segments, "corrections": corrections}
