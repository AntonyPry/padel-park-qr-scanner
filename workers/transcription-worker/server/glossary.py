from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


DEFAULT_GLOSSARY_PATH = Path(__file__).resolve().parents[1] / "config" / "domain-glossary.json"
FILLER_WORDS = {"угу", "ага", "мгм", "мм", "эм"}
ADMIN_GREETING_START_MAX_MS = 7000
ADMIN_GREETING_PATTERN = re.compile(
    r"^(добрый|доброе)\s+(день|вечер|утро),?\s+"
    r"(?:(?:(?:падел|петал|подал|падал|павел)\s+парк|папарк|попарк|папа|парк|па\s+парк),?\s+)?"
    r"(?:прошу|слушаю|слышу|послушаю)\s+вас(?:,?\s+(?:позвонили|звоните))?(?=$|[^\w])",
    re.IGNORECASE,
)
SUBTITLE_EXACT_RULES = {"продолжение следует": "subtitle_outro_continuation"}
SUBTITLE_PREFIX_RULES = [
    (
        re.compile(
            r"^субтитры\s+(создавал[аи]?|создал[аи]?|сделал[аи]?|подготовил[аи]?|оформил[аи]?|редактировал[аи]?|автор|от|для)(?=$|\s)"
        ),
        "subtitle_creator_credit",
    ),
    (
        re.compile(r"^редактор\s+(субтитров?|субтитр[a-zа-я0-9]*|суббот[a-zа-я0-9]*|сабтайтл[a-zа-я0-9]*)(?=$|\s)"),
        "subtitle_editor_credit",
    ),
    (
        re.compile(r"^корректор(?:\s+субтитров?)?(?:\s+[a-zа-я0-9]+){0,5}$"),
        "subtitle_corrector_credit",
    ),
]
SUBTITLE_CONVERSATION_HINTS = {
    "администратор",
    "документ",
    "звонок",
    "клиент",
    "можно",
    "нужно",
    "пожалуйста",
    "сказал",
    "скажите",
    "текст",
    "хочу",
}
ALLOWED_LATIN_TERMS = re.compile(r"\b(lunda|qr|vk|whatsapp|telegram|zoom)\b", re.IGNORECASE)


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


def _subtitle_match_text(value: str) -> str:
    text = _match_text(value).replace("ё", "е")
    text = re.sub(r"[«»„“”\"'.,!?;:()[\]{}]", " ", text)
    text = re.sub(r"[—–-]", " ", text)
    return " ".join(text.split()).strip()


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


def _can_normalize_admin_greeting(segment: dict[str, Any]) -> bool:
    if segment.get("speaker") != "administrator":
        return False
    start_ms = segment.get("startMs")
    return not isinstance(start_ms, int) or start_ms <= ADMIN_GREETING_START_MAX_MS


def _normalize_admin_greeting(text: str, segment: dict[str, Any], segment_index: int) -> tuple[str, list[dict[str, Any]]]:
    if not _can_normalize_admin_greeting(segment):
        return text, []
    normalized = _text(text) or ""
    match = ADMIN_GREETING_PATTERN.search(normalized)
    if not match:
        return text, []
    replacement = f"{match.group(1)} {match.group(2)}, Падел Парк, слушаю вас"
    next_text = ADMIN_GREETING_PATTERN.sub(replacement, normalized, count=1)
    if next_text == normalized:
        return text, []
    return next_text, [
        {
            **_correction_base(segment, segment_index),
            "original": match.group(0),
            "normalized": replacement,
            "reason": "admin_opening_greeting_mishear",
            "rule": "admin_opening_greeting",
            "type": "greeting_normalization",
        }
    ]


def _prompt_leak_rule(text: str) -> str | None:
    normalized = _subtitle_match_text(text)
    if not normalized or len(normalized) > 220:
        return None
    if re.match(r"^контекст(?=$|[^\w])", normalized):
        return "asr_initial_prompt_context_leak"
    if re.match(r"^клиента\s+зовут(?=$|[^\w])", normalized):
        return "asr_initial_prompt_context_leak"
    if re.match(r"^длительность\s+\d+\s+сек", normalized):
        return "asr_initial_prompt_context_leak"
    return None


def _subtitle_outro_rule(text: str) -> str | None:
    normalized = _subtitle_match_text(text)
    if not normalized:
        return None
    if normalized in SUBTITLE_EXACT_RULES:
        return SUBTITLE_EXACT_RULES[normalized]
    if normalized.startswith("продолжение следует "):
        rest = normalized.replace("продолжение следует ", "", 1)
        if _subtitle_outro_rule(rest):
            return "subtitle_outro_chain"
    if len(normalized) > 180:
        return None
    if any(hint in normalized for hint in SUBTITLE_CONVERSATION_HINTS):
        return None
    for pattern, rule in SUBTITLE_PREFIX_RULES:
        if pattern.search(normalized):
            return rule
    return None


def _asr_gibberish_rule(text: str) -> str | None:
    normalized = _text(text) or ""
    if not normalized or len(normalized) > 120:
        return None
    without_allowed = ALLOWED_LATIN_TERMS.sub(" ", normalized)
    if re.search(r"[A-Za-z]", without_allowed) and re.search(r"[А-Яа-яЁё]", without_allowed):
        return "mixed_script_low_signal"
    tokens = [token for token in re.sub(r"[^\w\s]", " ", normalized).split() if token]
    if len(tokens) >= 4 and all(re.match(r"^[А-ЯЁ]{1,3}$", token) for token in tokens):
        return "spelled_syllable_noise"
    return None


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
        prompt_rule = _prompt_leak_rule(raw_text)
        if prompt_rule:
            corrections.append(
                {
                    **_correction_base(segment, segment_index),
                    "original": raw_text,
                    "normalized": "",
                    "reason": "asr_repeated_initial_prompt_context",
                    "rule": prompt_rule,
                    "type": "prompt_leak_drop",
                }
            )
            continue

        outro_rule = _subtitle_outro_rule(raw_text)
        if outro_rule:
            corrections.append(
                {
                    **_correction_base(segment, segment_index),
                    "original": raw_text,
                    "normalized": "",
                    "reason": "standalone_subtitle_outro_hallucination",
                    "rule": outro_rule,
                    "type": "subtitle_outro_drop",
                }
            )
            continue

        gibberish_rule = _asr_gibberish_rule(raw_text)
        if gibberish_rule:
            corrections.append(
                {
                    **_correction_base(segment, segment_index),
                    "original": raw_text,
                    "normalized": "",
                    "reason": "low_signal_asr_gibberish",
                    "rule": gibberish_rule,
                    "type": "asr_gibberish_drop",
                }
            )
            continue

        text, greeting_corrections = _normalize_admin_greeting(raw_text, segment, segment_index)
        corrections.extend(greeting_corrections)
        text, domain_corrections = _apply_domain_rules(text, segment, segment_index, glossary)
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
