import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from server.crm import CrmClient


REQUESTS = []


class MockCrmHandler(BaseHTTPRequestHandler):
    def log_message(self, _fmt, *_args):
        return

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _check_auth(self):
        return self.headers.get("Authorization") == "Bearer worker-secret"

    def do_GET(self):
        REQUESTS.append(("GET", self.path, self.headers.get("Authorization")))
        if not self._check_auth():
            self._json({"error": "Unauthorized worker"}, status=401)
            return
        if self.path == "/api/health":
            self._json({"status": "ok"})
            return
        if self.path == "/api/telephony/transcription-jobs/worker-queue?pageSize=80":
            self._json({"items": [], "totals": {"queued": 0, "processing": 0, "completedToday": 0, "failed": 0}})
            return
        self._json({"error": "not found"}, status=404)

    def do_POST(self):
        REQUESTS.append(("POST", self.path, self.headers.get("Authorization")))
        if not self._check_auth():
            self._json({"error": "Unauthorized worker"}, status=401)
            return
        if self.path == "/api/telephony/transcription-jobs/claim":
            self._json(
                {
                    "job": {
                        "id": 77,
                        "telephonyCallId": 123,
                        "call": {"id": 123, "recordingStatus": "available"},
                    }
                }
            )
            return
        if self.path == "/api/telephony/transcription-jobs/77/audio-reference":
            self._json({"audio": {"downloadUrl": "https://records.test/audio.wav?token=secret"}})
            return
        if self.path == "/api/telephony/transcription-jobs/77/progress":
            self._json({"job": {"id": 77, "status": "processing"}})
            return
        if self.path == "/api/telephony/transcription-jobs/77/result":
            self._json({"job": {"id": 77, "status": "completed"}})
            return
        if self.path == "/api/telephony/transcription-jobs/77/fail":
            self._json({"job": {"id": 77, "status": "failed"}})
            return
        if self.path == "/api/telephony/transcription-jobs/77/worker-retry":
            self._json(
                {
                    "job": {
                        "id": 77,
                        "status": "processing",
                        "call": {"id": 123, "recordingStatus": "available"},
                    }
                }
            )
            return
        self._json({"error": "not found"}, status=404)


class MockCrmTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), MockCrmHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_address[1]}/api"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        REQUESTS.clear()
        self.client = CrmClient(self.base_url, "worker-secret")

    def test_claim_audio_result_and_retry_use_worker_token(self):
        self.assertEqual(self.client.health()["status"], "ok")
        self.assertEqual(self.client.queue()["totals"]["queued"], 0)
        self.assertEqual(self.client.claim_job("test-worker")["job"]["id"], 77)
        self.assertIn("downloadUrl", self.client.audio_reference(77)["audio"])
        self.assertEqual(self.client.progress_job(77, "ffmpeg_preprocess", 25, "Preparing")["job"]["status"], "processing")
        self.assertEqual(self.client.complete_job(77, {"transcriptText": "ok"})["job"]["status"], "completed")
        self.assertEqual(self.client.retry_job(77, "test-worker")["job"]["status"], "processing")

        self.assertTrue(REQUESTS)
        self.assertTrue(all(auth == "Bearer worker-secret" for _method, _path, auth in REQUESTS))


if __name__ == "__main__":
    unittest.main()
