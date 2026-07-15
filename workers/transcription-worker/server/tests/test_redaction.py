import unittest

from server.redaction import redact_text, redact_value


class RedactionTest(unittest.TestCase):
    def test_redacts_worker_token_and_bearer_headers(self):
        redacted = redact_text(
            "CRM_WORKER_TOKEN=secret-token Authorization: Bearer secret-token",
            ["secret-token"],
        )

        self.assertNotIn("secret-token", redacted)
        self.assertIn("Bearer [redacted]", redacted)
        self.assertIn("CRM_WORKER_TOKEN=[redacted]", redacted)

    def test_redacts_sensitive_url_query_params(self):
        redacted = redact_text(
            "download https://records.test/audio.wav?token=abc&expires=42&signature=xyz",
            [],
        )

        self.assertIn("[redacted-url]", redacted)
        self.assertNotIn("records.test", redacted)
        self.assertNotIn("token=abc", redacted)

    def test_redacts_filesystem_paths_in_error_strings(self):
        redacted = redact_text("ffmpeg failed at /tmp/private-audio/input.wav", [])
        self.assertIn("[redacted-path]", redacted)
        self.assertNotIn("/tmp", redacted)

    def test_redacts_nested_token_values(self):
        redacted = redact_value(
            {
                "downloadUrl": "https://records.test/file?token=abc",
                "headers": {"Authorization": "Bearer abc"},
                "CRM_WORKER_TOKEN": "abc",
            },
            ["abc"],
        )

        self.assertEqual(redacted["CRM_WORKER_TOKEN"], "[redacted]")
        self.assertNotIn("abc", str(redacted))

    def test_redacts_phone_recording_url_and_transcript_fields(self):
        redacted = redact_value(
            {
                "phone": "+7 (999) 123-45-67",
                "recordingUrl": "https://records.test/file?token=abc",
                "rawTranscriptText": "private transcript",
            },
            [],
        )
        serialized = str(redacted)
        self.assertNotIn("999", serialized)
        self.assertNotIn("records.test", serialized)
        self.assertNotIn("private transcript", serialized)


if __name__ == "__main__":
    unittest.main()
