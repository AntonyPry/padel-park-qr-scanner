from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from .config import load_quality_config, read_config
from .pipeline import build_transcript, ensure_model, prepare_audio, probe_audio, transcribe_channel


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python -m server.sample /path/to/audio.wav")

    env = dict(os.environ)
    env.setdefault("CRM_API_URL", "sample")
    env.setdefault("CRM_WORKER_TOKEN", "sample")
    config = load_quality_config(read_config(env))
    source = Path(sys.argv[1])
    temp_dir = Path(tempfile.mkdtemp(prefix="crm-transcription-sample-", dir=config.temp_root))

    def emit(stage, message=None, details=None):
        print(json.dumps({"stage": stage, "message": message, "details": details or {}}, ensure_ascii=False))

    try:
        probe = probe_audio(source, config)
        prepared = prepare_audio(source, temp_dir, probe, config)
        if config.asr_backend == "whisper_cpp":
            ensure_model(config, emit)
        channel_results = []
        for channel in prepared["channels"]:
            channel_results.append(transcribe_channel(channel, probe, temp_dir, config))
        result = build_transcript(
            channel_results,
            probe,
            config,
            {
                "glossary": {
                    "aliases": len((config.domain_glossary or {}).get("aliases") or []),
                    "canonicalTerms": len((config.domain_glossary or {}).get("canonicalTerms") or []),
                    "initialPrompt": config.asr_initial_prompt,
                },
                "preparedAudioMode": prepared["mode"],
                "sampleAudioPath": str(source),
            },
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        if config.delete_audio_after:
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
