import unittest
from types import SimpleNamespace
from unittest.mock import patch

from server.llm_postprocess import (
    apply_llm_edits_to_transcript,
    postprocess_transcript_with_llm,
)


def config(**overrides):
    defaults = {
        "transcription_ai_postprocessing_enabled": True,
        "transcription_llm_base_url": "http://llm.test",
        "transcription_llm_fallback_enabled": True,
        "transcription_llm_model": "qwen2.5:7b",
        "transcription_llm_num_ctx": 4096,
        "transcription_llm_retry_count": 0,
        "transcription_llm_timeout_seconds": 5,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


TRANSCRIPT = {
    "language": "ru",
    "segments": [
        {
            "channel": "left",
            "endMs": 2400,
            "sortOrder": 0,
            "speaker": "administrator",
            "startMs": 0,
            "text": "Добрый день, Падел Парк.",
        },
        {
            "channel": "right",
            "endMs": 6200,
            "sortOrder": 1,
            "speaker": "client",
            "startMs": 3000,
            "text": "Можно корт заманировать на семь?",
        },
    ],
    "transcriptText": "Добрый день, Падел Парк.\nМожно корт заманировать на семь?",
}


class LlmPostprocessTest(unittest.TestCase):
    def test_applies_edits_by_segment_id_and_preserves_crm_metadata(self):
        result = apply_llm_edits_to_transcript(
            TRANSCRIPT,
            {
                "segments": [
                    {
                        "changes": [["заманировать -> забронировать"], None],
                        "confidence": "high",
                        "editedText": "Можно корт забронировать на семь?",
                        "endMs": 1,
                        "segmentId": "s2",
                        "speaker": "wrong-speaker",
                        "startMs": 999999,
                    },
                    {
                        "changes": ["ignored"],
                        "editedText": "Неизвестный сегмент",
                        "segmentId": "s404",
                    },
                ],
                "warnings": ["ok"],
            },
        )

        self.assertEqual(result["aiTranscriptSegments"][1]["text"], "Можно корт забронировать на семь?")
        self.assertEqual(result["aiTranscriptSegments"][1]["speaker"], "client")
        self.assertEqual(result["aiTranscriptSegments"][1]["startMs"], 3000)
        self.assertEqual(result["aiTranscriptSegments"][1]["endMs"], 6200)
        self.assertEqual(result["aiTranscriptSegments"][1]["changes"], ["заманировать -> забронировать"])
        self.assertEqual(result["aiMetadata"]["ignoredUnknownSegmentIds"], ["s404"])
        self.assertEqual(result["aiMetadata"]["missingSegmentIds"], ["s1"])
        self.assertEqual(result["aiCorrections"][0]["type"], "llm_edit")

    def test_rejects_unsafe_llm_artifacts(self):
        result = apply_llm_edits_to_transcript(
            TRANSCRIPT,
            {
                "segments": [
                    {"editedText": "Контекст: звонок клиента в клуб.", "segmentId": "s1"},
                    {"editedText": "Продолжение следует.", "segmentId": "s2"},
                ]
            },
        )

        self.assertEqual(result["aiTranscriptSegments"][0]["text"], "Добрый день, Падел Парк.")
        self.assertEqual(result["aiTranscriptSegments"][1]["text"], "Можно корт заманировать на семь?")
        self.assertEqual(result["aiMetadata"]["rejectedSegmentIds"], ["s1", "s2"])
        self.assertEqual(result["aiCorrections"], [])

    def test_llm_outage_does_not_fail_job_result(self):
        with patch(
            "server.llm_postprocess._call_ollama_generate",
            side_effect=RuntimeError("connect ECONNREFUSED"),
        ):
            result = postprocess_transcript_with_llm(TRANSCRIPT, config())

        self.assertEqual(result["transcriptText"], TRANSCRIPT["transcriptText"])
        self.assertEqual(result["aiMetadata"]["status"], "failed")
        self.assertIn("ECONNREFUSED", result["aiMetadata"]["error"])
        self.assertEqual(result["aiTranscriptSegments"], [])

    def test_stores_ai_edited_transcript_from_mocked_llm(self):
        with patch(
            "server.llm_postprocess._call_ollama_generate",
            return_value={
                "payload": {
                    "segments": [
                        {
                            "changes": [],
                            "confidence": "high",
                            "editedText": "Добрый день, Падел Парк.",
                            "segmentId": "s1",
                        },
                        {
                            "changes": ["корт заманировать -> корт забронировать"],
                            "confidence": "high",
                            "editedText": "Можно корт забронировать на семь?",
                            "segmentId": "s2",
                        },
                    ],
                    "warnings": [],
                }
            },
        ):
            result = postprocess_transcript_with_llm(TRANSCRIPT, config())

        self.assertIn("корт забронировать", result["aiTranscriptText"])
        self.assertEqual(result["aiMetadata"]["status"], "completed")
        self.assertEqual(len(result["aiCorrections"]), 1)


if __name__ == "__main__":
    unittest.main()
