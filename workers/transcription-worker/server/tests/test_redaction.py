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

        self.assertIn("token=%5Bredacted%5D", redacted)
        self.assertIn("signature=%5Bredacted%5D", redacted)
        self.assertIn("expires=42", redacted)
        self.assertNotIn("token=abc", redacted)

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


if __name__ == "__main__":
    unittest.main()
