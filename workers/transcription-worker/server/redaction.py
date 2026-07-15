from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


SENSITIVE_QUERY_KEYS = {
    "access_token",
    "auth",
    "authorization",
    "download_token",
    "key",
    "password",
    "secret",
    "signature",
    "sig",
    "token",
}


def redact_url(value: str) -> str:
    try:
        parts = urlsplit(value)
    except ValueError:
        return value
    if not parts.scheme or not parts.netloc:
        return value

    safe_query = []
    for key, val in parse_qsl(parts.query, keep_blank_values=True):
        if key.lower() in SENSITIVE_QUERY_KEYS:
            safe_query.append((key, "[redacted]"))
        else:
            safe_query.append((key, val))

    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(safe_query), parts.fragment))


def redact_text(value: object, secrets: list[str] | None = None) -> str:
    text = str(value)
    for secret in secrets or []:
        if secret:
            text = text.replace(secret, "[redacted]")

    text = re.sub(r"Bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", text, flags=re.I)
    text = re.sub(
        r"(CRM_WORKER_TOKEN|TELEPHONY_TRANSCRIPTION_WORKER_TOKEN|TRANSCRIPTION_WORKER_TOKEN)=\S+",
        r"\1=[redacted]",
        text,
        flags=re.I,
    )
    text = re.sub(r"(?<!\w)(?:\+?7|8)[\s()\-]*\d(?:[\s()\-]*\d){9}(?!\d)", "[redacted-phone]", text)
    text = re.sub(
        r"https?://[^\s'\"<>]+",
        "[redacted-url]",
        text,
    )
    text = re.sub(r"(?<![A-Za-z0-9._-])/(?:[^\s'\"<>/]+/)*[^\s'\"<>/]+", "[redacted-path]", text)
    text = re.sub(r"\b[A-Za-z]:\\(?:[^\s'\"<>\\]+\\)*[^\s'\"<>\\]+", "[redacted-path]", text)
    return text


def redact_value(value: object, secrets: list[str] | None = None) -> object:
    if isinstance(value, dict):
        redacted = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in SENSITIVE_QUERY_KEYS or "token" in lowered or "secret" in lowered:
                redacted[key] = "[redacted]" if item else item
            elif "url" in lowered and isinstance(item, str):
                redacted[key] = "[redacted-url]"
            elif "path" in lowered and isinstance(item, str):
                redacted[key] = "[redacted-path]"
            elif any(marker in lowered for marker in ("rawaudio", "rawtranscript", "transcripttext")):
                redacted[key] = "[redacted-content]" if item else item
            else:
                redacted[key] = redact_value(item, secrets)
        return redacted
    if isinstance(value, list):
        return [redact_value(item, secrets) for item in value]
    if isinstance(value, str):
        return redact_text(value, secrets)
    return value
