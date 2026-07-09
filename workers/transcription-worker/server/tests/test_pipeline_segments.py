import unittest
from types import SimpleNamespace

from server.pipeline import build_speech_intervals, build_transcript, merge_adjacent_short_segments


def config(**overrides):
    defaults = {
        "asr_backend": "whisper_cpp",
        "channel_admin": "left",
        "channel_client": "right",
        "whisper_language": "ru",
        "whisper_model": "small",
        "whisper_threads": 4,
        "worker_id": "test-worker",
        "domain_glossary": {},
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class PipelineSegmentsTest(unittest.TestCase):
    def test_merges_stereo_channels_by_timestamp_and_keeps_channel(self):
        result = build_transcript(
            [
                {
                    "channel": "left",
                    "segments": [
                        {"startMs": 5000, "endMs": 6200, "text": "Подберу время."},
                        {"startMs": 1000, "endMs": 2200, "text": "Добрый день."},
                    ],
                },
                {
                    "channel": "right",
                    "segments": [
                        {"startMs": 2600, "endMs": 4300, "text": "Хочу записаться."},
                    ],
                },
            ],
            {"codec": "mp3", "channels": 2, "durationSeconds": 8, "channelLayout": "stereo"},
            config(),
            {},
        )

        self.assertEqual([segment["speaker"] for segment in result["segments"]], [
            "administrator",
            "client",
            "administrator",
        ])
        self.assertEqual([segment["channel"] for segment in result["segments"]], [
            "left",
            "right",
            "left",
        ])
        self.assertEqual([segment["startMs"] for segment in result["segments"]], [1000, 2600, 5000])

    def test_zero_ms_segments_stay_at_beginning_of_segments_and_text(self):
        result = build_transcript(
            [
                {
                    "channel": "left",
                    "segments": [
                        {"startMs": 4000, "endMs": 5200, "text": "Подберу время."},
                        {"startMs": 0, "endMs": 1500, "text": "Добрый день."},
                    ],
                },
                {
                    "channel": "right",
                    "segments": [
                        {"startMs": 0, "endMs": 1700, "text": "Здравствуйте."},
                    ],
                },
            ],
            {"codec": "mp3", "channels": 2, "durationSeconds": 6, "channelLayout": "stereo"},
            config(),
            {},
        )

        self.assertEqual([segment["startMs"] for segment in result["segments"]], [0, 0, 4000])
        transcript_lines = result["transcriptText"].splitlines()
        self.assertTrue(transcript_lines[0].startswith("[00:00] Администратор:"))
        self.assertTrue(transcript_lines[1].startswith("[00:00] Клиент:"))

    def test_short_neighbor_merge_does_not_cross_speakers_or_channels(self):
        merged = merge_adjacent_short_segments([
            {"speaker": "administrator", "channel": "left", "startMs": 1000, "endMs": 1600, "text": "Да,"},
            {"speaker": "administrator", "channel": "left", "startMs": 1800, "endMs": 2500, "text": "слушаю вас."},
            {"speaker": "client", "channel": "right", "startMs": 2600, "endMs": 3500, "text": "Здравствуйте."},
        ])

        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["text"], "Да, слушаю вас.")
        self.assertEqual(merged[1]["speaker"], "client")

    def test_long_admin_segment_splits_by_word_pause_around_client_question(self):
        result = build_transcript(
            [
                {
                    "channel": "left",
                    "segments": [
                        {
                            "startMs": 0,
                            "endMs": 9000,
                            "text": "Добрый день, Парк, слушаю вас. Да, подберу свободное время после вопроса.",
                            "words": [
                                {"startMs": 0, "endMs": 300, "text": "Добрый"},
                                {"startMs": 320, "endMs": 700, "text": "день,"},
                                {"startMs": 760, "endMs": 1150, "text": "Парк,"},
                                {"startMs": 1180, "endMs": 1600, "text": "слушаю"},
                                {"startMs": 1650, "endMs": 2050, "text": "вас."},
                                {"startMs": 6200, "endMs": 6550, "text": "Да,"},
                                {"startMs": 6600, "endMs": 7050, "text": "подберу"},
                                {"startMs": 7100, "endMs": 7600, "text": "свободное"},
                                {"startMs": 7650, "endMs": 8200, "text": "время"},
                                {"startMs": 8250, "endMs": 9000, "text": "после вопроса."},
                            ],
                        }
                    ],
                },
                {
                    "channel": "right",
                    "segments": [
                        {"startMs": 3600, "endMs": 5600, "text": "Здравствуйте, есть корт на вечер?"},
                    ],
                },
            ],
            {"codec": "mp3", "channels": 2, "durationSeconds": 10, "channelLayout": "stereo"},
            config(
                domain_glossary={
                    "aliases": [],
                }
            ),
            {},
        )

        self.assertEqual([segment["speaker"] for segment in result["segments"]], [
            "administrator",
            "client",
            "administrator",
        ])
        self.assertEqual([segment["startMs"] for segment in result["segments"]], [0, 3600, 6200])
        self.assertIn("Падел Парк", result["transcriptText"])
        self.assertEqual(result["metadata"]["segmentation"]["splitSegments"], 1)
        self.assertEqual(len(result["rawAsrJson"]["channels"][0]["parsedSegments"][0]["words"]), 10)

    def test_builds_speech_intervals_around_long_silence(self):
        intervals = build_speech_intervals(
            [
                {"type": "start", "at": 2.0},
                {"type": "end", "at": 12.0},
            ],
            16.0,
            config(chunk_padding_ms=250, chunk_min_speech_seconds=0.45),
        )

        self.assertEqual(intervals, [
            {"start": 0.0, "end": 2.25},
            {"start": 11.75, "end": 16.0},
        ])

    def test_build_transcript_keeps_raw_and_domain_corrections(self):
        result = build_transcript(
            [
                {
                    "channel": "right",
                    "segments": [
                        {"startMs": 1000, "endMs": 3000, "text": "Хочу подал теннис."},
                        {"startMs": 5000, "endMs": 6000, "text": "Угу. Угу. Угу."},
                        {"startMs": 7000, "endMs": 7500, "text": "Угу."},
                    ],
                }
            ],
            {"codec": "mp3", "channels": 1, "durationSeconds": 8, "channelLayout": "mono"},
            config(
                channel_admin="left",
                channel_client="right",
                domain_glossary={
                    "aliases": [
                        {
                            "aliases": ["подал теннис"],
                            "canonical": "падел-теннис",
                            "rule": "padel_tennis_alias",
                            "contextAny": [],
                        }
                    ]
                },
            ),
            {},
        )

        self.assertIn("подал теннис", result["rawTranscriptText"])
        self.assertIn("падел-теннис", result["transcriptText"])
        self.assertEqual(len(result["segments"]), 2)
        self.assertEqual(
            [correction["type"] for correction in result["corrections"]],
            ["domain_term", "filler_collapse", "filler_drop"],
        )

    def test_build_transcript_drops_prompt_and_outro_hallucinations(self):
        result = build_transcript(
            [
                {
                    "channel": "left",
                    "segments": [
                        {"startMs": 1000, "endMs": 2500, "text": "Добрый вечер, Парк, слушаю вас."},
                        {"startMs": 7000, "endMs": 7800, "text": "Продолжение следует."},
                    ],
                },
                {
                    "channel": "right",
                    "segments": [
                        {"startMs": 3000, "endMs": 4200, "text": "Контекст: звонок клиента в клуб."},
                        {"startMs": 5000, "endMs": 6100, "text": "Субтитры создавал DimaTorzok"},
                    ],
                },
            ],
            {"codec": "mp3", "channels": 2, "durationSeconds": 8, "channelLayout": "stereo"},
            config(),
            {},
        )

        self.assertIn("Контекст", result["rawTranscriptText"])
        self.assertNotIn("Контекст", result["transcriptText"])
        self.assertNotIn("Продолжение следует", result["transcriptText"])
        self.assertNotIn("Субтитры", result["transcriptText"])
        self.assertIn("Падел Парк", result["transcriptText"])
        self.assertEqual(
            [correction["type"] for correction in result["corrections"]],
            ["greeting_normalization", "prompt_leak_drop", "subtitle_outro_drop", "subtitle_outro_drop"],
        )


if __name__ == "__main__":
    unittest.main()
